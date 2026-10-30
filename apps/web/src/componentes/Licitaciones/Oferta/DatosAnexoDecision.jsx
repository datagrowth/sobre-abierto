// Datos de anexo como decisiones: lo que el anexo pide y el pliego no fija
// (si subcontratamos los servidores, el orden de preferencia de los lotes, el impuesto y su tipo).
// Qué pide cada oferta lo dicen las comprobaciones (filas «dato_anexo», con su cita); se guarda como
// sección propia de las decisiones (PATCH con la versión leída) y la hoja de datos lo usa.
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Save } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import useComprobaciones from '../../../hooks/useComprobaciones';
import { useCambiosSinGuardar } from '../../../hooks/useCambiosSinGuardar';
import {
  datosAnexoDeFormulario,
  datosPedidos,
  ETIQUETA_DATO,
  formularioInicial,
  mover,
  TIPO_GENERAL,
  TIPOS_IMPUESTO,
  textoCita,
  VACIOS,
} from '../../../lib/datosAnexoFormato';
import { Aviso, Boton, Campo } from '../../ui';

const ERROR_CONFLICTO = 'No se guardó: otra persona guardó decisiones antes que tú.';
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const estiloSeccion = { borderTop: `1px solid ${BORDE}`, paddingTop: 10, marginTop: 10 };

function Cita({ p }) {
  const texto = textoCita(p.cita);
  if (!texto) return null;
  return (
    <div data-testid={`dato-anexo-cita-${p.dato}`} style={{ fontSize: TIPO.pequeno, color: TINTA_2, marginTop: 4 }}>
      Lo pide: {texto}
    </div>
  );
}

function Subcontratacion({ valor, poner }) {
  return (
    <select
      className="input-field"
      data-testid="dato-anexo-subcontratacion"
      data-foco="datos_anexo.subcontratacion_servidores"
      value={valor}
      onChange={(e) => poner('subcontratacion', e.target.value)}
      aria-label={ETIQUETA_DATO.subcontratacion_servidores}
    >
      <option value="">Sin decidir</option>
      <option value="si">Sí, subcontratamos servidores o servicios asociados</option>
      <option value="no">No subcontratamos servidores</option>
    </select>
  );
}

