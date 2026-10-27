// Estado de la plataforma para agentes y web: cada pieza (índice, ingesta, cola)
// aporta el suyo sin que el núcleo dependa de los dominios.
type Proveedor = () => unknown;

const proveedores = new Map<string, Proveedor>();

export function registrarEstado(nombre: string, fn: Proveedor): void {
  proveedores.set(nombre, fn);
}

export function seccionesEstado(): string[] {
  return [...proveedores.keys()];
}

/** El estado de todas las piezas o, con `seccion`, solo el de esa (cada una se calcula aparte). */
export function estadoPlataforma(seccion?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [nombre, fn] of proveedores) {
    if (seccion !== undefined && nombre !== seccion) continue;
    try {
      out[nombre] = fn();
    } catch (err) {
      out[nombre] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}
