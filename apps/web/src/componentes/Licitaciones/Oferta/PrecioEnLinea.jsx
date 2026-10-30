// El precio de un lote fijado en su fila de las comprobaciones, sin abrir cajones. Al
// teclear se ven la baja y el umbral; «Usar» una sugerencia solo rellena el campo (sigue sin
// guardar). Guardar pasa por «Qué cambia» y escribe solo la sección «precio» de las decisiones:
// un problema en el equipo no impide fijar el precio. El precio no va a ningún agente. En las
// comprobaciones y en el cajón lleva debajo el contexto del órgano y el coste estimado (ContextoPrecio).
import { useMemo, useState } from 'react';
import { TINTA, TINTA_2, RIESGO, OK_TEXTO, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { decisionesAlDia } from '../../../lib/decisionesRecientes';
import { numeroONulo } from '../../../lib/formato';
import { hayCambios, importeFormulario, referenciaPrecio } from '../../../lib/ofertaFormato';
import {
  ETIQUETA_ESTADO_PRECIO,
  bajaEnVivo,
  causaSinSugerencia,
  estadoPrecio,
  filaInicial,
  guardadoDeLote,
  leerPreciosLote,
  ofertasConLote,
  sugerenciasUnicas,
  textoSugerencia,
  textoUmbral,
  umbralBaja,
} from '../../../lib/precioEnLinea';
import { precioLote } from '../../../lib/idsPrueba';
import useGuardarConImpacto from '../../../hooks/useGuardarConImpacto';
import { Aviso, Boton } from '../../ui';
import { Enlace } from '../../comun/listas';
import { PanelImpacto } from './QueCambia';
import ContextoPrecio from './ContextoPrecio';

const COLOR_ESTADO = { decidido: OK_TEXTO, sugerido: TINTA_2, pendiente: RIESGO };

// «Usar» una sugerencia pone su importe en el primer precio (o en el total) y nada más: no guarda.
const conPrimerPrecio = (fila, n) =>
  fila.unitarios.length
    ? { ...fila, unitarios: fila.unitarios.map((u, i) => (i === 0 ? { ...u, precio: importeFormulario(n) } : u)) }
    : { ...fila, importe: importeFormulario(n) };

// Lo tecleado vive aparte de lo guardado: si llega otra base sin cambios, se adopta; con
// cambios, se respeta lo que se está escribiendo (salvo que sea justo lo que llega: lo recién guardado).
function useBorrador(base) {
  const [s, setS] = useState({ fila: base, base });
  const sucio = hayCambios(s.fila, s.base);
  if (hayCambios(base, s.base) && (!sucio || !hayCambios(s.fila, base))) setS({ fila: base, base });
  return { fila: s.fila, sucio, poner: (fila) => setS((p) => ({ ...p, fila })) };
}

function Linea({ testid, foco, etiqueta, valor, onCambio, maximo, unidad, umbral }) {
  const baja = bajaEnVivo(numeroONulo(valor), maximo, { unidad, umbral });
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: TIPO.texto, color: TINTA, flex: '0 1 220px' }}>{etiqueta}</span>
      <input
        className="input-field"
        inputMode="decimal"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={unidad ? 'p. ej. 1,50' : 'p. ej. 95.000'}
        aria-label={etiqueta}
        data-testid={testid}
        data-foco={foco ?? undefined}
        style={{ width: 140 }}
      />
      {baja && (
        <span
          data-testid={`${testid}-baja`}
          style={{ fontSize: TIPO.pequeno, color: baja.pasa || baja.baja < 0 ? RIESGO : TINTA_2 }}
        >
          {baja.texto}
        </span>
      )}
    </div>
  );
}

function Lineas({ lote, oe, fila, poner, umbral }) {
  const lineas = oe?.precios_unitarios ?? [];
  const testid = (i) => (i === 0 ? precioLote(lote) : `${precioLote(lote)}-linea-${i}`);
  if (!lineas.length) {
    return (
      <Linea
        testid={testid(0)}
        foco={`precio.${lote}`}
        etiqueta="Importe total"
        valor={fila.importe}
        onCambio={(v) => poner({ ...fila, importe: v })}
        maximo={referenciaPrecio(oe).base}
        unidad={null}
        umbral={umbral}
      />
    );
  }
  const cambiar = (i, precio) =>
    poner({ ...fila, unitarios: fila.unitarios.map((u, j) => (j === i ? { ...u, precio } : u)) });
  return fila.unitarios.map((u, i) => (
    <Linea
      key={u.concepto}
      testid={testid(i)}
      foco={i === 0 ? `precio.${lote}` : null}
      valor={u.precio}
      onCambio={(v) => cambiar(i, v)}
      maximo={lineas[i]?.maximo}
      unidad={lineas[i]?.unidad}
      umbral={umbral}
      etiqueta={`${u.concepto} (por ${lineas[i]?.unidad ?? 'unidad'}${lineas[i]?.cantidad != null ? ` × ${lineas[i].cantidad}` : ''})`}
    />
  ));
}

