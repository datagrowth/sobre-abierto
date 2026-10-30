// El cajón Guion: el guion del pliego, lo que hay que entregar y cómo se puntúa,
// extraído por Hermes con documento y página de cada dato. Por defecto solo enseña lo que pide
// atención (las dudas de Hermes, qué cambió frente a la versión anterior y las prohibiciones
// cuando tienen sentido); el guion entero, literal, va plegado debajo, con las filas de otros
// lotes aparte y fuera de los recuentos. Volver a extraer pasa antes por «Qué cambia».
import { FileSearch } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, RIESGO, IMPIDE, FONT_MONO, TIPO, alpha } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { euros, fechaConHora, fechaHora, plural } from '../../../lib/formato';
import {
  cita,
  documentosDeArchivo,
  estadoGuion,
  guionDesfasado,
  memoriaValorable,
  ofertasEconomicas,
  plazoDiscrepa,
  resumenGuion,
  textoFormatoMemoria,
  textoImpuesto,
  textoLotesOferta,
  textoPrecioUnitario,
} from '../../../lib/ofertaFormato';
import { Enlace, Subtitulo } from '../../comun/listas';
import { Aviso, Boton, Chip } from '../../ui';
import { dividirPorLotes, prohibicionesVisibles, textoCambiosGuion } from '../../../lib/guionVista';
import useGuardarConImpacto from '../../../hooks/useGuardarConImpacto';
import RelanzarTrabajo from '../RelanzarTrabajo';
import { PanelImpacto } from './QueCambia';
import SiNosProponen from './SiNosProponen';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };
const celda = { padding: '5px 8px', textAlign: 'left', verticalAlign: 'top' };

