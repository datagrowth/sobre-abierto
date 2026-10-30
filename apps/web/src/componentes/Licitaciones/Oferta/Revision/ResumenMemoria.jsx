// Tarjeta «memoria» de la bandeja de revisión: lo único que la persona lee de la memoria.
// La hoja de compromisos con lo que choca, los párrafos marcados con su texto en cada ronda, la
// nota del crítico ciego con su margen (la autoevaluación de Hermes infla 6-8 puntos y no sale) y lo
// comprobado. «Dar por buena» enseña antes lo que se acepta y, si queda algo marcado, pide motivo;
// «Descartar» va aparte, a la derecha y con confirmación. Un compromiso caro (horas que el pliego no
// pide) sale aquí con su coste en euros (solo la web los ve) y «Suavizar estos N» los rehace en una ronda.
import { useState } from 'react';
import { BORDE, IMPIDE, TINTA_2, OK_TEXTO, TINTA, TIPO, RIESGO } from '../../../../lib/tema';
import { revisionApi } from '../../../../lib/revisionApi';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { memoriaCambiosApi } from '../../../../lib/memoriaCambiosApi';
import { avisoAfectados, textoAfectados } from '../../../../lib/diffPalabras';
import { estadoVersion, motivoNoMejorar, pideMotivoAlAceptar, revisionDeVersion } from '../../../../lib/memoriaFormato';
import { fugasDe } from '../../../../lib/fugasFormato';
import {
  filaCompromiso,
  loteDeLaVista,
  necesitaMotivo,
  pedidoActualizarAfectados,
  pedidoSuavizar,
  puedeActualizarAfectados,
  textoDescarte,
  textoNota,
  textoPaginas,
  textoSeDescartan,
  textoSinRedactar,
  versionDeClave,
  vistaCostes,
  vistaPreviaAfectados,
} from '../../../../lib/resumenMemoriaFormato';
import useCarga from '../../../../hooks/useCarga';
import { Aviso, Boton } from '../../../ui';
import { Celda, Fila, Subtitulo, Tabla } from '../../../comun/listas';
import { Pestanas } from '../../../comun/PanelDominio';
import Confirmacion from '../../../comun/Confirmacion';
import DiffApartado from '../DiffApartado';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { ...texto, color: TINTA_2 };

function Compromisos({ compromisos }) {
  return (
    <section data-testid="compromisos-memoria" aria-label="Hoja de compromisos">
      <Subtitulo>Hoja de compromisos</Subtitulo>
      <Tabla cabecera={[['Qué'], ['Quién'], ['Cuándo o medida'], ['']]} vacio="La memoria no recoge compromisos.">
        {compromisos.map((c, i) => {
          const f = filaCompromiso(c);
          return (
            <Fila key={`${c.clave ?? c.apartado}-${i}`}>
              <Celda largo>{f.que}</Celda>
              <Celda>{f.quien}</Celda>
              <Celda largo>{f.valor}</Celda>
              <Celda largo>
                {f.choca && (
                  <span data-testid="compromiso-choca" style={{ color: IMPIDE }}>
                    ✗ {f.choca}
                  </span>
                )}
              </Celda>
            </Fila>
          );
        })}
      </Tabla>
    </section>
  );
}

function FilaCoste({ f }) {
  return (
    <Fila>
      <Celda largo>
        <span data-testid="compromiso-coste" style={{ display: 'block', fontWeight: f.caro ? 600 : 400 }}>
          {f.texto}
        </span>
        {f.justificado && (
          <span data-testid="compromiso-coste-justificado" style={{ ...apagado, display: 'block', fontWeight: 600 }}>
            Justificado en la ficha de solución
          </span>
        )}
        <span style={{ ...apagado, display: 'block' }}>
          {f.donde}
          {f.cita ? `: «${f.cita}»` : ''}
        </span>
        {f.ficha && (
          <span data-testid="compromiso-coste-ficha" style={{ ...apagado, display: 'block' }}>
            {f.ficha}
          </span>
        )}
      </Celda>
      <Celda>
        <span data-testid="compromiso-coste-cifra" style={{ color: f.caro ? RIESGO : TINTA }} title={f.supuesto}>
          {f.coste}
        </span>
      </Celda>
      <Celda largo>
        <span data-testid="compromiso-coste-barata">{f.barata}</span>
      </Celda>
    </Fila>
  );
}

