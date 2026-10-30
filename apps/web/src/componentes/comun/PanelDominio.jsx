// Armazón de una pantalla (Pipeline, Oportunidades, Mercado, Equipo…): cabecera de página con
// migas, título y acciones, pestañas accesibles (flechas, Inicio y Fin) y, debajo, los
// avisos de lo que impide que llegue trabajo nuevo, visibles en todas las vistas.
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { TINTA, TINTA_2, RIESGO, IMPIDE, TIPO } from '../../lib/tema';
import { Pestanas, Aviso, Boton } from '../ui';

export { Pestanas };

// Plegados en una línea (con el primero a la vista): están en todas las vistas y, abiertos,
// empujaban el trabajo hacia abajo. Con un error, abiertos de entrada.
function Avisos({ alertas, onVerEstado }) {
  if (!alertas.length) return null;
  const error = alertas.some((a) => a.tono === 'error');
  const resumen = alertas.length === 1 ? alertas[0].texto : `${alertas.length} avisos: ${alertas[0].texto}`;
  return (
    <details open={error} style={{ marginBottom: 10 }}>
      <summary
        title={resumen}
        style={{
          cursor: 'pointer',
          fontSize: TIPO.texto,
          color: error ? IMPIDE : RIESGO,
          padding: '4px 0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {resumen}
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {alertas.map((a) => (
          <Aviso key={a.texto} tono={a.tono}>
            {a.texto}
          </Aviso>
        ))}
        {onVerEstado && (
          <div>
            <Boton onClick={onVerEstado}>Ver el estado</Boton>
          </div>
        )}
      </div>
    </details>
  );
}

/** Migas: [{ texto, onClick? , mono? }]; la última es donde se está. */
export function Migas({ migas }) {
  return (
    <nav aria-label="Migas" className="flex flex-wrap gap-1.5 text-tabla text-tinta-2">
      {migas.map((m, i) => (
        <span key={`${m.texto}-${i}`} className="inline-flex gap-1.5">
          {i > 0 && <span aria-hidden="true">/</span>}
          {m.onClick ? (
            <button
              type="button"
              onClick={m.onClick}
              className="bg-transparent border-0 p-0 text-tinta-2 underline underline-offset-3 cursor-pointer"
            >
              {m.texto}
            </button>
          ) : (
            <span
              aria-current={i === migas.length - 1 ? 'page' : undefined}
              className={m.mono ? 'font-mono text-leyenda' : undefined}
            >
              {m.texto}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function CabeceraPanel({ titulo, subtitulo, estado, migas, children }) {
  const { isSmall } = useAnchoPantalla();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      {migas && <Migas migas={migas} />}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <h1 style={{ fontSize: TIPO.grande, fontWeight: 700, color: TINTA, margin: 0, letterSpacing: '-0.01em' }}>
            {titulo}
          </h1>
          {(subtitulo || estado) && (
            <p style={{ fontSize: TIPO.texto, color: TINTA_2, margin: '3px 0 0' }}>
              {!isSmall && subtitulo}
              {subtitulo && estado && !isSmall ? ' · ' : ''}
              {estado}
            </p>
          )}
        </div>
        {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{children}</div>}
      </div>
    </div>
  );
}

export default function PanelDominio({
  titulo,
  subtitulo,
  estado,
  migas,
  acciones,
  vistas = [],
  vista,
  onVista,
  alertas = [],
  onVerEstado,
  lleno = false,
  children,
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px 24px 14px' }}>
      <CabeceraPanel titulo={titulo} subtitulo={subtitulo} estado={estado} migas={migas}>
        {acciones}
      </CabeceraPanel>
      {vistas.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <Pestanas vistas={vistas} vista={vista} onVista={onVista} etiqueta={`Vistas de ${titulo}`} />
        </div>
      )}
      <Avisos alertas={alertas} onVerEstado={onVerEstado} />
      <div
        role={vistas.length > 1 ? 'tabpanel' : undefined}
        // Una región con scroll debe poder recorrerse con el teclado.
        tabIndex={lleno ? undefined : 0}
        style={{ flex: 1, overflow: lleno ? 'hidden' : 'auto', minHeight: 0 }}
      >
        {children}
      </div>
    </div>
  );
}
