// Cajón Decisiones: las decisiones humanas antes
// de redactar, por secciones (lotes, equipo, criterios automáticos, herramientas, enfoque y
// precio), cada una con su «Guardar». Cada guardado pasa por «Qué cambia» y escribe solo su
// sección (PATCH con la versión leída), así que un problema en el equipo no impide fijar el
// precio: lo que no cuadra en otras secciones sale como filas de las comprobaciones. Llega relleno con la
// propuesta de Hermes (con el porqué); el precio no se rellena solo: una persona lo elige por lote.
// Lo que llega por los eventos no pisa lo que se está escribiendo; si otra persona guardó entre
// medias, se avisa. Arriba, «Deshacer el último cambio».
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Save, Sparkles } from 'lucide-react';
import { TINTA, TINTA_2, RIESGO, IMPIDE, BORDE, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { decisionesAlDia } from '../../../lib/decisionesRecientes';
import { fechaHora, plural } from '../../../lib/formato';
import {
  bloqueoAutomatico,
  camposDeDecisiones,
  claveAutomatico,
  camposIniciales,
  motivosDePropuesta,
  ofertaDeLoteGuion,
  puntosEstimados,
  textoMotivoAutomatico,
  textoPuntosAutomaticos,
  textoPuntosFila,
  automaticoDeLote,
  tramosDeAutomatico,
} from '../../../lib/ofertaFormato';
import { faltaParaRedactar, textoFaltaParaRedactar } from '../../../lib/memoriaFormato';
import { problemasAgrupados } from '../../../lib/presentacionFormato';
import {
  adoptarBase,
  cambioDeImpacto,
  campoDeSeccion,
  datosDeSeccion,
  seccionesSucias,
} from '../../../lib/decisionesSecciones';
import { puedeMarcar, textoMaximoLotes } from '../../../lib/lotesEleccion';
import useGuardarConImpacto from '../../../hooks/useGuardarConImpacto';
import { CambiosContext, useCambiosSinGuardar, useRegistroCambios } from '../../../hooks/useCambiosSinGuardar';
import EquipoOferta from './EquipoOferta';
import PrecioEnLinea from './PrecioEnLinea';
import DeshacerCambio from './DeshacerCambio';
import DatosAnexoDecision from './DatosAnexoDecision';
import { PanelImpacto } from './QueCambia';
import { Enlace } from '../../comun/listas';
import { Aviso, Boton, Campo } from '../../ui';
import RelanzarTrabajo from '../RelanzarTrabajo';

// La estrategia sale del pliego y el enfoque solo añade, por eso es opcional.
const TITULO_ENFOQUE = 'Indicaciones para la memoria (opcional)';
const AYUDA_ENFOQUE =
  'Hermes hace su estrategia a partir del pliego. Escribe solo lo que quieras que tenga en cuenta, en positivo. Se revisa contra lo que va en otros sobres y contra lo que Hermes recomendó no prometer.';
const NOMBRE_SECCION = {
  lotes: 'lotes',
  equipo: 'equipo',
  automaticos: 'criterios automáticos',
  herramientas: 'herramientas',
  enfoque: 'enfoque',
};
const ERROR_CONFLICTO = 'No se guardó: otra persona guardó decisiones antes que tú.';
const estiloSeccion = { borderTop: `1px solid ${BORDE}`, paddingTop: 10, marginTop: 10 };

function FilaAutomatico({ f, a, m, poner }) {
  const tramos = tramosDeAutomatico(a);
  const id = `${f.criterio} ${f.lote ?? ''}`.trim();
  // La fila «Te acoges a… sin con qué acreditarlo» de las comprobaciones (destino automatico:criterio|lote) abre aquí.
  const foco = `automatico:${claveAutomatico(f)}`;
  const bloqueo = bloqueoAutomatico(f, a);
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} data-testid="decision-automatico">
      <label
        style={{ fontSize: TIPO.texto, color: TINTA, display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 220px' }}
      >
        <input
          type="checkbox"
          data-foco={foco}
          checked={f.nos_acogemos}
          onChange={(e) =>
            poner({
              nos_acogemos: e.target.checked,
              tramo:
                e.target.checked && tramos.length === 1 ? tramos[0].descripcion : e.target.checked ? f.tramo : null,
            })
          }
        />
        {f.criterio}
        {a ? (
          <span className="tabular-nums" style={{ color: TINTA_2 }}>
            {' '}
            · {a.puntos} pt
          </span>
        ) : null}
      </label>
      {f.nos_acogemos && tramos.length > 1 && (
        <select
          className="input-field"
          value={f.tramo ?? ''}
          onChange={(e) => poner({ tramo: e.target.value || null })}
          aria-label={`Tramo de ${id}`}
          style={{ flex: '1 1 200px' }}
        >
          <option value="">Elige el tramo…</option>
          {tramos.map((t) => (
            <option key={t.descripcion} value={t.descripcion}>
              {t.descripcion} · {t.puntos} pt
            </option>
          ))}
        </select>
      )}
      {f.nos_acogemos && (
        <input
          className="input-field"
          data-testid="automatico-valor"
          data-foco={`automatico.${claveAutomatico(f)}`}
          inputMode="decimal"
          value={f.valor ?? ''}
          onChange={(e) => poner({ valor: e.target.value })}
          placeholder="Valor ofertado (p. ej. 30)"
          aria-label={`Valor ofertado en ${id}`}
          maxLength={20}
          style={{ flex: '0 1 150px' }}
        />
      )}
      <input
        className="input-field"
        value={f.evidencia}
        onChange={(e) => poner({ evidencia: e.target.value })}
        placeholder="Evidencia (dónde consta que podemos)"
        aria-label={`Evidencia de ${id}`}
        maxLength={600}
        style={{ flex: '1 1 200px' }}
      />
      <input
        className="input-field"
        value={f.nota}
        onChange={(e) => poner({ nota: e.target.value })}
        placeholder="Nota"
        aria-label={`Nota sobre ${id}`}
        maxLength={1000}
        style={{ flex: '1 1 140px' }}
      />
      {f.nos_acogemos && (
        <div
          data-testid="automatico-puntos"
          className="tabular-nums"
          style={{ flexBasis: '100%', fontSize: TIPO.pequeno, color: TINTA_2 }}
        >
          {textoPuntosFila(puntosEstimados(a, f))}
        </div>
      )}
      {bloqueo && (
        <div
          data-testid="automatico-bloqueo"
          role="alert"
          style={{ flexBasis: '100%', fontSize: TIPO.pequeno, color: IMPIDE }}
        >
          {bloqueo}.
        </div>
      )}
      {a?.exige_documento && (
        <div style={{ flexBasis: '100%', fontSize: TIPO.pequeno, color: RIESGO }}>
          Documento exigido: {a.exige_documento}
        </div>
      )}
      {m && (
        <div
          style={{
            flexBasis: '100%',
            fontSize: TIPO.pequeno,
            color: m.cumple === 'falta_dato' || (a?.exige_documento && !m.nos_acogemos) ? RIESGO : TINTA_2,
          }}
        >
          Hermes: {textoMotivoAutomatico(m, a)}. {m.motivo}
        </div>
      )}
    </li>
  );
}

// Un criterio marcado que no se puede declarar (nota contraria, documento sin evidencia) impide guardar la sección.
const automaticosGuardables = (guion, filas) =>
  filas.every((f) => !bloqueoAutomatico(f, automaticoDeLote(guion, f.criterio, f.lote ?? null)));

// Agrupados por lote: los comunes primero y luego cada lote con los suyos.
function Automaticos({ guion, filas, lotes, onCambio, motivos }) {
  const poner = (i, cambio) => onCambio(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  const grupos = [null, ...lotes]
    .map((lote) => ({ lote, filas: filas.map((f, i) => ({ f, i })).filter(({ f }) => f.lote === lote) }))
    .filter((g) => g.filas.length);
  return grupos.map((g) => (
    <div key={g.lote ?? 'comunes'} style={{ marginBottom: 6 }}>
      {grupos.length > 1 && (
        <div style={{ fontSize: TIPO.pequeno, color: TINTA_2, fontWeight: 600, margin: '4px 0' }}>
          {g.lote ? `Lote ${g.lote}` : 'Todos los lotes'}
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {g.filas.map(({ f, i }) => (
          <FilaAutomatico
            key={`${f.criterio}|${f.lote ?? ''}`}
            f={f}
            a={automaticoDeLote(guion, f.criterio, f.lote ?? null)}
            m={motivos.get(claveAutomatico(f))}
            poner={(c) => poner(i, c)}
          />
        ))}
      </ul>
    </div>
  ));
}

// Lo que Hermes recomendó no prometer al proponer: el enfoque se revisa contra ello al guardar.
function NoPrometer({ items }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginTop: 6, fontSize: TIPO.pequeno, color: TINTA_2 }}>
      Hermes recomienda no prometer:
      <ul data-testid="enfoque-no-prometer" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {items.map((n) => (
          <li key={n.que}>
            {n.que} — {n.motivo}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MotivosEquipo({ filas, motivos, personas }) {
  const con = filas.filter((f) => motivos.get(Number(f.persona_id)));
  if (!con.length) return null;
  const nombre = (id) => personas?.find((p) => p.id === Number(id))?.nombre ?? `Persona ${id}`;
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: TIPO.pequeno, color: TINTA_2 }}>
      {con.map((f) => (
        <li key={f.persona_id}>
          Hermes: {nombre(f.persona_id)}, {f.rol_en_la_oferta}. {motivos.get(Number(f.persona_id))}
        </li>
      ))}
    </ul>
  );
}

function PropuestaHermes({ f, o, onPedida }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const p = o.propuesta_decisiones;
  const enCurso = Boolean(o.propuesta_en_curso);
  const pedir = async () => {
    setOcupado(true);
    setError(null);
    try {
      await licitacionesApi.proponerDecisiones(f.id);
      onPedida();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {enCurso && (
        <Aviso tono="info">
          Hermes está preparando la propuesta: equipo, criterios automáticos, herramientas y enfoque.{' '}
          <RelanzarTrabajo id={f.id} tipo="decisiones" onHecho={onPedida} />
        </Aviso>
      )}
      {p && !enCurso && (
        <Aviso tono="info">
          {o.decisiones ? 'Propuesta de Hermes' : 'Relleno con la propuesta de Hermes'} ({fechaHora(p.creada_en)}):{' '}
          {p.datos.resumen}
          {!o.decisiones &&
            ' Revisa y guarda cada sección. El precio no se rellena solo: elígelo tú en cada lote (los sugeridos están al lado, con «Usar»).'}
          {o.decisiones &&
            ' Lo que cambia frente a lo guardado se aplica campo a campo en «Revisar lo que hizo Hermes».'}
        </Aviso>
      )}
      {p?.avisos?.map((a) => (
        <Aviso key={a} tono="aviso">
          {a}
        </Aviso>
      ))}
      <div>
        <Boton
          Icono={Sparkles}
          cargando={ocupado || enCurso}
          onClick={pedir}
          testid="pedir-propuesta"
          escribe
          title="Unos 30 min de Hermes"
        >
          {p ? 'Pedir otra propuesta' : 'Pedir propuesta a Hermes'}
        </Boton>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}

// El formulario vive aparte de lo guardado: `base` es lo último que se cargó en él. Cuando llega
// otra base, cada sección sin cambios la adopta; con cambios, se respeta y se ofrece cargarla.
// Lo recién guardado manda sobre la base de la prop mientras `o` sea la misma (como useGuardado de
// PrecioEnLinea): la prop sigue con lo de antes hasta que llega la oferta recargada, y adoptarBase
// devolvería la sección al valor anterior (o se quedaría así si la recarga falla).
function useBaseConRecien(o, ambito) {
  const [recien, setRecien] = useState(null);
  const delServidor = useMemo(() => camposIniciales(o, ambito), [o, ambito]);
  const base = useMemo(
    () => (recien?.de === o ? { ...delServidor, ...recien.campos } : delServidor),
    [delServidor, recien, o],
  );
  const apuntar = (k, v) => setRecien((r) => ({ de: o, campos: { ...(r?.de === o ? r.campos : {}), [k]: v } }));
  return { base, apuntar };
}

function useFormulario(o, ambito) {
  const g = o.guion.datos;
  const { base, apuntar } = useBaseConRecien(o, ambito);
  const [form, setForm] = useState(() => ({ campos: base, base }));
  const r = adoptarBase(form, base);
  if (r.campos !== form.campos || r.base !== form.base) setForm({ campos: r.campos, base: r.base });
  const poner = (k, v) => setForm((s) => ({ ...s, campos: { ...s.campos, [k]: v } }));
  // Recién guardada una sección, lo que devolvió el servidor pasa a ser su base (las demás siguen como estaban).
  const guardada = (s, datos) => {
    const k = campoDeSeccion(s);
    const v = (datos ? camposDeDecisiones(datos, g)[k] : undefined) ?? form.campos[k];
    apuntar(k, v);
    setForm((p) => ({ campos: { ...p.campos, [k]: v }, base: { ...p.base, [k]: v } }));
  };
  return {
    campos: form.campos,
    base: form.base,
    sucias: seccionesSucias(form.campos, form.base),
    ajena: r.ajenas.length > 0,
    poner,
    guardada,
    cargarBase: () => setForm({ campos: base, base }),
  };
}

// Cada sección dice si tiene algo sin guardar («decisiones.<sección>»); a las comprobaciones les llega un solo
// «decisiones», que es el nombre de su cajón (el que pregunta antes de cambiar de cajón o salir).
function RegistroSecciones({ children }) {
  const externo = useContext(CambiosContext);
  const { sucios, marcar } = useRegistroCambios();
  useCambiosSinGuardar('decisiones', sucios.length > 0);
  const valor = useMemo(() => ({ ...(externo ?? {}), sucios, marcar }), [externo, sucios, marcar]);
  return <CambiosContext.Provider value={valor}>{children}</CambiosContext.Provider>;
}

function useGuardarSeccion(ctx, s) {
  const { id, version, form, onGuardado, alConflicto } = ctx;
  const [error, setError] = useState(null);
  const [otras, setOtras] = useState([]);
  // El cambio que se dio a «Qué cambia»: el mismo pide luego «Actualizar los apartados afectados».
  const [cambio, setCambio] = useState(null);
  const guardar = async () => {
    const r = datosDeSeccion(form.campos, s);
    if (r.error) throw new Error(r.error);
    let res;
    try {
      res = await licitacionesApi.guardarSeccionDecisiones(id, s, { datos: r.data, version });
    } catch (e) {
      if (e?.code !== 'conflicto') throw e;
      alConflicto();
      throw new Error(ERROR_CONFLICTO);
    }
    form.guardada(s, res?.datos);
    ctx.alGuardar(res?.version);
    setOtras(res?.problemas_otras ?? []);
    onGuardado?.();
  };
  const g = useGuardarConImpacto(id, { guardar });
  const pedir = () => {
    const r = datosDeSeccion(form.campos, s);
    setError(r.error);
    if (r.error) return;
    setOtras([]);
    const c = cambioDeImpacto(s, form.campos, form.base);
    setCambio(c);
    g.iniciar(c);
  };
  return { g, pedir, error, otras, cambio };
}

// Lo que no cuadra en otras secciones no bloquea: son filas de las comprobaciones; aquí solo se lleva a ellas.
function OtrasSecciones({ otras }) {
  if (!otras.length) return null;
  const ir = () => document.querySelector('[data-testid="bloqueos"]')?.scrollIntoView({ block: 'start' });
  return (
    <div
      data-testid="otras-secciones"
      title={otras.join(' ')}
      style={{ fontSize: TIPO.pequeno, color: TINTA_2, marginTop: 6 }}
    >
      <Enlace onClick={ir}>{plural(otras.length, 'cosa por revisar', 'cosas por revisar')} en otras secciones</Enlace>
    </div>
  );
}

function Seccion({ ctx, s, titulo, ayuda, listo = true, children }) {
  const sucio = ctx.form.sucias.includes(s);
  useCambiosSinGuardar(`decisiones.${s}`, sucio);
  const { g, pedir, error, otras, cambio } = useGuardarSeccion(ctx, s);
  return (
    <section data-testid={`seccion-${s}`} aria-label={titulo} style={estiloSeccion}>
      <Campo grupo label={titulo} ayuda={ayuda}>
        {children}
      </Campo>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Boton
          Icono={Save}
          variante="principal"
          escribe
          testid={`guardar-${s}`}
          disabled={!sucio || !listo || g.estado.fase === 'panel'}
          cargando={g.ocupado}
          onClick={pedir}
        >
          Guardar {NOMBRE_SECCION[s]}
        </Boton>
        {sucio && (
          <span data-testid={`sin-guardar-${s}`} style={{ fontSize: TIPO.pequeno, color: RIESGO }}>
            ● sin guardar
          </span>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <PanelImpacto
          g={g}
          conMarcar={s !== 'lotes'}
          textoRehacer={`Guardar ${NOMBRE_SECCION[s]}`}
          soloApartados
          id={ctx.id}
          cambio={cambio}
        />
      </div>
      <OtrasSecciones otras={otras} />
    </section>
  );
}

// Los lotes a los que vamos se cambian aquí (son los de interés): guardar poda lo de los quitados.
function EleccionLotes({ f, elegidos, onCambio }) {
  const [limite, setLimite] = useState(false);
  const presentacion = f.go_no_go?.presentacion;
  const maximo = presentacion?.maximo_lotes ?? presentacion?.maximo;
  // Presentación «a todos los lotes»: no hay elección.
  const fija = presentacion?.codigo === '2';
  const alternar = (id) => {
    if (!puedeMarcar(elegidos, id, maximo)) {
      setLimite(true);
      return;
    }
    setLimite(false);
    onCambio(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);
  };
  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {f.lotes.map((l, i) => (
          <li key={l.id}>
            <label style={{ fontSize: TIPO.texto, color: TINTA, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                data-testid={`decision-lote-${l.id}`}
                data-foco={i === 0 ? 'lotes' : undefined}
                checked={elegidos.includes(l.id)}
                disabled={fija}
                onChange={() => alternar(l.id)}
                aria-label={`Vamos al lote ${l.id}`}
              />
              Lote {l.id}
              {l.nombre ? <span style={{ color: TINTA_2 }}> · {l.nombre}</span> : null}
            </label>
          </li>
        ))}
      </ul>
      {limite && maximo && (
        <div data-testid="lotes-maximo" style={{ marginTop: 6 }}>
          <Aviso tono="aviso">{textoMaximoLotes(maximo)}</Aviso>
        </div>
      )}
    </>
  );
}

// PrecioEnLinea guarda su borrador dentro y su «Guardar precio» se habilita justo cuando tiene algo
// sin guardar: se mira ese botón para que el cajón también avise al salir con un precio a medias.
function useSucioPrecio(raiz) {
  const [sucio, setSucio] = useState(false);
  useEffect(() => {
    const el = raiz.current;
    if (!el) return undefined;
    const mirar = () =>
      setSucio(
        [...el.querySelectorAll('[data-testid^="precio-lote-"][data-testid$="-guardar"]')].some((b) => !b.disabled),
      );
    mirar();
    const obs = new MutationObserver(mirar);
    obs.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    return () => obs.disconnect();
  }, [raiz]);
  return sucio;
}

function SeccionPrecio({ f, o, lotes, decisiones, onGuardado, alGuardar }) {
  const raiz = useRef(null);
  useCambiosSinGuardar('decisiones.precio', useSucioPrecio(raiz));
  const g = o.guion.datos;
  const oe0 = ofertaDeLoteGuion(g, lotes[0]);
  const impuesto =
    oe0?.impuesto_aparte === 'exento' ? '(prestación exenta de impuestos)' : `sin ${oe0?.impuesto_aparte ?? 'IVA'}`;
  return (
    <section ref={raiz} data-testid="seccion-precio" aria-label="Precio" style={estiloSeccion}>
      <Campo
        grupo
        label={lotes.length > 1 ? 'Precio de cada lote' : 'Precio'}
        ayuda={`Precios ${impuesto}. No van en la memoria (es causa de exclusión); se usan en la oferta económica de cada lote. Cada lote se guarda solo.`}
      >
        {lotes.map((lote) => (
          // Sin lotes, la fila «Fijar el precio» de las comprobaciones llega como precio.unico.
          <div
            key={lote ?? 'contrato'}
            data-foco={lote == null ? 'precio.unico' : undefined}
            tabIndex={lote == null ? -1 : undefined}
            style={{ padding: '6px 0' }}
          >
            {lotes.length > 1 && (
              <div style={{ fontSize: TIPO.texto, color: TINTA, fontWeight: 600, marginBottom: 4 }}>Lote {lote}</div>
            )}
            <PrecioEnLinea
              id={f.id}
              lote={lote}
              oe={ofertaDeLoteGuion(g, lote)}
              sugerido={o.precios_sugeridos?.[lote ?? ''] ?? null}
              decisiones={decisiones}
              onGuardado={onGuardado}
              alGuardar={alGuardar}
              conContexto
            />
          </div>
        ))}
      </Campo>
    </section>
  );
}

function Pie({ o, lotes, sucio }) {
  const falta = textoFaltaParaRedactar(faltaParaRedactar(o, lotes));
  return (
    <div style={{ marginTop: 10 }}>
      {o.decisiones && !sucio && (
        <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
          Guardadas {fechaHora(o.decisiones.actualizada_en)} (v{o.decisiones.version ?? 1})
        </div>
      )}
      {falta && <div style={{ fontSize: TIPO.pequeno, color: TINTA_2, marginTop: 6 }}>{falta}</div>}
    </div>
  );
}

// La versión con la que se guarda: la leída o, si ya se guardó algo y la oferta aún no se recargó,
// la que devolvió ese guardado, aquí o en otra pieza (una fila de precio de las comprobaciones): si no, la
// segunda sección seguida daría un 409 falso.
function useVersion(id, decisiones) {
  const [propia, setPropia] = useState(0);
  const version = Math.max(decisionesAlDia(id, decisiones)?.version ?? 1, propia);
  const vigentes = useMemo(() => (decisiones ? { ...decisiones, version } : null), [decisiones, version]);
  return {
    version,
    vigentes,
    apuntar: (v) => {
      if (Number.isInteger(v)) setPropia((p) => Math.max(p, v));
    },
  };
}

function Secciones({ f, o, form, ctx, motivos, equipo, personas }) {
  const g = o.guion.datos;
  return (
    <>
      {(f.lotes ?? []).length > 0 && (
        <Seccion
          ctx={ctx}
          s="lotes"
          titulo="Lotes a los que vamos"
          listo={form.campos.lotes.length > 0}
          ayuda="La memoria se redacta para estos lotes. Quitar uno poda su precio, sus criterios y quien solo va en él: «Qué cambia» lo enseña antes de guardar."
        >
          <EleccionLotes f={f} elegidos={form.campos.lotes} onCambio={(v) => form.poner('lotes', v)} />
        </Seccion>
      )}
      <Seccion
        ctx={ctx}
        s="equipo"
        titulo="Equipo de la oferta"
        ayuda="Con nombre y rol: la memoria los nombra y Hermes lee sus CV de la Biblioteca."
      >
        <div data-foco="equipo" tabIndex={-1}>
          <EquipoOferta
            id={f.id}
            version={ctx.version}
            filas={form.campos.equipo}
            lotes={form.base.lotes}
            onCambio={(v) => form.poner('equipo', v)}
            equipo={equipo}
            personas={personas}
          />
        </div>
        <MotivosEquipo filas={form.campos.equipo} motivos={motivos.equipo} personas={personas} />
      </Seccion>
      {form.campos.automaticos.length > 0 && (
        <Seccion
          ctx={ctx}
          s="automaticos"
          listo={automaticosGuardables(g.automaticos ?? [], form.campos.automaticos)}
          titulo="Criterios automáticos a los que nos acogemos"
          ayuda={`${textoPuntosAutomaticos(g.automaticos ?? [], form.campos.automaticos, form.base.lotes)} Van en su archivo con su casilla; la memoria no los menciona. Elige el tramo que podemos demostrar y di dónde consta.`}
        >
          <Automaticos
            guion={g.automaticos ?? []}
            filas={form.campos.automaticos}
            lotes={form.base.lotes}
            onCambio={(v) => form.poner('automaticos', v)}
            motivos={motivos.automaticos}
          />
        </Seccion>
      )}
      <Seccion
        ctx={ctx}
        s="herramientas"
        titulo="Herramientas y medios"
        ayuda="Separadas por comas: las que la memoria puede nombrar."
      >
        <input
          className="input-field"
          data-foco="herramientas"
          aria-label="Herramientas y medios"
          value={form.campos.herramientas}
          onChange={(e) => form.poner('herramientas', e.target.value)}
          style={{ width: '100%' }}
        />
      </Seccion>
      <Seccion ctx={ctx} s="enfoque" titulo={TITULO_ENFOQUE} ayuda={AYUDA_ENFOQUE}>
        <textarea
          className="input-field"
          data-testid="decision-enfoque"
          data-foco="enfoque"
          aria-label={TITULO_ENFOQUE}
          rows={5}
          maxLength={8000}
          value={form.campos.enfoque}
          onChange={(e) => form.poner('enfoque', e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <NoPrometer items={o.propuesta_decisiones?.datos?.no_prometer} />
      </Seccion>
    </>
  );
}

function Avisos({ o, ajena, onCargar }) {
  return (
    <>
      {ajena && (
        <div data-testid="decisiones-ajenas" style={{ marginBottom: 10 }}>
          <Aviso tono="aviso">
            Otra persona guardó decisiones distintas mientras editabas.{' '}
            <Enlace onClick={onCargar}>Cargar las suyas</Enlace> (se pierden tus cambios).
          </Aviso>
        </div>
      )}
      {o.guion_cambiado && (
        <div style={{ marginBottom: 10 }}>
          <Aviso tono="aviso">Las decisiones se fijaron con un guion anterior: revísalas y guárdalas otra vez.</Aviso>
        </div>
      )}
      {problemasAgrupados(o).map((p) => (
        <div key={p} data-testid="decisiones-problema" style={{ marginBottom: 10 }}>
          <Aviso tono="aviso">{p}</Aviso>
        </div>
      ))}
    </>
  );
}

function Formulario({ f, o, equipo, personas, onGuardado }) {
  const motivos = useMemo(() => motivosDePropuesta(o.propuesta_decisiones), [o.propuesta_decisiones]);
  const ambito = f.go_no_go?.ambito ?? null;
  const form = useFormulario(o, ambito);
  const { version, vigentes, apuntar } = useVersion(f.id, o.decisiones);
  const [conflicto, setConflicto] = useState(false);
  // Tras un 409 se recarga la oferta: llegan las decisiones de la otra persona y se ofrece cargarlas.
  const ctx = {
    id: f.id,
    version,
    form,
    onGuardado,
    alGuardar: apuntar,
    alConflicto: () => {
      setConflicto(true);
      onGuardado?.();
    },
  };
  const lotesPrecio = form.base.lotes.length ? form.base.lotes : [null];
  return (
    <RegistroSecciones>
      <div style={{ marginBottom: 10 }}>
        <DeshacerCambio
          id={f.id}
          recarga={version}
          alDeshacer={(r) => {
            apuntar(r?.version);
            onGuardado?.();
          }}
        />
      </div>
      <PropuestaHermes f={f} o={o} onPedida={onGuardado} />
      <Avisos
        o={o}
        ajena={form.ajena || conflicto}
        onCargar={() => {
          setConflicto(false);
          form.cargarBase();
        }}
      />
      <Secciones f={f} o={o} form={form} ctx={ctx} motivos={motivos} equipo={equipo} personas={personas} />
      <DatosAnexoDecision
        id={f.id}
        guardados={o.decisiones?.datos?.datos_anexo ?? null}
        lotes={form.base.lotes}
        version={version}
        alGuardar={(v) => {
          apuntar(v);
          onGuardado?.();
        }}
      />
      <SeccionPrecio
        f={f}
        o={o}
        lotes={lotesPrecio}
        decisiones={vigentes}
        onGuardado={onGuardado}
        alGuardar={apuntar}
      />
      <Pie o={o} lotes={f.lotes ?? []} sucio={form.sucias.length > 0} />
    </RegistroSecciones>
  );
}

export default function DecisionesOferta({ f, o, equipo, personas, onGuardado }) {
  if (!o.guion)
    return (
      <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>
        Primero el guion (paso 1): las decisiones se toman sobre lo que pide el pliego.
      </div>
    );
  return <Formulario f={f} o={o} equipo={equipo} personas={personas} onGuardado={onGuardado} />;
}
