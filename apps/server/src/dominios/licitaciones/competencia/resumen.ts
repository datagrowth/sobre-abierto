// Resumen narrativo opcional de un competidor: Hermes propone una nota para la Biblioteca en Competidores/.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { encolarUnico } from '../../../nucleo/trabajos.js';
import { usadaDesde } from '../../../nucleo/agentes/auditoria.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';

// Hermes lee los agregados con competidores_ver. El código pone los números; la IA solo los cuenta, y la nota
// queda pendiente de aprobar.
export const TIPO_RESUMEN_COMPETIDOR = 'licitaciones.resumen_competidor';
const CARPETA_COMPETIDORES = 'Competidores';
export const PayloadResumen = z.object({ nif: z.string().min(3).max(20), pedida_en: z.string().min(10) });

/** Encola el resumen; si ya hay uno en cola o en marcha para ese NIF, devuelve ese. */
export function pedirResumenCompetidor(dbNucleo: DbNucleo, dbLic: Db, nif: string): Result<{ trabajo: number }> {
  if (!dbLic.prepare('SELECT 1 FROM adjudicaciones WHERE adjudicatario_nif = ? LIMIT 1').get(nif)) {
    return fail('not_found', `No hay adjudicaciones de la empresa con NIF ${nif}: no hay nada que resumir.`);
  }
  const enCurso = dbNucleo
    .prepare(
      `SELECT id FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.nif') = ?`,
    )
    .get(TIPO_RESUMEN_COMPETIDOR, nif) as { id: number } | undefined;
  if (enCurso) return ok({ trabajo: enCurso.id });
  const pedida = new Date().toISOString();
  const trabajo = encolarUnico(dbNucleo, {
    tipo: TIPO_RESUMEN_COMPETIDOR,
    dominio: 'licitaciones',
    base: `resumen-competidor-${nif}`,
    payload: { nif, pedida_en: pedida },
    aMano: true,
  }).id;
  return ok({ trabajo });
}

/**
 * ¿Llegó la propuesta? La tool biblioteca_proponer deja en la auditoría la carpeta como
 * recurso; con dos resúmenes a la vez, cualquiera de las dos notas cuenta para ambos.
 */
export function resumenRecibido(dbNucleo: DbNucleo, pedidaEn: string): boolean {
  return usadaDesde(dbNucleo, 'biblioteca_proponer', CARPETA_COMPETIDORES, pedidaEn);
}

export function instruccionesResumen(nif: string, empresa: string): string {
  return [
    `Tarea de la plataforma de ${empresa}: resume en una nota lo que sabemos del competidor con NIF ${nif}.`,
    `1. Lee sus datos con competidores_ver (nif=${nif}): contratos ganados, importe, órganos donde gana, CPV, territorios, baja media y su rango, ofertas en las que gana, evolución por año, si es pyme, últimos contratos y coincidencias con las oportunidades que seguimos.`,
    '2. Si te ayuda, mira con biblioteca_buscar si ya hay notas de esa empresa (carpeta «Competidores») para no repetirlas.',
    `3. Propón una nota con biblioteca_proponer: titulo «Competidor <nombre> (${nif})», carpeta «${CARPETA_COMPETIDORES}» (sin fuente), y en el contenido: quién es, en qué gana (tipos de contrato y CPV), dónde (órganos y territorios), cómo (baja típica y frente a cuántas ofertas), cómo evoluciona, dónde coincide con lo que seguimos y qué vigilar. Cita las cifras tal cual vienen; no inventes ni estimes lo que no esté en los datos.`,
    '4. Recuerda en la nota que la PLACSP solo publica los ganadores: no sabemos en qué concursos participa sin ganar.',
    'No hagas nada más ni respondas en ningún canal.',
  ].join('\n');
}
