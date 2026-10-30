// Una fila de «Qué impide presentar»: qué pasa, en qué lote, quién la mueve, la cita del pliego
// y sus botones. El botón de dato abre donde se arregla (onAbrirCajon); los de estado («Vamos»,
// aceptar el riesgo, descartar) piden confirmación con motivo y los guarda el servidor. El precio
// de un lote se fija en la propia fila (PrecioEnLinea): es un dato de un minuto y abrir un cajón
// para él era el paso que más se repetía; el cajón queda como enlace secundario. Un compromiso
// caro de la memoria enseña su coste y «Suavizar»: una ronda de memoria con la
// formulación barata que trae el servidor; aceptar el riesgo con motivo sigue como siempre.
import { useState } from 'react';
import { TINTA, TINTA_2, BORDE, ACCION, RADIUS, alpha } from '../../../lib/tema';
import {
  ETIQUETA_ACTOR,
  ETIQUETA_CLASE,
  accionesDeEstado,
  destinoAbre,
  documentoDeCita,
  marcaGravedad,
  memoriaDeVersion,
  pedidoSuavizarFila,
  puedeSuavizar,
  textoAccionDato,
  textoChipCoste,
  textoCriterioCoste,
  textoRondaSuavizar,
} from '../../../lib/comprobacionesFormato';
import { urlDocumento } from '../../../lib/apiCliente';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { motivoNoMejorar, progresoMemoria } from '../../../lib/memoriaFormato';
import { ofertaDeLoteGuion } from '../../../lib/ofertaFormato';
import { BLOQUEO_ACCION, bloqueo as testidBloqueo } from '../../../lib/idsPrueba';
import useAccionAviso from '../../../hooks/useAccionAviso';
import useTelemetriaTarea from '../../../hooks/useTelemetriaTarea';
import { Aviso, Boton, Chip } from '../../ui';
import Confirmacion from '../../comun/Confirmacion';
import Comentarios from '../../comun/Comentarios';
import PrecioEnLinea from './PrecioEnLinea';

const TONO_CHIP = { peligro: 'impide', aviso: 'riesgo', neutro: 'neutro', bien: 'ok' };

// Las filas de compromisos caros citan la memoria («Memoria v3, apartado 4»), no el pliego.
const deMemoria = (cita) => String(cita.documento ?? '').startsWith('Memoria');

// Para fiarse sin ir a buscar el pliego: la cita abre el documento en su página.
function Cita({ cita, pliegos }) {
  if (!cita) return null;
  // Una cita comprobada en el pliego trae su ruta entera: basta el nombre del archivo.
  const donde = [cita.documento?.split('/').pop(), cita.pagina != null ? `pág. ${cita.pagina}` : null]
    .filter(Boolean)
    .join(' · ');
  const doc = documentoDeCita(cita, pliegos);
  return (
    <details data-testid="bloqueo-cita" style={{ fontSize: 12.5, color: TINTA_2 }}>
      <summary style={{ cursor: 'pointer' }}>
        {deMemoria(cita) ? 'Ver la cita de la memoria' : 'Ver la cita del pliego'}
      </summary>
      <div style={{ marginTop: 4 }}>
        {doc ? (
          <a
            href={`${urlDocumento(doc.ruta)}${doc.pagina ? `#page=${doc.pagina}` : ''}`}
            target="_blank"
            rel="noreferrer"
            data-testid="bloqueo-cita-abrir"
            style={{ color: TINTA }}
          >
            {donde}
          </a>
        ) : (
          donde
        )}
      </div>
      <blockquote style={{ margin: '4px 0 0', paddingLeft: 8, borderLeft: `2px solid ${BORDE}`, color: TINTA }}>
        {cita.texto}
      </blockquote>
      <div style={{ marginTop: 2 }}>
        {cita.comprobada ? '(cita comprobada: está tal cual)' : '(cita sin comprobar)'}
      </div>
    </details>
  );
}

function Cabecera({ b }) {
  const marca = marcaGravedad(b);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <Chip tono={TONO_CHIP[marca.tono]} punto={false} testid="bloqueo-gravedad">
        {marca.texto}
      </Chip>
      {b.lote && <Chip>Lote {b.lote}</Chip>}
      <span style={{ fontSize: 13, color: TINTA, fontWeight: 600 }}>{b.titulo}</span>
      {b.actor && <span style={{ fontSize: 12, color: TINTA_2 }}>· {ETIQUETA_ACTOR[b.actor] ?? b.actor}</span>}
    </div>
  );
}

