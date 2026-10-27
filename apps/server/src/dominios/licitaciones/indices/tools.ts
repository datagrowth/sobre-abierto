// Herramientas MCP de solo lectura de los índices de mercado, con los mismos números que ve la persona.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { claseNif } from '../../../nucleo/identidad.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { ok, type Result } from '../../../nucleo/result.js';
import { nombreEmpresa } from '../competencia/ambito.js';
import { dbLicitaciones } from '../db.js';
import { participacionesDe } from '../participaciones.js';
import type { Db } from '../store.js';
import { indicesDeLicitacion, OpcionesIndices, type IndicesLicitacion } from './index.js';

const ConsultaIndices = OpcionesIndices.extend({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación, como p-12345678'),
});

// Hermes razona con los mismos números que la ficha (la misma función, indicesDeLicitacion). El NIF de una
// persona física (su DNI) no sale: basta con saber que es una persona física.
const sinDni = <T extends { nif: string }>(x: T): T =>
  claseNif(x.nif) === 'persona_fisica' ? { ...x, nif: 'persona física' } : x;

/** Los índices para un agente: sin los DNI de los licitadores que son personas físicas. */
export function indicesParaAgente(i: IndicesLicitacion): IndicesLicitacion {
  const c = i.concentracion;
  return {
    ...i,
    licitadores: i.licitadores.map(sinDni),
    concentracion: c?.primero ? { ...c, primero: sinDni(c.primero) } : c,
  };
}

export type LicitadoresDeLicitacion = {
  id: string;
  lote: string | null;
  probables: IndicesLicitacion['licitadores'];
  presentados: {
    lote: string;
    nif: string;
    nombre: string | null;
    rol: string;
    importe_ofertado: number | null;
    puntos_tecnicos: number | null;
    puntos_economicos: number | null;
    motivo_exclusion: string | null;
    fuente: string;
    confianza: number;
  }[];
  nota: string;
};

const NOTA_LICITADORES =
  'probables: quién suele presentarse a lo comparable, con su evidencia (sale de las adjudicaciones de la PLACSP y de las actas leídas). presentados: quién se presentó a esta licitación, si ya está resuelta: la adjudicataria la publica la PLACSP y el resto sale de su acta (fuente «acta», con la confianza de la lectura).';

/** Licitadores probables de una licitación y, si ya se resolvió, quién se presentó de verdad. */
export function licitadoresDeLicitacion(db: Db, a: z.infer<typeof ConsultaIndices>): Result<LicitadoresDeLicitacion> {
  const i = indicesDeLicitacion(db, a.id, { lote: a.lote });
  if (i.error) return i;
  const presentados = participacionesDe(db, a.id)
    .filter((p) => !a.lote || p.lote === a.lote)
    .map((p) =>
      sinDni({
        lote: p.lote,
        nif: p.empresa_nif,
        nombre: nombreEmpresa(p.empresa_nombre),
        rol: p.rol,
        importe_ofertado: p.importe_ofertado,
        puntos_tecnicos: p.puntos_tecnicos,
        puntos_economicos: p.puntos_economicos,
        motivo_exclusion: p.motivo_exclusion,
        fuente: p.fuente,
        confianza: p.confianza,
      }),
    );
  return ok({
    id: a.id,
    lote: i.data.lote?.id ?? null,
    probables: indicesParaAgente(i.data).licitadores,
    presentados,
    nota: NOTA_LICITADORES,
  });
}

export function herramientasIndices(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_indices',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaIndices,
    descripcion:
      'Índices de mercado de una licitación (o de un `lote`; por defecto, el primero de interés), los mismos que ve la persona en la ficha: `competencia` (ofertas esperadas con su rango, P(un solo licitador) y si se mezcló con el órgano), `baja` (esperada por tramos de ofertas, rango P25-P75 y umbral de anormalidad del art. 85), `confianza` (alta, media o baja: con baja no des la cifra como buena), `muestra` (n, CPV al que se llegó, descripción), `licitadores` probables con su evidencia, `concentracion` del órgano, `comparables` (los de más peso), `resumen` (la línea que enseña la ficha) y `acierto` (cuánto se desvía cada índice en la prueba hacia atrás). Calcula el código; tú lo explicas. Solo lee.',
    recurso: (a) => a.id,
    ejecutar: async (a) => {
      const r = indicesDeLicitacion(dbLicitaciones(), a.id, { lote: a.lote });
      return r.error ? r : ok(indicesParaAgente(r.data));
    },
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_licitadores',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaIndices,
    descripcion:
      'Licitadores de una licitación (o de un `lote`): `probables` (quién suele presentarse a lo comparable, con puntos, ganadas, presentadas, en este órgano, última vez, baja media y evidencia) y `presentados` (si ya se resolvió: la adjudicataria de la PLACSP y los demás leídos de su acta, con importe, puntos, exclusión, fuente y confianza). Una persona física sale sin NIF ni nombre. Solo lee.',
    recurso: (a) => a.id,
    ejecutar: async (a) => licitadoresDeLicitacion(dbLicitaciones(), a),
  });
}
