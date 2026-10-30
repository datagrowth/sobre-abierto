// El estado del radar de licitaciones repartido por las pestañas de Ajustes: Fuentes y filtros
// (ingesta por fuente, histórico de años, pliegos ilegibles y cuentas), Drive (carpetas en
// Conocimiento y su reorganización) y Hermes (perfiles, programado, trabajos y fichas).
import { useState } from 'react';
import { FolderSync, History } from 'lucide-react';
import { TINTA, TINTA_2, RIESGO, BORDE, IMPIDE } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import {
  duracion,
  etiquetaEstado,
  etiquetaModelo,
  etiquetaReorganizacion,
  textoIngesta,
  tonoReorganizacion,
} from '../../lib/licitacionesFormato';
import { fechaHora } from '../../lib/formato';
import { ESTADOS_HISTORICO, progresoHistorico } from '../../lib/preciosFormato';
import { KPI, SectionCard } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Chip } from '../ui';
import ProgramadoBloque from '../comun/ProgramadoBloque';
import TrabajosEstado from '../comun/TrabajosEstado';

const TONO_HISTORICO = {
  pendiente: 'neutro',
  descargando: 'neutro',
  procesando: 'neutro',
  hecho: 'ok',
  error: 'impide',
};

// Lo que «Programado» deja lanzar a mano (lo mismo que los botones de la cabecera).
const ACCIONES = {
  sync: { texto: 'Sincronizar ahora', fn: licitacionesApi.sincronizar },
  cribar: { texto: 'Cribar ahora', fn: licitacionesApi.cribar },
  pausar_regeneracion: { texto: 'Pausar', fn: () => licitacionesApi.regeneracionFichas('pausar') },
  reanudar_regeneracion: { texto: 'Reanudar', fn: () => licitacionesApi.regeneracionFichas('reanudar') },
};

const NOMBRE_FUENTE = { perfiles: 'PLACSP (Estado y adheridos)', agregadas: 'Plataformas agregadas (CCAA y locales)' };

function Conteos({ titulo, datos, etiqueta = (k) => k }) {
  const filas = Object.entries(datos ?? {});
  return (
    <SectionCard title={titulo}>
      {filas.length === 0 ? (
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>Aún no hay datos.</div>
      ) : (
        filas.map(([k, n]) => (
          <div
            key={k}
            style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: TINTA, padding: '2px 0' }}
          >
            <span>{etiqueta(k)}</span>
            <span className="tabular-nums">{n}</span>
          </div>
        ))
      )}
    </SectionCard>
  );
}

