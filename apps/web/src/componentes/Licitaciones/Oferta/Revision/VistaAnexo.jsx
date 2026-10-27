// Tarjeta «anexo» de la bandeja de revisión: el borrador en una columna legible con cada
// valor que puso Hermes resaltado (y el dato del que sale en el title), lo cambiado frente a la
// versión anterior con borde de aviso, y los avisos arriba. Se acepta sin abrir el Word.
// Aquí viven también las piezas de la fila del documento: la vista previa del PDF del
// borrador, el enlace al modelo original y la tarjeta de un anexo que se rellena a mano.
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ACCION_SUAVE, BORDE, TINTA_2, TINTA, TIPO, RIESGO } from '../../../../lib/tema';
import { anexoApi } from '../../../../lib/revisionApi';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { enlaceDocumento } from '../../../../lib/propuestasFormato';
import {
  estadoAnexo,
  textoTipoBorrador,
  textoValoresAnexo,
  valoresDelAnexo,
  vistaPreviaAnexo,
} from '../../../../lib/documentosOfertaFormato';
import { claveDocumento, tituloValor, trozos } from '../../../../lib/vistaAnexoFormato';
import useCarga from '../../../../hooks/useCarga';
import { Aviso, Boton } from '../../../ui';

const ENLACE = { fontSize: TIPO.texto, color: TINTA, overflowWrap: 'anywhere' };

/** «Abrir el modelo original» (en su página): ninguna fila con modelo se queda sin enlace a él. */
export function ModeloOriginal({ modelo, texto = 'Abrir el modelo original' }) {
  if (!modelo?.url) return null;
  return (
    <a data-testid="abrir-modelo" href={modelo.url} target="_blank" rel="noreferrer" style={ENLACE}>
      {texto}
    </a>
  );
}

// Un PDF grande pesa en el móvil: el iframe se monta solo al desplegar la vista previa.
function MarcoPdf({ ruta, nombre }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <details data-testid="vista-previa" onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary data-testid="ver-vista-previa" style={{ cursor: 'pointer', fontSize: TIPO.texto, color: TINTA_2 }}>
        Vista previa
      </summary>
      {abierta && (
        <iframe
          data-testid="vista-previa-anexo"
          title={`Vista previa de «${nombre}»`}
          src={enlaceDocumento(ruta)}
          loading="lazy"
          style={{ width: '100%', height: 480, border: `1px solid ${BORDE}`, marginTop: 6 }}
        />
      )}
    </details>
  );
}

/** El borrador de un documento: qué es, su vista previa (el PDF o la conversión del Word) y el modelo original. */
export function VistaPreviaAnexo({ d }) {
  const v = vistaPreviaAnexo(d);
  if (!v) return null;
  const tipo = textoTipoBorrador(d);
  return (
    <div data-testid="borrador-anexo" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {tipo && (
        <div data-testid="tipo-borrador" style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
          {tipo}
        </div>
      )}
      {v.ruta ? (
        <MarcoPdf ruta={v.ruta} nombre={d.nombre} />
      ) : (
        <div data-testid="sin-vista-previa" style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
          {v.texto}
        </div>
      )}
      <ModeloOriginal modelo={estadoAnexo(d)?.modelo} />
    </div>
  );
}

function CopiarTodo({ valores }) {
  const [estado, setEstado] = useState(null);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoValoresAnexo(valores));
      setEstado('ok');
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS) se dice: los valores siguen a la vista.
      setEstado('error');
    }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Boton
        Icono={estado === 'ok' ? Check : Copy}
        testid="copiar-valores-anexo"
        disabled={!valores.length}
        onClick={copiar}
      >
        Copiar todo
      </Boton>
      <span role="status" style={{ fontSize: TIPO.pequeno, color: estado === 'error' ? RIESGO : TINTA_2 }}>
        {estado === 'ok' ? 'Copiado' : estado === 'error' ? 'No se pudo copiar: selecciónalo a mano.' : ''}
      </span>
    </span>
  );
}

