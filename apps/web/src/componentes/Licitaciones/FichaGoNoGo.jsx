// Bloque «Ficha» de una licitación: semáforo go/no-go, requisitos con su estado y
// página, criterios, documentación por sobre, fechas, garantías, penalizaciones,
// riesgos y recomendación. Los requisitos estructurados los evalúa el código; el
// resto sale de la ficha que deja Hermes, que vale desde que llega.
import { useState } from 'react';
import { FileSearch } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, OK_TEXTO, RIESGO, COLOR_SEMAFORO, alpha } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import {
  DECISIONES,
  SEMAFOROS,
  TEMAS_APARTADOS,
  agruparRequisitos,
  etiquetaResultado,
  textoMetricas,
  lineasRequisito,
  normaNuevaCreacion,
  porSobre,
  requisitosALaVista,
  requisitosDeFicha,
  resumenCobertura,
  textoCitaRequisito,
  textoCalidad,
  textoComprobado,
  textoGarantia,
  textoReglaFicha,
} from '../../lib/licitacionesFormato';
import { fechaHora } from '../../lib/formato';
import { textoSenal } from '../../lib/antecedentesFormato';
import { fiabilidadFicha, filtrarPorLotes } from '../../lib/expedienteFormato';
import { resumenArea } from '../../lib/fichaFormato';
import { Aviso, Boton, Chip } from '../ui';
import { Bloque } from '../comun/ui';
import RelanzarTrabajo from './RelanzarTrabajo';
import Comentarios from '../comun/Comentarios';
import { claveRequisito } from '../../lib/comentariosFormato';

const TONO_RESULTADO = { cumple: 'ok', no_cumple: 'impide', desconocido: 'riesgo', no_aplica: 'neutro' };
const TONO_DECISION = { go: 'ok', no_go: 'impide', revisar: 'riesgo' };
const TONO_GRAVEDAD = { alta: 'impide', media: 'riesgo', baja: 'neutro' };