const celda = { padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' };
const valor = (v, sufijo = '') => (v == null ? '—' : `${v}${sufijo}`);

// Calidad de las fichas (medida por código) y lo que costaron, por modelo: para elegir el
// modelo del perfil de Hermes con las mismas fichas.
function FichasHermes({ f }) {
  if (!f?.recientes?.length) return null;
  return (
    <SectionCard title="FICHAS DE HERMES">
      {f.por_modelo.length > 0 && (
        <div style={{ fontSize: 12.5, color: TINTA, marginBottom: 8 }}>
          {f.por_modelo.map((m) => (
            <div key={m.modelo}>
              <b style={{ fontWeight: 600 }}>{etiquetaModelo(m.modelo)}</b>: {m.fichas} fichas · calidad media{' '}
              {valor(m.calidad_media, '/100')} · {valor(m.dudosos_media, ' %')} por confirmar ·{' '}
              {m.duracion_media_s == null ? '—' : duracion(m.duracion_media_s)} · {valor(m.tokens_media)} tokens
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: TINTA_2 }}>
            Medias de las fichas hechas con la versión actual del análisis (v{f.version_actual}).
          </div>
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: TINTA_2 }}>
              {[
                'Licitación',
                'Versión',
                'Modelo',
                'Calidad',
                'Por confirmar',
                'Corregidos',
                'Duración',
                'Llamadas',
                'Recortadas',
              ].map((t) => (
                <th key={t} scope="col" style={celda}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {f.recientes.map((r) => (
              <tr key={`${r.licitacion}-${r.creada_en}`} style={{ borderTop: `1px solid ${BORDE}` }}>
                <td style={celda}>{r.licitacion}</td>
                <td style={celda}>v{r.version}</td>
                <td style={celda}>{r.modelo ? etiquetaModelo(r.modelo) : '—'}</td>
                <td style={celda}>{valor(r.calidad)}</td>
                <td style={celda}>{valor(r.dudosos_pct, ' %')}</td>
                <td style={celda}>{valor(r.corregidos)}</td>
                <td style={celda}>{r.duracion_s == null ? '—' : duracion(r.duracion_s)}</td>
                <td style={celda}>{valor(r.llamadas)}</td>
                <td style={{ ...celda, color: r.recortadas ? RIESGO : TINTA }}>{r.recortadas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// Pliegos bajados que la Biblioteca no puede leer: sin ellos no hay ficha (no se pide sola).
function PliegosIlegibles({ filas = [] }) {
  if (!filas.length) return null;
  return (
    <SectionCard title="PLIEGOS QUE NO SE PUEDEN LEER">
      <div style={{ fontSize: 12.5, color: TINTA_2, marginBottom: 6 }}>
        La ficha automática no se pide mientras el PCAP (o el PPT) no se pueda leer. Revisa el documento en Drive: si es
        un escaneo, súbelo en PDF con texto.
      </div>
      {filas.map((p) => (
        <div key={p.ruta} style={{ fontSize: 12.5, color: TINTA, padding: '3px 0', borderTop: `1px solid ${BORDE}` }}>
          <div>
            {p.titulo} <span style={{ color: TINTA_2 }}>· {p.clase.toUpperCase()}</span>
          </div>
          <div style={{ color: RIESGO }}>
            {p.ruta.split('/').pop()}: {p.problema}
          </div>
        </div>
      ))}
    </SectionCard>
  );
}

function Fuente({ id, f }) {
  const u = f.ultima;
  return (
    <SectionCard title={NOMBRE_FUENTE[id] ?? id}>
      <div style={{ fontSize: 12.5, color: TINTA, lineHeight: 1.7 }}>
        <div>Última vuelta: {fechaHora(f.ultima_vuelta)}</div>
        <div>Al día hasta: {fechaHora(f.hasta)}</div>
        {u && (
          <div style={{ color: TINTA_2 }}>
            {u.paginas} páginas · {u.entradas} entradas · {u.cambiadas} nuevas o cambiadas
            {u.errores ? ` · ${u.errores} ilegibles` : ''}
          </div>
        )}
        {f.ultimo_error && <div style={{ color: RIESGO }}>Último error: {f.ultimo_error}</div>}
      </div>
    </SectionCard>
  );
}

function anio(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 2012 && n <= 2100 ? n : NaN;
}

function PedirHistorico({ desdeInicial, onPedido }) {
  const [desde, setDesde] = useState(String(desdeInicial));
  const [hasta, setHasta] = useState('');
  const [repetir, setRepetir] = useState(false);
  const [aviso, setAviso] = useState(null);
  const enviar = async (e) => {
    e.preventDefault();
    const d = anio(desde);
    const h = anio(hasta);
    if (d === null || Number.isNaN(d) || Number.isNaN(h))
      return setAviso({ tono: 'error', texto: 'Los años van de 2012 en adelante.' });
    try {
      const r = await licitacionesApi.cargarHistorico({ desde: d, ...(h === null ? {} : { hasta: h }), repetir });
      const parada = r.en_marcha ? '' : ' La ingesta está parada: empezará cuando arranque.';
      setAviso({ tono: 'info', texto: `${r.pedidos} ${r.pedidos === 1 ? 'año' : 'años'} en cola.${parada}` });
      onPedido();
    } catch (err) {
      setAviso({ tono: 'error', texto: err.message });
    }
  };
  const campo = { display: 'block', width: 90, marginTop: 3 };
  return (
    <form
      onSubmit={enviar}
      style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', margin: '10px 0' }}
    >
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Desde
        <input
          className="input-field"
          inputMode="numeric"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          style={campo}
        />
      </label>
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Hasta
        <input
          className="input-field"
          inputMode="numeric"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          placeholder="este año"
          style={campo}
        />
      </label>
      <label style={{ fontSize: 12, color: TINTA_2, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
        <input type="checkbox" checked={repetir} onChange={(e) => setRepetir(e.target.checked)} /> Volver a cargar los
        años hechos
      </label>
      <Boton Icono={History} submit>
        Cargar histórico
      </Boton>
      {aviso && (
        <div style={{ flexBasis: '100%' }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </form>
  );
}

function Historico({ h, onPedido }) {
  if (!h) return null;
  return (
    <SectionCard
      title="HISTÓRICO DE ADJUDICACIONES"
      right={h.guarda_todo ? 'guarda todo' : 'solo el sector'}
      style={{ flexBasis: '100%' }}
    >
      <div style={{ fontSize: 12.5, color: TINTA_2, lineHeight: 1.5 }}>
        Baja los ZIP de la PLACSP (uno por mes desde 2018, anuales antes) para los precios y, más adelante, los
        competidores. Guarda solo lo del sector: CPV de <strong>Filtros</strong> y de <strong>Empresa</strong>, o
        palabras clave. La PLACSP es lenta (un mes de perfiles pesa más de 100 MB): un año tarda horas, sin frenar el
        radar. Si se corta, sigue donde iba.
      </div>
      <PedirHistorico desdeInicial={h.desde_por_defecto} onPedido={onPedido} />
      {h.anios.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: TINTA_2, textAlign: 'left' }}>
                <th scope="col">Año</th>
                <th scope="col">Fuente</th>
                <th scope="col">Estado</th>
                <th scope="col">Progreso</th>
              </tr>
            </thead>
            <tbody>
              {h.anios.map((f) => (
                <tr key={`${f.fuente}-${f.anio}`} style={{ borderTop: `1px solid ${BORDE}` }}>
                  <td className="tabular-nums" style={{ padding: '4px 6px 4px 0' }}>
                    {f.anio}
                  </td>
                  <td style={{ padding: '4px 6px' }}>{NOMBRE_FUENTE[f.fuente] ?? f.fuente}</td>
                  <td style={{ padding: '4px 6px' }}>
                    <Chip tono={TONO_HISTORICO[f.estado]} punto={false}>
                      {ESTADOS_HISTORICO[f.estado] ?? f.estado}
                    </Chip>
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ padding: '4px 6px', color: f.estado === 'error' ? RIESGO : TINTA }}
                  >
                    {progresoHistorico(f)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

const TONO_CHIP = { exito: 'ok', error: 'impide', aviso: 'riesgo', info: 'neutro' };

function ListaRutas({ titulo, filas, color = TINTA }) {
  if (!filas?.length) return null;
  return (
    <details style={{ fontSize: 12, marginTop: 6 }}>
      <summary style={{ cursor: 'pointer', color: TINTA_2 }}>
        {titulo} ({filas.length})
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, color, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
        {filas.map((f) => (
          <li key={`${f.de ?? f.ruta}`}>
            {f.de ? (
              <>
                {f.de} → {f.a}
              </>
            ) : (
              <>
                {f.ruta}: <span style={{ color: TINTA_2 }}>{f.motivo}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Carpetas({ c, onRecargar }) {
  const [aviso, setAviso] = useState(null);
  if (!c) return null;
  const r = c.reorganizacion;
  // «Comprobando…» solo mientras de verdad mueve: al acabar manda el chip del estado.
  const visible = aviso && (aviso.tono !== 'info' || r.estado === 'en_curso') ? aviso : null;
  const comprobar = async () => {
    try {
      await licitacionesApi.reorganizarCarpetas();
      setAviso({ tono: 'info', texto: 'Comprobando en Drive…' });
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    }
    onRecargar();
  };
  const omitidas =
    r.total_omitidas > r.omitidas.length
      ? `Sin mover (primeras ${r.omitidas.length} de ${r.total_omitidas})`
      : 'Sin mover';
  return (
    <SectionCard
      title="CARPETAS EN CONOCIMIENTO"
      right={
        <Chip tono={TONO_CHIP[tonoReorganizacion(r.estado)]} punto={false}>
          {etiquetaReorganizacion(r.estado)}
        </Chip>
      }
      style={{ flexBasis: '100%' }}
    >
      <div style={{ fontSize: 12.5, color: TINTA, lineHeight: 1.7 }}>
        <div>
          Lo que baja el radar: <strong>Conocimiento/{c.radar}/&lt;año&gt;/</strong>
        </div>
        <div>
          Lo presentado: <strong>Conocimiento/{c.presentadas}/</strong>
        </div>
        {r.mensaje && (
          <div style={{ color: TINTA_2 }}>
            {r.mensaje}
            {r.actualizada_en ? ` (${fechaHora(r.actualizada_en)})` : ''}
          </div>
        )}
        {r.descarga_en_espera && (
          <div style={{ color: RIESGO }}>La descarga de pliegos espera a que termine la reorganización.</div>
        )}
      </div>
      <ListaRutas titulo="Movidas" filas={r.movidas} />
      <ListaRutas titulo={omitidas} filas={r.omitidas} color={TINTA_2} />
      <ListaRutas titulo="Con error" filas={r.errores} color={IMPIDE} />
      <div style={{ marginTop: 10 }}>
        <Boton
          Icono={FolderSync}
          onClick={comprobar}
          title="Vuelve a mirar en Drive y mueve lo que aún esté en la estructura anterior"
        >
          Comprobar de nuevo
        </Boton>
      </div>
      {visible && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={visible.tono}>{visible.texto}</Aviso>
        </div>
      )}
    </SectionCard>
  );
}

// De qué perfil de Hermes salen la preparación de ofertas y la crítica de la memoria: un
// crítico sin perfil propio es el mismo modelo que redacta y tiende a sobrevalorar.
function PerfilesOferta({ estado }) {
  if (!estado.hermes_oferta && !estado.hermes_critico) return null;
  const sinCritico = typeof estado.hermes_critico === 'string' && !estado.hermes_critico.startsWith('perfil propio');
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: TINTA_2 }}>
      {estado.hermes_oferta && <div>Preparación de ofertas: {estado.hermes_oferta}.</div>}
      {estado.hermes_critico && (
        <div style={{ color: sinCritico ? RIESGO : TINTA_2 }}>Crítico de la memoria: {estado.hermes_critico}.</div>
      )}
    </div>
  );
}

const cargando = <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>;

/** Ajustes › Fuentes y filtros: la ingesta por fuente, el histórico, lo que no se puede leer y las cuentas. */
export function EstadoFuentes({ estado, onRecargar = () => {} }) {
  if (!estado) return cargando;
  const ing = estado.ingesta?.estado;
  const ingesta = textoIngesta(estado);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label="Licitaciones" value={ing?.contadores.total ?? '—'} hint="guardadas" />
        <KPI label="Abiertas" value={ing?.contadores.abiertas ?? '—'} hint="en plazo o anuncio previo" />
        <KPI label="Adjudicaciones" value={ing?.contadores.adjudicaciones ?? '—'} hint="para precios y competidores" />
        <div data-testid="estado-ingesta" style={{ display: 'contents' }}>
          <KPI
            label="Ingesta"
            value={ingesta.valor}
            hint={ingesta.pista}
            accent={ingesta.valor === 'sin novedades' ? RIESGO : undefined}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {Object.entries(ing?.fuentes ?? {}).map(([id, f]) => (
          <Fuente key={id} id={id} f={f} />
        ))}
      </div>
      <Historico h={estado.historico} onPedido={onRecargar} />
      <PliegosIlegibles filas={estado.pliegos_ilegibles} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Conteos titulo="OPORTUNIDADES" datos={estado.oportunidades} etiqueta={etiquetaEstado} />
        <Conteos titulo="LOTES DE CRIBA" datos={estado.lotes} />
        <Conteos titulo="PLIEGOS" datos={estado.pliegos} />
        <Conteos titulo="FICHAS" datos={estado.fichas} />
        <Conteos titulo="CARPETAS DE PRESENTADAS" datos={estado.carpetas?.carpetas_presentadas} />
      </div>
    </div>
  );
}

/** Ajustes › Drive: dónde deja el radar los pliegos en Conocimiento y la reorganización de carpetas. */
export function CarpetasConocimiento({ estado, onRecargar = () => {} }) {
  if (!estado) return cargando;
  return <Carpetas c={estado.carpetas} onRecargar={onRecargar} />;
}

/** Ajustes › Hermes: los perfiles de la oferta, lo programado, los trabajos de la cola y las fichas. */
export function EstadoHermes({ estado }) {
  if (!estado) return cargando;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PerfilesOferta estado={estado} />
      <ProgramadoBloque dominios={['licitaciones']} acciones={ACCIONES} />
      <TrabajosEstado />
      <FichasHermes f={estado.fichas_hermes} />
    </div>
  );
}
