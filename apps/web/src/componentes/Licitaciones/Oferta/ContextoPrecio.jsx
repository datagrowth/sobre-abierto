// Contexto del precio de un lote, dentro de su fila de precio: qué suele pasar en este
// órgano, el escenario «un solo licitador» con la fórmula del pliego y el coste estimado opcional,
// que avisa si el precio guardado queda por debajo. El coste se guarda con la sección «precio» de
// las decisiones (ofertas[].coste_estimado) y no va a ningún agente.
import { useState } from 'react';
import { Save } from 'lucide-react';
import { TINTA_2, RIESGO, TIPO } from '../../../lib/tema';
import { request } from '../../../lib/apiCliente';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { decisionesAlDia } from '../../../lib/decisionesRecientes';
import useCarga from '../../../hooks/useCarga';
import { useCambiosSinGuardar } from '../../../hooks/useCambiosSinGuardar';
import {
  avisoMargen,
  costeGuardado,
  importeDeOferta,
  leerCoste,
  lineaOrgano,
  ofertasConCoste,
  textoIndicios,
  textoUnLicitador,
} from '../../../lib/contextoPrecioFormato';
import { Aviso, Boton } from '../../ui';

const ERROR_CONFLICTO = 'No se guardó: otra persona guardó decisiones antes que tú.';
const rutaContexto = (id, lote) =>
  `/api/licitaciones/licitaciones/${encodeURIComponent(id)}/oferta/precio/contexto${lote ? `?lote=${encodeURIComponent(lote)}` : ''}`;

function Contexto({ id, lote, testid }) {
  const c = useCarga(() => request(rutaContexto(id, lote)), [id, lote]);
  if (c.kind === 'loading') return null;
  if (c.kind === 'error')
    return <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>No se pudo leer el contexto del órgano.</div>;
  const escenario = textoUnLicitador(c.data);
  const indicios = textoIndicios(c.data?.indicios);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: TIPO.pequeno, color: TINTA_2 }}>
      <span data-testid={`${testid}-organo`}>{lineaOrgano(c.data?.organo)}</span>
      {escenario && <span data-testid={`${testid}-un-licitador`}>Escenario «1 licitador»: {escenario}.</span>}
      {indicios && <span data-testid={`${testid}-indicios`}>{indicios}</span>}
    </div>
  );
}

function useGuardarCoste({ id, lote, decisiones, onGuardado, alGuardar }) {
  const [estado, setEstado] = useState({ ocupado: false, error: null });
  const guardar = async (coste) => {
    setEstado({ ocupado: true, error: null });
    try {
      // Como el precio: sobre lo último guardado si la oferta aún no se recargó.
      const d = decisionesAlDia(id, decisiones);
      const datos = ofertasConCoste(d?.datos?.ofertas ?? [], lote, coste);
      const res = await licitacionesApi.guardarSeccionDecisiones(id, 'precio', { datos, version: d?.version ?? 1 });
      setEstado({ ocupado: false, error: null });
      alGuardar?.(res?.version);
      onGuardado?.();
    } catch (e) {
      setEstado({ ocupado: false, error: e?.code === 'conflicto' ? ERROR_CONFLICTO : e.message });
    }
  };
  return { ...estado, guardar, setError: (error) => setEstado((s) => ({ ...s, error })) };
}

function CampoCoste({ testid, texto, onCambio, sucio, ocupado, onGuardar }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: TIPO.pequeno, color: TINTA_2, flex: '0 1 220px' }}>
        Coste estimado (sin impuestos), opcional
      </span>
      <input
        className="input-field"
        inputMode="decimal"
        value={texto}
        onChange={(e) => onCambio(e.target.value)}
        placeholder="p. ej. 4.500"
        aria-label="Coste estimado (sin impuestos)"
        data-testid={testid}
        style={{ width: 140 }}
      />
      <Boton Icono={Save} escribe testid={`${testid}-guardar`} disabled={!sucio} cargando={ocupado} onClick={onGuardar}>
        Guardar coste
      </Boton>
    </div>
  );
}

function Coste({ id, lote, oe, decisiones, onGuardado, alGuardar }) {
  const ofertas = decisiones?.datos?.ofertas ?? [];
  const base = costeGuardado(ofertas, lote);
  const [s, setS] = useState({ texto: base, base });
  // Lo recargado se adopta si no se está escribiendo otra cosa.
  if (s.base !== base) setS((p) => ({ texto: p.texto === p.base ? base : p.texto, base }));
  const sucio = s.texto !== base;
  useCambiosSinGuardar(`decisiones.coste.${lote ?? 'unico'}`, sucio);
  const g = useGuardarCoste({ id, lote, decisiones, onGuardado, alGuardar });
  const oferta = ofertas.find((o) => (o.lote ?? null) === (lote ?? null));
  const margen = sucio ? null : avisoMargen(importeDeOferta(oferta, oe), oferta?.coste_estimado ?? null);
  const enviar = () => {
    const r = leerCoste(s.texto);
    if (r.error) return g.setError(r.error);
    return g.guardar(r.data);
  };
  const testid = `coste-lote-${lote ?? 'unico'}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <CampoCoste
        testid={testid}
        texto={s.texto}
        onCambio={(texto) => setS((p) => ({ ...p, texto }))}
        sucio={sucio}
        ocupado={g.ocupado}
        onGuardar={enviar}
      />
      {margen && (
        <span
          data-testid={`${testid}-margen`}
          data-negativo={margen.negativo ? '1' : '0'}
          style={{ fontSize: TIPO.pequeno, color: margen.negativo ? RIESGO : TINTA_2 }}
        >
          {margen.texto}
        </span>
      )}
      {g.error && <Aviso tono="error">{g.error}</Aviso>}
    </div>
  );
}

/**
 * id: la licitación; lote: el de la fila (null, contrato entero); oe: su oferta económica del guion;
 * decisiones: las guardadas (con su versión); onGuardado: recargar la oferta; alGuardar(version): la
 * versión que devolvió el guardado, para el formulario que la lleva.
 */
export default function ContextoPrecio({
  id,
  lote = null,
  oe = null,
  decisiones = null,
  onGuardado,
  alGuardar = null,
}) {
  const testid = `contexto-precio-lote-${lote ?? 'unico'}`;
  return (
    <div data-testid={testid} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Contexto id={id} lote={lote} testid={testid} />
      <Coste id={id} lote={lote} oe={oe} decisiones={decisiones} onGuardado={onGuardado} alGuardar={alGuardar} />
    </div>
  );
}