// Lo que cuesta cumplir el compromiso (con euros: esto es solo web), de dónde sale y la forma barata.
function Coste({ coste }) {
  const chip = textoChipCoste(coste);
  const criterio = textoCriterioCoste(coste);
  return (
    <div
      data-testid="bloqueo-coste"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: TINTA_2 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {chip && (
          <Chip tono="riesgo" punto={false} testid="bloqueo-coste-chip">
            {chip}
          </Chip>
        )}
        <span data-testid="bloqueo-coste-clase">{ETIQUETA_CLASE[coste.clase] ?? coste.clase}</span>
        {criterio && <span data-testid="bloqueo-coste-criterio">· {criterio}</span>}
      </div>
      {coste.supuesto && (
        <details data-testid="bloqueo-coste-supuesto">
          <summary style={{ cursor: 'pointer' }}>De dónde sale la cifra</summary>
          <div style={{ marginTop: 4, color: TINTA }}>{coste.supuesto}</div>
        </details>
      )}
      {coste.barata && (
        <div data-testid="bloqueo-coste-barata" style={{ color: TINTA }}>
          Más barato: {coste.barata}
        </div>
      )}
    </div>
  );
}

/**
 * «Suavizar» de la fila: null si no se ofrece (sin oferta, memoria presentada, otra ronda en
 * marcha o fila cerrada); si se ofrece pero el servidor la rechazaría, el motivo para desactivarla.
 */
function suavizarDe(b, oferta, soloLectura) {
  if (soloLectura || !b.coste) return null;
  const m = memoriaDeVersion(oferta, b.coste.memoria_version);
  const enCurso = (oferta?.memorias ?? []).some((x) => progresoMemoria(x).enCurso);
  return puedeSuavizar(b, m, enCurso) ? { motivo: motivoNoMejorar(m, oferta, true) } : null;
}

function Botones({ b, onAbrirCajon, onEstado, ocupado, enLinea = false, suavizar = null, onSuavizar }) {
  // Solo se ofrece el botón de dato si lleva a algún sitio: un cajón de las comprobaciones o donde se
  // arregla fuera (Ajustes › Empresa, el expediente). Sin onAbrirCajon (solo lectura), ninguno.
  // Con el dato en la fila, el cajón es secundario y no escribe: lo que escribe es «Guardar precio».
  // Con «Suavizar», el cajón de la memoria solo sirve para mirar: va como secundario.
  const dato =
    onAbrirCajon && destinoAbre(b.accion?.destino) ? (enLinea ? 'Ver en Decisiones' : textoAccionDato(b.accion)) : null;
  const secundario = enLinea || Boolean(b.coste);
  const estado = accionesDeEstado(b);
  if (!dato && !estado.length && !suavizar) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {suavizar && (
        <Boton
          variante="principal"
          escribe
          testid="bloqueo-suavizar"
          cargando={ocupado}
          disabled={Boolean(suavizar.motivo)}
          title={suavizar.motivo ?? undefined}
          onClick={onSuavizar}
        >
          Suavizar
        </Boton>
      )}
      {dato && (
        <Boton
          variante={!secundario ? 'principal' : undefined}
          escribe={!secundario}
          testid={BLOQUEO_ACCION}
          onClick={() => onAbrirCajon(b.accion.destino, b)}
        >
          {dato}
        </Boton>
      )}
      {estado.map((a) => (
        <Boton
          key={a.accion}
          escribe
          cargando={ocupado}
          testid={`bloqueo-estado-${a.accion}`}
          onClick={() => onEstado(a)}
        >
          {a.texto}
        </Boton>
      ))}
      {suavizar?.motivo && (
        <span data-testid="bloqueo-suavizar-motivo" style={{ fontSize: 12, color: TINTA_2 }}>
          {suavizar.motivo}
        </span>
      )}
    </div>
  );
}

// El precio de un lote se fija aquí si ya está la oferta (guion, sugeridos, decisiones guardadas).
function PrecioDeFila({ b, idLicitacion, oferta, recargar }) {
  return (
    <PrecioEnLinea
      id={idLicitacion}
      lote={b.lote}
      oe={ofertaDeLoteGuion(oferta.guion.datos, b.lote)}
      sugerido={oferta.precios_sugeridos?.[b.lote] ?? null}
      decisiones={oferta.decisiones ?? null}
      onGuardado={recargar}
      conContexto
    />
  );
}

// El tiempo con foco de la fila: desplegada (foco dentro o su confirmación abierta) o con
// el cajón que abrió su botón. En solo lectura no hay trabajo que medir.
function useTiempoDeFila({ b, idLicitacion, soloLectura, pidiendo, onAbrirCajon }) {
  const { props, pedirCajon } = useTelemetriaTarea({
    idLicitacion: soloLectura ? null : idLicitacion,
    b,
    desplegada: Boolean(pidiendo),
  });
  const abrir = onAbrirCajon
    ? (destino, fila) => {
        pedirCajon(destino);
        onAbrirCajon(destino, fila);
      }
    : undefined;
  return { props, abrir };
}

const precioEnLinea = (b, oferta, soloLectura) =>
  !soloLectura && b.categoria === 'precio' && Boolean(b.lote) && Boolean(oferta?.guion);

const SUAVIZAR = { accion: 'suavizar', texto: 'Suavizar' };

