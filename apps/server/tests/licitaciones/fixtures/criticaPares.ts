// Una crítica por pares de prueba: en los apartados de `pares`, cuál gana y el tramo de
// cada versión; en los demás (idénticos), empate con el tramo de `tramos`. La versión nueva va en
// el documento que toca a la ronda, como en el paquete real.
type Motivo = { cita: string; motivo: string; arreglo: string };
export type Evaluacion = { tramo: number; cita: string; motivos_para_bajar: Motivo[]; falta: string[] };
export type Par = { gana: 'nueva' | 'anterior' | 'empate'; nueva: number; anterior: number };
export type ApartadoPar = { apartado: number; preferido: '1' | '2' | 'empate'; documento_1: Evaluacion; documento_2?: Evaluacion; diferencia?: string };

export function apartadosPares(nuevo: 1 | 2, tramos: number[], pares: Record<number, Par>, evaluar: (apartado: number, tramo: number) => Evaluacion): ApartadoPar[] {
  return tramos.map((t, i) => {
    const n = i + 1;
    const p = pares[n];
    if (!p) return { apartado: n, preferido: 'empate' as const, documento_1: evaluar(n, t) };
    const otro = nuevo === 1 ? 2 : 1;
    const preferido = p.gana === 'empate' ? 'empate' as const : (String(p.gana === 'nueva' ? nuevo : otro) as '1' | '2');
    const docs = { [`documento_${nuevo}`]: evaluar(n, p.nueva), [`documento_${otro}`]: evaluar(n, p.anterior) } as { documento_1: Evaluacion; documento_2: Evaluacion };
    return { apartado: n, preferido, ...docs, ...(p.gana === 'empate' ? {} : { diferencia: 'La otra versión no fija la meta mensual del indicador ni quién la revisa.' }) };
  });
}
