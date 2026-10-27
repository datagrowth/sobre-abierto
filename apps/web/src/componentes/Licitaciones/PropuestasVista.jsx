// Vista «Presentadas»: histórico de lo presentado con su resultado y estadísticas (tasa de
// éxito por sector, órgano y banda de importe; nuestra baja frente a la ganadora;
// puntuaciones), lo aprendido de las actas de mesa y, al elegir una, el detalle de su licitación.
// La elegida va en la ruta (#/licitaciones/presentadas/<id>): sobrevive a recargar y Atrás vuelve.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, LIENZO, SUPERFICIE_2, RADIUS_PANEL, RIESGO } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { euros, fechaCorta } from '../../lib/formato';
import { porcentaje, puntos } from '../../lib/preciosFormato';
import {
  RESULTADOS,
  avisoBaja,
  estadisticasVisibles,
  textoGanadas,
  textoPendientes,
  textoSinPropuestas,
} from '../../lib/propuestasFormato';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import usePeticionVigente from '../../hooks/usePeticionVigente';
import { KPI, SectionCard } from '../Biblioteca/bibliotecaUi';
import { ChipResultado, FormPresentacion } from './PropuestaRegistro';
import AprendizajesActas from './AprendizajesActas';
import DescargarCsv from '../comun/DescargarCsv';
import { Aviso, Boton, Esqueleto } from '../ui';
import { Desplazable, Pildora } from '../comun/ui';

// La ficha (con todo el trabajo de la oferta) es lo más pesado de la web: se descarga al abrir una.
const FichaLicitacion = lazy(() => import('./FichaLicitacion'));

const celda = { padding: '4px 6px', textAlign: 'left' };
const numero = { ...celda, textAlign: 'right' };

function TablaExito({ titulo, grupos, testid }) {
  return (
    <div data-testid={testid} style={{ flex: '1 1 200px', minWidth: 0 }}>
      <SectionCard title={titulo}>
        {grupos.length === 0 ? (
          <div style={{ fontSize: 12.5, color: TINTA_2 }}>Aún no hay ofertas resueltas.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: TINTA_2 }}>
                <th style={celda}></th>
                <th style={numero}>Present.</th>
                <th style={numero}>Ganadas</th>
                <th style={numero}>Éxito</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.clave} style={{ borderTop: `1px solid ${BORDE}` }}>
                  <td style={celda}>{g.nombre ?? g.clave}</td>
                  <td className="tabular-nums" style={numero}>
                    {g.presentadas}
                  </td>
                  <td className="tabular-nums" style={numero}>
                    {g.ganadas}/{g.decididas}
                  </td>
                  <td className="tabular-nums" style={numero}>
                    {porcentaje(g.tasa)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}

// Con pocas decididas, una tasa por sector, banda u órgano engaña (1 de 1 = 100 %): van plegadas.
function TablasPorGrupo({ e }) {
  const v = estadisticasVisibles(e);
  const tablas = (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: v.visibles ? 0 : 8 }}>
      <TablaExito titulo="Por sector (división CPV)" grupos={e.por_sector} testid="presentadas-por-sector" />
      <TablaExito titulo="Por banda de importe" grupos={e.por_banda} testid="presentadas-por-banda" />
      <TablaExito titulo="Por órgano" grupos={e.por_organo} testid="presentadas-por-organo" />
    </div>
  );
  if (v.visibles) return tablas;
  return (
    <details data-testid="presentadas-estadisticas-plegadas" style={{ fontSize: 12.5, color: TINTA_2 }}>
      <summary style={{ cursor: 'pointer' }}>{`Por sector, banda y órgano: ${v.texto}.`}</summary>
      {tablas}
    </details>
  );
}

