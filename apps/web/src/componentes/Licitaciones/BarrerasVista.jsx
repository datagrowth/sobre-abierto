// «Qué nos falta»: certificaciones, seguro, clasificación y habilitaciones que piden las
// licitaciones que seguimos, cuántas veces no lo tenemos y cuántas nos deja fuera. Para
// decidir qué sacar: lo calcula el servidor con los requisitos de la PLACSP y las fichas.
// Aparte, la experiencia del personal: no se saca con un papel sino con quién fichamos.
import { useEffect, useState } from 'react';
import { TINTA, TINTA_2, BORDE, LIENZO, RADIUS_PANEL, IMPIDE, RIESGO, OK_TEXTO } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { euros, plural } from '../../lib/formato';
import { etiquetaEstado } from '../../lib/licitacionesFormato';
import {
  FILTROS_BARRERAS,
  TIPOS_BARRERA,
  filtrarBarreras,
  textoBarrera,
  textoNiveles,
  textoPersonal,
} from '../../lib/barrerasFormato';
import usePersistente from '../../hooks/usePersistente';
import { Aviso, Chip } from '../ui';
import { Desplazable, Pildora } from '../comun/ui';
import { Enlace, Periodo } from '../comun/listas';

const COLOR_RESULTADO = { no_cumple: IMPIDE, desconocido: RIESGO, cumple: OK_TEXTO };
const TEXTO_RESULTADO = { no_cumple: 'no lo tenemos', desconocido: 'por confirmar', cumple: 'lo tenemos' };

function Barrera({ b, onVerOportunidad }) {
  return (
    <li style={{ background: LIENZO, border: `1px solid ${BORDE}`, borderRadius: RADIUS_PANEL, padding: '10px 14px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: TINTA }}>{b.nombre}</span>
        <Chip>{TIPOS_BARRERA[b.tipo] ?? b.tipo}</Chip>
        {b.nos_dejan_fuera > 0 && (
          <Chip tono="impide" punto={false}>
            nos deja fuera en {b.nos_dejan_fuera}
          </Chip>
        )}
      </div>
      <div className="tabular-nums" style={{ fontSize: 12.5, color: TINTA_2, marginTop: 4 }}>
        {textoBarrera(b)}
      </div>
      {textoNiveles(b.niveles) && (
        <div style={{ fontSize: 12.5, color: TINTA, marginTop: 2 }}>Categoría que piden: {textoNiveles(b.niveles)}</div>
      )}
      {b.exigidos.length > 0 && (
        <div style={{ fontSize: 12, color: TINTA_2, marginTop: 2 }}>Piden: {b.exigidos.join(' · ')}</div>
      )}
      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 12, color: TINTA_2, cursor: 'pointer' }}>
          Ver {plural(b.ejemplos.length, 'licitación', 'licitaciones')}
        </summary>
        <ul
          style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          {b.ejemplos.map((e) => (
            <li key={e.id} style={{ fontSize: 12.5, color: TINTA, lineHeight: 1.4 }}>
              <Enlace onClick={() => onVerOportunidad(e.id)} title="Abrir la oportunidad">
                {e.titulo}
              </Enlace>
              <span style={{ color: TINTA_2 }}>
                {' '}
                · {euros(e.importe)} · {etiquetaEstado(e.estado)} ·{' '}
              </span>
              <span style={{ color: COLOR_RESULTADO[e.resultado] }}>{TEXTO_RESULTADO[e.resultado]}</span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function Personal({ lista, onVerOportunidad }) {
  return (
    <section data-testid="barreras-personal" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: '6px 0 0', fontSize: 14, color: TINTA }}>Experiencia del personal</h3>
      <div style={{ fontSize: 12, color: TINTA_2 }}>
        La materia que piden al equipo y nadie acredita, y cuántas veces nos dejó fuera (también los descartes por
        solvencia del personal).
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lista.map((p) => (
          <li
            key={p.clave}
            data-testid={`barrera-personal-${p.clave}`}
            style={{
              background: LIENZO,
              border: `1px solid ${BORDE}`,
              borderRadius: RADIUS_PANEL,
              padding: '8px 14px',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="tabular-nums" style={{ fontSize: 13, color: TINTA }}>
                {textoPersonal(p)}
              </span>
              {p.nos_dejan_fuera > 0 && (
                <Chip tono="impide" punto={false}>
                  fuera {plural(p.nos_dejan_fuera, 'vez', 'veces')}
                </Chip>
              )}
            </div>
            <div style={{ fontSize: 12, color: TINTA_2, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {p.ejemplos.map((e) => (
                <Enlace key={e.id} onClick={() => onVerOportunidad(e.id)} title="Abrir la oportunidad">
                  {e.titulo}
                </Enlace>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function BarrerasVista({ version, onVerOportunidad }) {
  const [meses, setMeses] = useState(12);
  const [filtro, setFiltro] = usePersistente('licitaciones.barreras.filtro', FILTROS_BARRERAS[0].key);
  const [estado, setEstado] = useState({ kind: 'loading' });
  // Al cambiar de periodo, la respuesta del anterior que llegue tarde no cuenta.
  useEffect(() => {
    let vivo = true;
    licitacionesApi.barreras({ meses }).then(
      (r) => vivo && setEstado({ kind: 'ready', ...r }),
      (e) => vivo && setEstado({ kind: 'error', message: e.message }),
    );
    return () => {
      vivo = false;
    };
  }, [meses, version]);

  const lista = estado.kind === 'ready' ? filtrarBarreras(estado.barreras, filtro) : [];
  return (
    <Desplazable>
      <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Aviso>
          Lo que piden las licitaciones que seguimos y se acredita con un papel: <b>certificaciones</b>, <b>seguro</b>,{' '}
          <b>clasificación</b> y <b>habilitaciones</b>. Sale de los requisitos de la PLACSP y de las fichas de Hermes.
          Lo primero es lo que más nos deja fuera: es lo que más contratos abriría.
        </Aviso>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Periodo meses={meses} onCambio={setMeses} />
          <span style={{ width: 8 }} />
          {FILTROS_BARRERAS.map((f) => (
            <Pildora key={f.key} label={f.label} activa={filtro === f.key} onClick={() => setFiltro(f.key)} />
          ))}
        </div>
        {estado.kind === 'loading' && <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>}
        {estado.kind === 'error' && <Aviso tono="error">{estado.message}</Aviso>}
        {estado.kind === 'ready' && (
          <div style={{ fontSize: 12, color: TINTA_2 }}>
            {plural(estado.oportunidades, 'oportunidad revisada', 'oportunidades revisadas')} (
            {estado.meses ? `últimos ${estado.meses} meses` : 'todas'}, sin las sin cribar).
          </div>
        )}
        {estado.kind === 'ready' && lista.length === 0 && (
          <div style={{ fontSize: 13, color: TINTA_2 }}>
            {filtro === 'todo'
              ? 'Ninguna pide certificaciones, seguro, clasificación ni habilitaciones.'
              : 'Nada con este filtro: prueba con uno más amplio.'}{' '}
            Las fichas de Hermes traen el detalle de cada pliego: cuantas más fichas, más completo.
          </div>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map((b) => (
            <Barrera key={b.clave} b={b} onVerOportunidad={onVerOportunidad} />
          ))}
        </ul>
        {estado.kind === 'ready' && estado.personal?.length > 0 && (
          <Personal lista={estado.personal} onVerOportunidad={onVerOportunidad} />
        )}
      </div>
    </Desplazable>
  );
}