function Subtitulo({ children }) {
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

function Cabecera({ semaforo, decision }) {
  const color = COLOR_SEMAFORO[semaforo.color] ?? TINTA_2;
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 10,
        background: alpha(color, 0.1),
        border: `1px solid ${alpha(color, 0.4)}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          background: color,
          marginTop: 2,
          flex: '0 0 16px',
          boxShadow: `0 0 0 4px ${alpha(color, 0.18)}`,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: TINTA }}>
            {SEMAFOROS[semaforo.color] ?? semaforo.color}
          </span>
          {decision && (
            <Chip tono={TONO_DECISION[decision.decision]} punto={false} title={decision.motivo}>
              Hermes: {DECISIONES[decision.decision]}
            </Chip>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: TINTA_2, marginTop: 3 }}>{semaforo.motivo}</div>
        {semaforo.bloqueos.length > 0 && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: TINTA, lineHeight: 1.5 }}>
            {semaforo.bloqueos.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Lo que piden en grande. Si el pliego da otra norma a las empresas de nueva creación y nos aplica,
// esa es la que se enseña, con la regla general debajo en pequeño.
function LoQuePiden({ l, nueva }) {
  if (nueva) {
    return (
      <>
        <div
          data-testid="requisito-nueva-creacion"
          style={{ color: TINTA, fontSize: 13.5, fontWeight: 600, marginTop: 3 }}
        >
          <Chip tono="ok" punto={false}>
            nueva creación
          </Chip>{' '}
          {nueva.exigido}
        </div>
        {nueva.general && <div style={{ color: TINTA_2, fontSize: 11.5 }}>Regla general: {nueva.general}</div>}
        {nueva.pagina && (
          <div style={{ color: TINTA_2, fontSize: 11.5 }}>
            {[nueva.documento, `pág. ${nueva.pagina}`].filter(Boolean).join(' · ')}
          </div>
        )}
      </>
    );
  }
  if (!l.piden && !l.exigido) return null;
  return (
    <div style={{ color: TINTA, fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
      {l.piden}
      {l.piden && l.exigido ? ': ' : ''}
      {l.exigido && <span style={{ color: TINTA }}>{l.exigido}</span>}
    </div>
  );
}

// Dónde lo dice el pliego; con la cita literal, si está tal cual.
function CitaRequisito({ r }) {
  const c = textoCitaRequisito(r);
  if (!c) return null;
  return (
    <div style={{ color: TINTA_2, fontSize: 11.5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {c.donde && <span>{c.donde}</span>}
      {c.estado && (
        <Chip tono={c.estado.tono} testid="cita-requisito">
          {c.estado.texto}
        </Chip>
      )}
      {r.cita && (
        <span title={r.cita} style={{ fontStyle: 'italic' }}>
          «{r.cita.length > 140 ? `${r.cita.slice(0, 139)}…` : r.cita}»
        </span>
      )}
    </div>
  );
}

// Primero lo que piden (en grande) y lo exigido; debajo, cómo estamos nosotros.
function HiloRequisito({ r, comentarios }) {
  const clave = claveRequisito(r);
  return (
    <Comentarios
      hilo={comentarios.de('requisito', clave)}
      onPublicar={(t) => comentarios.publicar('requisito', clave, t)}
      onResolver={comentarios.resolver}
      testid={`comentarios-requisito-${clave}`}
    />
  );
}

function Requisito({ r, empresaNueva, comentarios }) {
  const estado = (
    <Chip tono={TONO_RESULTADO[r.resultado]} punto={false}>
      {etiquetaResultado(r.resultado)}
    </Chip>
  );
  const l = lineasRequisito(r);
  const nueva = normaNuevaCreacion(r, empresaNueva);
  return (
    <li
      style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${BORDE}`, alignItems: 'flex-start' }}
    >
      <span style={{ flex: '0 0 96px' }}>{estado}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45 }}>
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
            color: TINTA_2,
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          {l.tipo}
          {r.lote && <span style={{ fontWeight: 400 }}>· lote {r.lote}</span>}
          {r.excluyente && (
            <Chip tono="impide" punto={false}>
              excluyente
            </Chip>
          )}
          <Chip tono={r.origen === 'ficha' ? 'neutro' : 'neutro'} punto={false}>
            {r.origen === 'ficha' ? 'pliego (IA)' : 'PLACSP'}
          </Chip>
        </div>
        <LoQuePiden l={l} nueva={nueva} />
        {l.nosotros && (
          <div style={{ color: TINTA_2, marginTop: 2 }}>
            <span style={{ color: TINTA_2 }}>Tu empresa: </span>
            {l.nosotros}
          </div>
        )}
        {r.fuente && <div style={{ color: TINTA_2, fontSize: 11.5 }}>Dato: {r.fuente}</div>}
        {r.verificacion && (
          <div
            style={{
              color: r.verificacion.resultado !== r.verificacion.resultado_ia ? RIESGO : OK_TEXTO,
              fontSize: 11.5,
            }}
            title={r.verificacion.detalle ?? undefined}
          >
            {textoComprobado(r.verificacion)}
            {r.verificacion.detalle ? ` ${r.verificacion.detalle}` : ''}
          </div>
        )}
        <CitaRequisito r={r} />
        {comentarios && <HiloRequisito r={r} comentarios={comentarios} />}
      </div>
    </li>
  );
}

// Los cinco apartados siempre a la vista, cada uno con sus requisitos o con por qué no tiene.
function Requisitos({ requisitos, leidosEnFicha, cobertura, empresaNueva, comentarios }) {
  if (!requisitos.length && !leidosEnFicha.length)
    return <div style={{ fontSize: 12.5, color: TINTA_2 }}>Sin requisitos evaluables todavía.</div>;
  return (
    <>
      {agruparRequisitos(requisitos, cobertura).map((a) => (
        <section key={a.key} data-testid={`requisitos-${a.key}`} aria-label={a.titulo}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Subtitulo>
              {a.titulo}
              {a.requisitos.length > 0 && <span style={{ fontWeight: 500 }}> · {a.requisitos.length}</span>}
            </Subtitulo>
            <Chip tono={resumenArea(a.requisitos).tono} testid={`area-${a.key}`}>
              {resumenArea(a.requisitos).texto}
            </Chip>
          </div>
          {a.vacio ? (
            <div style={{ fontSize: 12.5, color: TINTA_2 }}>{a.vacio}</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {a.requisitos.map((r, i) => (
                <Requisito key={i} r={r} empresaNueva={empresaNueva} comentarios={comentarios} />
              ))}
            </ul>
          )}
        </section>
      ))}
      {leidosEnFicha.length > 0 && (
        <div style={{ fontSize: 12, color: TINTA_2, marginTop: 8 }}>
          {leidosEnFicha.join(', ')}: la PLACSP no da el detalle y están leídos del pliego en los requisitos de esta
          ficha.
        </div>
      )}
    </>
  );
}

