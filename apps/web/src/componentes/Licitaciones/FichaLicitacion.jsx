// Detalle de una licitación. Arriba, fija, la decisión: el título, un solo botón con el
// siguiente paso y las tres preguntas (¿Podemos?, ¿Merece la pena?, ¿Llegamos?). Debajo, por
// pestañas: Resumen (con «Preguntar al pliego») · Requisitos · Criterios de valoración · Mercado y, con la oferta en marcha,
// Oferta (el asistente que pregunta y el detalle) y Revisión (lo que impide presentar, lo generado por
// sobre y documento, y el registro); descartada o por decidir con prisa, Oferta con lo que hay que
// decidir (pestanasFicha). Las comprobaciones ya no están en la web: sus enlaces llevan aquí (seccionDeFicha).
import { useCallback, useEffect, useRef, useState } from 'react';
import { TINTA, TINTA_2, BORDE, OK_TEXTO, RIESGO, IMPIDE, COLOR_VEREDICTO } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import {
  MOTIVOS_DESCARTE,
  accionCabecera,
  avisoDescarte,
  conComprobaciones,
  cuerpoDescarte,
  esFichaPorRevisar,
  estadoVisible,
  opinionHermes,
  pestanasFicha,
  preguntaPreparar,
  sePuedeDescartar,
  seccionDeFicha,
  textoEstadoPlacsp,
  textoRetirada,
  valorOpinion,
} from '../../lib/licitacionesFormato';
import { euros } from '../../lib/formato';
import { rutaFicha } from '../../lib/rutas';
import { bloqueo as testidBloqueo, REGISTRAR_PAQUETE } from '../../lib/idsPrueba';
import { trasCarga, trasFallo } from '../../lib/carga';
import { porcentaje } from '../../lib/preciosFormato';
import usePeticionVigente from '../../hooks/usePeticionVigente';
import useEventosLicitacion from '../../hooks/useEventosLicitacion';
import useComprobaciones from '../../hooks/useComprobaciones';
import { salirCon } from '../../hooks/useCambiosSinGuardar';
import { Aviso, Boton } from '../ui';
import { Bloque, EstadoFicha } from '../comun/ui';
import { errorDeProceso } from '../../lib/listaFormato';
import { Pestanas } from '../comun/PanelDominio';
import CabeceraDecision from '../comun/CabeceraDecision';
import AbrirEnDrive from './AbrirEnDrive';
import ResponsableOferta from './ResponsableOferta';
import { conResponsable } from '../../lib/responsableFormato';
import { carpetasDrive } from '../../lib/carpetasDrive';
import Confirmacion from '../comun/Confirmacion';
import PreciosLicitacion from './PreciosLicitacion';
import PresentacionOferta from './Oferta/PresentacionOferta';
import OfertaPestana from './Oferta/OfertaPestana';
import RevisionOferta from './Oferta/RevisionOferta';
import AntecedentesLicitacion from './AntecedentesLicitacion';
import PreguntarPliego from './PreguntarPliego';
import { CriteriosFicha, RequisitosFicha, ResumenFicha } from './Expediente';
import TresPreguntas, { IndicesMercado } from './TresPreguntas';
import useIndices from '../../hooks/useIndices';
import { Enlace } from '../comun/listas';
import AvisoRecarga from '../comun/AvisoRecarga';