function Bajas({ b }) {
  return (
    <SectionCard title="Tu baja frente a la ganadora" right="lo adjudicado">
      <div style={{ fontSize: 12.5, color: TINTA, lineHeight: 1.7 }}>
        <div>
          Mediana de tu baja cuando ganas: <b className="tabular-nums">{porcentaje(b.mediana_ofertada_ganadas)}</b>
        </div>
        <div>
          Cuando pierdes: la tuya <b className="tabular-nums">{porcentaje(b.mediana_ofertada_perdidas)}</b>, la ganadora{' '}
          <b className="tabular-nums">{porcentaje(b.mediana_ganadora_perdidas)}</b> (diferencia mediana{' '}
          {puntos(b.mediana_diferencia_perdidas)})
        </div>
      </div>
      {b.pares.length > 0 && (
        <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr style={{ color: TINTA_2 }}>
              <th style={celda}>Licitación</th>
              <th style={numero}>Tuya</th>
              <th style={numero}>Ganadora</th>
              <th style={numero}>Dif.</th>
            </tr>
          </thead>
          <tbody>
            {b.pares.slice(0, 15).map((p) => (
              <tr key={p.propuesta} style={{ borderTop: `1px solid ${BORDE}` }}>
                <td
                  style={{
                    ...celda,
                    maxWidth: 220,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={p.titulo}
                >
                  <ChipResultado resultado={p.resultado} /> {p.titulo}
                </td>
                <td className="tabular-nums" style={numero}>
                  {porcentaje(p.baja_ofertada)}
                </td>
                <td className="tabular-nums" style={numero}>
                  {porcentaje(p.baja_ganadora)}
                </td>
                <td className="tabular-nums" style={numero}>
                  {puntos(p.diferencia)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function Estadisticas({ e }) {
  const p = e.puntuaciones;
  const ganadas = textoGanadas(e);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div data-testid="presentadas-kpis" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KPI label="Presentadas" value={e.total} hint={textoPendientes(e)} />
        <KPI label="Tasa de éxito" value={porcentaje(e.tasa_exito)} hint="de lo ya decidido" />
        <KPI label="Ganadas" value={ganadas.valor} hint={ganadas.texto} />
        <KPI
          label="Puntos medios"
          value={p.media_total ?? '—'}
          hint={p.n ? `ganador: ${p.media_ganador ?? '—'} · ${p.n} con puntos` : 'sin puntuaciones'}
        />
      </div>
      <TablasPorGrupo e={e} />
      <Bajas b={e.bajas} />
      <div style={{ fontSize: 11.5, color: TINTA_2 }}>{e.nota}</div>
    </div>
  );
}

function Fila({ p, activa, onClick }) {
  const aviso = avisoBaja(p);
  return (
    <button
      type="button"
      data-testid={`presentada-${p.id}`}
      onClick={onClick}
      aria-current={activa ? 'true' : undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 12px',
        cursor: 'pointer',
        background: activa ? SUPERFICIE_2 : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${BORDE}`,
      }}
    >
      <div style={{ fontSize: 13, color: TINTA, fontWeight: 600, lineHeight: 1.35 }}>
        {p.titulo}
        {p.lote ? ` · lote ${p.lote}` : ''}
      </div>
      <div style={{ fontSize: 11.5, color: TINTA_2, marginTop: 3 }}>
        {p.organo} · {fechaCorta(p.presentada_en)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, fontSize: 12, color: TINTA }}>
        <ChipResultado resultado={p.resultado} />
        <span className="tabular-nums">{euros(p.importe_ofertado)}</span>
        <span className="tabular-nums" style={{ color: TINTA_2 }}>
          baja {porcentaje(p.baja_ofertada)}
        </span>
        {p.puntos_total != null && (
          <span className="tabular-nums" style={{ color: TINTA_2 }}>
            {p.puntos_total} pts
          </span>
        )}
      </div>
      {aviso && (
        <div data-testid={`presentada-aviso-baja-${p.id}`} style={{ fontSize: 12, color: RIESGO, marginTop: 4 }}>
          {aviso}
        </div>
      )}
    </button>
  );
}

function Lista({ resultado, filtro, setFiltro, texto, setTexto, busqueda, seleccion, onElegir }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Pildora label="Todas" activa={!filtro} onClick={() => setFiltro(null)} />
        {RESULTADOS.map((r) => (
          <Pildora key={r.key} label={r.label} activa={filtro === r.key} onClick={() => setFiltro(r.key)} />
        ))}
      </div>
      <input
        className="input-field"
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar por título, órgano o expediente"
        aria-label="Buscar en lo presentado"
        style={{ marginBottom: 8 }}
      />
      <div style={{ marginBottom: 8 }}>
        <DescargarCsv
          pequeno
          url={licitacionesApi.csv.presentadas({ resultado: filtro, texto: busqueda })}
          testid="presentadas-csv"
        />
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: LIENZO,
          border: `1px solid ${BORDE}`,
          borderRadius: RADIUS_PANEL,
          minHeight: 160,
        }}
      >
        {resultado.kind === 'error' && (
          <div style={{ padding: 12 }}>
            <Aviso tono="error">{resultado.message}</Aviso>
          </div>
        )}
        {resultado.kind === 'ready' && resultado.items.length === 0 && (
          <div style={{ padding: 16, color: TINTA_2, fontSize: 13, lineHeight: 1.6 }}>
            {textoSinPropuestas({ total: resultado.estadisticas.total, filtro, busqueda })}
          </div>
        )}
        {resultado.kind === 'ready' &&
          resultado.items.map((p) => (
            <Fila key={p.id} p={p} activa={seleccion === p.licitacion_id} onClick={() => onElegir(p.licitacion_id)} />
          ))}
      </div>
    </div>
  );
}

function usePropuestas(filtro, busqueda, version) {
  const [resultado, setResultado] = useState({ kind: 'loading' });
  // Al cambiar de filtro o de búsqueda, una respuesta anterior que llegue tarde no cuenta.
  const nuevaPeticion = usePeticionVigente();
  const cargar = useCallback(() => {
    const vigente = nuevaPeticion();
    return licitacionesApi.propuestas({ resultado: filtro, texto: busqueda }).then(
      (r) => vigente() && setResultado({ kind: 'ready', ...r }),
      (e) => vigente() && setResultado({ kind: 'error', message: e.message }),
    );
  }, [filtro, busqueda, nuevaPeticion]);
  useEffect(() => {
    cargar();
  }, [cargar, version]);
  return [resultado, cargar];
}

// Todos los estados: lo presentado fuera de Hermes puede estar en cualquiera (incluso descartado).
const ESTADOS_BUSQUEDA = [
  'candidata',
  'nueva',
  'ficha_por_revisar',
  'en_preparacion',
  'presentada',
  'ganada',
  'perdida',
  'descartada',
];

const SIN_BUSQUEDA = { kind: 'idle', items: [] };

// Con menos de 2 letras no se busca; la respuesta solo vale para el texto que la pidió.
function useLicitacionesBuscadas(texto) {
  const [estado, setEstado] = useState({ ...SIN_BUSQUEDA, q: '' });
  const nuevaPeticion = usePeticionVigente();
  const q = texto.trim();
  useEffect(() => {
    if (q.length < 2) return undefined;
    const t = setTimeout(() => {
      const vigente = nuevaPeticion();
      licitacionesApi.oportunidades({ estados: ESTADOS_BUSQUEDA, texto: q, limite: 8 }).then(
        (r) => vigente() && setEstado({ kind: 'ready', items: r.items, q }),
        (e) => vigente() && setEstado({ kind: 'error', message: e.message, items: [], q }),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [q, nuevaPeticion]);
  return q.length >= 2 && estado.q === q ? estado : SIN_BUSQUEDA;
}

function ElegirLicitacion({ onElegir }) {
  const [texto, setTexto] = useState('');
  const encontradas = useLicitacionesBuscadas(texto);
  return (
    <div>
      <input
        className="input-field"
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        data-testid="presentada-fuera-buscar"
        placeholder="Busca la licitación por título, órgano o expediente"
        aria-label="Buscar la licitación presentada"
        style={{ width: '100%' }}
      />
      {encontradas.kind === 'error' && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="error">{encontradas.message}</Aviso>
        </div>
      )}
      {encontradas.kind === 'ready' && encontradas.items.length === 0 && (
        <div style={{ fontSize: 12.5, color: TINTA_2, marginTop: 6 }}>
          Ninguna coincide: tiene que estar en el radar de la PLACSP.
        </div>
      )}
      {encontradas.items.map((l) => (
        <button
          key={l.id}
          type="button"
          data-testid={`presentada-fuera-opcion-${l.id}`}
          onClick={() => onElegir(l)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 8px',
            background: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${BORDE}`,
            color: TINTA,
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          {l.titulo} <span style={{ color: TINTA_2 }}>· {l.organo}</span>
        </button>
      ))}
    </div>
  );
}

// Lo normal es registrar desde el pie de las comprobaciones (el paquete vN con lote y precio); esto es para
// lo que se presentó sin pasar por Hermes.
function RegistrarFuera({ onRegistrada }) {
  const [abierto, setAbierto] = useState(false);
  const [licitacion, setLicitacion] = useState(null);
  const cerrar = () => {
    setAbierto(false);
    setLicitacion(null);
  };
  if (!abierto)
    return (
      <div>
        <Boton Icono={Plus} testid="presentada-fuera-abrir" onClick={() => setAbierto(true)}>
          Registrar una presentada fuera de Hermes
        </Boton>
      </div>
    );
  return (
    <div
      data-testid="presentada-fuera"
      style={{ padding: 12, background: LIENZO, border: `1px solid ${BORDE}`, borderRadius: RADIUS_PANEL }}
    >
      <div style={{ fontSize: 13, color: TINTA, fontWeight: 600, marginBottom: 8 }}>
        {licitacion ? licitacion.titulo : 'Registrar una presentada fuera de Hermes'}
      </div>
      {licitacion ? (
        <FormPresentacion
          id={licitacion.id}
          candidatos={[]}
          onHecho={() => {
            cerrar();
            onRegistrada(licitacion.id);
          }}
          onCancelar={cerrar}
        />
      ) : (
        <>
          <ElegirLicitacion onElegir={setLicitacion} />
          <div style={{ marginTop: 8 }}>
            <Boton testid="presentada-fuera-cancelar" onClick={cerrar}>
              Cancelar
            </Boton>
          </div>
        </>
      )}
    </div>
  );
}

// Con onElegir, la elegida es la de la ruta (`inicial`, como en Competidores) y elegir cambia la
// ruta; sin él, se recuerda aquí.
function useSeleccion(inicial, onElegir) {
  const [local, setLocal] = useState(inicial ?? null);
  return onElegir ? [inicial ?? null, onElegir] : [local, setLocal];
}

export default function PropuestasVista({ version, inicial = null, onElegir, onVerCompetidor, onVerOrganismo }) {
  const { isSmall } = useAnchoPantalla();
  const [filtro, setFiltro] = useState(null);
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [seleccion, setSeleccion] = useSeleccion(inicial, onElegir);
  const [resultado, cargar] = usePropuestas(filtro, busqueda, version);
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const registrada = (id) => {
    cargar();
    setSeleccion(id);
  };

  const sinNinguna = resultado.kind === 'ready' && resultado.estadisticas.total === 0;
  // key: otra licitación es otra ficha (sin el «Descartar…» abierto ni respuestas de la anterior).
  const ficha = seleccion && (
    <Suspense fallback={<Esqueleto lineas={6} />}>
      <FichaLicitacion
        key={seleccion}
        id={seleccion}
        version={version}
        onVolver={isSmall ? () => setSeleccion(null) : undefined}
        onCambio={cargar}
        onVerCompetidor={onVerCompetidor}
        onVerOrganismo={onVerOrganismo}
      />
    </Suspense>
  );
  if (isSmall && seleccion) return <Desplazable>{ficha}</Desplazable>;
  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minWidth: 0,
          flex: isSmall ? 1 : '0 0 460px',
          overflow: 'auto',
          paddingRight: 4,
        }}
      >
        {resultado.kind === 'loading' && <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>}
        {resultado.kind === 'ready' && resultado.estadisticas.total > 0 && <Estadisticas e={resultado.estadisticas} />}
        <AprendizajesActas version={version} />
        <RegistrarFuera onRegistrada={registrada} />
        <Lista
          resultado={resultado}
          filtro={filtro}
          setFiltro={setFiltro}
          texto={texto}
          setTexto={setTexto}
          busqueda={busqueda}
          seleccion={seleccion}
          onElegir={setSeleccion}
        />
      </div>
      {!isSmall && (
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: 4 }}>
          {ficha || (
            <div style={{ color: TINTA_2, fontSize: 13, padding: 20 }}>
              {sinNinguna
                ? 'Aquí verás las cifras de lo presentado (tasa de éxito, bajas, puntos) cuando registres la primera.'
                : 'Elige una propuesta para ver su licitación.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
