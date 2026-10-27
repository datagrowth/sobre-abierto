// Piezas pequeñas comunes a las pestañas de la plataforma (Licitaciones, Colaboradores).
import { ArrowLeft, ChevronDown } from 'lucide-react';
import usePlegado from '../../hooks/usePlegado';
import { TINTA, TINTA_2, BORDE, LIENZO, ACCION, RADIUS_PANEL, RADIUS_PILDORA, ACCION_SUAVE } from '../../lib/tema';
import { plazo, proximoPlazo, textoPlazo, textoVeredicto } from '../../lib/formato';
import { Aviso, Boton, Chip } from '../ui';

const TONO_VEREDICTO = { interesa: 'ok', revisar: 'riesgo', descartar: 'neutro' };
const TONO_URGENCIA = { alta: 'impide', media: 'riesgo', baja: 'neutro', pasada: 'neutro', ninguna: 'neutro' };

// El plazo relativo con su fecha y su hora a la vista («en 2 días · lun 6 oct · 14:00»): sin
// depender del tooltip. `peninsular`: la hora es de la península (PLACSP); la de Canarias, al lado si la empresa está allí.
// En dos fases, mientras no pase, el de la solicitud de participación («Solicitud mañana · …»).
// `zona`: la de la hora del plazo (las ayudas canarias van en hora de Canarias).
export function Plazo({ fechaLimite, fechaSolicitud = null, peninsular = false, zona = 'Europe/Madrid' }) {
  const prox = proximoPlazo(fechaLimite, fechaSolicitud);
  const p = plazo(prox.fecha, undefined, zona);
  const hora = p.hora && peninsular ? 'Hora peninsular, la que publica la Plataforma de Contratación.' : '';
  const ayuda = prox.solicitud
    ? `Fin de la solicitud de participación: sin ella no se puede presentar la oferta (${textoPlazo(plazo(fechaLimite, undefined, zona), peninsular)}). ${hora}`
    : hora || undefined;
  return (
    <Chip tono={TONO_URGENCIA[p.urgencia]} punto={false} title={ayuda} testid="plazo" urgencia={p.urgencia}>
      {prox.solicitud ? 'Solicitud ' : ''}
      {textoPlazo(p, peninsular)}
    </Chip>
  );
}

// Opinión de Hermes en la criba (la tooltip lo explica).
function Veredicto({ veredicto, motivo }) {
  if (!veredicto) return null;
  const ayuda = `Opinión de Hermes al cribar${motivo ? `: ${motivo}` : ''}`;
  return (
    <Chip tono={TONO_VEREDICTO[veredicto]} punto={false} title={ayuda}>
      Hermes: {textoVeredicto(veredicto)}
    </Chip>
  );
}

export function Pildora({ label, activa, onClick, cuenta, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      data-testid={testid}
      style={{
        padding: '5px 11px',
        fontSize: 13,
        fontWeight: activa ? 700 : 500,
        borderRadius: RADIUS_PILDORA,
        cursor: 'pointer',
        background: activa ? ACCION_SUAVE : 'transparent',
        color: activa ? TINTA : TINTA_2,
        border: `1px solid ${activa ? ACCION : BORDE}`,
      }}
    >
      {label}
      {typeof cuenta === 'number' && <span style={{ marginLeft: 6, color: TINTA_2 }}>{cuenta}</span>}
    </button>
  );
}

// extra: lo que va a la derecha del título (un chip de estado, un enlace).
const estiloTitulo = { fontSize: 11, color: TINTA_2, letterSpacing: '0.08em', margin: 0 };

/** Caja con título. Con `plegable` (un nombre único, p. ej. «oferta.guion»), se pliega y lo recuerda. */
export function Bloque({ titulo, extra, children, plegable }) {
  if (plegable)
    return (
      <BloquePlegable titulo={titulo} extra={extra} nombre={plegable}>
        {children}
      </BloquePlegable>
    );
  return (
    <section
      style={{ background: LIENZO, border: `1px solid ${BORDE}`, borderRadius: RADIUS_PANEL, padding: '12px 14px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 8px' }}>
        <h3 className="brand-text" style={estiloTitulo}>
          {titulo}
        </h3>
        {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
      </div>
      {children}
    </section>
  );
}

function BloquePlegable({ titulo, extra, nombre, children }) {
  const [plegada, alternar] = usePlegado(nombre);
  const id = `bloque-${nombre.replace(/[^a-z0-9-]/gi, '-')}`;
  return (
    <section
      style={{ background: LIENZO, border: `1px solid ${BORDE}`, borderRadius: RADIUS_PANEL, padding: '12px 14px' }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: plegada ? 0 : '0 0 8px' }}
      >
        <h3 className="brand-text" style={estiloTitulo}>
          <button
            type="button"
            onClick={alternar}
            aria-expanded={!plegada}
            aria-controls={id}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
              font: 'inherit',
              letterSpacing: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              style={{ transform: plegada ? 'rotate(-90deg)' : 'none', transition: 'transform 0.12s ease' }}
            />
            {titulo}
          </button>
        </h3>
        {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
      </div>
      <div id={id} hidden={plegada}>
        {children}
      </div>
    </section>
  );
}

/**
 * Ficha a pantalla completa en pantallas estrechas: el panel y la página no se desplazan
 * (overflow hidden), así que sin este contenedor se cortaría todo lo que no cabe.
 */
// El hueco de abajo deja ver lo último de la ficha por encima de la barra fija del móvil.
export function Desplazable({ children }) {
  return <div style={{ height: '100%', overflow: 'auto', paddingRight: 4, paddingBottom: 76 }}>{children}</div>;
}

/** Carga o error de una ficha, con «Volver» para no dejar atascado a quien la abrió en el móvil. */
export function EstadoFicha({ estado, onVolver }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {onVolver && (
        <div>
          <Boton Icono={ArrowLeft} onClick={onVolver}>
            Volver
          </Boton>
        </div>
      )}
      {estado.kind === 'error' ? (
        <Aviso tono="error">{estado.message}</Aviso>
      ) : (
        <div style={{ color: TINTA_2, fontSize: 13, padding: 20 }}>Cargando…</div>
      )}
    </div>
  );
}