function OrdenLotes({ lotes, poner }) {
  const subir = (i, d) => poner('orden_lotes', mover(lotes, i, d));
  if (!lotes.length)
    return <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>Decide primero a qué lotes vamos.</div>;
  return (
    <ol
      data-testid="dato-anexo-orden-lotes"
      data-foco="datos_anexo.orden_lotes"
      tabIndex={-1}
      style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      {lotes.map((l, i) => (
        <li key={l} data-testid={`dato-anexo-orden-lote-${l}`} style={{ fontSize: TIPO.texto, color: TINTA }}>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            Lote {l}
            <Boton Icono={ArrowUp} disabled={i === 0} onClick={() => subir(i, -1)} title={`Subir el lote ${l}`}>
              Subir
            </Boton>
            <Boton
              Icono={ArrowDown}
              disabled={i === lotes.length - 1}
              onClick={() => subir(i, 1)}
              title={`Bajar el lote ${l}`}
            >
              Bajar
            </Boton>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Impuesto({ tipo, porcentaje, poner }) {
  return (
    <div data-testid="dato-anexo-impuesto" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <select
        className="input-field"
        data-foco="datos_anexo.impuesto"
        value={tipo}
        onChange={(e) => poner('impuesto_tipo', e.target.value)}
        aria-label="Impuesto de la oferta"
      >
        <option value="">Sin decidir</option>
        {TIPOS_IMPUESTO.map((t) => (
          <option key={t} value={t}>
            {t === 'exento' ? 'Exento' : t}
          </option>
        ))}
      </select>
      {tipo && tipo !== 'exento' && (
        <input
          className="input-field"
          inputMode="decimal"
          value={porcentaje}
          onChange={(e) => poner('impuesto_porcentaje', e.target.value)}
          placeholder={`${TIPO_GENERAL[tipo]} (tipo general)`}
          aria-label="Tipo del impuesto (%)"
          maxLength={6}
          style={{ width: 140 }}
        />
      )}
      {tipo && tipo !== 'exento' && <span style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>%</span>}
    </div>
  );
}

function useGuardarDatos({ id, version, alGuardar }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const guardar = async (datos) => {
    setOcupado(true);
    setError(null);
    try {
      const r = await licitacionesApi.guardarSeccionDecisiones(id, 'datos_anexo', { datos, version });
      alGuardar?.(r?.version);
      return true;
    } catch (e) {
      setError(e?.code === 'conflicto' ? ERROR_CONFLICTO : e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  };
  return { guardar, ocupado, error, setError };
}

function Formulario({ id, pedidos, guardados, lotes, version, alGuardar }) {
  const inicial = useMemo(() => formularioInicial(guardados, lotes), [guardados, lotes]);
  const [estado, setEstado] = useState({ form: inicial, base: inicial });
  // Lo que llega por los eventos no pisa lo que se está escribiendo: sin cambios, se adopta.
  if (estado.base !== inicial) setEstado((s) => ({ form: igual(s.form, s.base) ? inicial : s.form, base: inicial }));
  const form = estado.form;
  const sucio = !igual(form, inicial);
  useCambiosSinGuardar('decisiones.datos_anexo', sucio);
  const g = useGuardarDatos({ id, version, alGuardar });
  const poner = (k, v) => setEstado((s) => ({ ...s, form: { ...s.form, [k]: v } }));
  const r = datosAnexoDeFormulario(form, guardados, pedidos);
  // Con un solo lote el orden ya viene puesto: guardarlo también es decidirlo.
  const cambia = Boolean(r.error) || !igual(r.data, { ...VACIOS, ...(guardados ?? {}) });
  const enviar = () => {
    if (r.error) return g.setError(r.error);
    return g.guardar(r.data);
  };
  const CAMPO = {
    subcontratacion_servidores: <Subcontratacion valor={form.subcontratacion} poner={poner} />,
    orden_lotes: <OrdenLotes lotes={form.orden_lotes} poner={poner} />,
    impuesto: <Impuesto tipo={form.impuesto_tipo} porcentaje={form.impuesto_porcentaje} poner={poner} />,
  };
  return (
    <>
      {pedidos.map((p) => (
        <Campo key={p.dato} grupo label={ETIQUETA_DATO[p.dato]}>
          {CAMPO[p.dato]}
          <Cita p={p} />
        </Campo>
      ))}
      <Boton
        Icono={Save}
        variante="principal"
        escribe
        testid="guardar-datos-anexo"
        disabled={!cambia}
        cargando={g.ocupado}
        onClick={enviar}
      >
        Guardar datos del anexo
      </Boton>
      {g.error && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="error">{g.error}</Aviso>
        </div>
      )}
    </>
  );
}

/** Se monta en el cajón Decisiones; sin nada que el anexo pida, no se ve. */
export default function DatosAnexoDecision({ id, guardados, lotes, version, alGuardar }) {
  const comprobaciones = useComprobaciones(id);
  const pedidos = useMemo(
    () => datosPedidos(comprobaciones.data?.bloqueos, guardados),
    [comprobaciones.data, guardados],
  );
  if (!pedidos.length) return null;
  return (
    <section data-testid="seccion-datos-anexo" aria-label="Datos que pide el anexo" style={estiloSeccion}>
      <div style={{ fontSize: TIPO.texto, color: TINTA, fontWeight: 600, marginBottom: 6 }}>
        Datos que pide el anexo
      </div>
      <Formulario
        id={id}
        pedidos={pedidos}
        guardados={guardados}
        lotes={lotes}
        version={version}
        alGuardar={alGuardar}
      />
    </section>
  );
}
