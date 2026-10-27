// licitaciones_compromisos: lo que la memoria compromete y cuesta al ejecutar el contrato, para el agente.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { listarPersonas } from '../../../nucleo/colaboradores/personas.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { leerPerfilCostes, type PerfilCostesData } from '../../../nucleo/perfilCostes.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import type { Db } from '../store.js';
import type { ClaseCompromiso, NivelCoste } from './compromisosSolucion.js';
import { sinImportes } from './compromisosSolucion.js';
import { memoriaDeLaOferta, memoriasDe } from './memoria.js';
import { lotesDeLaMemoria } from './memoriaPresentada.js';
import { supuestoParaAgente, taparPersonas, type Tapar } from './ofertaAgente.js';
import { registrarProveedorCoste, type ProveedorCompromisosCoste } from './compromisosMemoriaCoste.js';
import { compromisosConCoste } from './costesCompromisos.js';
import { compromisosDeMemoria, type CompromisoCosteMemoria, type CostesMemoria } from './resumenMemoria.js';
import { sanearTexto } from './toolsMesa.js';

// Son las horas que el pliego no pedía. Sale de compromisosDeMemoria, así que dice lo mismo que el resumen de la
// memoria y las comprobaciones, pero sin euros: el coste va en horas y en un nivel (bajo, medio, alto) con los
// umbrales del perfil de costes. Una cifra en euros que lee un agente puede acabar en la memoria, que va en un
// sobre sin precios. Las personas van tapadas: las citas son texto de la memoria. Solo lee.
export const ConsultaCompromisos = z.strictObject({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Versión de la memoria; sin ella, la de la oferta (la presentada o la última que no es de ensayo)'),
  lote: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe('Solo los compromisos de ese lote (y, con memoria por lote, la memoria de ese lote)'),
  solo_caros: z.boolean().default(false).describe('Solo los añadidos que pasan los umbrales del perfil de costes'),
});
export type ConsultaCompromisosData = z.infer<typeof ConsultaCompromisos>;

/** Un compromiso para el agente: horas y nivel, nunca euros. */
type CompromisoParaAgente = {
  texto: string;
  cita: string | null;
  apartados: number[];
  clase: ClaseCompromiso;
  criterio: string | null;
  horas: number | null;
  nivel: NivelCoste | null;
  supuesto: string;
  barata: string;
};
export type RespuestaCompromisos = {
  id: string;
  version: number;
  cotejado: boolean;
  total_horas: number;
  compromisos: CompromisoParaAgente[];
};

// Medio desde la mitad del umbral: lo que se acerca a una fila de las comprobaciones sin llegar.
const FRACCION_MEDIO = 0.5;
const pasa = (x: CompromisoCosteMemoria, p: PerfilCostesData, f: number): boolean =>
  (x.horas ?? 0) >= f * p.umbral_horas || (x.euros ?? 0) >= f * p.umbral_euros;

/**
 * El nivel con los umbrales del perfil de costes. Un añadido es «alto» si el resumen lo marca caro
 * (umbral de horas o max(umbral de euros, % del presupuesto)); un exigido, si pasa los umbrales
 * base. null sin coste estimado (falta el alcance).
 */
export function nivelDeCompromiso(x: CompromisoCosteMemoria, perfil: PerfilCostesData): NivelCoste | null {
  if (x.horas === null && x.euros === null) return null;
  if (x.caro || (x.clase === 'exigido' && pasa(x, perfil, 1))) return 'alto';
  return pasa(x, perfil, FRACCION_MEDIO) ? 'medio' : 'bajo';
}

// Sin importes primero (también los que no llevan «€»), luego sin personas.
const limpio = (tapar: Tapar, t: string): string => tapar(sinImportes(t));

function compromisoParaAgente(x: CompromisoCosteMemoria, perfil: PerfilCostesData, tapar: Tapar): CompromisoParaAgente {
  return {
    texto: limpio(tapar, x.texto),
    cita: x.cita === null ? null : limpio(tapar, x.cita),
    apartados: x.apartados,
    clase: x.clase,
    criterio: x.criterio === null ? null : limpio(tapar, x.criterio),
    horas: x.horas,
    nivel: nivelDeCompromiso(x, perfil),
    supuesto: tapar(supuestoParaAgente(x.supuesto)),
    barata: limpio(tapar, x.barata),
  };
}

