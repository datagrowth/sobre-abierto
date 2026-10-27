// El detalle de la oferta, debajo del asistente: Guion, Decisiones (con «Qué cambia» y deshacer),
// Equipo, Memoria (con volver a montar sin IA, pedir cambios y dar por buena) y Documentos (con el
// DEUC, los anexos y la hoja de datos). Era lo que se abría en los cajones de las comprobaciones; ahora va en
// línea, un apartado a la vista. Los que se abrieron siguen montados y ocultos para no perder lo
// escrito, y salir con cambios sin guardar pregunta antes (CambiosContext).
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TINTA_2, TINTA, ACCION, ACCION_SUAVE, BORDE, RIESGO, RADIUS, LIENZO, RADIUS_PANEL } from '../../../lib/tema';
import { CAJONES, ETIQUETA_CAJON, preguntaCambiosSinGuardar } from '../../../lib/comprobacionesFormato';
import { cajon as testidCajon } from '../../../lib/idsPrueba';
import { useCajonTelemetria } from '../../../hooks/useTelemetriaTarea';
import { Aviso } from '../../ui';
import AvisoRecarga from '../../comun/AvisoRecarga';
import Confirmacion from '../../comun/Confirmacion';
import EquipoLicitacion from '../EquipoLicitacion';
import GuionOferta from './GuionOferta';
import DecisionesOferta from './DecisionesOferta';
import MemoriaOferta from './MemoriaOferta';
import ChecklistOferta from './ChecklistOferta';

const ESPERA_CAMPO_MS = 4000;
const PASO_MS = 100;

export function AvisoSalida({ salida }) {
  if (!salida.pide) return null;
  return (
    <div
      data-testid="cambios-sin-guardar"
      style={{ position: 'fixed', top: 12, right: 12, zIndex: 50, width: 'min(480px, calc(100vw - 24px))' }}
    >
      <Confirmacion
        pregunta={preguntaCambiosSinGuardar(salida.pide.nombres)}
        textoSi="Sí, salir"
        textoNo="Seguir editando"
        destructiva
        onSi={salida.si}
        onNo={salida.no}
      />
    </div>
  );
}

function Cargado({ carga, children }) {
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  if (carga.kind === 'loading' || carga.data == null)
    return <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>;
  return (
    <>
      <AvisoRecarga carga={carga} />
      {children(carga.data)}
    </>
  );
}

function Contenido({ nombre, f, datos, comprobaciones, tras, irA }) {
  const { oferta, propuesta, equipo, personas } = datos;
  if (nombre === 'guion')
    return <Cargado carga={oferta}>{(o) => <GuionOferta f={f} o={o} onCambio={tras} irA={irA} />}</Cargado>;
  if (nombre === 'decisiones') {
    return (
      <Cargado carga={oferta}>
        {(o) => (
          <DecisionesOferta
            f={f}
            o={o}
            equipo={equipo.data ?? null}
            personas={personas.data ?? null}
            onGuardado={tras}
            irA={irA}
          />
        )}
      </Cargado>
    );
  }
  if (nombre === 'equipo')
    return <Cargado carga={equipo}>{(e) => <EquipoLicitacion id={f.id} sinMarco equipo={e} />}</Cargado>;
  if (nombre === 'memoria') {
    return (
      <Cargado carga={oferta}>
        {(o) => (
          <MemoriaOferta f={f} o={o} propuesta={propuesta.data ?? null} onCambio={tras} recargar={oferta.recargar} />
        )}
      </Cargado>
    );
  }
  return (
    <ChecklistOferta
      f={f}
      version={datos.version}
      comprobaciones={comprobaciones.data}
      recargarComprobaciones={comprobaciones.recargar}
    />
  );
}

// Al abrirse, el foco va al campo pedido (data-foco) si aparece en un rato; si no, al apartado.
function useEnfocarCampo(raiz, abierto, campo, pedido) {
  useEffect(() => {
    if (!abierto) return undefined;
    const el = raiz.current;
    el?.scrollIntoView?.({ block: 'start' });
    if (!campo) {
      el?.focus();
      return undefined;
    }
    const inicio = Date.now();
    const iv = setInterval(() => {
      const objetivo = el?.querySelector(`[data-foco="${CSS.escape(campo)}"]`);
      if (!objetivo && Date.now() - inicio < ESPERA_CAMPO_MS) return;
      clearInterval(iv);
      if (objetivo) {
        objetivo.scrollIntoView({ block: 'center' });
        objetivo.focus();
      } else el?.focus();
    }, PASO_MS);
    return () => clearInterval(iv);
  }, [raiz, abierto, campo, pedido]);
}

function Apartado({ nombre, abierto, campo, pedido, onCerrar, children }) {
  const raiz = useRef(null);
  useEnfocarCampo(raiz, abierto, campo, pedido);
  useCajonTelemetria(nombre, abierto);
  return (
    <section
      ref={raiz}
      aria-label={ETIQUETA_CAJON[nombre]}
      data-testid={testidCajon(nombre)}
      hidden={!abierto}
      tabIndex={-1}
      style={{
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
        padding: '12px 14px',
        minWidth: 0,
        outline: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: TINTA, flex: 1 }}>{ETIQUETA_CAJON[nombre]}</h3>
        <button
          type="button"
          data-testid="cajon-cerrar"
          aria-label={`Cerrar ${ETIQUETA_CAJON[nombre]}`}
          onClick={onCerrar}
          style={{
            display: 'inline-flex',
            padding: 6,
            borderRadius: RADIUS,
            border: `1px solid ${BORDE}`,
            background: 'transparent',
            color: TINTA_2,
            cursor: 'pointer',
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {children}
    </section>
  );
}

function Selector({ actual, sucios, onElegir }) {
  return (
    <nav aria-label="Detalle de la oferta" data-testid="cajones" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {CAJONES.map((n) => (
        <button
          key={n}
          type="button"
          data-testid={`abrir-cajon-${n}`}
          aria-pressed={actual === n}
          onClick={() => onElegir(n)}
          style={{
            padding: '5px 11px',
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: RADIUS,
            cursor: 'pointer',
            color: TINTA,
            background: actual === n ? ACCION_SUAVE : 'transparent',
            border: `1px solid ${actual === n ? ACCION : BORDE}`,
          }}
        >
          {ETIQUETA_CAJON[n]}
          {sucios.includes(n) && (
            <span title="Cambios sin guardar" style={{ color: RIESGO, marginLeft: 4 }}>
              ●
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** cajones: useCajones; salida: useSalida; datos: useDatosDetalle; comprobaciones: useComprobaciones (los documentos la recargan). */
export default function DetalleOferta({ f, cajones, salida, sucios, datos, comprobaciones, tras, irA }) {
  const elegir = (n) => salida.pedirSalida(() => (cajones.actual === n ? cajones.cerrar() : cajones.abrir(n)), n);
  return (
    <div data-testid="detalle-oferta" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 14, color: TINTA }}>Detalle de la oferta</h3>
      <Selector actual={cajones.actual} sucios={sucios} onElegir={elegir} />
      {cajones.abiertos.map((n) => (
        <Apartado
          key={`${n}-${cajones.claves[n] ?? 0}`}
          nombre={n}
          abierto={cajones.actual === n}
          campo={cajones.actual === n ? cajones.campo : null}
          pedido={cajones.pedido}
          onCerrar={cajones.cerrar}
        >
          <Contenido nombre={n} f={f} datos={datos} comprobaciones={comprobaciones} tras={tras} irA={irA} />
        </Apartado>
      ))}
    </div>
  );
}
