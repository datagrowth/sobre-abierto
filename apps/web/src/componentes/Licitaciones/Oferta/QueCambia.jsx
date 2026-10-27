// Panel «Qué cambia»: lo que rehace, marca y pierde un cambio antes de guardarlo, con
// su coste a la vista. «Sigue valiendo» es solo lo que el servidor dice que se mantiene.
// PanelImpacto lo conecta con useGuardarConImpacto (panel, fallo del cálculo y aviso en línea) y,
// si quien lo usa le pasa el cambio, rehace tras guardar los apartados que lo nombran.
import { useEffect, useRef, useState } from 'react';
import { TINTA, TINTA_2, SUPERFICIE_2, RADIUS, IMPIDE, RIESGO, alpha } from '../../../lib/tema';
import { avisoTrasGuardar, textoCoste } from '../../../lib/impactoFormato';
import { apartadosAfectados, avisoAfectados, textoAfectados } from '../../../lib/diffPalabras';
import { memoriaCambiosApi } from '../../../lib/memoriaCambiosApi';
import { IMPACTO } from '../../../lib/idsPrueba';
import Confirmacion from '../../comun/Confirmacion';
import { Aviso, Boton } from '../../ui';

const titulo = {
  fontSize: 12,
  fontWeight: 700,
  color: TINTA_2,
  margin: '10px 0 4px',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
};
const listaEstilo = { margin: 0, paddingLeft: 18, fontSize: 12.5, color: TINTA, lineHeight: 1.6 };

