// Gancho para el extractor de compromisos con coste (oferta/costesCompromisos.ts). Puro.
import { textoComparable } from '../temas.js';
import { chequeosDelDocumento, secciones, type Chequeo, type Seccion } from './chequeosDocumento.js';
import { esCaro, sinImportes, textoDeCoste, type ClaseCompromiso } from './compromisosSolucion.js';

export type { ClaseCompromiso };
// El extractor lee el texto de la memoria y, con el perfil de costes de la empresa, devuelve cada compromiso con
// su coste. Aquí se define el contrato con ese extractor y cómo llega al crítico: los añadidos caros entran en
// las comprobaciones automáticas del documento, que el crítico lleva a sus motivos. Al crítico solo llegan las
// horas, nunca los euros: la memoria va en un sobre sin precios y nada de lo que lee un agente puede sugerirle un
// importe. Sin proveedor no cambia nada.
/**
 * Cada compromiso que devuelve el extractor, tal como lo acordamos con oferta/costesCompromisos.ts
 * (cuando exista, el tipo se importará de allí). cita: la frase de la memoria donde está;
 * criterio: el que lo puntúa, si es añadido; euros: solo para la persona, aquí se ignora.
 */
export type CompromisoConCoste = {
  texto: string;
  cita: string | null;
  clase: ClaseCompromiso;
  criterio: string | null;
  horas: number | null;
  euros: number | null;
  supuesto: string;
};
/** El extractor ya atado a un perfil de costes: p. ej. (t) => compromisosConCoste(t, perfil). */
export type ProveedorCompromisosCoste = (texto: string) => CompromisoConCoste[];

const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

// El apartado donde sale la cita; null si no se encuentra (va como comprobación del documento).
function apartadoDeCita(ss: Seccion[], cita: string | null): number | null {
  const c = comparable(cita ?? '');
  if (!c) return null;
  return ss.find((s) => s.apartado !== null && comparable(s.texto).includes(c))?.apartado ?? null;
}

// Lo que sigue al crítico: sin euros (ni para decidir si es caro ni en el texto, aunque el
// extractor los escriba en él: «Kits por alumna (4.500 €)»).
const sinEuros = ({ texto, cita, clase, horas }: CompromisoConCoste) => ({
  texto: sinImportes(texto),
  cita,
  clase,
  horas,
});

/** Los compromisos añadidos caros (por sus horas) como comprobaciones del documento (ninguna sin proveedor). */
export function chequeosDeCoste(md: string, proveedor?: ProveedorCompromisosCoste): Chequeo[] {
  if (!proveedor) return [];
  const ss = secciones(md);
  return proveedor(md)
    .map(sinEuros)
    .filter((c) => c.clase === 'anadido' && esCaro(c))
    .map((c) => ({
      tipo: 'coste' as const,
      apartado: apartadoDeCita(ss, c.cita),
      texto: `Compromete «${c.texto}» (${textoDeCoste(c)}), que el pliego no exige: si no lo puntúa, es coste y riesgo de ejecución sin puntos.`,
    }));
}

// El punto de inyección: el crítico (critica.ts) y la crítica por pares (criticaPares.ts) llaman a
// chequeosConCoste sin proveedor, así que quien tenga el extractor lo registra al arrancar y no
// tiene que tocar sus firmas.
let registrado: ProveedorCompromisosCoste | undefined;

/** Registra (o, sin argumento, quita) el proveedor que usan el crítico y la crítica por pares. */
export function registrarProveedorCoste(proveedor?: ProveedorCompromisosCoste): void {
  registrado = proveedor;
}

/** Las comprobaciones del documento y, con proveedor (el que se pasa o el registrado), los compromisos añadidos caros. */
export const chequeosConCoste = (
  md: string,
  proveedor: ProveedorCompromisosCoste | undefined = registrado,
): Chequeo[] => [...chequeosDelDocumento(md), ...chequeosDeCoste(md, proveedor)];
