// Búsqueda de candidatos para uno o varios requisitos: reglas deterministas sobre personas de nucleo.db y CV.
import { z } from 'zod';
import type { Db } from '../db.js';
import { buscarEnBiblioteca } from '../../biblioteca/motor/documentos/busquedaHibrida.js';
import { errorMessage, fail, ok, type Result } from '../result.js';
import { logger } from '../log.js';
import { candidatos, type ResultadoMatching } from './matching.js';
import { listarPersonas, TIPOS_PERSONA } from './personas.js';
import { CARPETA_COLABORADORES } from './cvs.js';
import { disponibilidades } from './disponibilidad.js';

// Las reglas son deterministas y, como apoyo, entran los CV de Colaboradores/ que la Biblioteca encuentra por
// significado. Si la Biblioteca no responde, el matching sigue solo con las reglas.
/** Rutas de los CV más parecidos a un texto, de más a menos. Es la frontera con la Biblioteca. */
export type BuscadorCvs = (texto: string) => Promise<Result<string[]>>;

const CVS_POR_BUSQUEDA = 20;
const log = logger('colaboradores');

export const buscarCvs: BuscadorCvs = async (texto) => {
  try {
    const hits = await buscarEnBiblioteca(texto, CVS_POR_BUSQUEDA, CARPETA_COLABORADORES);
    return ok(hits.map((h) => h.path));
  } catch (err) {
    // Solo el mensaje del error: nunca el texto buscado, que puede llevar nombres.
    log.warn('búsqueda de CV no disponible', { error: errorMessage(err).slice(0, 200) });
    return fail('biblioteca_no_disponible', 'La búsqueda por significado en los CV no está disponible ahora.');
  }
};

const Cpv = z.string().regex(/^\d{2,8}$/, 'CPV: de 2 a 8 cifras');
const TextoRequisito = z.string().trim().min(3).max(2000);

// Sin transformaciones: el mismo esquema se publica a los agentes como JSON Schema.
export const ConsultaCandidatos = z.strictObject({
  texto: TextoRequisito.optional().describe(
    'Un requisito en texto libre, p. ej. «Jefe de proyecto con PMP y 5 años de experiencia»',
  ),
  requisitos: z
    .array(TextoRequisito)
    .max(15)
    .optional()
    .describe('Varios requisitos; se responde cada uno por separado'),
  cpvs: z.array(Cpv).max(30).optional().describe('CPV del contrato, para valorar la experiencia por sector'),
  tipo: z.enum(TIPOS_PERSONA).optional().describe('Solo internos o solo externos'),
  limite: z.number().int().min(1).max(20).default(5).describe('Candidatos por requisito y tipo'),
});
export type ConsultaCandidatosData = z.infer<typeof ConsultaCandidatos>;

export type RespuestaRequisito = ResultadoMatching & { texto: string };
export type RespuestaCandidatos = {
  requisitos: RespuestaRequisito[];
  busqueda_semantica: boolean;
  aviso: string | null;
};

const NOTA =
  'Puntuación orientativa (0–100): 70 puntos por lo exigido que se puede comprobar (años, titulación, certificación, idioma, horas de docencia) y 30 por afinidad (tecnologías y rol citados, CPV, CV parecido). Revisa siempre el CV.';

/** Candidatos de cada requisito. `buscador` es la frontera con la Biblioteca (en tests, un doble). */
export async function buscarCandidatos(
  db: Db,
  c: ConsultaCandidatosData,
  buscador: BuscadorCvs = buscarCvs,
): Promise<Result<RespuestaCandidatos>> {
  const textos = [...(c.texto ? [c.texto] : []), ...(c.requisitos ?? [])];
  if (!textos.length) return fail('invalid_input', 'Indica texto o requisitos.');
  const personas = listarPersonas(db, { inactivos: false, ...(c.tipo ? { tipo: c.tipo } : {}) });
  const disponibilidad = disponibilidades();
  const requisitos: RespuestaRequisito[] = [];
  let semantica = true;
  for (const texto of textos) {
    const cvs = await buscador(texto);
    if (cvs.error) semantica = false;
    requisitos.push({
      texto,
      ...candidatos(personas, { texto, cpvs: c.cpvs ?? [], cvs: cvs.data ?? [], disponibilidad }, c.limite),
    });
  }
  const aviso =
    personas.length === 0
      ? 'Aún no hay colaboradores dados de alta.'
      : semantica
        ? NOTA
        : `${NOTA} La búsqueda por significado en los CV no estaba disponible: solo reglas.`;
  return ok({ requisitos, busqueda_semantica: semantica, aviso });
}