function Grupo({ nombre, piezas, testid, conCoste = false }) {
  if (!piezas.length) return null;
  return (
    <div data-testid={testid}>
      <div style={titulo}>{nombre}</div>
      <ul style={listaEstilo}>
        {piezas.map((a) => (
          <li key={`${a.pieza}#${a.clave}`} data-testid={`${testid}-${a.clave}`}>
            {a.nombre}
            {a.por.length > 0 && <span style={{ color: TINTA_2 }}> · por {a.por.join(', ')}</span>}
            {conCoste && <span style={{ color: TINTA_2 }}> · {textoCoste(a.coste)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SePierde({ piezas }) {
  if (!piezas.length) return null;
  return (
    <div
      data-testid="impacto-pierde"
      style={{
        marginTop: 10,
        padding: '6px 10px',
        borderRadius: RADIUS,
        background: alpha(IMPIDE, 0.1),
        border: `1px solid ${alpha(IMPIDE, 0.45)}`,
      }}
    >
      <div style={{ ...titulo, marginTop: 0, color: IMPIDE }}>Se pierde</div>
      <ul style={listaEstilo}>
        {piezas.map((a) => (
          <li key={`${a.pieza}#${a.clave}`}>
            {a.nombre}: {a.pierde.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SigueValiendo({ mantiene }) {
  if (!mantiene.length) return null;
  return (
    <details data-testid="impacto-mantiene" style={{ marginTop: 10, fontSize: 12.5, color: TINTA_2 }}>
      <summary style={{ cursor: 'pointer' }}>Sigue valiendo ({mantiene.length})</summary>
      <ul style={{ ...listaEstilo, color: TINTA_2 }}>
        {mantiene.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </details>
  );
}

// Lo que hará «Actualizar los apartados afectados»: solo los que nombran lo que cambió, con su coste.
function Afectados({ a }) {
  if (!a) return null;
  return (
    <div data-testid="actualizar-afectados-lista" style={{ marginTop: 10, fontSize: 12.5, color: TINTA }}>
      <div style={{ ...titulo, marginTop: 0 }}>Actualizar los apartados afectados · {textoAfectados(a)}</div>
      <div style={{ color: TINTA_2 }}>
        Hermes los rehace sobre el texto que hay, cambiando solo lo necesario; luego ves el cambio de cada uno.
      </div>
    </div>
  );
}

function Casilla({ texto, marcada, setMarcada }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 12.5, color: TINTA }}>
      <input
        type="checkbox"
        checked={marcada}
        onChange={(e) => setMarcada(e.target.checked)}
        data-testid="impacto-confirmar"
      />
      <span>{texto}</span>
    </label>
  );
}

/**
 * c: la clasificación de impactoFormato; confirmacion: el texto de la casilla obligatoria o null.
 * Sin onMarcar no hay «solo marcarlo» (el perfil de empresa o deshacer no tienen esa opción).
 */
/**
 * coste: el que va en el botón si no es el de todo lo que se rehace (el guardado de las decisiones
 * solo pide los apartados afectados: lo demás queda sin rehacer y el aviso lo dice).
 */
export default function QueCambia({
  c,
  afectados = null,
  coste = null,
  confirmacion = null,
  ocupado = false,
  onRehacer,
  onMarcar = null,
  onCancelar,
  textoRehacer = 'Guardar y rehacer lo afectado',
  textoMarcar = 'Guardar y solo marcarlo',
}) {
  const [marcada, setMarcada] = useState(false);
  const caja = useRef(null);
  useEffect(() => {
    caja.current?.querySelector('[data-testid="impacto-rehacer"]')?.focus();
  }, []);
  const bloqueado = Boolean(confirmacion) && !marcada;
  const alTeclear = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancelar();
    }
  };
  return (
    <section
      ref={caja}
      data-testid={IMPACTO}
      role="dialog"
      aria-label="Qué cambia"
      onKeyDown={alTeclear}
      style={{
        padding: 12,
        borderRadius: RADIUS,
        background: SUPERFICIE_2,
        border: `1px solid ${alpha(RIESGO, 0.5)}`,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>Qué cambia</div>
      {c.resumen && (
        <p data-testid="impacto-resumen" style={{ fontSize: 12.5, color: TINTA, margin: '4px 0 0', lineHeight: 1.5 }}>
          {c.resumen}
        </p>
      )}
      <Grupo nombre="Se rehace" piezas={c.rehace} testid="impacto-se-rehace" conCoste />
      <Grupo nombre="Se marca para revisar" piezas={c.marca} testid="impacto-se-marca" />
      <Afectados a={afectados} />
      <SePierde piezas={c.pierden} />
      <SigueValiendo mantiene={c.mantiene} />
      {confirmacion && <Casilla texto={confirmacion} marcada={marcada} setMarcada={setMarcada} />}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Boton
          variante="principal"
          escribe
          testid="impacto-rehacer"
          onClick={onRehacer}
          disabled={bloqueado}
          cargando={ocupado}
        >
          {textoRehacer} ({textoCoste(coste ?? c)})
        </Boton>
        {onMarcar && (
          <Boton escribe testid="impacto-marcar" onClick={onMarcar} disabled={bloqueado || ocupado}>
            {textoMarcar}
          </Boton>
        )}
        <Boton testid="impacto-cancelar" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Boton>
      </div>
    </section>
  );
}

// Tras guardar con «rehacer», los apartados afectados se piden solos (su coste ya estaba en el
// botón); con «solo marcarlo» queda el botón para pedirlos luego. Un guardado fallido no pide nada.
// Una petición por versión (con memoria por lote, la de cada lote que toca el cambio); el aviso
// junta lo pedido y el primer fallo.
async function pedirPorVersion(id, a, cambio) {
  const rs = await Promise.allSettled(
    a.versiones.map((v) => memoriaCambiosApi.actualizarAfectados(id, v.version, cambio)),
  );
  const fallo = rs.find((r) => r.status === 'rejected')?.reason;
  const hechos = rs.flatMap((r, i) => (r.status === 'fulfilled' ? [avisoAfectados(r.value, a.versiones[i])] : []));
  const texto = [...hechos, ...(fallo ? [fallo.message] : [])].join(' ');
  return {
    fase: 'hecho',
    tono: fallo ? (fallo.status === 400 && hechos.length === 0 ? 'aviso' : 'error') : 'info',
    texto,
  };
}

function useAfectadosTrasGuardar(g, id, cambio) {
  const [pendiente, setPendiente] = useState(null);
  const [tras, setTras] = useState({ fase: 'nada' });
  const [visto, setVisto] = useState(g.estado);
  // Cada petición, una sola vez aunque el efecto se repita (StrictMode): cada una gasta runs.
  const pedida = useRef(null);
  // El guardado termina cuando el estado del hook cambia: a «quieto» si fue bien, al panel si falló.
  if (visto !== g.estado) {
    setVisto(g.estado);
    if (pendiente && !g.estado.guardando) {
      setPendiente(null);
      if (g.estado.fase === 'quieto')
        setTras({ fase: pendiente.tras === 'rehacer' ? 'pidiendo' : 'boton', a: pendiente.a });
    }
  }
  useEffect(() => {
    if (tras.fase !== 'pidiendo' || pedida.current === tras) return;
    pedida.current = tras;
    pedirPorVersion(id, tras.a, cambio).then(setTras);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tras]);
  const a = id && cambio && g.estado.fase === 'panel' ? apartadosAfectados(g.estado.clasificacion) : null;
  const con = (fn, modo) => () => {
    if (a) setPendiente({ a, tras: modo });
    setTras({ fase: 'nada' });
    fn();
  };
  return {
    a,
    tras,
    lanzar: (af) => setTras({ fase: 'pidiendo', a: af }),
    rehacer: con(g.rehacer, 'rehacer'),
    marcar: con(g.marcar, 'marcar'),
  };
}

// «Guardar el precio y rehacer los apartados afectados (30 min · 1 run)»; sin apartados que pedir, solo «Guardar el precio».
function textoBotonApartados(texto, a) {
  return a
    ? { texto: `${texto} y rehacer los apartados afectados`, coste: a }
    : { texto, coste: { minutos: 0, runs: 0 } };
}

function TrasGuardar({ t, onLanzar }) {
  if (t.fase === 'boton') {
    return (
      <div style={{ marginTop: 8 }}>
        <Boton variante="principal" escribe testid="actualizar-afectados" onClick={() => onLanzar(t.a)}>
          Actualizar los apartados afectados ({textoAfectados(t.a)})
        </Boton>
      </div>
    );
  }
  if (t.fase === 'pidiendo')
    return (
      <div data-testid="actualizar-afectados-pidiendo" style={{ marginTop: 8, fontSize: 12.5, color: TINTA_2 }}>
        Pidiendo a Hermes los apartados afectados…
      </div>
    );
  if (t.fase === 'hecho')
    return (
      <div data-testid="actualizar-afectados-aviso" style={{ marginTop: 8 }}>
        <Aviso tono={t.tono}>{t.texto}</Aviso>
      </div>
    );
  return null;
}

/**
 * Lo que enseña useGuardarConImpacto: el panel, la pregunta si el cálculo falla y el aviso del guardado.
 * id y cambio (el mismo que se pasó a g.iniciar): con ellos, tras guardar se rehacen los apartados de
 * la memoria que nombran lo que cambió; sin ellos, el panel no los ofrece. soloApartados: el guardado
 * no rehace nada más (las decisiones): el botón dice y cuesta solo lo que se pide de verdad.
 */
export function PanelImpacto({
  g,
  conMarcar = true,
  textoRehacer,
  textoFallo = null,
  id = null,
  cambio = null,
  soloApartados = false,
}) {
  const { estado } = g;
  const af = useAfectadosTrasGuardar(g, id, cambio);
  const boton = soloApartados ? textoBotonApartados(textoRehacer, af.a) : { texto: textoRehacer, coste: null };
  // Si este panel ya pide los apartados afectados, el aviso no los da por pendientes.
  const aviso =
    g.aviso?.tras && af.tras.fase !== 'nada'
      ? { ...g.aviso, texto: avisoTrasGuardar(g.aviso.tras, g.aviso.clasificacion, { conApartados: true }) }
      : g.aviso;
  return (
    <>
      {estado.fase === 'panel' && (
        <QueCambia
          c={estado.clasificacion}
          afectados={af.a}
          coste={boton.coste}
          confirmacion={estado.confirmacion}
          ocupado={Boolean(estado.guardando)}
          onRehacer={af.rehacer}
          onMarcar={conMarcar ? af.marcar : null}
          onCancelar={g.cancelar}
          textoRehacer={boton.texto}
        />
      )}
      {estado.fase === 'fallo' && (
        <Confirmacion
          pregunta={textoFallo ?? estado.texto}
          detalle={estado.detalle}
          textoSi={conMarcar ? 'Guardar y marcar todo' : 'Guardar igualmente'}
          onSi={conMarcar ? g.marcar : g.rehacer}
          onNo={g.cancelar}
        />
      )}
      {aviso && (
        <div data-testid="impacto-aviso">
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      <TrasGuardar t={af.tras} onLanzar={af.lanzar} />
    </>
  );
}