// Una sola ronda de «mejorar» con los apartados y las instrucciones que da el servidor.
function Suavizar({ id, k, n, m, o, onCambio }) {
  const a = useAccion(onCambio);
  const pedido = pedidoSuavizar(k);
  const motivo = !m ? 'No se encuentra esta versión en la oferta.' : motivoNoMejorar(m, o, true);
  if (!pedido) return null;
  if (a.hecho)
    return (
      <div data-testid="suavizar-compromisos-hecho">
        <Aviso>{a.hecho}</Aviso>
      </div>
    );
  const pedir = () =>
    a.lanzar(
      () => licitacionesApi.mejorarMemoria(id, m.version, pedido.apartados, pedido.indicaciones),
      'Hermes rehace los apartados con la formulación barata en una versión nueva.',
    );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Boton
        variante="principal"
        escribe
        testid="suavizar-compromisos"
        disabled={Boolean(motivo)}
        cargando={a.ocupado}
        onClick={pedir}
        title={motivo ?? undefined}
      >
        Suavizar estos {n}
      </Boton>
      {motivo && <span style={apagado}>{motivo}</span>}
      {a.error && <Aviso tono="error">{a.error}</Aviso>}
    </div>
  );
}

function CostesCompromisos({ id, k, m, o, onCambio }) {
  const v = vistaCostes(k);
  if (!v) return null;
  return (
    <section
      data-testid="costes-memoria"
      aria-label="Compromisos añadidos y su coste"
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <Subtitulo>Compromisos añadidos y su coste</Subtitulo>
      {v.sinCotejar && (
        <div data-testid="costes-sin-cotejar" style={{ ...texto, color: RIESGO }}>
          {v.sinCotejar}
        </div>
      )}
      {v.vacio ? (
        <div data-testid="costes-comprobado" style={{ ...texto, color: OK_TEXTO }}>
          ✓ {v.vacio}
        </div>
      ) : (
        <>
          <Tabla cabecera={[['Compromiso'], ['Coste'], ['Qué haría']]}>
            {v.filas.map((f, i) => (
              <FilaCoste key={`${f.texto}-${i}`} f={f} />
            ))}
          </Tabla>
          <div data-testid="costes-total" style={{ ...texto, fontWeight: 600, color: v.totalRiesgo ? IMPIDE : TINTA }}>
            {v.total}
          </div>
          <Suavizar id={id} k={k} n={v.aSuavizar} m={m} o={o} onCambio={onCambio} />
        </>
      )}
    </section>
  );
}

function Rondas({ p }) {
  return (
    <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
      {p.rondas.map((r) => (
        <li key={r.ronda} style={apagado}>
          Ronda {r.ronda}: {r.texto ?? 'no estaba'}
        </li>
      ))}
      <li style={texto}>Ahora: {p.ahora ?? 'ya no está en la memoria'}</li>
    </ol>
  );
}