// Solo con un precio por lote: con varios conceptos, la sugerencia (del total) no dice cuál.
function Sugerencias({ lote, oe, sugerido, onUsar }) {
  if ((oe?.precios_unitarios ?? []).length > 1) return null;
  const causa = causaSinSugerencia(oe, lote, sugerido);
  if (causa)
    return (
      <div data-testid={`${precioLote(lote)}-sin-sugerencia`} style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
        {causa}
      </div>
    );
  return (
    <div
      data-testid={`${precioLote(lote)}-sugerido`}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: TIPO.pequeno, color: TINTA_2 }}
    >
      {sugerenciasUnicas(sugerido).map((s) => (
        <div key={s.clave} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="tabular-nums">Sugerido, sin guardar · {textoSugerencia(s, sugerido.unidad)}</span>
          <Enlace onClick={() => onUsar(s.opcion.importe)}>Usar</Enlace>
        </div>
      ))}
    </div>
  );
}

// Lo que dijo el PATCH vale hasta que llega la oferta recargada (si se recarga tarde, el estado
// no vuelve a «Pendiente» después de guardar).
function useGuardado(decisiones, lote) {
  const [recien, setRecien] = useState(null);
  const guardado =
    recien && recien.de === decisiones ? recien.oferta : guardadoDeLote(decisiones?.datos?.ofertas ?? [], lote);
  return { guardado, apuntar: (oferta) => setRecien({ de: decisiones, oferta }) };
}

function useGuardarPrecio({ id, lote, oe, decisiones, fila, apuntar, onGuardado, alGuardar }) {
  // El cálculo de «Qué cambia» no admite importes: solo qué lote cambia. El mismo va a «Actualizar los apartados afectados».
  const cambio = useMemo(() => ({ decisiones: { precio: { lote } } }), [lote]);
  const [otras, setOtras] = useState([]);
  const guardar = async () => {
    const r = leerPreciosLote(fila, oe);
    if (r.error) throw new Error(r.error);
    // Con lo que devolvió el último guardado si la oferta aún no se recargó: su versión y los precios de los demás lotes.
    const d = decisionesAlDia(id, decisiones);
    const res = await licitacionesApi.guardarSeccionDecisiones(id, 'precio', {
      datos: ofertasConLote(d?.datos?.ofertas ?? [], r.data),
      version: d?.version ?? 1,
    });
    apuntar(r.data);
    setOtras(res?.problemas_otras ?? []);
    alGuardar?.(res?.version);
    onGuardado?.();
  };
  const g = useGuardarConImpacto(id, { cambio, guardar });
  return { g, otras, cambio };
}

/**
 * id: la licitación; lote: el del bloqueo; oe: su oferta económica del guion; sugerido: el de
 * precios_sugeridos; decisiones: las guardadas (o.decisiones, con su versión); onGuardado: recargar.
 * conContexto: debajo, el contexto del órgano y el coste estimado (la Mesa no lo enseña: es un vistazo).
 * alGuardar(version): la versión que devolvió el guardado, para el formulario que la lleva (Decisiones).
 */
export default function PrecioEnLinea({
  id,
  lote,
  oe,
  sugerido = null,
  decisiones = null,
  onGuardado,
  conContexto = false,
  alGuardar = null,
}) {
  const { guardado, apuntar } = useGuardado(decisiones, lote);
  const base = useMemo(() => filaInicial(oe, lote, guardado), [oe, lote, guardado]);
  const { fila, sucio, poner } = useBorrador(base);
  const [error, setError] = useState(null);
  const { g, otras, cambio } = useGuardarPrecio({ id, lote, oe, decisiones, fila, apuntar, onGuardado, alGuardar });
  const estado = estadoPrecio({ guardado, borrador: fila, sugerido });
  const umbral = umbralBaja(sugerido, oe);
  const pedirGuardar = () => {
    const r = leerPreciosLote(fila, oe);
    setError(r.error);
    if (!r.error) g.iniciar();
  };
  return (
    <div data-testid={`${precioLote(lote)}-fila`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: TIPO.pequeno }}>
        <span
          data-testid={`${precioLote(lote)}-estado`}
          data-estado={estado}
          style={{ fontWeight: 600, color: COLOR_ESTADO[estado] }}
        >
          {ETIQUETA_ESTADO_PRECIO[estado]}
        </span>
        {sucio && <span style={{ color: RIESGO }}>● sin guardar</span>}
      </div>
      <Lineas lote={lote} oe={oe} fila={fila} poner={poner} umbral={umbral} />
      <div data-testid={`${precioLote(lote)}-umbral`} style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
        {textoUmbral(sugerido, oe)}
      </div>
      <Sugerencias lote={lote} oe={oe} sugerido={sugerido} onUsar={(n) => poner(conPrimerPrecio(fila, n))} />
      <div>
        <Boton
          variante="principal"
          escribe
          testid={`${precioLote(lote)}-guardar`}
          disabled={!sucio}
          cargando={g.ocupado}
          onClick={pedirGuardar}
        >
          Guardar precio
        </Boton>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      <PanelImpacto g={g} textoRehacer="Guardar el precio" soloApartados id={id} cambio={cambio} />
      {otras.length > 0 && (
        <Aviso tono="aviso">Precio guardado. Sigue pendiente en otras partes: {otras.join(' ')}</Aviso>
      )}
      {conContexto && (
        <ContextoPrecio
          id={id}
          lote={lote}
          oe={oe}
          decisiones={decisiones}
          onGuardado={onGuardado}
          alGuardar={alGuardar}
        />
      )}
    </div>
  );
}