// Lo que guarda o pide una fila: los botones de estado (con motivo) y «Suavizar» (una ronda de memoria).
function useAccionesFila(b, idLicitacion, recargar) {
  const [pidiendo, setPidiendo] = useState(null);
  const [aviso, hacer, ocupado] = useAccionAviso(recargar);
  const guardar = (accion, motivo) => {
    setPidiendo(null);
    hacer(() => licitacionesApi.accionBloqueo(idLicitacion, b.clave, { accion, motivo }), 'Guardado.');
  };
  const suavizar = () => {
    setPidiendo(null);
    const p = pedidoSuavizarFila(b);
    hacer(
      () => licitacionesApi.mejorarMemoria(idLicitacion, p.version, p.apartados, p.indicaciones),
      'Hermes rehace la memoria con la formulación barata.',
    );
  };
  const onEstado = (a) => (a.conMotivo ? setPidiendo(a) : guardar(a.accion));
  return { pidiendo, setPidiendo, aviso, ocupado, guardar, suavizar, onEstado };
}

function DetalleSuavizar({ b }) {
  const p = pedidoSuavizarFila(b);
  return (
    <div data-testid="bloqueo-suavizar-detalle">
      {textoRondaSuavizar(p.apartados)}
      <blockquote style={{ margin: '4px 0 0', paddingLeft: 8, borderLeft: `2px solid ${BORDE}`, color: TINTA }}>
        {p.indicaciones}
      </blockquote>
    </div>
  );
}

function Pedido({ b, a }) {
  const { pidiendo } = a;
  if (pidiendo.accion === SUAVIZAR.accion) {
    return (
      <Confirmacion
        pregunta={`¿Suavizar «${b.titulo}»?`}
        detalle={<DetalleSuavizar b={b} />}
        textoSi="Suavizar"
        onSi={a.suavizar}
        onNo={() => a.setPidiendo(null)}
      />
    );
  }
  return (
    <Confirmacion
      pregunta={`${pidiendo.texto}: «${b.titulo}»`}
      textoSi={pidiendo.texto}
      conMotivo
      destructiva={pidiendo.accion === 'descartar'}
      onSi={(motivo) => a.guardar(pidiendo.accion, motivo)}
      onNo={() => a.setPidiendo(null)}
    />
  );
}

/**
 * soloLectura: sin botones. resaltada: la fila a la que lleva el enlace (2 s). oferta: la que
 * carga las comprobaciones (GET /oferta), para fijar el precio de un lote en la fila y saber si su memoria
 * se puede suavizar; sin ella, el cajón y sin «Suavizar».
 */
/** comentarios: los de la licitación (useComentarios); sin ellos, la fila va sin hilo. */
export function HiloDeFila({ b, comentarios }) {
  return (
    <Comentarios
      hilo={comentarios.de('bloqueo', b.clave)}
      onPublicar={(t) => comentarios.publicar('bloqueo', b.clave, t)}
      onResolver={comentarios.resolver}
      testid={`comentarios-${testidBloqueo(b.clave)}`}
    />
  );
}

export default function FilaBloqueo({
  b,
  idLicitacion,
  soloLectura = false,
  resaltada = false,
  onAbrirCajon,
  recargar,
  oferta = null,
  pliegos = [],
  comentarios = null,
}) {
  const a = useAccionesFila(b, idLicitacion, recargar);
  const enLinea = precioEnLinea(b, oferta, soloLectura);
  const suavizar = suavizarDe(b, oferta, soloLectura);
  const tiempo = useTiempoDeFila({ b, idLicitacion, soloLectura, pidiendo: a.pidiendo, onAbrirCajon });
  return (
    <li
      data-testid={testidBloqueo(b.clave)}
      data-estado={b.gravedad}
      data-categoria={b.categoria}
      tabIndex={-1}
      {...tiempo.props}
      style={{
        listStyle: 'none',
        padding: '8px 10px',
        borderRadius: RADIUS,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        border: `1px solid ${resaltada ? ACCION : BORDE}`,
        background: resaltada ? alpha(ACCION, 0.1) : 'transparent',
        transition: 'background 0.3s ease',
      }}
    >
      <Cabecera b={b} />
      {b.coste && <Coste coste={b.coste} />}
      {b.propuesta && <div style={{ fontSize: 12.5, color: TINTA_2 }}>Hermes propone: {b.propuesta.resumen}</div>}
      <Cita cita={b.cita} pliegos={pliegos} />
      {enLinea && <PrecioDeFila b={b} idLicitacion={idLicitacion} oferta={oferta} recargar={recargar} />}
      {!soloLectura && !a.pidiendo && (
        <Botones
          b={b}
          onAbrirCajon={tiempo.abrir}
          onEstado={a.onEstado}
          ocupado={a.ocupado}
          enLinea={enLinea}
          suavizar={suavizar}
          onSuavizar={() => a.setPidiendo(SUAVIZAR)}
        />
      )}
      {a.pidiendo && <Pedido b={b} a={a} />}
      {a.aviso?.tono === 'error' && <Aviso tono="error">{a.aviso.texto}</Aviso>}
      {comentarios && <HiloDeFila b={b} comentarios={comentarios} />}
    </li>
  );
}
