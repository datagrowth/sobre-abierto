// Bloque «Antecedentes» del detalle: ediciones anteriores de la licitación (del contrato o
// de cada lote) con quién ganó, importe, baja, ofertas, duración y fechas, y los indicios
// de «licitación con nombre» con su explicación, su dato y el nivel. Todo lo calcula el
// servidor con datos de la PLACSP y la ficha; aquí solo se pinta.
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, OK_TEXTO, RIESGO, IMPIDE, alpha } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { euros, urlEnlazable } from '../../lib/formato';
import { porcentaje } from '../../lib/preciosFormato';
import {
  NIVELES,
  agruparPorEdicion,
  etiquetaNivel,
  motivoSinEdiciones,
  nivelVisible,
  repartirDelOrgano,
  textoDuracion,
  textoParecido,
  textoPeriodo,
  tituloOtroObjeto,
  vistaElegida,
  vistasAntecedentes,
} from '../../lib/antecedentesFormato';
import { Aviso, Chip } from '../ui';
import { Bloque, Pildora } from '../comun/ui';
import { Celda, Enlace, Subtitulo, Tabla } from '../comun/listas';

const COLOR_NIVEL = { bajo: OK_TEXTO, medio: RIESGO, alto: IMPIDE };
const TONO_NIVEL = { bajo: 'ok', medio: 'riesgo', alto: 'impide' };

// Sin datos: color neutro y sin puntos, para que no se lea como una buena señal.
function Nivel({ indicios, nivel }) {
  const color = COLOR_NIVEL[nivel] ?? TINTA_2;
  const puntos = nivel === 'sin_datos' ? '' : ` · ${indicios.puntos} ${indicios.puntos === 1 ? 'punto' : 'puntos'}`;
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: 10,
        background: alpha(color, 0.1),
        border: `1px solid ${alpha(color, 0.35)}`,
      }}
    >
      <Chip tono={TONO_NIVEL[nivel]} punto={false}>
        Indicios: {etiquetaNivel(nivel)}
      </Chip>
      <span style={{ fontSize: 12.5, color: TINTA }}>
        {NIVELES[nivel]?.texto}
        {puntos}
      </span>
    </div>
  );
}

function Indicios({ indicios }) {
  if (!indicios.indicios.length)
    return (
      <div style={{ fontSize: 12.5, color: TINTA_2, marginTop: 8 }}>Ningún indicio con los datos disponibles.</div>
    );
  return (
    <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
      {indicios.indicios.map((i, n) => (
        <li
          key={`${i.codigo}-${n}`}
          style={{ padding: '7px 0', borderTop: `1px solid ${BORDE}`, fontSize: 12.5, lineHeight: 1.45 }}
        >
          <div
            style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: TINTA, fontWeight: 600 }}
          >
            {i.titulo}
            <Chip>+{i.peso}</Chip>
            {i.origen === 'pliego' && (
              <Chip tono="riesgo" punto={false}>
                pliego (ficha)
              </Chip>
            )}
          </div>
          <div style={{ color: TINTA }}>{i.dato}</div>
          <div style={{ color: TINTA_2, fontSize: 12 }}>{i.explicacion}</div>
        </li>
      ))}
    </ul>
  );
}

