// Lo que la memoria no afirma por no estar acreditado y los méritos que declara porque la empresa se acoge a ellos.
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { contextoCoherencia } from './coherenciaMemoria.js';
import { valorDeCompromiso, type CompromisoMemoria } from './compromisosMemoria.js';
import type { FilaMemoria } from './ensamblado.js';
import { estrategiaDe } from './estrategia.js';

export type EntradaFrontera = { no_decir: string; motivo: string };

// Los méritos que se prueban con un documento (CV, certificado, título): un compromiso de servicio
// (horas de formación, meses de soporte) lo cumple la empresa al ejecutar y no necesita aviso.
const MERITO = /experiencia|certifica|titulacion|\btitulo|homologa|cualificacion/;
// Cómo escribe la estrategia lo que el dossier no respalda; «se acredita en el sobre 3» es frontera
// con otro archivo, no falta de acreditación, y no casa.
const SIN_ACREDITAR =
  /\bsin acreditar\b|\bno (?:lo |la )?acredita\b|\bno (?:esta |estan |queda |quedan )?acreditad[oa]s?\b|\bno consta\b/;

// Antes, un hueco así paraba la redacción y la persona se enteraba; ahora no la para (fichaSolucion.ts), así
// que la plataforma lo deja como aviso de la memoria al cerrarla: el redactor no tiene dónde decirlo y lo que
// diga de sí mismo no se puede comprobar.
/** Los avisos para la persona: méritos declarados que hay que poder probar y lo que la estrategia dejó sin afirmar. */
export function avisosDeAcreditacion(compromisos: CompromisoMemoria[], frontera: EntradaFrontera[]): string[] {
  const declarados = compromisos
    .filter((c) => MERITO.test(textoComparable(c.criterio)))
    .map(
      (c) =>
        `Acreditación por comprobar: la memoria declara «${c.criterio}» (${valorDeCompromiso(c)}) porque nos acogemos a él y se acredita en este archivo; la plataforma no comprueba el documento que lo prueba (CV, certificado o título): confírmalo antes de presentar o renuncia a esos puntos.`,
    );
  const callados = frontera
    .filter((f) => SIN_ACREDITAR.test(textoComparable(`${f.no_decir} ${f.motivo}`)))
    .map(
      (f) =>
        `Sin acreditar: la memoria no afirma «${f.no_decir}» (${f.motivo}): consigue la acreditación y añádela, o renuncia a esos puntos.`,
    );
  return [...new Set([...declarados, ...callados])];
}

/** Los avisos de acreditación de una memoria (ninguno en una versión subida a mano). */
export function acreditacionesPorComprobar(db: Db, m: FilaMemoria): string[] {
  const c = contextoCoherencia(db, m);
  return c ? avisosDeAcreditacion(c.compromisos ?? [], estrategiaDe(db, m.id)?.datos.frontera ?? []) : [];
}
