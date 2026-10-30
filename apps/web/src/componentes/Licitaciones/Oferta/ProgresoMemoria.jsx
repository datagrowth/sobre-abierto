// El progreso de la memoria (plan y crítico) en el paso 3: la línea de fases y, plegado, lo que hay detrás:
// el dossier y la estrategia en Salidas, si el crítico fue independiente y ciego, su nota por
// ronda y apartado (con los apartados restaurados), la hoja de hechos y lo que no casa con ella.
// Encima, si cambió algo de lo que usó (el equipo, las herramientas…), a qué apartados afecta y
// el botón para rehacer solo esos.
import { FileText, RefreshCw } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, BORDE_CONTROL, RIESGO, RADIUS, TIPO } from '../../../lib/tema';
import { enlaceDocumento } from '../../../lib/propuestasFormato';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import {
  costeActualizar,
  fasesMemoria,
  minutosActualizar,
  tablaCriticas,
  textoCritico,
  textoDesfaseMemoria,
} from '../../../lib/progresoMemoriaFormato';
import { avisoAfectados } from '../../../lib/diffPalabras';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Aviso, Boton, Chip } from '../../ui';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };
const TONO_PASO = { hecho: 'ok', en_curso: 'neutro', pendiente: 'neutro', fallido: 'impide', omitido: 'neutro' };
const celda = { padding: '4px 8px', borderTop: `1px solid ${BORDE}`, textAlign: 'left' };