function FilaHito({ h, grupo, primera, onVerCompetidor }) {
  const ganador = h.adjudicatario_nombre ? (
    <Enlace
      onClick={onVerCompetidor && h.adjudicatario_nif ? () => onVerCompetidor(h.adjudicatario_nif) : undefined}
      title="Ver la ficha del competidor"
    >
      {h.adjudicatario_nombre}
    </Enlace>
  ) : (
    <span style={{ color: TINTA_2 }}>{h.resultado ?? 'sin adjudicar'}</span>
  );
  return (
    <tr style={{ borderTop: `1px solid ${primera ? BORDE : 'transparent'}` }}>
      <Celda>{primera ? grupo.anio : ''}</Celda>
      <Celda largo>
        {primera && (
          <span title={grupo.titulo}>
            {grupo.expediente || grupo.titulo.slice(0, 60)}{' '}
            {urlEnlazable(grupo.url) && (
              <a
                href={urlEnlazable(grupo.url)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir ${grupo.expediente} en la PLACSP`}
                style={{ color: TINTA_2 }}
              >
                <ExternalLink size={12} />
              </a>
            )}
          </span>
        )}
      </Celda>
      <Celda largo>{h.lote ? `${h.lote}${h.lote_nombre ? ` · ${h.lote_nombre.slice(0, 40)}` : ''}` : '—'}</Celda>
      <Celda largo>
        {ganador}
        {h.adjudicatario_nif && <span style={{ color: TINTA_2 }}> {h.adjudicatario_nif}</span>}
      </Celda>
      <Celda d>{euros(h.importe)}</Celda>
      <Celda d>{porcentaje(h.baja)}</Celda>
      <Celda d>{h.ofertas ?? '—'}</Celda>
      <Celda>{textoDuracion(h.duracion)}</Celda>
      <Celda>{textoPeriodo(h)}</Celda>
      <Celda d>{primera ? textoParecido(grupo.similitud) : ''}</Celda>
    </tr>
  );
}

const CABECERA = [
  ['Año'],
  ['Expediente'],
  ['Lote'],
  ['Adjudicatario'],
  ['Importe', 'd'],
  ['Baja', 'd'],
  ['Ofertas', 'd'],
  ['Duración'],
  ['Inicio – fin'],
  ['Parecido', 'd'],
];

function Linea({ ediciones, motivo, onVerCompetidor }) {
  if (!ediciones.length)
    return (
      <div data-testid="antecedentes-sin-ediciones" style={{ fontSize: 12.5, color: TINTA_2 }}>
        {motivo}
      </div>
    );
  return (
    <Tabla cabecera={CABECERA}>
      {agruparPorEdicion(ediciones).flatMap((g) =>
        g.filas.map((h, i) => (
          <FilaHito
            key={`${g.licitacion_id}-${h.lote ?? ''}-${i}`}
            h={h}
            grupo={g}
            primera={i === 0}
            onVerCompetidor={onVerCompetidor}
          />
        )),
      )}
    </Tabla>
  );
}

const CABECERA_OTRO = [['Fecha'], ['Objeto'], ['Adjudicatario'], ['Importe', 'd'], ['Baja', 'd']];

// Adjudicaciones del mismo órgano sin objeto parecido: dicen qué más contrata el órgano, no
// quién ganó antes esta licitación; plegadas para que no se lean como ediciones.
function OtroObjeto({ estado }) {
  if (estado.kind === 'error')
    return (
      <div style={{ fontSize: 12, color: TINTA_2, marginTop: 6 }}>
        No se pudieron leer las adjudicaciones del órgano: {estado.message}
      </div>
    );
  const otras = estado.kind === 'ready' ? estado.reparto.otro_objeto : [];
  if (!otras.length) return null;
  return (
    <details data-testid="antecedentes-otro-objeto" style={{ marginTop: 10, fontSize: 12, color: TINTA_2 }}>
      <summary style={{ cursor: 'pointer' }}>{tituloOtroObjeto(otras.length)}</summary>
      <Tabla cabecera={CABECERA_OTRO}>
        {otras.map((c) => (
          <tr key={`${c.licitacion_id}-${c.lote}`} style={{ borderTop: `1px solid ${BORDE}` }}>
            <Celda>{c.fecha?.slice(0, 10) ?? '—'}</Celda>
            <Celda largo>{c.titulo}</Celda>
            <Celda largo>{c.adjudicatario_nombre ?? '—'}</Celda>
            <Celda d>{euros(c.importe)}</Celda>
            <Celda d>{porcentaje(c.baja)}</Celda>
          </tr>
        ))}
      </Tabla>
    </details>
  );
}

function Explicaciones({ datos, sinDatos }) {
  return (
    <details style={{ marginTop: 10, fontSize: 12, color: TINTA_2, lineHeight: 1.5 }}>
      <summary style={{ cursor: 'pointer' }}>Cómo se buscan las ediciones y cómo se calcula el nivel</summary>
      <p style={{ margin: '6px 0' }}>
        Mismo órgano: {datos.licitacion.organo_por ?? 'la licitación no trae NIF, DIR3 ni nombre reconocible'}.{' '}
        {datos.como_se_buscan}
      </p>
      <p style={{ margin: '6px 0' }}>{datos.reglas}</p>
      {sinDatos.length > 0 && (
        <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
          {sinDatos.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function useAntecedentes(id, version) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    licitacionesApi.antecedentes(id).then(
      (datos) => vivo && setEstado({ kind: 'ready', datos }),
      (e) => vivo && setEstado({ kind: 'error', message: e.message }),
    );
    return () => {
      vivo = false;
    };
  }, [id, version]);
  return estado;
}

// Las mismas adjudicaciones que Precios enseña con «Solo este órgano», para no contradecirla.
function useDelOrgano(id, lote, version) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    licitacionesApi.comparables(id, { limite: 50, mismoOrgano: true, lote }).then(
      (filas) => vivo && setEstado({ kind: 'ready', reparto: repartirDelOrgano(filas) }),
      (e) => vivo && setEstado({ kind: 'error', message: e.message }),
    );
    return () => {
      vivo = false;
    };
  }, [id, lote, version]);
  return estado;
}

const loteDeVista = (vista) => (vista.startsWith('lote-') ? vista.slice(5) : null);

// «version» sube con los eventos licitacion*: una ficha nueva puede traer señales del pliego.
export default function AntecedentesLicitacion({ id, version, onVerCompetidor }) {
  const estado = useAntecedentes(id, version);
  const [vista, setVista] = useState('contrato');
  const delOrgano = useDelOrgano(id, loteDeVista(vista), version);
  if (estado.kind === 'loading')
    return (
      <Bloque titulo="ANTECEDENTES">
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>Buscando ediciones anteriores…</div>
      </Bloque>
    );
  if (estado.kind === 'error')
    return (
      <Bloque titulo="ANTECEDENTES">
        <Aviso tono="error">{estado.message}</Aviso>
      </Bloque>
    );
  const { datos } = estado;
  const vistas = vistasAntecedentes(datos);
  const elegida = vistaElegida(datos, vista);
  return (
    <Bloque titulo="ANTECEDENTES (EDICIONES ANTERIORES E INDICIOS)">
      {vistas.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {vistas.map((v) => (
            <Pildora
              key={v.clave}
              label={`${v.etiqueta} · ${etiquetaNivel(v.nivel)}`}
              activa={vista === v.clave}
              cuenta={v.n}
              onClick={() => setVista(v.clave)}
            />
          ))}
        </div>
      )}
      <Nivel indicios={elegida.indicios} nivel={nivelVisible(elegida.indicios, elegida.ediciones)} />
      <Indicios indicios={elegida.indicios} />
      <Subtitulo>{elegida.titulo}: ediciones anteriores</Subtitulo>
      <Linea
        ediciones={elegida.ediciones}
        motivo={motivoSinEdiciones(datos, delOrgano.kind === 'ready' ? delOrgano.reparto : null)}
        onVerCompetidor={onVerCompetidor}
      />
      <OtroObjeto estado={delOrgano} />
      {datos.lotes_sin_mirar > 0 && (
        <div style={{ fontSize: 12, color: TINTA_2, marginTop: 6 }}>
          {datos.lotes_sin_mirar} lotes más sin mirar (se miran los 30 primeros).
        </div>
      )}
      <Explicaciones datos={datos} sinDatos={elegida.indicios.sin_datos} />
      <div style={{ fontSize: 11, color: TINTA_2, marginTop: 8, lineHeight: 1.5 }}>{datos.nota}</div>
    </Bloque>
  );
}