function Marcados({ marcados }) {
  if (!marcados.length) return null;
  return (
    <section data-testid="parrafos-marcados" aria-label="Párrafos marcados">
      <Subtitulo>Párrafos marcados</Subtitulo>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {marcados.map((p) => (
          <li
            key={`${p.apartado}-${p.cita}`}
            data-testid="parrafo-marcado"
            style={{ padding: '6px 0', borderTop: `1px solid ${BORDE}` }}
          >
            <div style={texto}>
              <strong>Apartado {p.apartado}:</strong> «{p.cita}»
            </div>
            <div style={{ ...texto, color: RIESGO }}>{p.motivo}</div>
            {p.arreglo && <div style={apagado}>Arreglo: {p.arreglo}</div>}
            <Rondas p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comprobado({ comprobado }) {
  if (!comprobado.length) return null;
  return (
    <section data-testid="comprobado-memoria" aria-label="Comprobado">
      <Subtitulo>Comprobado</Subtitulo>
      {comprobado.map((c) => (
        <div key={c} style={{ ...texto, color: OK_TEXTO }}>
          ✓ {c}
        </div>
      ))}
    </section>
  );
}

// Lo que se acepta, dicho antes de aceptar: páginas, avisos, apartados sin redactar y lo que se descarta.
function DetalleAceptar({ antes }) {
  const lineas = [
    textoPaginas(antes.paginas, antes.limite),
    textoSinRedactar(antes.sin_redactar),
    textoSeDescartan(antes.se_descartan),
  ].filter(Boolean);
  return (
    <span data-testid="dar-por-buena-detalle">
      {lineas.map((l) => (
        <span key={l} style={{ display: 'block' }}>
          {l}
        </span>
      ))}
      {antes.avisos.length > 0 && <span style={{ display: 'block', marginTop: 4 }}>Avisos que quedan:</span>}
      {antes.avisos.map((a) => (
        <span key={a} style={{ display: 'block', color: RIESGO }}>
          · {a}
        </span>
      ))}
    </span>
  );
}

function useAccion(alTerminar) {
  const [estado, setEstado] = useState({ ocupado: false, error: null, hecho: null });
  const lanzar = async (fn, hecho) => {
    setEstado({ ocupado: true, error: null, hecho: null });
    try {
      await fn();
      setEstado({ ocupado: false, error: null, hecho });
      alTerminar?.();
    } catch (e) {
      setEstado({ ocupado: false, error: e.message, hecho: null });
    }
  };
  return { ...estado, lanzar };
}

// aceptacion: el resumen sin filtrar por lote (el servidor acepta la versión entera y pide motivo con
// él); si el servidor aun así pide motivo (400), se pide aquí en vez de dejar el error a secas.
// «Dar por buena» y «Descartar» la vN. Con fugas, el servidor solo acepta si se explican: el mismo
// motivo las explica.
function useRevisarVersion({ id, version, m, borrador, onCambio }) {
  const [pide, setPide] = useState(null);
  const [pideServidor, setPideServidor] = useState(false);
  const a = useAccion(onCambio);
  const aceptar = (motivo) => {
    setPide(null);
    a.lanzar(async () => {
      try {
        await revisionApi.aceptarMemoria(id, version, {
          motivo,
          anularFugas: fugasDe(m).hallazgos.length ? motivo : undefined,
        });
      } catch (e) {
        if (!motivo && pideMotivoAlAceptar(e)) {
          setPideServidor(true);
          setPide('aceptar');
        }
        throw e;
      }
    }, `La v${version} queda como la memoria buena.`);
  };
  const descartar = (motivo) => {
    setPide(null);
    a.lanzar(async () => {
      await revisionApi.cerrar(id, `memoria:v${version}`, 'descartar', motivo);
      await licitacionesApi.revisarBorrador(borrador.id, 'descartar');
    }, `v${version} descartada.`);
  };
  return { a, pide, setPide, pideServidor, aceptar, descartar };
}

function Acciones({ id, version, r, aceptacion, m, onCambio }) {
  const borrador = m ? revisionDeVersion(m) : null;
  const { a, pide, setPide, pideServidor, aceptar, descartar } = useRevisarVersion({
    id,
    version,
    m,
    borrador,
    onCambio,
  });
  const base = aceptacion ?? r;
  const conMotivo = pideServidor || necesitaMotivo(base.antes_de_aceptar, base.marcados);
  if (a.hecho) return <Aviso>{a.hecho}</Aviso>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!pide && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Boton
            variante="principal"
            escribe
            testid="dar-por-buena"
            cargando={a.ocupado}
            onClick={() => setPide('aceptar')}
          >
            Dar por buena
          </Boton>
          <span style={{ flex: '1 1 0', minWidth: 8 }} />
          {borrador && (
            <Boton
              variante="peligro"
              escribe
              testid="descartar-memoria"
              disabled={a.ocupado}
              onClick={() => setPide('descartar')}
            >
              Descartar
            </Boton>
          )}
        </div>
      )}
      {pide === 'aceptar' && (
        <Confirmacion
          pregunta={`¿Dar por buena la v${version}?`}
          detalle={<DetalleAceptar antes={base.antes_de_aceptar} />}
          textoSi="Dar por buena"
          conMotivo={conMotivo}
          onSi={aceptar}
          onNo={() => setPide(null)}
        />
      )}
      {pide === 'descartar' && (
        <Confirmacion
          pregunta={`¿Descartar la v${version}?`}
          detalle="Deja de ser la memoria de la oferta. El motivo queda guardado."
          textoSi="Descartar"
          destructiva
          conMotivo
          onSi={descartar}
          onNo={() => setPide(null)}
        />
      )}
      {conMotivo && !pide && (
        <div style={apagado}>Queda algo marcado o caro: para darla por buena tendrás que decir por qué.</div>
      )}
      {a.error && <Aviso tono="error">{a.error}</Aviso>}
    </div>
  );
}

// Las versiones anteriores, plegadas: su estado, quién la descartó y por qué, y las fugas que
// llevaban (o por qué se anularon).
function Historial({ memorias, version, descartes }) {
  const anteriores = memorias.filter((m) => !m.ensayo && m.version !== version);
  if (!anteriores.length) return null;
  return (
    <details data-testid="historial-memoria" style={{ marginTop: 4 }}>
      <summary style={{ ...apagado, cursor: 'pointer' }}>
        Historial: {anteriores.map((m) => `v${m.version} ${estadoVersion(m).texto.toLowerCase()}`).join(' · ')}
      </summary>
      {anteriores.map((m) => {
        const f = fugasDe(m);
        const descarte = textoDescarte(m.version, descartes);
        return (
          <div
            key={m.id}
            data-testid={`historial-memoria-v${m.version}`}
            style={{ ...texto, padding: '6px 0', borderTop: `1px solid ${BORDE}` }}
          >
            <div>
              v{m.version}: {estadoVersion(m).texto}
            </div>
            {descarte && (
              <div data-testid={`historial-memoria-v${m.version}-descarte`} style={apagado}>
                {descarte}
              </div>
            )}
            {f.hallazgos.map((h) => (
              <div key={`${h.apartado}-${h.cita}`} style={{ color: RIESGO }}>
                Fuga en el apartado {h.apartado}: «{h.cita}»
              </div>
            ))}
            {f.anulada && <div style={apagado}>Fugas anuladas: «{f.anulada.motivo}»</div>}
          </div>
        );
      })}
    </details>
  );
}

// Los apartados que la versión rehízo sobre su base (p. ej. con «Actualizar los apartados
// afectados»), cada uno con su diff. Uno mantenido sale de apartados_rehechos al recargar: sigue
// a la vista para que se vea que quedó el anterior.
function CambiosPorApartado({ id, m, onCambio }) {
  const [mantenidos, setMantenidos] = useState([]);
  const origen = m?.origen;
  if (!origen || typeof origen.version_base !== 'number' || revisionDeVersion(m)?.estado === 'aceptada') return null;
  const lista = [...new Set([...(origen.apartados_rehechos ?? []), ...mantenidos])].sort((a, b) => a - b);
  if (!lista.length) return null;
  const titulo = (n) => (m.apartados ?? []).find((a) => a.apartado === n)?.titulo ?? null;
  const tras = (n) => {
    setMantenidos((xs) => [...xs, n]);
    onCambio?.();
  };
  return (
    <section
      data-testid="cambios-por-apartado"
      aria-label="Cambios por apartado"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <Subtitulo>Qué cambió respecto a la v{origen.version_base}</Subtitulo>
      {lista.map((n) => (
        <DiffApartado
          key={n}
          id={id}
          version={m.version}
          n={n}
          titulo={titulo(n)}
          puedeMantener={m.estado === 'ensamblada'}
          onCambio={() => tras(n)}
        />
      ))}
    </section>
  );
}

// Desde la tarjeta: lo que cambió en el equipo o los lotes desde que se pidió esta versión
// lo calcula el servidor sin escribir; el coste se ve antes de pedirlo. Sin cambios no sale nada.
function ActualizarAfectados({ id, m, onCambio }) {
  const previa = useCarga(() => memoriaCambiosApi.vistaPrevia(id, m.version), [id, m.version]);
  const [tras, setTras] = useState({ fase: 'nada' });
  const vista = vistaPreviaAfectados(previa.data);
  if (previa.kind === 'error')
    return (
      <div data-testid="tarjeta-afectados-error">
        <Aviso tono="aviso">No se pudo calcular qué apartados afectan los cambios: {previa.message}</Aviso>
      </div>
    );
  if (!vista) return null;
  const pedir = () => {
    setTras({ fase: 'pidiendo' });
    memoriaCambiosApi.actualizarCambios(id, m.version, pedidoActualizarAfectados(vista)).then(
      (r) => {
        setTras({
          fase: 'hecho',
          tono: 'info',
          texto: avisoAfectados(
            { apartados: r?.apartados ?? vista.apartados.map((a) => a.n), version: r?.version },
            vista,
          ),
        });
        onCambio?.();
      },
      (e) => setTras({ fase: 'hecho', tono: e.status === 400 ? 'aviso' : 'error', texto: e.message }),
    );
  };
  return (
    <section
      data-testid="tarjeta-afectados"
      aria-label="Apartados afectados por cambios"
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <Subtitulo>Cambió el equipo o los lotes desde la v{m.version}</Subtitulo>
      <ul data-testid="tarjeta-afectados-lista" style={{ margin: 0, paddingLeft: 18 }}>
        {vista.apartados.map((a) => (
          <li key={a.n ?? a.nombre} style={texto}>
            {a.nombre}
          </li>
        ))}
      </ul>
      {tras.fase === 'hecho' ? (
        <div data-testid="tarjeta-afectados-aviso">
          <Aviso tono={tras.tono}>{tras.texto}</Aviso>
        </div>
      ) : (
        <div>
          <Boton
            variante="principal"
            escribe
            testid="tarjeta-actualizar-afectados"
            cargando={tras.fase === 'pidiendo'}
            onClick={pedir}
          >
            Actualizar los apartados afectados ({textoAfectados(vista)})
          </Boton>
        </div>
      )}
    </section>
  );
}

function Contenido({ id, version, r, aceptacion, o, onCambio }) {
  const m = (o?.memorias ?? []).find((x) => !x.ensayo && x.version === version) ?? null;
  return (
    <>
      <Compromisos compromisos={r.compromisos} />
      <Marcados marcados={r.marcados} />
      <div data-testid="nota-critico" style={{ ...texto, fontWeight: 600 }}>
        {textoNota(r.nota)}
      </div>
      <Comprobado comprobado={r.comprobado} />
      <CostesCompromisos id={id} k={r.costes} m={m} o={o} onCambio={onCambio} />
      <CambiosPorApartado id={id} m={m} onCambio={onCambio} />
      {puedeActualizarAfectados(m) && <ActualizarAfectados id={id} m={m} onCambio={onCambio} />}
      <Acciones id={id} version={version} r={r} aceptacion={aceptacion} m={m} onCambio={onCambio} />
      <Historial memorias={o?.memorias ?? []} version={version} descartes={r.descartes} />
    </>
  );
}

function Resumen({ id, version, onCambio }) {
  const o = useCarga(() => licitacionesApi.oferta(id), [id]);
  const [lote, setLote] = useState(null);
  const { pestanas, lote: elegido } = loteDeLaVista(o.data, version, lote);
  const r = useCarga(() => revisionApi.resumenMemoria(id, version, elegido), [id, version, elegido]);
  // «Dar por buena» acepta la versión entera: el motivo se decide con el resumen sin filtrar, como el servidor.
  const completo = useCarga(
    () => (elegido ? revisionApi.resumenMemoria(id, version, null) : Promise.resolve(null)),
    [id, version, Boolean(elegido)],
  );
  const tras = () => {
    r.recargar();
    completo.recargar();
    o.recargar();
    onCambio?.();
  };
  return (
    <div data-testid="resumen-memoria" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {pestanas.length > 0 && (
        <Pestanas
          vistas={pestanas.map((l) => ({ key: l, label: `Lote ${l}` }))}
          vista={elegido}
          onVista={setLote}
          etiqueta="Lote de la memoria"
          prefijo="resumen-memoria-lote"
        />
      )}
      {r.kind === 'error' && <Aviso tono="error">{r.message}</Aviso>}
      {r.kind !== 'error' && !r.data && <div style={apagado}>Cargando el resumen…</div>}
      {r.data && (
        <Contenido id={id} version={version} r={r.data} aceptacion={completo.data ?? null} o={o.data} onCambio={tras} />
      )}
    </div>
  );
}

export default function ResumenMemoria({ tarjeta, onAbrir, id, onCambio }) {
  const [abierta, setAbierta] = useState(false);
  const version = versionDeClave(tarjeta.clave);
  const abrir = () => {
    setAbierta(true);
    onAbrir?.();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>{tarjeta.titulo}</div>
      <div style={apagado}>{tarjeta.resumen}</div>
      {abierta && version ? (
        <Resumen id={id} version={version} onCambio={onCambio} />
      ) : (
        <div>
          <Boton testid={`abrir-${tarjeta.clave}`} onClick={abrir}>
            Abrir
          </Boton>
        </div>
      )}
    </div>
  );
}