/** Los costes de la memoria para un agente: sin euros, con nivel y con las personas tapadas. Puro. */
function costesParaAgente(
  costes: CostesMemoria,
  perfil: PerfilCostesData,
  tapar: Tapar,
  soloCaros: boolean,
): Omit<RespuestaCompromisos, 'id' | 'version'> {
  const filas = soloCaros ? costes.compromisos.filter((x) => x.caro) : costes.compromisos;
  return {
    cotejado: costes.cotejado,
    total_horas: costes.total_anadidos.horas,
    compromisos: filas.map((x) => compromisoParaAgente(x, perfil, tapar)),
  };
}

// Los nombres exactos pasan a «la persona <id>»; las formas cortas (nombre y apellido), a «una persona del equipo».
function taparEquipo(dbNucleo: DbNucleo): Tapar {
  const exactos = taparPersonas(dbNucleo);
  const nombres = listarPersonas(dbNucleo, { inactivos: true })
    .map((p) => p.nombre)
    .filter((n) => n.trim());
  return (t) => sanearTexto(exactos(t), nombres);
}

// La versión pedida o la de la oferta (con memoria por lote, la del lote pedido).
function versionDe(db: Db, a: ConsultaCompromisosData): Result<number> {
  if (a.version !== undefined) return ok(a.version);
  const porLote = lotesDeLaMemoria(db, a.id) !== null && a.lote !== undefined;
  const m = memoriaDeLaOferta(memoriasDe(db, a.id), porLote ? a.lote : undefined);
  return m
    ? ok(m.version)
    : fail('not_found', 'Esta oferta aún no tiene memoria técnica: no hay compromisos que leer.');
}

/** Los compromisos con coste de la memoria para un agente. not_found sin oferta o memoria; conflicto si aún no está montada. */
export function compromisosParaAgente(
  db: Db,
  dbNucleo: DbNucleo,
  a: ConsultaCompromisosData,
): Result<RespuestaCompromisos> {
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(a.id))
    return fail('not_found', `No hay ninguna licitación con id «${a.id}».`);
  const version = versionDe(db, a);
  if (version.error) return version;
  const costes = compromisosDeMemoria(db, dbNucleo, a.id, version.data, a.lote ?? null);
  if (costes.error) return costes;
  const perfil = leerPerfilCostes(dbNucleo, nucleo().config.licitaciones.precioHora).perfil;
  return ok({
    id: a.id,
    version: version.data,
    ...costesParaAgente(costes.data, perfil, taparEquipo(dbNucleo), a.solo_caros),
  });
}

/**
 * El extractor con el perfil de costes de la empresa (con LICITACIONES_PRECIO_HORA por defecto),
 * leído en cada llamada: un cambio en Ajustes › Empresa se nota sin reiniciar. Sin guion ni pliego
 * (el crítico solo pasa el texto): las personas y semanas salen de la propia memoria.
 */
const proveedorCosteDelPerfil =
  (dbNucleo: () => DbNucleo = () => nucleo().db): ProveedorCompromisosCoste =>
  (texto) =>
    compromisosConCoste(texto, leerPerfilCostes(dbNucleo(), nucleo().config.licitaciones.precioHora).perfil);

/** Engancha el extractor al crítico y a la crítica por pares (contrato con compromisosMemoriaCoste.ts). Idempotente. */
export function registrarCostesDelCritico(): void {
  registrarProveedorCoste(proveedorCosteDelPerfil());
}

export function herramientasCompromisos(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_compromisos',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaCompromisos,
    descripcion:
      'Lo que la memoria técnica compromete y cuesta al ejecutar el contrato (frecuencias, horas fijas, sesiones, entrevistas, material por persona, plazos cortos), lo mismo que ve la persona en las comprobaciones y en el resumen de la memoria: por compromiso, su texto, la cita literal de la memoria y sus apartados, si lo exige el pliego o lo añadimos (con el criterio que lo puntúa), las horas de persona en todo el contrato, el nivel de coste (bajo, medio o alto, con los umbrales de la empresa), de dónde sale cada cifra y la formulación más barata; «cotejado» false si no se pudo leer el pliego (todo sale añadido) y «total_horas» de los añadidos. Con «solo_caros», solo los añadidos que pasan los umbrales. Sin «version», la memoria de la oferta. Sin importes: el coste va en horas y nivel. Solo lee: suavizar es una ronda de memoria que pide una persona.',
    recurso: (a) => `${a.id}${a.version ? `#v${a.version}` : ''}`,
    ejecutar: async (a) => compromisosParaAgente(dbLicitaciones(), nucleo().db, a),
  });
}
