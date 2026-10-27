// Piezas comunes de las vistas de listas con ficha: lista con la ficha al lado, tablas,
// barras por año, enlaces entre fichas y el selector de periodo.
import { Children, useState } from 'react';
import { TINTA, TINTA_2, BORDE, LIENZO, SUPERFICIE_2, ACCION, RADIUS_PANEL, alpha } from '../../lib/tema';
import { barrasAnio, PERIODOS } from '../../lib/competenciaFormato';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { Aviso, Boton } from '../ui';
import { Desplazable, Pildora } from './ui';
import { plural } from '../../lib/formato';

const celda = { padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap' };
const numero = { ...celda, textAlign: 'right' };

// d: cifra (a la derecha, con números tabulares); largo: texto que puede partirse.
export function Celda({ children, d = false, largo = false }) {
  const estilo = d ? numero : largo ? { ...celda, whiteSpace: 'normal', minWidth: 160 } : celda;
  return (
    <td className={d ? 'tabular-nums' : undefined} style={estilo}>
      {children}
    </td>
  );
}

export function Tabla({ cabecera, children, titulo, vacio = 'Aún no hay datos.' }) {
  const sinFilas = Children.count(children) === 0;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}>
        {titulo && (
          <caption style={{ textAlign: 'left', fontSize: 11.5, color: TINTA_2, paddingBottom: 4 }}>{titulo}</caption>
        )}
        <thead>
          <tr style={{ color: TINTA_2 }}>
            {cabecera.map(([t, alinear]) => (
              <th key={t} scope="col" style={alinear === 'd' ? numero : celda}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sinFilas ? (
            <tr>
              <td colSpan={cabecera.length} style={{ ...celda, color: TINTA_2, whiteSpace: 'normal' }}>
                {vacio}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Fila({ children }) {
  return <tr style={{ borderTop: `1px solid ${BORDE}` }}>{children}</tr>;
}

// Un nombre que abre la ficha de otro competidor u organismo.
export function Enlace({ children, onClick, title }) {
  if (!onClick) return <span>{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: TINTA,
        textAlign: 'left',
        textDecoration: 'underline',
        textDecorationColor: alpha(ACCION, 0.5),
        textUnderlineOffset: 3,
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

export function Subtitulo({ children }) {
  return (
    <h4
      style={{
        fontSize: 11.5,
        color: TINTA_2,
        fontWeight: 600,
        letterSpacing: '0.06em',
        margin: '14px 0 6px',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </h4>
  );
}

export function Periodo({ meses, onCambio }) {
  return PERIODOS.map((p) => (
    <Pildora key={p.meses} label={p.label} activa={meses === p.meses} onClick={() => onCambio(p.meses)} />
  ));
}

/** Barras horizontales por año con la cifra a la derecha. */
export function BarrasAnio({ grupos, campo = 'contratos', formato = String, etiqueta }) {
  if (!grupos?.length) return <div style={{ fontSize: 12.5, color: TINTA_2 }}>Sin datos por año.</div>;
  return (
    <ul
      aria-label={etiqueta}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}
    >
      {barrasAnio(grupos, campo).map((g) => (
        <li
          key={g.clave}
          style={{
            display: 'grid',
            gridTemplateColumns: '44px 1fr 90px',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: TINTA,
          }}
        >
          <span style={{ color: TINTA_2 }}>{g.clave}</span>
          <span aria-hidden="true" style={{ height: 8, borderRadius: 4, background: alpha(ACCION, 0.12) }}>
            <span
              style={{
                display: 'block',
                width: `${g.ancho}%`,
                height: 8,
                borderRadius: 4,
                background: alpha(ACCION, 0.7),
              }}
            />
          </span>
          <span className="tabular-nums" style={{ textAlign: 'right' }}>
            {formato(g[campo])}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Lista a la izquierda y ficha a la derecha; en pantallas estrechas, la ficha sustituye a la lista. */
export function ListaYFicha({ lista, ficha, vacio }) {
  const { isSmall, width } = useAnchoPantalla();
  if (isSmall && ficha) return <Desplazable>{ficha}</Desplazable>;
  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          flex: isSmall ? 1 : `0 0 ${width < 1200 ? 380 : 440}px`,
        }}
      >
        {lista}
      </div>
      {!isSmall && (
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: 4 }}>
          {ficha ?? <div style={{ color: TINTA_2, fontSize: 13, padding: 20 }}>{vacio}</div>}
        </div>
      )}
    </div>
  );
}

function PanelLista({ children }) {
  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
      }}
    >
      {children}
    </div>
  );
}

/** Lista de resultados con sus estados de carga, error y vacío; `item` pinta cada fila. */
export function ResultadosLista({ resultado, vacio, item }) {
  return (
    <>
      <PanelLista>
        {resultado.kind === 'loading' && (
          <div role="status" style={{ padding: 16, color: TINTA_2, fontSize: 13 }}>
            Cargando…
          </div>
        )}
        {resultado.kind === 'error' && (
          <div style={{ padding: 12 }}>
            <Aviso tono="error">{resultado.message}</Aviso>
          </div>
        )}
        {resultado.kind === 'ready' && resultado.items.length === 0 && (
          <div style={{ padding: 16, color: TINTA_2, fontSize: 13, lineHeight: 1.6 }}>{vacio}</div>
        )}
        {resultado.kind === 'ready' && resultado.items.map(item)}
      </PanelLista>
      {resultado.kind === 'ready' && (
        <div style={{ fontSize: 12, color: TINTA_2, marginTop: 6 }}>
          {resultado.items.length < resultado.total
            ? `Mostrando ${resultado.items.length} de ${resultado.total}`
            : `${resultado.total} en total`}
        </div>
      )}
    </>
  );
}

export function FilaLista({ activa, onClick, titulo, subtitulo, children }) {
  return (
    <button
      onClick={onClick}
      aria-current={activa ? 'true' : undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        cursor: 'pointer',
        background: activa ? SUPERFICIE_2 : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${BORDE}`,
      }}
    >
      <div className="so-tres-lineas" style={{ fontSize: 13, color: TINTA, fontWeight: 600, lineHeight: 1.35 }}>
        {titulo}
      </div>
      {subtitulo && <div style={{ fontSize: 11.5, color: TINTA_2, marginTop: 3 }}>{subtitulo}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>{children}</div>
    </button>
  );
}

/**
 * Lista vacía de oportunidades: si hay candidatas sin cribar fuera de los estados elegidos
 * (p. ej. con Hermes parado), lo dice y ofrece verlas o mandarlas a cribar.
 */
function VacioOportunidades({ sinCribar = 0, viendoSinCribar = false, texto, onVerSinCribar, onCribar }) {
  if (sinCribar > 0 && !viendoSinCribar) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, color: TINTA }}>
        <span>
          No hay nada en estos estados, pero {plural(sinCribar, 'candidata espera', 'candidatas esperan')} a que Hermes
          las cribe.
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Boton onClick={onVerSinCribar}>Ver las {sinCribar} sin cribar</Boton>
          {onCribar && <Boton onClick={onCribar}>Cribar ahora</Boton>}
        </div>
      </div>
    );
  }
  return <span>{texto}</span>;
}

/**
 * Filtros de una lista: a la vista en escritorio; en el móvil, plegados tras un botón que
 * dice cuántos hay activos, para que la lista empiece arriba.
 */
function FiltrosPlegables({ activos, children }) {
  const { isSmall } = useAnchoPantalla();
  const [abiertos, setAbiertos] = useState(false);
  if (!isSmall) return children;
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Boton onClick={() => setAbiertos((a) => !a)}>
          {abiertos ? 'Ocultar filtros' : `Filtros${activos ? ` · ${activos}` : ''}`}
        </Boton>
      </div>
      {abiertos && children}
    </>
  );
}