/** Dossier → Estrategia → Redacción → Crítica → Ronda → Ensamblada. */
export function FasesMemoria({ m }) {
  const pasos = fasesMemoria(m);
  return (
    <ol
      aria-label="Fases de la memoria"
      style={{ listStyle: 'none', display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 0', padding: 0 }}
    >
      {pasos.map((p, i) => (
        <li key={p.clave} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Chip tono={TONO_PASO[p.estado]} punto={false} title={p.estado === 'omitido' ? 'No hizo falta' : undefined}>
            {p.texto}
          </Chip>
          {i < pasos.length - 1 && (
            <span aria-hidden="true" style={{ color: TINTA_2 }}>
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function EnlaceMd({ ruta, nombre }) {
  if (!ruta) return null;
  return (
    <a
      href={enlaceDocumento(ruta)}
      target="_blank"
      rel="noreferrer"
      title={ruta}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 12.5,
        borderRadius: RADIUS,
        border: `1px solid ${BORDE_CONTROL}`,
        color: TINTA,
        textDecoration: 'none',
      }}
    >
      <FileText size={14} aria-hidden="true" />
      {nombre}
    </a>
  );
}

function TablaRondas({ m }) {
  const t = tablaCriticas(m);
  if (!t) return <div style={{ ...apagado, marginTop: 6 }}>Aún no hay crítica.</div>;
  return (
    <div style={{ overflowX: 'auto', marginTop: 6 }}>
      <table style={{ borderCollapse: 'collapse', ...texto }}>
        <thead>
          <tr>
            <th style={celda}>Apartado</th>
            {t.rondas.map((r) => (
              <th key={r} style={celda}>
                Ronda {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.filas.map((f) => (
            <tr key={f.apartado}>
              <td style={celda}>
                {f.apartado}. {f.titulo}
              </td>
              {f.celdas.map((c) => (
                <td
                  key={c.ronda}
                  className="tabular-nums"
                  style={{ ...celda, color: c.restaurado ? RIESGO : TINTA }}
                  title={c.restaurado ? 'Empeoró: se conserva su mejor versión' : undefined}
                >
                  {c.texto}
                  {c.restaurado ? ' ↺' : ''}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td style={{ ...celda, fontWeight: 600 }}>Total</td>
            {t.totales.map((x, i) => (
              <td key={t.rondas[i]} className="tabular-nums" style={{ ...celda, fontWeight: 600 }}>
                {x}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Hechos({ hechos }) {
  if (!hechos?.length) return null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ ...texto, color: TINTA_2, cursor: 'pointer' }}>
        Hoja de hechos ({hechos.length}): lo que todos los apartados dicen igual
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {hechos.map((h) => (
          <li key={h.clave} style={texto}>
            <span style={{ color: TINTA_2 }}>{h.sobre}:</span> {h.valor}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Lo que cambió desde esta versión y a qué apartados afecta, con «Actualizar los apartados
 * afectados» (crea la versión siguiente; el diff de cada apartado lo enseña la fila del apartado).
 * La presentada y la de ensayo no se rehacen por cambios tardíos.
 */
function DesfaseMemoria({ id, m, onCambio = () => {} }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const texto = textoDesfaseMemoria(m);
  if (!texto && !aviso) return null;
  const apartados = m.progreso?.desfase?.apartados ?? [];
  const actualizar = () => {
    if (
      !window.confirm(`${texto}

${costeActualizar(apartados)} ¿Actualizarlos?`)
    )
      return;
    // Una redacción de los afectados y una crítica: 2 runs, sin dossier ni estrategia.
    const coste = { apartados, minutos: minutosActualizar(apartados), runs: 2 };
    hacer(
      () => licitacionesApi.actualizarMemoria(id, m.version, apartados),
      (r) => avisoAfectados(r, coste),
    );
  };
  return (
    <section data-testid="memoria-desfase" aria-label="Lo que cambió desde esta versión" style={{ marginTop: 10 }}>
      {texto && <Aviso tono="aviso">{texto}</Aviso>}
      {texto && id && !m.presentada && !m.ensayo && (
        <div style={{ marginTop: 6 }}>
          <Boton
            variante="principal"
            escribe
            Icono={RefreshCw}
            cargando={ocupado}
            testid="memoria-actualizar"
            title={costeActualizar(apartados)}
            onClick={actualizar}
          >
            Actualizar los apartados afectados
          </Boton>
        </div>
      )}
      {aviso?.texto && (
        <div data-testid="memoria-actualizar-aviso" style={{ marginTop: 6 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </section>
  );
}

/** Lo de detrás de una memoria, plegado; con `id`, encima lo que cambió desde ella (DesfaseMemoria). */
export function DetalleMemoria({ m, id = null, onCambio }) {
  const v = m.progreso;
  const critico = textoCritico(v.criticas.at(-1));
  return (
    <>
      {id && <DesfaseMemoria id={id} m={m} onCambio={onCambio} />}
      <details style={{ marginTop: 10 }}>
        <summary style={{ ...texto, color: TINTA_2, cursor: 'pointer' }}>
          Plan y crítico: dossier, estrategia, nota por ronda y coherencia
        </summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <EnlaceMd ruta={v.dossier?.ruta_md} nombre="Dossier" />
          <EnlaceMd ruta={v.estrategia?.ruta_md} nombre="Estrategia" />
          {v.dossier?.equipo_por_roles && (
            <Chip
              tono="riesgo"
              punto={false}
              title="El pliego pide CV anonimizados o puntúa la experiencia del equipo en otro archivo"
            >
              Equipo por roles, sin nombres
            </Chip>
          )}
        </div>
        {v.dossier?.recortadas.length > 0 && (
          <div style={{ ...apagado, marginTop: 4 }}>
            Secciones del dossier recortadas (Hermes sigue leyendo en la Biblioteca): {v.dossier.recortadas.join(', ')}.
          </div>
        )}
        {critico && <div style={{ ...texto, marginTop: 8 }}>{critico.texto}</div>}
        {critico?.avisos.map((a) => (
          <div key={a} style={{ marginTop: 4 }}>
            <Aviso tono="aviso">{a}</Aviso>
          </div>
        ))}
        <TablaRondas m={m} />
        <Hechos hechos={v.estrategia?.hechos} />
        {v.coherencia.length > 0 && (
          <section aria-label="Coherencia con la hoja de hechos" style={{ marginTop: 8 }}>
            <div style={{ ...texto, fontWeight: 600, color: RIESGO }}>
              Lo que no casa con la hoja de hechos o entre apartados
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {v.coherencia.map((h) => (
                <li key={`${h.apartado}-${h.tipo}-${h.hecho}-${h.cita}`} style={texto}>
                  Apartado {h.apartado}: {h.texto}
                </li>
              ))}
            </ul>
          </section>
        )}
      </details>
    </>
  );
}