function Adjudicaciones({ filas = [], onVerCompetidor }) {
  if (!filas.length) return null;
  const celda = { padding: '5px 8px', textAlign: 'left' };
  return (
    <Bloque titulo="ADJUDICACIONES DE ESTA LICITACIÓN">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: TINTA_2 }}>
              {['Lote', 'Adjudicatario', 'Importe', 'Baja', 'Ofertas', 'Resultado'].map((t) => (
                <th key={t} scope="col" style={celda}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((a) => (
              <tr key={a.ord} style={{ borderTop: `1px solid ${BORDE}` }}>
                <td style={celda}>{a.lote || '—'}</td>
                <td style={celda}>
                  <Enlace
                    onClick={
                      onVerCompetidor && a.adjudicatario_nif ? () => onVerCompetidor(a.adjudicatario_nif) : undefined
                    }
                    title="Ver la ficha del competidor"
                  >
                    {a.adjudicatario_nombre ?? '—'}
                  </Enlace>
                </td>
                <td style={celda} className="tabular-nums">
                  {euros(a.importe_sin_iva)}
                </td>
                <td style={celda} className="tabular-nums">
                  {porcentaje(a.baja)}
                </td>
                <td style={celda} className="tabular-nums">
                  {a.ofertas ?? '—'}
                </td>
                <td style={celda}>{a.resultado_nombre ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloque>
  );
}

const LLAMADAS = {
  seguir: (f) => licitacionesApi.seguirLicitacion(f.id),
  reactivar: (f) => licitacionesApi.cambiar(f.id, { estado: 'nueva' }),
  preparar: (f) => licitacionesApi.cambiar(f.id, { estado: 'en_preparacion' }),
  generar_ficha: (f) => licitacionesApi.generarFicha(f.id),
};

// Lo que hace el botón sin escribir: llevar a una fila o al registro del paquete (en la Revisión; sin
// ella, la Oferta enseña las filas) o a una pestaña.
function navegar(accion, irA) {
  if (accion.clave === 'bloqueo') irA('revision', { bloqueo: accion.bloqueo });
  else if (accion.clave === 'paquete') irA('revision', { testid: REGISTRAR_PAQUETE });
  else if (accion.pestana) irA(accion.pestana);
  else return false;
  return true;
}

// El botón principal: accionCabecera (de las comprobaciones en preparación, el paso de siempre fuera).
// «Preparar la oferta» en rojo o retirada pregunta antes y, hecha, lleva a la Oferta.
function useAccionPrincipal(f, comprobaciones, { onCambio, irA }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [pregunta, setPregunta] = useState(null);
  const siguiente = accionCabecera(comprobaciones, f);
  const accion = siguiente && { ...siguiente, escribe: !siguiente.pestana && Boolean(LLAMADAS[siguiente.clave]) };
  const llamar = async (clave) => {
    setOcupado(true);
    setError(null);
    try {
      await LLAMADAS[clave](f);
      onCambio();
      if (clave === 'preparar') irA('oferta');
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };
  const ejecutar = () => {
    if (!accion || navegar(accion, irA) || !LLAMADAS[accion.clave]) return;
    if (accion.clave === 'preparar' && preguntaPreparar(f)) {
      setPregunta(preguntaPreparar(f));
      return;
    }
    llamar(accion.clave);
  };
  const confirmar = {
    pregunta,
    si: () => {
      setPregunta(null);
      llamar('preparar');
    },
    no: () => setPregunta(null),
  };
  return { accion, ocupado, error, ejecutar, confirmar };
}

const COLOR_DECISION = { go: OK_TEXTO, no_go: IMPIDE, revisar: RIESGO };

// La opinión de la ficha (pliegos leídos) manda sobre la de la criba, como en la lista: si no,
// la cabecera decía «Encaja» mientras la ficha aprobada decía «Con dudas».
// data-estado: la decisión de la ficha o el veredicto de la criba que se está enseñando.
function indicadorHermes(f, opinion) {
  const base = { label: 'Hermes', testid: 'ficha-indicador-hermes' };
  const valor = valorOpinion(opinion);
  if (!opinion) return { ...base, valor, color: TINTA_2, estado: 'sin_cribar' };
  if (opinion.clave === 'descarte') return { ...base, valor, color: TINTA_2, estado: 'descartada:hermes_no_go' };
  if (opinion.clave === 'ficha') {
    const decision = f.go_no_go.ficha.aprobada.datos.recomendacion.decision;
    return { ...base, valor, color: COLOR_DECISION[decision] ?? TINTA_2, estado: `ficha:${decision}` };
  }
  return {
    ...base,
    valor,
    color: opinion.clave === 'criba' ? (COLOR_VEREDICTO[f.veredicto_ia] ?? TINTA_2) : TINTA_2,
    estado: `${opinion.clave}:${f.veredicto_ia ?? ''}`,
  };
}

// Con las tres preguntas debajo, en la fila solo quedan el estado y, sin comprobaciones, la opinión de Hermes
// (con comprobaciones la dice su veredicto, en «¿Podemos?»).
function indicadoresYOpinion(f, enComprobaciones) {
  const estado = { label: 'Estado', valor: estadoVisible(f), testid: 'ficha-indicador-estado', estado: f.estado };
  const opinion = opinionHermes({
    veredicto_ia: f.veredicto_ia,
    motivo_ia: f.motivo_ia,
    recomendacion_ficha: f.go_no_go?.ficha?.aprobada?.datos?.recomendacion,
    estado: f.estado,
    categoria_descarte: f.categoria_descarte,
    motivo_descarte: f.motivo_descarte,
  });
  return {
    indicadores: enComprobaciones ? [estado] : [estado, indicadorHermes(f, opinion)],
    opinion: opinion?.texto ?? null,
  };
}

// Siempre a mano, estés en la pestaña que estés (los de pliegos y oferta solo si existen).
function AccesosDrive({ f }) {
  const { unica, pliegos, oferta } = carpetasDrive(f);
  return (
    <>
      {unica && <AbrirEnDrive id={f.id} carpeta="principal" compacto testid="drive-carpeta" />}
      {pliegos && <AbrirEnDrive id={f.id} carpeta="pliegos" compacto testid="drive-pliegos" />}
      {oferta && <AbrirEnDrive id={f.id} carpeta="oferta" compacto testid="drive-oferta" />}
    </>
  );
}

function Cabecera({ f, comprobaciones = null, enComprobaciones, version, onVolver, onVerOrganismo, onCambio, irA }) {
  const { accion, ocupado, error, ejecutar, confirmar } = useAccionPrincipal(f, comprobaciones, { onCambio, irA });
  const { indicadores, opinion } = indicadoresYOpinion(f, enComprobaciones);
  const indices = useIndices(f.id, version);
  const lotes = f.lotes?.length ? ` · ${f.lotes.length === 1 ? '1 lote' : `${f.lotes.length} lotes`}` : '';
  const subtitulo = (
    <>
      <Enlace
        onClick={onVerOrganismo && f.organo_nif ? () => onVerOrganismo(f.organo_nif) : undefined}
        title="Ver la ficha del órgano"
      >
        {f.organo}
      </Enlace>{' '}
      · Exp. {f.expediente} · {textoEstadoPlacsp(f)}
      {f.procedimiento ? ` · ${f.procedimiento}` : ''}
      {lotes} · {euros(f.importe)} sin IVA
    </>
  );
  const descartar = async (d) => {
    const cuerpo = cuerpoDescarte(d);
    if (cuerpo.error) throw new Error(cuerpo.error);
    await licitacionesApi.cambiar(f.id, cuerpo.data);
  };
  const debajo = confirmar.pregunta && (
    <div style={{ marginTop: 8 }}>
      <Confirmacion
        pregunta={confirmar.pregunta}
        textoSi="Preparar la oferta"
        onSi={confirmar.si}
        onNo={confirmar.no}
      />
    </div>
  );
  return (
    <CabeceraDecision
      titulo={f.titulo}
      subtitulo={subtitulo}
      url={f.url}
      urlTitulo="Abrir en la Plataforma de Contratación"
      onVolver={onVolver}
      indicadores={indicadores}
      preguntas={<TresPreguntas f={f} comprobaciones={comprobaciones} opinion={opinion} indices={indices} />}
      debajo={debajo}
      accesos={
        <>
          {conResponsable(f) && <ResponsableOferta f={f} onCambio={onCambio} />}
          <AccesosDrive f={f} />
        </>
      }
      accion={accion?.clave === 'esperar' ? null : accion}
      espera={accion?.clave === 'esperar' ? accion.espera : null}
      onAccion={ejecutar}
      ocupado={ocupado}
      error={error}
      onDescartar={sePuedeDescartar(f.estado) ? descartar : undefined}
      motivosDescarte={MOTIVOS_DESCARTE}
      onDescartado={onCambio}
    />
  );
}

// La cabecera de una ficha de oferta en preparación lee las mismas comprobaciones (GET con ETag) que la Oferta y la Revisión.
function CabeceraConComprobaciones(props) {
  const comprobaciones = useComprobaciones(props.f.id);
  return <Cabecera {...props} comprobaciones={comprobaciones.data} enComprobaciones />;
}

// Pestaña «Errores»: por qué el proceso automático no la saca adelante y, si sirve, «Reintentar».
function AvisoError({ f, onCambio }) {
  const [envio, setEnvio] = useState({ ocupado: false, error: null });
  const e = f.go_no_go?.ficha?.aprobada ? null : errorDeProceso(f.error_proceso);
  if (!e) return null;
  const reintentar = () => {
    setEnvio({ ocupado: true, error: null });
    licitacionesApi.reintentar(f.id).then(
      () => {
        setEnvio({ ocupado: false, error: null });
        onCambio();
      },
      (err) => setEnvio({ ocupado: false, error: err.message }),
    );
  };
  return (
    <div data-testid="ficha-aviso-error" data-codigo={f.error_proceso.codigo}>
      <Aviso tono="error">
        <div
          style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <span>
            <strong>{e.texto}.</strong>
            {e.detalle && <> {e.detalle}</>}
            {!e.reintentar && ' Sube un pliego legible desde «Pliegos» o descártala.'}
          </span>
          {e.reintentar && (
            <Boton testid="reintentar-proceso" onClick={reintentar} cargando={envio.ocupado} escribe>
              Reintentar
            </Boton>
          )}
        </div>
        {envio.error && <div style={{ marginTop: 6 }}>No se pudo reintentar: {envio.error}</div>}
      </Aviso>
    </div>
  );
}

function Avisos({ f, enComprobaciones, onCambio }) {
  // Con Oferta, la descartada lo dice la propia Oferta (en solo lectura, con «Recuperar»).
  const descarte = enComprobaciones ? null : avisoDescarte(f);
  return (
    <>
      {f.estado === 'nueva' && <AvisoError f={f} onCambio={onCambio} />}
      {descarte && (
        <div data-testid="ficha-aviso-descarte" data-categoria={f.categoria_descarte ?? ''}>
          <Aviso tono={f.descarte_automatico ? 'aviso' : undefined}>{descarte}</Aviso>
        </div>
      )}
      {f.estado === 'sin_oportunidad' && (
        <Aviso>
          Esta licitación no pasó el prefiltro. Síguela si interesa, o ajusta los filtros si debería haberlo pasado.
        </Aviso>
      )}
    </>
  );
}

function Mercado({ f, version, onVerCompetidor }) {
  const indices = useIndices(f.id, version);
  return (
    <>
      <IndicesMercado indices={indices} id={f.id} />
      <AntecedentesLicitacion
        key={`antecedentes-${f.id}`}
        id={f.id}
        version={version}
        onVerCompetidor={onVerCompetidor}
      />
      <PreciosLicitacion key={`precios-${f.id}`} id={f.id} version={version} />
      <Adjudicaciones filas={f.adjudicaciones} onVerCompetidor={onVerCompetidor} />
    </>
  );
}

// La Oferta decide su modo (modoComprobaciones) con el estado de la persona: una nueva con ficha es «por revisar».
const paraComprobaciones = (f) => (esFichaPorRevisar(f) ? { ...f, estado: 'ficha_por_revisar' } : f);

function Seccion({ seccion, f, foco, version, onCambio, onVerCompetidor, irA }) {
  if (seccion === 'oferta')
    return (
      <OfertaPestana
        key={`oferta-${f.id}`}
        f={paraComprobaciones(f)}
        foco={foco}
        version={version}
        irA={irA}
        onCambio={onCambio}
      />
    );
  if (seccion === 'revision')
    return (
      <RevisionOferta key={`revision-${f.id}`} f={f} foco={foco} version={version} irA={irA} onCambio={onCambio} />
    );
  if (seccion === 'mercado') return <Mercado f={f} version={version} onVerCompetidor={onVerCompetidor} />;
  if (seccion === 'preparacion')
    return <PresentacionOferta key={`presentacion-${f.id}`} f={f} version={version} onCambio={onCambio} />;
  if (seccion === 'requisitos') return <RequisitosFicha f={f} onCambio={onCambio} />;
  if (seccion === 'criterios') return <CriteriosFicha f={f} />;
  return (
    <>
      <ResumenFicha f={f} onCambio={onCambio} />
      <PreguntarPliego f={f} version={version} conComprobaciones={conComprobaciones(f)} />
    </>
  );
}

// Lleva el foco a una fila (o al paquete) si ya está pintada; si no, lo hace la pestaña al llegar con `foco`.
function enfocar(testid) {
  setTimeout(() => {
    const el = document.querySelector(`[data-testid="${CSS.escape(testid)}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus?.();
  }, 0);
}

function useFicha(id) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  // Tras un cambio o un evento se recarga: solo vale la respuesta de la última petición.
  const nuevaPeticion = usePeticionVigente();
  const cargar = useCallback(() => {
    const vigente = nuevaPeticion();
    // Una recarga fallida conserva la ficha a la vista (con aviso): no la cierra en mitad del
    // trabajo. Solo la de esta licitación: la de otra, con el aviso, parecería esta.
    return licitacionesApi.licitacion(id).then(
      (ficha) => vigente() && setEstado(trasCarga(ficha)),
      (e) => vigente() && setEstado((previo) => trasFallo(previo?.data?.id === id ? previo : null, e.message)),
    );
  }, [id, nuevaPeticion]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  // Solo los eventos de esta licitación (y la reconexión), no cada «version» del dominio: así
  // llegan solas la ficha de Hermes o el descarte automático sin recargar con lo de otras.
  useEventosLicitacion(id, (d) => {
    if (String(d?.tipo ?? '').startsWith('licitacion') || d?.tipo === 'plataforma-reconectado') cargar();
  });
  return { estado, cargar };
}

// El enlace antiguo («p-…/preparacion») abre la Oferta y la dirección pasa a ser la suya, sin
// dejar la vieja en el historial: hay enlaces ya enviados que lo usan.
function useRedirigirPreparacion(f, seccionInicial) {
  const redirigir = Boolean(f) && seccionInicial === 'preparacion' && conComprobaciones(f);
  useEffect(() => {
    if (!redirigir) return;
    window.history.replaceState(null, '', rutaFicha(f.id, 'oferta'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [redirigir, f?.id]);
}

// La sección (y la fila o el apartado) elegida vale para esta licitación: al abrir otra se vuelve a la
// de la ruta. irA(seccion, { bloqueo | testid | cajon, campo }) lleva además a esa fila, pieza o apartado
// del detalle de la Oferta; «pedido» lo abre otra vez aunque sea el mismo.
function useEleccion(id, seccionInicial, foco) {
  const [eleccion, setEleccion] = useState({ id, seccion: seccionInicial, foco });
  const deEsta = eleccion.id === id ? eleccion : { seccion: seccionInicial, foco };
  const irA = (s, destino = null) => {
    setEleccion((p) => ({ id, seccion: s, foco: destino ? { ...destino, pedido: (p.foco?.pedido ?? 0) + 1 } : null }));
    if (destino?.bloqueo) enfocar(testidBloqueo(destino.bloqueo));
    if (destino?.testid) enfocar(destino.testid);
  };
  return { deEsta, irA };
}

// onCargada se llama una vez por ficha llegada, aunque el padre pase una función nueva en cada render.
function useAlCargar(f, onCargada) {
  const ultimo = useRef(onCargada);
  useEffect(() => {
    ultimo.current = onCargada;
  });
  useEffect(() => {
    if (f) ultimo.current?.(f);
  }, [f]);
}

/**
 * seccionInicial: la sección con la que se abre (de la ruta: «oferta», «comprobaciones», «preparacion»…); si
 * no, la primera pestaña. foco: { bloqueo | testid } de la ruta, para abrir en esa fila o pieza.
 * onCargada(f): cada vez que llega la ficha (la lista la usa para cambiar de pestaña).
 */
export default function FichaLicitacion({
  id,
  seccionInicial = null,
  foco = null,
  version,
  onVolver,
  onCambio,
  onCargada,
  onVerCompetidor,
  onVerOrganismo,
}) {
  const { estado, cargar } = useFicha(id);
  const { deEsta, irA } = useEleccion(id, seccionInicial, foco);
  const f = estado.kind === 'ready' ? estado.data : null;
  useRedirigirPreparacion(f, seccionInicial);
  useAlCargar(f, onCargada);
  if (estado.kind !== 'ready') return <EstadoFicha estado={estado} onVolver={onVolver} />;
  const pestanas = pestanasFicha(f);
  const seccion = seccionDeFicha(deEsta.seccion, pestanas, deEsta.foco);
  const tras = () => {
    cargar();
    onCambio();
  };
  const enComprobaciones = conComprobaciones(f);
  const cabecera = { f, version, onVolver, onVerOrganismo, onCambio: tras, irA };
  return (
    <div data-testid="ficha-licitacion" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {enComprobaciones ? (
        <CabeceraConComprobaciones {...cabecera} />
      ) : (
        <Cabecera {...cabecera} enComprobaciones={false} />
      )}
      {/* Arriba y en todas las pestañas: quien prepara la oferta tiene que verlo. */}
      {f.retirada && <Aviso tono="error">{textoRetirada(f.retirada)}</Aviso>}
      <AvisoRecarga carga={{ ...estado, recargar: cargar }} />
      <Pestanas
        vistas={pestanas}
        vista={seccion}
        onVista={(s) => (s === seccion ? irA(s) : salirCon(() => irA(s)))}
        etiqueta="Secciones de la ficha"
        prefijo="ficha-pestana"
      />
      <Avisos f={f} enComprobaciones={enComprobaciones} onCambio={tras} />
      <div role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Seccion
          seccion={seccion}
          f={f}
          foco={deEsta.foco}
          version={version}
          onCambio={tras}
          onVerCompetidor={onVerCompetidor}
          irA={irA}
        />
      </div>
    </div>
  );
}
