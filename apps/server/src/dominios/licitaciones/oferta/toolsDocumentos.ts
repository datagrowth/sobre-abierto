// licitaciones_documentos: la checklist de la presentación para el agente, por lote y sobre.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { registrarHerramienta, RESPUESTA_LECTURA } from '../../../nucleo/mcp/herramienta.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { archivoExistente, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { documentosOferta, type DocumentoConAnexo } from './anexosChecklist.js';
import { comprobacionesDe } from './comprobaciones.js';
import type { Bloqueo } from './comprobacionesTipos.js';
import { hojaDeDatos, type CampoHoja } from './hojaDatos.js';

// Lo que falta va primero y, si se pide, la hoja de datos sin los importes. El estado que se da es el verificado
// (el archivo existe), nunca el que una persona dejó en el select, para que el agente vea lo mismo que las
// comprobaciones y no repita un «todo listo» que no es verdad.
export const ConsultaDocumentos = z.strictObject({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  lote: z.string().trim().min(1).max(20).optional().describe('Solo los documentos de ese lote y los comunes a todos'),
  sobre: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe('Solo los del archivo electrónico o sobre cuyo nombre contenga este texto'),
  hoja: z
    .boolean()
    .default(false)
    .describe('Añade la hoja de datos (empresa, licitación, criterios y firma), sin importes'),
});
export type ConsultaDocumentos = z.infer<typeof ConsultaDocumentos>;

type EstadoVerificado = 'verificado' | 'falta' | 'no_aplica' | 'no_comprobado';
type DocumentoMcp = {
  clave: string;
  nombre: string;
  lote: string | null;
  sobre: string;
  tipo: string;
  obligatorio: boolean;
  estado_verificado: EstadoVerificado;
  produce: 'hermes' | 'persona' | 'empresa';
  ruta: string | null;
  avisos: string[];
};
export type RespuestaDocumentos = {
  resumen: { obligatorios: number; verificados: number; faltan: number };
  documentos: DocumentoMcp[];
  aviso?: string;
  hoja?: { campos: CampoHoja[]; avisos: string[] };
};

type EstadoComprobaciones = { ok: boolean; bloqueos: Bloqueo[] };

const ORDEN: Record<EstadoVerificado, number> = { falta: 0, no_comprobado: 1, verificado: 2, no_aplica: 3 };
// Los importes ofertados viven en los grupos «Oferta…» de la hoja; la empresa y la firma no los llevan.
const esEconomico = (c: CampoHoja): boolean => c.grupo.startsWith('Oferta');

// Sin las comprobaciones no hay con qué contrastar: «no comprobado» es más honesto que un «verificado» adivinado.
function verificar(d: DocumentoConAnexo, raices: Raices, comprobacionesOk: boolean): EstadoVerificado {
  if (d.estado === 'no_aplica') return 'no_aplica';
  if (!comprobacionesOk) return 'no_comprobado';
  if (d.estado !== 'preparado') return 'falta';
  if (!d.ruta) return 'no_comprobado';
  return archivoExistente(raices, d.ruta).error ? 'falta' : 'verificado';
}

const quienLoProduce = (d: DocumentoConAnexo): DocumentoMcp['produce'] =>
  d.produce === 'hermes' ? 'hermes' : d.tipo === 'acreditacion' ? 'empresa' : 'persona';

function avisosDe(d: DocumentoConAnexo, bloqueos: Bloqueo[]): string[] {
  const deComprobaciones = bloqueos.filter((b) => b.accion.destino === `documentos.${d.clave}`).map((b) => b.titulo);
  return [...new Set([...d.anexo.avisos, ...deComprobaciones])];
}

function aMcp(d: DocumentoConAnexo, raices: Raices, comprobaciones: EstadoComprobaciones): DocumentoMcp {
  return {
    clave: d.clave,
    nombre: d.nombre,
    lote: d.lote,
    sobre: d.archivo,
    tipo: d.tipo,
    obligatorio: d.obligatorio,
    estado_verificado: verificar(d, raices, comprobaciones.ok),
    produce: quienLoProduce(d),
    ruta: d.ruta,
    avisos: avisosDe(d, comprobaciones.bloqueos),
  };
}

const delLote = (d: DocumentoConAnexo, lote?: string): boolean =>
  lote === undefined || d.lote === null || d.lote === lote;
const delSobre = (d: DocumentoConAnexo, sobre?: string): boolean =>
  sobre === undefined || textoComparable(d.archivo).includes(textoComparable(sobre));

function resumir(docs: DocumentoMcp[]): RespuestaDocumentos['resumen'] {
  const obligatorios = docs.filter((d) => d.obligatorio && d.estado_verificado !== 'no_aplica');
  const verificados = obligatorios.filter((d) => d.estado_verificado === 'verificado').length;
  return { obligatorios: obligatorios.length, verificados, faltan: obligatorios.length - verificados };
}

function hojaSinImportes(
  db: Db,
  dbNucleo: DbNucleo,
  q: ConsultaDocumentos,
): Result<NonNullable<RespuestaDocumentos['hoja']>> {
  const h = hojaDeDatos(db, dbNucleo, q.id, { lote: q.lote ?? undefined });
  if (h.error) return h;
  return ok({ campos: h.data.campos.filter((c) => !esEconomico(c)), avisos: h.data.avisos });
}

/** La checklist verificada de una oferta para un agente: el resumen, los documentos con lo que falta primero y, si se pide, la hoja sin importes. */
export async function documentosParaAgente(
  db: Db,
  dbNucleo: DbNucleo,
  raices: Raices,
  q: ConsultaDocumentos,
): Promise<Result<RespuestaDocumentos>> {
  const lista = await documentosOferta(db, raices, q.id);
  if (lista.error) return lista;
  const c = comprobacionesDe(db, dbNucleo, q.id);
  const comprobaciones = { ok: !c.error, bloqueos: c.data?.bloqueos ?? [] };
  const documentos = lista.data.documentos
    .filter((d) => delLote(d, q.lote) && delSobre(d, q.sobre))
    .map((d) => aMcp(d, raices, comprobaciones))
    .sort((a, b) => ORDEN[a.estado_verificado] - ORDEN[b.estado_verificado]);
  const respuesta: RespuestaDocumentos = {
    resumen: resumir(documentos),
    documentos,
    ...(lista.data.aviso ? { aviso: lista.data.aviso } : {}),
  };
  if (!q.hoja) return ok(respuesta);
  const hoja = hojaSinImportes(db, dbNucleo, q);
  return hoja.error ? fail(hoja.error.code, hoja.error.message) : ok({ ...respuesta, hoja: hoja.data });
}

export function herramientasDocumentos(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_documentos',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaDocumentos,
    descripcion:
      'La checklist de documentos de la presentación de una licitación, con lo que falta primero: «resumen» (obligatorios, verificados, faltan) y, por documento, clave, nombre, lote, sobre, tipo, si es obligatorio, «estado_verificado» (verificado: el archivo existe; falta; no_aplica; no_comprobado: no se puede comprobar; nunca lo que alguien dejó marcado a mano), quién lo produce (hermes, persona o empresa), ruta y avisos. Con «lote», los de ese lote y los comunes; con «sobre», los del archivo electrónico cuyo nombre lo contenga. Con «hoja», la hoja de datos de la oferta (empresa, licitación, criterios automáticos y firma) sin ningún importe.',
    recurso: (a) => a.id,
    respuestaLarga: RESPUESTA_LECTURA,
    ejecutar: async (a) => documentosParaAgente(dbLicitaciones(), nucleo().db, raicesActuales(), a),
  });
}