// Lo que el pliego no pide (y dónde lo dice) fuera de los apartados, que ya lo dicen; lo que no se
// encontró va en «Fiabilidad de la ficha».
function Cobertura({ cobertura }) {
  const { noLoPide } = resumenCobertura((cobertura ?? []).filter((c) => !TEMAS_APARTADOS.has(c.tema)));
  if (!noLoPide.length) return null;
  return (
    <div style={{ fontSize: 12, color: TINTA_2, marginTop: 8, lineHeight: 1.5 }}>
      El pliego no pide: {noLoPide.join(', ')}.
    </div>
  );
}

// Lo que condiciona el semáforo, junto en una línea: antes eran tres avisos sueltos.
function Fiabilidad({ ficha }) {
  const linea = fiabilidadFicha(ficha);
  if (!linea) return null;
  return (
    <div
      data-testid="ficha-fiabilidad"
      data-estado={linea.avisa ? 'aviso' : 'ok'}
      style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5, color: linea.avisa ? RIESGO : TINTA_2 }}
    >
      {linea.texto}
    </div>
  );
}

function Criterios({ criterios }) {
  const total = criterios.reduce((s, c) => s + c.peso, 0) || 1;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {criterios.map((c, i) => (
        <li key={i} style={{ fontSize: 12.5, color: TINTA }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 140 }}>{c.descripcion}</span>
            <Chip tono={c.tipo === 'formula' ? 'neutro' : 'riesgo'} punto={false}>
              {c.tipo === 'formula' ? 'fórmula' : 'juicio de valor'}
            </Chip>
            <span className="tabular-nums" style={{ color: TINTA_2 }}>
              {c.peso}
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: alpha(ACCION, 0.12) }}>
            <div
              style={{
                width: `${Math.min(100, (c.peso / total) * 100)}%`,
                height: 4,
                borderRadius: 2,
                background: ACCION,
              }}
            />
          </div>
          {c.subcriterios?.length > 0 && (
            <div style={{ color: TINTA_2, fontSize: 12, marginTop: 3 }}>
              {c.subcriterios.map((s) => `${s.descripcion}${s.peso != null ? ` (${s.peso})` : ''}`).join(' · ')}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Documentacion({ documentacion }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {porSobre(documentacion).map((g) => (
        <div
          key={g.sobre}
          style={{ flex: '1 1 220px', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 10px' }}
        >
          <div style={{ fontSize: 12, color: TINTA, fontWeight: 600, marginBottom: 4 }}>Sobre {g.sobre}</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: TINTA_2, lineHeight: 1.5 }}>
            {g.documentos.map((d, i) => (
              <li key={i}>
                {d.documento}
                {!d.obligatorio && ' (opcional)'}
                {d.pagina ? ` · pág. ${d.pagina}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Lista({ items, render }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: TINTA, lineHeight: 1.6 }}>
      {items.map((x, i) => (
        <li key={i}>{render(x)}</li>
      ))}
    </ul>
  );
}

// La regla de lotes que leyó Hermes del pliego (con todos los lotes, cuenta el total).
function ReglaLotes({ pl }) {
  if (!pl) return null;
  return (
    <>
      <Subtitulo>Presentación por lotes (pliego)</Subtitulo>
      <div style={{ fontSize: 12.5, color: TINTA, lineHeight: 1.5 }}>{textoReglaFicha(pl)}</div>
      {pl.detalle && <div style={{ fontSize: 12, color: TINTA_2 }}>{pl.detalle}</div>}
    </>
  );
}

function DetalleFicha({ datos, fechaLimite, garantiasPlacsp, sinCriterios, deLotes }) {
  const fechas = [{ hito: 'Fin de presentación (PLACSP)', fecha: fechaLimite }, ...(datos?.hitos ?? [])].filter(
    (h) => h.fecha || h.detalle,
  );
  const garantias = [...garantiasPlacsp, ...(datos?.garantias ?? [])];
  const criterios = deLotes(datos?.criterios ?? []);
  const documentacion = deLotes(datos?.documentacion ?? []);
  return (
    <>
      {datos?.resumen && (
        <p style={{ fontSize: 13, color: TINTA, lineHeight: 1.55, margin: '12px 0 0' }}>{datos.resumen}</p>
      )}
      {!sinCriterios && criterios.length > 0 && (
        <>
          <Subtitulo>Criterios</Subtitulo>
          <Criterios criterios={criterios} />
        </>
      )}
      {documentacion.length > 0 && (
        <>
          <Subtitulo>Documentación por sobre</Subtitulo>
          <Documentacion documentacion={documentacion} />
        </>
      )}
      {fechas.length > 0 && (
        <>
          <Subtitulo>Fechas clave</Subtitulo>
          <Lista
            items={fechas}
            render={(h) => (
              <>
                <b style={{ fontWeight: 600 }}>{h.hito}</b>: {h.fecha ? fechaHora(h.fecha) : ''}
                {h.detalle ? ` ${h.detalle}` : ''}
              </>
            )}
          />
        </>
      )}
      {garantias.length > 0 && (
        <>
          <Subtitulo>Garantías</Subtitulo>
          <Lista items={garantias} render={textoGarantia} />
        </>
      )}
      {datos?.penalizaciones.length > 0 && (
        <>
          <Subtitulo>Penalizaciones</Subtitulo>
          <Lista
            items={datos.penalizaciones}
            render={(p) => `${p.descripcion}${p.pagina ? ` (pág. ${p.pagina})` : ''}`}
          />
        </>
      )}
      {datos?.senales_pliego?.length > 0 && (
        <>
          <Subtitulo>Señales de pliego a medida</Subtitulo>
          <Lista items={datos.senales_pliego} render={textoSenal} />
          <div style={{ fontSize: 11.5, color: TINTA_2, marginTop: 4 }}>
            Se suman a los indicios de «Antecedentes». Son indicios, no pruebas.
          </div>
        </>
      )}
      {datos?.riesgos.length > 0 && (
        <>
          <Subtitulo>Riesgos</Subtitulo>
          <Lista
            items={datos.riesgos}
            render={(r) => (
              <>
                <Chip tono={TONO_GRAVEDAD[r.gravedad]} punto={false}>
                  {r.gravedad}
                </Chip>{' '}
                {r.descripcion}
              </>
            )}
          />
        </>
      )}
      {datos?.recomendacion && (
        <>
          <Subtitulo>Recomendación</Subtitulo>
          <div style={{ fontSize: 12.5, color: TINTA }}>
            <Chip tono={TONO_DECISION[datos.recomendacion.decision]} punto={false}>
              {DECISIONES[datos.recomendacion.decision]}
            </Chip>{' '}
            {datos.recomendacion.motivo}
          </div>
        </>
      )}
    </>
  );
}

function textoGenerar(enCurso, hayFicha) {
  if (enCurso) return enCurso.estado === 'generando' ? 'Generando ficha…' : 'Ficha en cola…';
  return hayFicha ? 'Volver a generar la ficha' : 'Generar ficha';
}

function Generar({ id, conPliegos, enCurso, hayFicha, onCambio }) {
  const [estado, setEstado] = useState({ ocupado: false, aviso: null });
  const generar = async () => {
    setEstado({ ocupado: true, aviso: null });
    try {
      await licitacionesApi.generarFicha(id);
      setEstado({
        ocupado: false,
        aviso: { tono: 'info', texto: 'Hermes leerá los pliegos y dejará la ficha; si ya había una, la sustituye.' },
      });
      onCambio();
    } catch (e) {
      setEstado({ ocupado: false, aviso: { tono: 'error', texto: e.message } });
    }
  };
  const ayuda = conPliegos
    ? 'Hermes lee los pliegos y saca requisitos, criterios, documentación, fechas y riesgos'
    : 'Aún no hay pliegos descargados: la ficha se lee de ellos';
  return (
    <div style={{ marginTop: 12 }}>
      <Boton
        Icono={FileSearch}
        disabled={!conPliegos}
        cargando={estado.ocupado || Boolean(enCurso)}
        onClick={generar}
        title={ayuda}
      >
        {textoGenerar(enCurso, hayFicha)}
      </Boton>
      {enCurso && (
        <div style={{ marginTop: 6 }}>
          <RelanzarTrabajo id={id} tipo="ficha" onHecho={onCambio} />
        </div>
      )}
      {estado.aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={estado.aviso.tono}>{estado.aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}

// Tokens, llamadas y rechazos sirven para depurar la ficha, no para decidir: plegados.
function DetallesTecnicos({ ficha }) {
  const lineas = [textoCalidad(ficha?.datos.calidad), textoMetricas(ficha?.metricas)].filter(Boolean);
  const avisos = ficha?.datos.calidad?.avisos ?? [];
  if (!lineas.length && !avisos.length) return null;
  return (
    <details data-testid="detalles-tecnicos" style={{ fontSize: 11.5, color: TINTA_2, marginTop: 6 }}>
      <summary style={{ cursor: 'pointer' }}>Detalles técnicos</summary>
      {lineas.map((l) => (
        <div key={l} style={{ marginTop: 4 }}>
          {l}
        </div>
      ))}
      {avisos.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * lotes: los ids de los lotes de interés; con ellos, requisitos, criterios y documentación de
 * otros lotes no se enseñan salvo con `mostrarTodos`. Sin lotes, todo el contrato.
 */
/** comentarios: los de la licitación (useComentarios), para el hilo de cada requisito; sin ellos, sin hilos. */
export default function FichaGoNoGo({
  ficha,
  onCambio,
  sinCriterios = false,
  lotes = null,
  mostrarTodos = false,
  comentarios = null,
}) {
  const gng = ficha.go_no_go;
  const mostrada = gng.ficha.aprobada;
  const deLotes = (items) => filtrarPorLotes(items, lotes ?? [], mostrarTodos);
  const { lista, leidosEnFicha } = requisitosALaVista(
    gng.requisitos,
    requisitosDeFicha(mostrada, ficha.citas_requisitos),
  );
  const requisitos = deLotes(lista);
  return (
    <Bloque titulo="FICHA">
      <Cabecera semaforo={gng.semaforo} decision={mostrada?.datos.recomendacion} />
      <Fiabilidad ficha={ficha} />
      <DetallesTecnicos ficha={mostrada} />
      {!mostrada && (
        <div style={{ fontSize: 12.5, color: TINTA_2, marginTop: 8 }}>
          Aún no hay ficha de los pliegos: se genera sola cuando se descargan, o con «Generar ficha».
        </div>
      )}
      <ReglaLotes pl={mostrada?.datos.presentacion_lotes} />
      <Requisitos
        requisitos={requisitos}
        leidosEnFicha={leidosEnFicha}
        cobertura={mostrada?.datos.cobertura}
        empresaNueva={gng.nueva_creacion}
        comentarios={comentarios}
      />
      <Cobertura cobertura={mostrada?.datos.cobertura} />
      <DetalleFicha
        datos={mostrada?.datos}
        fechaLimite={ficha.fecha_limite}
        garantiasPlacsp={ficha.datos?.garantias ?? []}
        sinCriterios={sinCriterios}
        deLotes={deLotes}
      />
      {ficha.estado !== 'sin_oportunidad' && (
        <Generar
          id={ficha.id}
          conPliegos={(ficha.pliegos ?? []).some((p) => p.estado === 'descargado')}
          enCurso={ficha.ficha_en_curso}
          hayFicha={Boolean(mostrada)}
          onCambio={onCambio}
        />
      )}
    </Bloque>
  );
}
