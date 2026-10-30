// Equipo propuesto para una licitación: los colaboradores que mejor encajan en cada requisito de medios personales.
import type { Db as DbNucleo } from '../../nucleo/db.js';
import {
  buscarCandidatos,
  type BuscadorCvs,
  buscarCvs,
  type RespuestaRequisito,
} from '../../nucleo/colaboradores/busqueda.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { lotesDeLicitacion } from './lotes.js';
import { fichasDe } from './ficha.js';
import type { Db } from './store.js';

type RequisitoEquipo = RespuestaRequisito & {
  descripcion: string;
  valor_exigido: string | null;
  excluyente: boolean;
  pagina: number | null;
};

// cpvs y ambito: los del lote o lotes de interés si los hay (el equipo es para esos lotes); si no, los del contrato.
export type Equipo = {
  id: string;
  cpvs: string[];
  ambito: string;
  ficha: 'aprobada' | 'sin_ficha';
  requisitos: RequisitoEquipo[];
  busqueda_semantica: boolean;
  aviso: string | null;
};

const SIN_FICHA =
  'Esta licitación aún no tiene ficha: el equipo sale de sus requisitos de medios personales. Mientras, busca a mano con un requisito escrito.';

// Sin IA: reglas y la búsqueda por significado en los CV. Solo la ficha aprobada cuenta, como en el semáforo.
export async function equipoDeLicitacion(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  limite: number,
  buscador: BuscadorCvs = buscarCvs,
): Promise<Result<Equipo>> {
  const lotes = lotesDeLicitacion(db, id);
  if (!lotes) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const cpvs = lotes.ambito.cpvs.filter((c) => /^\d{2,8}$/.test(c));
  const ambito = lotes.ambito.descripcion;
  const fichas = fichasDe(db, id);
  if (!fichas.aprobada)
    return ok({ id, cpvs, ambito, ficha: 'sin_ficha', requisitos: [], busqueda_semantica: false, aviso: SIN_FICHA });
  const medios = fichas.aprobada.datos.requisitos.filter((r) => r.tipo === 'medios_personales');
  if (!medios.length)
    return ok({
      id,
      cpvs,
      ambito,
      ficha: 'aprobada',
      requisitos: [],
      busqueda_semantica: false,
      aviso: 'La ficha no trae requisitos de medios personales.',
    });
  const textos = medios.map((r) => [r.descripcion, r.valor_exigido].filter(Boolean).join('. '));
  const r = await buscarCandidatos(dbNucleo, { requisitos: textos, cpvs: cpvs.slice(0, 30), limite }, buscador);
  if (r.error) return r;
  const requisitos = r.data.requisitos.map((req, i) => ({
    ...req,
    descripcion: medios[i]!.descripcion,
    valor_exigido: medios[i]!.valor_exigido ?? null,
    excluyente: medios[i]!.excluyente,
    pagina: medios[i]!.pagina ?? null,
  }));
  return ok({
    id,
    cpvs,
    ambito,
    ficha: 'aprobada',
    requisitos,
    busqueda_semantica: r.data.busqueda_semantica,
    aviso: r.data.aviso,
  });
}
