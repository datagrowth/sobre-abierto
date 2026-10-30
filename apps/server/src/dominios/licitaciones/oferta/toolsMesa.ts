// licitaciones_mesa: la Mesa de las comprobaciones para el agente, pensada para el resumen diario por canal.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { listarPersonas } from '../../../nucleo/colaboradores/personas.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { zonaEmpresa } from '../../../nucleo/empresa.js';
import { horaLocalEspana, type ZonaHoraria } from '../../../nucleo/fechas.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { ok, type Result } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import type { Db } from '../store.js';
import { comprobacionesDe } from './comprobaciones.js';
import type { Categoria, Comprobaciones } from './comprobacionesTipos.js';
import { hermesEnVivo } from './hermesEnVivo.js';
import { nombresDelEquipoEn } from './hechos.js';
import { compromisosCarosDe, mesaDe, tareaTuya, type CompromisosCaros } from './mesa.js';
import { primerBloqueoAbierto } from './ofertaAgente.js';
import { textoPlazo } from './plazo.js';

// Sale de mesaDe y de comprobacionesDe, así que el veredicto y el primer bloqueo son los de la web. Sin importes
// ni datos personales: el título del bloqueo pasa por un saneado.
export const ConsultaMesa = z.strictObject({
  desde: z.number().int().min(0).default(0).describe('Desplazamiento: el «siguiente» de la respuesta anterior'),
  limite: z.number().int().min(1).max(20).default(10).describe('Cuántas ofertas devolver (hasta 20)'),
});
export type ConsultaMesa = z.infer<typeof ConsultaMesa>;

type OfertaMesa = {
  id: string;
  expediente: string;
  titulo: string;
  organo: string;
  limite_decidir: string | null;
  limite_decidir_texto: string | null;
  veredicto: { tipo: string; texto: string };
  primer_bloqueo: { clave: string; categoria: Categoria; titulo: string } | null;
  tareas_tuyas: number;
  cola: { en_marcha: number; en_cola: number };
  // Lo mismo que la Mesa web, en horas y sin euros (los euros son solo de la web).
  compromisos_caros: CompromisosCaros | null;
};
export type RespuestaMesa = {
  total: number;
  desde: number;
  siguiente: number | null;
  recortado: false;
  ofertas: OfertaMesa[];
};

const TITULO_MAX = 160;
const IMPORTE = /\d[\d.,]*\s*(?:€|eur\b|euros?\b)|€\s*\d[\d.,]*/gi;
const PERSONA = 'una persona del equipo';

const escapar = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Las formas con que se nombra a alguien: entero, nombre y primer apellido, o los dos apellidos.
function formasLiterales(nombre: string): string[] {
  const t = nombre.trim().split(/\s+/);
  return [
    ...new Set(
      [t.join(' '), t.slice(0, 2).join(' '), t.length >= 3 ? t.slice(-2).join(' ') : ''].filter((f) => f.includes(' ')),
    ),
  ].sort((a, b) => b.length - a.length);
}

/** Quita del texto los nombres del equipo y los importes. Si algún nombre se resiste (tildes distintas), no devuelve el texto: solo la frase genérica. */
export function sanearTexto(texto: string, nombres: string[]): string {
  let t = texto.replace(IMPORTE, 'un importe');
  for (const n of nombres) for (const f of formasLiterales(n)) t = t.replace(new RegExp(escapar(f), 'gi'), PERSONA);
  return nombresDelEquipoEn(t, nombres).length > 0 ? `Tarea de ${PERSONA}` : t;
}

const recortar = (t: string): string => (t.length > TITULO_MAX ? `${t.slice(0, TITULO_MAX - 1).trimEnd()}…` : t);
const instante = (iso: string | null): number => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);

function textoLimite(iso: string | null, zona: ZonaHoraria): string | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? null : textoPlazo(horaLocalEspana(ms), zona);
}

function colaDe(db: Db, dbNucleo: DbNucleo, id: string, ahoraMs: number): OfertaMesa['cola'] {
  const h = hermesEnVivo(db, dbNucleo, id, ahoraMs);
  const trabajos = h.error ? [] : h.data.trabajos;
  return {
    en_marcha: trabajos.filter((t) => t.estado === 'generando').length,
    en_cola: trabajos.filter((t) => t.estado === 'en_cola').length,
  };
}

function ofertaDe(db: Db, dbNucleo: DbNucleo, id: string, nombres: string[], ahoraMs: number): OfertaMesa | null {
  const c = comprobacionesDe(db, dbNucleo, id, ahoraMs);
  const l = db.prepare('SELECT expediente, titulo, organo_nombre FROM licitaciones WHERE id = ?').get(id) as
    { expediente: string; titulo: string; organo_nombre: string } | undefined;
  if (c.error || !l) return null;
  const cab: Comprobaciones = c.data;
  const b = primerBloqueoAbierto(cab.bloqueos);
  return {
    id,
    expediente: l.expediente,
    titulo: recortar(sanearTexto(l.titulo, nombres)),
    organo: l.organo_nombre,
    limite_decidir: cab.limite_decidir,
    limite_decidir_texto: textoLimite(cab.limite_decidir, zonaEmpresa(dbNucleo)),
    veredicto: { tipo: cab.veredicto.tipo, texto: sanearTexto(cab.veredicto.texto, nombres) },
    primer_bloqueo: b ? { clave: b.clave, categoria: b.categoria, titulo: sanearTexto(b.titulo, nombres) } : null,
    tareas_tuyas: cab.bloqueos.filter(tareaTuya).length,
    cola: colaDe(db, dbNucleo, id, ahoraMs),
    compromisos_caros: compromisosCarosDe(cab),
  };
}

/** La Mesa para un agente: las ofertas en preparación por fecha límite para decidir, paginadas. */
export function mesaParaAgente(
  db: Db,
  dbNucleo: DbNucleo,
  q: ConsultaMesa,
  ahoraMs: number = Date.now(),
): Result<RespuestaMesa> {
  const m = mesaDe(db, dbNucleo, ahoraMs);
  if (m.error) return m;
  const filas = [
    ...m.data.decide_hoy.filter((x) => x.tipo === 'frenada'),
    ...m.data.tu_mesa,
    ...m.data.listas_para_firmar,
  ].sort(
    (a, b) =>
      instante(a.limite_decidir) - instante(b.limite_decidir) ||
      instante(a.vence_en) - instante(b.vence_en) ||
      a.id.localeCompare(b.id),
  );
  const nombres = listarPersonas(dbNucleo, { inactivos: true })
    .map((p) => p.nombre)
    .filter((n) => n.trim());
  const pagina = filas.slice(q.desde, q.desde + q.limite);
  const ofertas = pagina.flatMap((f) => ofertaDe(db, dbNucleo, f.id, nombres, ahoraMs) ?? []);
  const siguiente = q.desde + q.limite < filas.length ? q.desde + q.limite : null;
  return ok({ total: filas.length, desde: q.desde, siguiente, recortado: false, ofertas });
}

export function herramientasMesa(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_mesa',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaMesa,
    descripcion:
      'La Mesa: ofertas por fecha límite para decidir, con su veredicto, su primer bloqueo, cuántas tareas tiene la persona, la cola y los compromisos caros de la memoria por suavizar (cuántos, horas y hasta cuándo da tiempo a otra ronda). Sin importes ni datos personales: sirve para el resumen diario por canal.',
    recurso: () => 'mesa',
    ejecutar: async (q) => mesaParaAgente(dbLicitaciones(), nucleo().db, q),
  });
}
