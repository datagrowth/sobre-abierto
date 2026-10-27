// Tools MCP de competencia, de solo lectura: ranking y ficha de competidores y de
// organismos. Marcar seguidos y pedir resúmenes es cosa de las personas, en la web.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { ok } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { fichaCompetidor, OpcionesCompetidores, OpcionesFicha, rankingCompetidores } from './competidores.js';
import { fichaOrganismo, OpcionesOrganismos, rankingOrganismos } from './organismos.js';
import { normalizarNif } from '../../../nucleo/organizaciones.js';

// Sin transformaciones en el esquema (el SDK lo publica como JSON Schema): se normaliza al ejecutar.
const Ver = OpcionesFicha.extend({
  nif: z
    .string()
    .trim()
    .min(3)
    .max(25)
    .regex(/^[A-Za-z0-9 .-]+$/, 'NIF no válido')
    .describe('NIF de la empresa o del órgano, p. ej. «B12345678»'),
});

const AVISO = 'Solo hay datos de ganadores (la PLACSP no publica todos los licitadores).';
// Lo mismo que la web por defecto: a la escala de la empresa y no la de las grandes consultoras.
const ESCALA =
  'Por defecto, a nuestra escala: la banda de importe en la que licitamos (percentiles 10-90 de nuestras presentadas o, con menos de 5, la de la escala de los rankings) y el territorio de esa escala (prefijo NUTS; sin él, toda España); importe_min/importe_max y nuts los cambian, y todos_importes y toda_espana los quitan. Paginado: pasa en desde el «siguiente» de la respuesta para ver más.';

export function herramientasCompetencia(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'competidores_ranking',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: OpcionesCompetidores,
    descripcion: `Empresas que más ganan en nuestro sector (prefijos CPV de los filtros y del perfil de la empresa, o los que indiques) en los últimos N meses (24 por defecto): contratos, importe, órganos distintos, baja media, ofertas medias, si es pyme, última adjudicación, coincidencias con las oportunidades que seguimos (mismo órgano o misma clase de CPV) y si el equipo la sigue. Orden por importe, contratos o coincidencias. ${ESCALA} ${AVISO}`,
    ejecutar: async (a) => ok(rankingCompetidores(dbLicitaciones(), a)),
  });
  registrarHerramienta(server, agente, {
    nombre: 'competidores_ver',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Ver,
    descripcion: `Ficha de un competidor por NIF: contratos ganados, importe total y medio, órganos donde gana, CPV y territorios (NUTS) frecuentes, baja media y su rango (percentiles), número de ofertas de los contratos que gana, evolución por año, proporción como pyme, últimos contratos con enlace, oportunidades nuestras donde coincide y notas del equipo. ${AVISO}`,
    // Sin recurso: un adjudicatario puede ser una persona física y su NIF, un DNI; la
    // auditoría no guarda datos personales. El del órgano (público) sí se audita.
    ejecutar: async (a) => fichaCompetidor(dbLicitaciones(), normalizarNif(a.nif), a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'organismos_ranking',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: OpcionesOrganismos,
    descripcion: `Órganos de contratación que licitan en nuestro sector en los últimos N meses: licitaciones, importe licitado, meses con actividad, adjudicaciones, importe adjudicado, baja media, ofertas medias, adjudicatarios distintos, oportunidades que seguimos y una puntuación de interés 0–100 (45 % volumen, 35 % recurrencia, 20 % baja moderada). Orden por interés, importe o número de licitaciones. ${ESCALA}`,
    ejecutar: async (a) => ok(rankingOrganismos(dbLicitaciones(), a)),
  });
  registrarHerramienta(server, agente, {
    nombre: 'organismos_ver',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Ver,
    descripcion: `Ficha de un órgano de contratación por NIF: licitaciones (total, del sector, abiertas, por año), a quién adjudica (los 10 que más ganan y la concentración del primero), baja media y percentiles, ofertas medias, evolución por año, últimas adjudicaciones con enlace, oportunidades que seguimos de ese órgano y notas del equipo. ${AVISO}`,
    recurso: (a) => normalizarNif(a.nif),
    ejecutar: async (a) => fichaOrganismo(dbLicitaciones(), normalizarNif(a.nif), a),
  });
}