function ValoresDelAnexo({ id, d }) {
  const c = useCarga(() => licitacionesApi.hojaDatos(id), [id]);
  if (c.kind === 'error') return <Aviso tono="error">{c.message}</Aviso>;
  if (c.kind !== 'ready') return <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>Cargando los valores…</div>;
  const valores = valoresDelAnexo(c.data, d);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: TIPO.texto, fontWeight: 600, color: TINTA }}>Valores de este anexo</span>
        <CopiarTodo valores={valores} />
      </div>
      {!valores.length && (
        <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
          La hoja de datos aún no tiene valores para este anexo.
        </div>
      )}
      <dl
        data-testid="valores-anexo"
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(120px, 1fr) 2fr',
          gap: '2px 12px',
          fontSize: TIPO.pequeno,
        }}
      >
        {valores.map((v) => (
          <div key={`${v.grupo}|${v.etiqueta}`} style={{ display: 'contents' }}>
            <dt style={{ color: TINTA_2 }}>{v.etiqueta}</dt>
            <dd style={{ margin: 0, color: TINTA, userSelect: 'all' }}>{v.valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Un anexo en PDF sin campos que no se pudo transcribir: el modelo en su página y los valores para copiarlos. */
export function TarjetaAMano({ id, d, a }) {
  const pagina = a.modelo?.pagina;
  return (
    <div
      data-testid="tarjeta-a-mano"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 8px',
        borderLeft: `3px solid ${RIESGO}`,
      }}
    >
      <div style={{ fontSize: TIPO.texto, fontWeight: 600, color: TINTA }}>Hay que rellenarlo a mano (PDF)</div>
      {a.motivo && <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>{a.motivo}</div>}
      <ModeloOriginal modelo={a.modelo} texto={pagina ? `Abrir el modelo (pág. ${pagina})` : 'Abrir el modelo'} />
      <ValoresDelAnexo id={id} d={d} />
    </div>
  );
}

// En la bandeja la tarjeta no trae el documento: se pide al desplegar, para ver su PDF y el original.
function PreviaDeTarjeta({ id, doc }) {
  const c = useCarga(() => licitacionesApi.documentosOferta(id), [id, doc]);
  if (c.kind === 'error') return <Aviso tono="error">{c.message}</Aviso>;
  if (c.kind !== 'ready') return <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>Cargando…</div>;
  const d = (c.data?.documentos ?? []).find((x) => x.clave === doc);
  return d ? (
    <VistaPreviaAnexo d={d} />
  ) : (
    <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>Este documento ya no está en el guion vigente.</div>
  );
}

function VerDocumento({ id, doc }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <details data-testid="vista-previa-tarjeta" onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary style={{ cursor: 'pointer', fontSize: TIPO.texto, color: TINTA_2 }}>
        Ver el documento y el modelo original
      </summary>
      {abierta && (
        <div style={{ marginTop: 6 }}>
          <PreviaDeTarjeta id={id} doc={doc} />
        </div>
      )}
    </details>
  );
}

const MARCA = { background: ACCION_SUAVE, color: TINTA, borderRadius: 3, padding: '0 2px' };
const MARCA_CAMBIADA = { ...MARCA, outline: `1px solid ${RIESGO}` };

function Parrafo({ p }) {
  return (
    <p
      data-testid={`parrafo-anexo-${p.n}`}
      style={{ margin: '0 0 8px', fontSize: TIPO.base, lineHeight: 1.6, color: TINTA }}
    >
      {trozos(p).map((t, i) =>
        t.valor ? (
          <mark key={i} title={tituloValor(t.valor)} style={t.valor.cambiado ? MARCA_CAMBIADA : MARCA}>
            {t.texto}
          </mark>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </p>
  );
}

function Campos({ campos }) {
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 1fr) 2fr',
        gap: '4px 12px',
        fontSize: TIPO.texto,
      }}
    >
      {campos.map((c) => (
        <div key={c.nombre} style={{ display: 'contents' }}>
          <dt style={{ color: TINTA_2 }}>{c.nombre}</dt>
          <dd
            title={c.dato}
            style={{ margin: 0, color: TINTA, ...(c.cambiado ? { outline: `1px solid ${RIESGO}` } : {}) }}
          >
            {c.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function VistaAnexo({ id, tarjeta, onAbrir, onCambio }) {
  const doc = claveDocumento(tarjeta.clave);
  const c = useCarga(() => anexoApi.vista(id, doc), [id, doc]);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const aceptar = () => {
    setTrabajando(true);
    anexoApi.aceptar(id, [doc]).then(
      () => onCambio?.(),
      (e) => {
        setError(e.message);
        setTrabajando(false);
      },
    );
  };
  const v = c.data;
  return (
    <div data-testid={`vista-anexo-${tarjeta.clave}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>
        {tarjeta.titulo}
        {v ? ` · v${v.version}` : ''}
      </div>
      {c.kind === 'error' && <Aviso tono="error">{c.message}</Aviso>}
      {v?.avisos.map((a) => (
        <Aviso key={a} tono="aviso">
          {a}
        </Aviso>
      ))}
      {v && (
        <div style={{ maxWidth: 760, padding: '8px 12px', borderLeft: `3px solid ${BORDE}` }}>
          {v.parrafos ? v.parrafos.map((p) => <Parrafo key={p.n} p={p} />) : <Campos campos={v.campos ?? []} />}
        </div>
      )}
      {!v && c.kind !== 'error' && <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>{tarjeta.resumen}</div>}
      <VerDocumento id={id} doc={doc} />
      {error && <Aviso tono="error">{error}</Aviso>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton
          testid={`aceptar-anexo-${tarjeta.clave}`}
          variante="principal"
          escribe
          disabled={!v}
          cargando={trabajando}
          onClick={aceptar}
        >
          Aceptar
        </Boton>
        <Boton testid={`abrir-${tarjeta.clave}`} onClick={onAbrir}>
          Marcar como vista
        </Boton>
      </div>
    </div>
  );
}