function Documento({ d }) {
  return (
    <li style={{ ...texto, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', padding: '3px 0' }}>
      <span style={{ fontWeight: 600 }}>{d.nombre}</span>
      <Chip>{d.tipo}</Chip>
      {!d.obligatorio && <Chip>opcional</Chip>}
      <span style={{ color: TINTA_2 }}>
        {d.quien}
        {d.modelo ? ` · modelo ${d.modelo}` : ''}
      </span>
      {d.cita && <span style={apagado}>{d.cita}</span>}
      {d.notas && <span style={{ color: TINTA_2, flexBasis: '100%' }}>{d.notas}</span>}
    </li>
  );
}

function Archivo({ a }) {
  return (
    <div style={{ padding: '8px 0', borderTop: `1px solid ${BORDE}` }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ ...texto, fontWeight: 700 }}>{a.nombre}</span>
        {cita(a) && <span style={apagado}>{cita(a)}</span>}
      </div>
      {a.contenido && <div style={{ ...texto, color: TINTA_2, marginTop: 2 }}>{a.contenido}</div>}
      {/* La firma es literal del pliego (a veces una frase entera): texto que parte línea, no etiqueta. */}
      {a.firma && (
        <div style={{ ...texto, color: TINTA_2, marginTop: 2 }}>
          <span style={{ color: TINTA, fontWeight: 600 }}>Firma:</span> {a.firma}
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
        {documentosDeArchivo(a).map((d) => (
          <Documento key={d.nombre} d={d} />
        ))}
      </ul>
      {a.prohibiciones?.length > 0 && (
        <ul
          aria-label={`Prohibido en ${a.nombre}`}
          style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: TIPO.texto, color: RIESGO, lineHeight: 1.5 }}
        >
          {a.prohibiciones.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rubrica({ ap, valorable }) {
  if (!ap.se_valorara?.length && !ap.escala?.length) return null;
  return (
    <details style={{ marginTop: 4 }}>
      <summary style={{ cursor: 'pointer', fontSize: TIPO.pequeno, color: TINTA_2 }}>
        {valorable ? 'Se valorará y escala' : 'Contenido que exige el pliego'}
      </summary>
      {ap.se_valorara?.length > 0 && (
        <ul style={{ margin: '4px 0', paddingLeft: 18, ...texto }}>
          {ap.se_valorara.map((s, i) => (
            <li key={s}>
              {s}
              {ap.puntos_se_valorara?.[i] != null ? (
                <span className="tabular-nums" style={{ color: TINTA_2 }}>
                  {' '}
                  · máx. {ap.puntos_se_valorara[i]} pt
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {ap.escala?.length > 0 && (
        <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', ...texto, color: TINTA_2 }}>
          {ap.escala.map((e) => (
            <li key={`${e.puntos}-${e.descripcion}`}>
              <b className="tabular-nums" style={{ color: TINTA, fontWeight: 600 }}>
                {e.puntos} pt
              </b>{' '}
              · {e.descripcion}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Memoria({ m }) {
  if (!m)
    return <div style={{ ...texto, color: TINTA_2 }}>El guion no trae memoria técnica: el pliego no la pide.</div>;
  const valorable = memoriaValorable(m);
  return (
    <>
      <div style={{ ...texto, color: TINTA_2 }}>
        «{m.titulo_documento}» en {m.archivo} · {textoFormatoMemoria(m)}
        {cita(m) ? ` · ${cita(m)}` : ''}
      </div>
      {!valorable && (
        <div style={{ ...texto, color: TINTA_2, marginTop: 2 }}>
          No se puntúa: el pliego la exige con un contenido mínimo y la mesa comprueba que está todo.
        </div>
      )}
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={{ width: '100%', fontSize: TIPO.texto, color: TINTA, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: TINTA_2 }}>
              {['Apartado', ...(valorable ? ['Puntos'] : []), 'Pág.'].map((t) => (
                <th key={t} scope="col" style={celda}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.apartados.map((ap, i) => (
              <tr key={ap.titulo} style={{ borderTop: `1px solid ${BORDE}` }}>
                <td style={celda}>
                  <span style={{ fontWeight: 600 }}>
                    {i + 1}. {ap.titulo}
                  </span>
                  <Rubrica ap={ap} valorable={valorable} />
                </td>
                {valorable && (
                  <td style={celda} className="tabular-nums">
                    {ap.puntos}
                  </td>
                )}
                <td style={celda} className="tabular-nums">
                  {ap.pagina ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.advertencias?.map((a) => (
        <div key={a} style={{ marginTop: 6 }}>
          <Aviso tono="aviso">{a}</Aviso>
        </div>
      ))}
    </>
  );
}

function Automaticos({ items, conMarcas }) {
  if (!items.length) return null;
  return (
    <>
      <Subtitulo>Criterios automáticos (fuera de la memoria)</Subtitulo>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((a) => (
          <li key={a.criterio} style={{ ...texto, padding: '4px 0', borderTop: `1px solid ${BORDE}` }}>
            <span style={{ fontWeight: 600 }}>{a.criterio}</span>{' '}
            <span className="tabular-nums" style={{ color: TINTA_2 }}>
              · {a.puntos} pt
            </span>
            {textoLotesOferta(a.lotes) && (
              <>
                {' '}
                <Chip>{textoLotesOferta(a.lotes)}</Chip>
              </>
            )}
            {a.tipo && (
              <>
                {' '}
                <Chip>{a.tipo === 'compromiso' ? 'compromiso' : 'acreditación'}</Chip>
              </>
            )}
            <div style={{ color: TINTA_2 }}>
              {a.como_se_acredita}
              {a.casilla_en ? ` · casilla en ${a.casilla_en}` : ''} · va en {a.archivo}
              {cita(a) ? ` · ${cita(a)}` : ''}
            </div>
            {a.tramos?.length > 0 && (
              <ul style={{ margin: '2px 0 0', padding: 0, listStyle: 'none', color: TINTA_2 }}>
                {a.tramos.map((t) => (
                  <li key={t.descripcion}>
                    <b className="tabular-nums" style={{ color: TINTA, fontWeight: 600 }}>
                      {t.puntos} pt
                    </b>{' '}
                    · {t.descripcion}
                    {t.valor ? ` (se teclea «${t.valor}»)` : ''}
                  </li>
                ))}
              </ul>
            )}
            {a.exige_documento && <div style={{ color: RIESGO }}>Documento exigido: {a.exige_documento}</div>}
            {a.penalizacion && (
              <div style={{ color: TINTA_2 }}>
                Penalización si se incumple: {a.penalizacion.texto}
                {cita(a.penalizacion) ? ` · ${cita(a.penalizacion)}` : ''}
              </div>
            )}
            {conMarcas && a.marcas?.length > 0 && (
              <div style={apagado}>La memoria no puede decir: {a.marcas.map((m) => `«${m}»`).join(', ')}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function OfertaEconomica({ oe }) {
  const lotes = textoLotesOferta(oe.lotes);
  return (
    <div style={{ padding: '6px 0', borderTop: `1px solid ${BORDE}` }} data-testid="guion-oferta-economica">
      {lotes && <div style={{ ...texto, fontWeight: 700 }}>{lotes}</div>}
      <div
        style={{
          ...texto,
          fontFamily: FONT_MONO,
          fontSize: TIPO.pequeno + 1,
          background: alpha(TINTA, 0.04),
          padding: '6px 8px',
          borderRadius: 6,
          overflowWrap: 'anywhere',
        }}
      >
        {oe.formula}
      </div>
      <div style={{ ...texto, color: TINTA_2, marginTop: 4 }}>
        {oe.presupuesto_base != null
          ? `Presupuesto base ${euros(oe.presupuesto_base)}`
          : 'Sin presupuesto base en el guion'}
        {textoImpuesto(oe.impuesto_aparte) ? ` (${textoImpuesto(oe.impuesto_aparte)})` : ''}
        {oe.umbral_anormalidad ? ` · anormalidad: ${oe.umbral_anormalidad}` : ''}
        {oe.redondeo ? ` · redondeo: ${oe.redondeo}` : ''}
        {oe.modelo ? ` · modelo ${oe.modelo}` : ''} · va en {oe.archivo}
        {cita(oe) ? ` · ${cita(oe)}` : ''}
      </div>
      {oe.precios_unitarios.length > 0 && (
        <ul
          aria-label={`Precios unitarios${lotes ? ` del ${lotes.toLowerCase()}` : ''}`}
          style={{ margin: '4px 0 0', paddingLeft: 18, ...texto }}
        >
          {oe.precios_unitarios.map((p) => (
            <li key={p.concepto} className="tabular-nums">
              {textoPrecioUnitario(p)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OfertasEconomicas({ datos }) {
  const ofertas = ofertasEconomicas(datos);
  if (!ofertas.length) return null;
  return (
    <>
      <Subtitulo>{ofertas.length > 1 ? 'Ofertas económicas por lote' : 'Oferta económica'}</Subtitulo>
      {ofertas.map((oe) => (
        <OfertaEconomica key={(oe.lotes ?? []).join('+') || 'contrato'} oe={oe} />
      ))}
    </>
  );
}

function Plazo({ p, fechaLimite }) {
  const discrepa = plazoDiscrepa(p?.fecha_limite, fechaLimite);
  return (
    <>
      <Subtitulo>Plazo y canal</Subtitulo>
      <div style={texto}>
        {p?.fecha_limite ? `Hasta ${fechaConHora(p.fecha_limite)}` : 'El guion no trae fecha límite'}
        {p?.canal ? ` · ${p.canal}` : ''}
        {p?.observaciones ? ` · ${p.observaciones}` : ''}
      </div>
      {discrepa && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="aviso">
            El pliego dice {fechaConHora(p.fecha_limite)} y la PLACSP, {fechaConHora(fechaLimite)}: comprueba cuál manda
            antes de planificar.
          </Aviso>
        </div>
      )}
    </>
  );
}

function textoExtraer(o) {
  const e = estadoGuion(o);
  if (e.clave === 'en_curso') return e.texto;
  return o.guion ? 'Volver a extraer del pliego' : 'Extraer del pliego';
}

const AVISO_EXTRAER = {
  tono: 'info',
  texto: 'Hermes leerá el pliego y dejará aquí el guion; si ya había uno, lo que no cambie sigue valiendo.',
};
// Sin guion, extraerlo no invalida nada: el «impacto» vacío hace que se pida sin panel.
const SIN_GUION = async () => ({ afectadas: [], se_mantiene: [], resumen: '' });
const FALLO_REEXTRAER =
  'No se pudo calcular qué cambia al volver a extraer. ¿Extraerlo igualmente? Lo que dependa del guion puede quedar desfasado.';

function motivoExtraer(o) {
  if (!o.ficha_aprobada)
    return {
      texto: 'Primero hace falta la ficha aprobada: el guion se contrasta con sus criterios.',
      enlace: { texto: 'Ir a Requisitos', seccion: 'requisitos' },
    };
  if (o.pliegos_listos === false)
    return {
      texto: 'Los pliegos aún no se leen en la Biblioteca: el guion se extrae de ellos.',
      enlace: { texto: 'Ver los pliegos', seccion: 'pliegos' },
    };
  return null;
}

// Volver a extraer enseña antes lo que invalida y su coste.
function Extraer({ id, o, onCambio, irA }) {
  const pedir = async () => {
    await licitacionesApi.extraerGuion(id);
    onCambio();
  };
  const impacto = useGuardarConImpacto(id, {
    cambio: { guion: 'reextraer' },
    guardar: pedir,
    calcular: o.guion ? null : SIN_GUION,
  });
  const motivo = motivoExtraer(o);
  // El aviso del hook dice «Guardado»: aquí no se guarda nada, se pide a Hermes.
  const g = impacto.aviso?.tono === 'info' ? { ...impacto, aviso: AVISO_EXTRAER } : impacto;
  return (
    <div style={{ marginTop: 10 }}>
      <Boton
        Icono={FileSearch}
        testid="guion-extraer"
        disabled={Boolean(motivo) || impacto.estado.fase === 'panel'}
        cargando={impacto.ocupado || Boolean(o.guion_en_curso)}
        onClick={() => impacto.iniciar()}
        title={
          motivo?.texto ?? 'Hermes lee las cláusulas de criterios y de contenido de los sobres y saca el guion literal'
        }
      >
        {textoExtraer(o)}
      </Boton>
      {motivo && (
        <div style={{ ...apagado, marginTop: 4 }}>
          {motivo.texto} {irA && <Enlace onClick={() => irA(motivo.enlace.seccion)}>{motivo.enlace.texto}</Enlace>}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <PanelImpacto g={g} conMarcar={false} textoRehacer="Volver a extraer" textoFallo={FALLO_REEXTRAER} />
      </div>
    </div>
  );
}

const plegable = { marginTop: 10, borderTop: `1px solid ${BORDE}`, paddingTop: 6 };
const resumenPlegable = { cursor: 'pointer', fontSize: TIPO.texto, fontWeight: 600, color: TINTA };

// Los lotes a los que vamos: los decididos o, sin decisiones, los de interés de la licitación.
function lotesDecididos(f, o) {
  const decididos = o.decisiones?.datos?.lotes;
  return decididos?.length ? decididos : (f.lotes_interes ?? []).map((l) => l.id);
}

function Dudas({ avisos }) {
  return (
    <div data-testid="guion-dudas">
      <Subtitulo>Dudas de Hermes ({avisos.length})</Subtitulo>
      {!avisos.length && <div style={{ ...texto, color: TINTA_2 }}>Hermes no dejó dudas en este guion.</div>}
      {avisos.map((a) => (
        <div key={a} style={{ marginTop: 6 }}>
          <Aviso tono="aviso">{a}</Aviso>
        </div>
      ))}
    </div>
  );
}

function CambiosGuion({ g }) {
  if (!(g.version > 1)) return null;
  return (
    <div data-testid="guion-cambios">
      <Subtitulo>Cambios frente a la v{g.version - 1}</Subtitulo>
      <div style={texto}>{textoCambiosGuion(g.cambios, g.version)}</div>
    </div>
  );
}

function Prohibiciones({ grupos }) {
  if (!grupos.length) return null;
  return (
    <div data-testid="guion-prohibiciones">
      <Subtitulo>Prohibiciones</Subtitulo>
      {grupos.map((p) => (
        <div key={p.donde} style={{ ...texto, marginTop: 4 }}>
          <span style={{ fontWeight: 600 }}>{p.donde}</span>
          <ul style={{ margin: '2px 0 0', paddingLeft: 18, color: RIESGO }}>
            {p.textos.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function OtrosLotes({ ajenos }) {
  if (!ajenos.total) return null;
  const filas = [
    ...ajenos.documentos.map((x) => ({
      k: `d-${x.archivo}-${x.documento.nombre}`,
      t: x.documento.nombre,
      en: x.archivo,
    })),
    ...ajenos.automaticos.map((a) => ({
      k: `a-${a.criterio}-${(a.lotes ?? []).join('+')}`,
      t: a.criterio,
      en: textoLotesOferta(a.lotes),
    })),
    ...ajenos.ofertas.map((oe) => ({
      k: `o-${(oe.lotes ?? []).join('+')}`,
      t: 'Oferta económica',
      en: textoLotesOferta(oe.lotes),
    })),
  ];
  return (
    <details data-testid="guion-otros-lotes" style={plegable}>
      <summary style={{ ...resumenPlegable, color: TINTA_2 }}>{ajenos.total} de otros lotes</summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, ...texto, color: TINTA_2 }}>
        {filas.map((x) => (
          <li key={x.k}>
            {x.t}
            {x.en ? <span style={apagado}> · {x.en}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

// La vista por lote de siempre, con las filas de los lotes a los que vamos.
function GuionCompleto({ d, ajenos, conMarcas, fechaLimite }) {
  return (
    <details data-testid="guion-completo" style={plegable}>
      <summary style={resumenPlegable}>Ver el guion completo</summary>
      <Subtitulo>{plural(d.archivos.length, 'Archivo electrónico', 'Archivos electrónicos')}</Subtitulo>
      {d.archivos.map((a) => (
        <Archivo key={a.nombre} a={a} />
      ))}
      <Subtitulo>Memoria técnica</Subtitulo>
      <Memoria m={d.memoria} />
      <Automaticos items={d.automaticos ?? []} conMarcas={conMarcas} />
      <OfertasEconomicas datos={d} />
      <Plazo p={d.plazo} fechaLimite={fechaLimite} />
      {d.lotes?.length > 0 && (
        <div style={{ ...texto, color: TINTA_2, marginTop: 6 }}>Lotes del guion: {d.lotes.join(', ')}</div>
      )}
      <OtrosLotes ajenos={ajenos} />
    </details>
  );
}

function Guion({ f, o, g }) {
  const { propios, ajenos } = dividirPorLotes(g.datos, lotesDecididos(f, o));
  const prohibiciones = prohibicionesVisibles(g.datos);
  return (
    <>
      <div style={texto}>{resumenGuion(propios)}</div>
      <div style={apagado}>
        v{g.version} · {fechaHora(g.creado_en)}
      </div>
      {guionDesfasado(o, f.go_no_go?.ficha?.aprobada?.id ?? null) && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="aviso">
            La ficha cambió después de este guion: vuelve a extraerlo para que los apartados casen con sus criterios.
          </Aviso>
        </div>
      )}
      {o.lotes_cambiados && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="aviso">
            Este guion se extrajo para los lotes {(g.datos.lotes ?? []).join(', ')} y los lotes a los que vamos han
            cambiado: vuelve a extraerlo.
          </Aviso>
        </div>
      )}
      <Dudas avisos={g.avisos ?? []} />
      <CambiosGuion g={g} />
      <Prohibiciones grupos={prohibiciones} />
      <GuionCompleto d={propios} ajenos={ajenos} conMarcas={prohibiciones.length > 0} fechaLimite={f.fecha_limite} />
      <SiNosProponen docs={g.datos.documentos_adjudicacion} />
    </>
  );
}

export default function GuionOferta({ f, o, onCambio, irA }) {
  const g = o.guion;
  return (
    <div data-testid="guion">
      {!g && (
        <div style={{ ...texto, color: TINTA_2 }}>
          Aún no hay guion: Hermes lo extrae del pliego cuando la licitación pasa a «En preparación» con ficha aprobada,
          o con el botón.
        </div>
      )}
      {g && <Guion f={f} o={o} g={g} />}
      {o.guion_en_curso && (
        <div style={{ ...texto, color: TINTA_2, marginTop: 6 }}>
          {!g && estadoGuion(o).texto} <RelanzarTrabajo id={f.id} tipo="guion" onHecho={onCambio} />
        </div>
      )}
      {f.estado !== 'sin_oportunidad' && <Extraer id={f.id} o={o} onCambio={onCambio} irA={irA} />}
      {!o.ficha_aprobada && g && (
        <div style={{ ...apagado, color: IMPIDE, marginTop: 4 }}>
          La ficha ya no está aprobada: el guion se queda, pero no se puede volver a extraer hasta aprobar una.
        </div>
      )}
    </div>
  );
}
