// Banco de 30 respuestas libres del asistente, con la decisión correcta, para medir si Hermes interpreta bien.
import { z } from 'zod';
import type { InterpretacionEntradaData } from './asistenteInterpretar.js';
import type { Pregunta } from './asistenteTipos.js';

// Son textos escritos a mano sobre las preguntas de ofertas anonimizadas de las comprobaciones. Hace falta
// acertar al menos 27 de 30. La puntuación es por código y compara lo que importa de la decisión, no la frase.
export const UMBRAL_BANCO = 27;

// opcion: la clave de la opción; persona: la persona de Colaboradores (por su nombre); acogerse:
// si la empresa se acoge al criterio; entendido=false: hay que repreguntar.
const Esperado = z.union([
  z.strictObject({ opcion: z.string().min(1) }),
  z.strictObject({ persona: z.string().min(2) }),
  z.strictObject({ acogerse: z.boolean() }),
  z.strictObject({ entendido: z.literal(false) }),
]);
export const CasoBanco = z.strictObject({
  caso: z.string().regex(/^[a-z0-9-]+$/),
  oferta: z.string().min(2),
  pregunta: z.string().min(1),
  texto: z.string().min(1),
  esperado: Esperado,
});
export type CasoBancoData = z.infer<typeof CasoBanco>;
export type RespuestaBanco = Pick<InterpretacionEntradaData, 'entendido' | 'opcion' | 'accion'>;

type Fallo = { caso: string; esperado: CasoBancoData['esperado']; recibido: RespuestaBanco | null };
export type Puntuacion = { aciertos: number; total: number; aprobado: boolean; fallos: Fallo[] };

type Accion = NonNullable<RespuestaBanco['accion']>;

// La acción a la que lleva una respuesta: la de su opción o la que mandó Hermes.
const accionDe = (r: RespuestaBanco, p: Pregunta): Accion | null =>
  r.opcion ? (p.opciones.find((o) => o.clave === r.opcion)?.accion ?? null) : (r.accion ?? null);

// Lo que decide una acción, sin lo que la acompaña (la evidencia, el rol escrito de otra forma).
const decision = (a: Accion | null): unknown => {
  if (!a) return null;
  if (a.tipo === 'persona') return [a.tipo, a.persona_id];
  if (a.tipo === 'automatico') return [a.tipo, a.nos_acogemos, a.nos_acogemos ? a.tramo : null];
  return [a.tipo];
};

/** ¿La respuesta da la decisión esperada? `nombreDe` resuelve el id de una persona a su nombre. */
function acierta(
  c: CasoBancoData,
  r: RespuestaBanco | null,
  p: Pregunta,
  nombreDe: (id: number) => string | null,
): boolean {
  if (!r) return false;
  const e = c.esperado;
  if ('entendido' in e) return r.entendido === false;
  if (!r.entendido) return false;
  const a = accionDe(r, p);
  if ('opcion' in e)
    return (
      JSON.stringify(decision(a)) ===
        JSON.stringify(decision(p.opciones.find((o) => o.clave === e.opcion)?.accion ?? null)) && a !== null
    );
  if ('persona' in e) return a?.tipo === 'persona' && nombreDe(a.persona_id) === e.persona;
  return a?.tipo === 'automatico' && a.nos_acogemos === e.acogerse;
}

/** Cuántos acierta Hermes del banco; un caso sin respuesta o sin su pregunta cuenta como fallo. */
export function puntuarBanco(
  casos: CasoBancoData[],
  respuestas: Record<string, RespuestaBanco>,
  preguntaDe: (c: CasoBancoData) => Pregunta | null,
  nombreDe: (id: number) => string | null,
): Puntuacion {
  const fallos = casos.flatMap((c): Fallo[] => {
    const p = preguntaDe(c);
    const r = respuestas[c.caso] ?? null;
    return p && acierta(c, r, p, nombreDe) ? [] : [{ caso: c.caso, esperado: c.esperado, recibido: r }];
  });
  const aciertos = casos.length - fallos.length;
  return { aciertos, total: casos.length, aprobado: aciertos >= UMBRAL_BANCO, fallos };
}
