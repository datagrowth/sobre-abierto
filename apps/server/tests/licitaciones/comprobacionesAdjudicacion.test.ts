// Documentos «Si nos proponen»: salen del guion, no son del checklist de la presentación
// y solo aparecen como tareas de las comprobaciones cuando la oferta ya está presentada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import { componerComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobaciones.js';
import { documentosDelGuion } from '../../src/dominios/licitaciones/oferta/documentos.js';
import { GuionBase, instruccionesGuion, type GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';
import { duracionesFases } from '../../src/dominios/licitaciones/oferta/horaCierre.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');
type Fixture = {
  id: string;
  ahora: string;
  licitacion: { fecha_limite: string | null };
  oportunidad: EntradasComprobaciones['oportunidad'] & { lotes_interes: string[] | null };
  guiones: { id: number; version: number; ficha_id: number | null; datos: GuionBaseData; creado_en: string }[];
  documentos: EntradasComprobaciones['documentos']['filas'];
  pliegos: EntradasComprobaciones['pliegos'];
};
const casoC = (): Fixture => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'casoC.json'), 'utf8')) as Fixture;

const ADJUDICACION = [
  {
    nombre: 'Anexo VIII. Compromiso de confidencialidad',
    modelo: 'Anexo VIII',
    documento: 'PCAP.pdf',
    pagina: 31,
    cuando: 'antes de la formalización',
  },
  {
    nombre: 'Anexo IX. Protección de datos',
    modelo: null,
    documento: 'PCAP.pdf',
    pagina: 32,
    cuando: 'en 10 días hábiles desde el requerimiento',
  },
];

function entradas(estado: string, adjudicacion: unknown): EntradasComprobaciones {
  const f = casoC();
  const g = f.guiones.at(-1)!;
  const datos = { ...g.datos, documentos_adjudicacion: adjudicacion } as GuionBaseData;
  const guion = {
    ...g,
    datos,
    licitacion_id: f.id,
    avisos: [],
    agente: 'oferta',
    version_prompt: 1,
    trabajo_id: null,
    cambios: null,
  };
  const ambito = f.oportunidad?.lotes_interes ?? [];
  return {
    id: f.id,
    ahoraMs: Date.parse(f.ahora),
    licitacion: {
      fecha_limite: f.licitacion.fecha_limite,
      fecha_solicitud: null,
      borrada_en: null,
      borrada_motivo: null,
    },
    oportunidad: { ...f.oportunidad, estado, lotes_interes: JSON.stringify(ambito) },
    lotes: { lotes: [], presentacion: null, ambito: null } as unknown as EntradasComprobaciones['lotes'],
    ambito,
    ficha: null,
    guion,
    decisiones: null,
    decisiones_version: 1,
    propuesta: null,
    memoria: null,
    hallazgos: [],
    fugas: null,
    textos_memoria: [],
    documentos: { filas: f.documentos, del_guion: documentosDelGuion(datos, ambito) },
    perfil: null,
    personas: [],
    pliegos: f.pliegos,
    trabajos: [],
    paquete: null,
    coherencia: [],
    guardados: new Map(),
    duraciones: duracionesFases(),
    decisiones_incompletas: [],
  } as EntradasComprobaciones;
}

const filasAdj = (e: EntradasComprobaciones) =>
  componerComprobaciones(e, 2).bloqueos.filter((b) => b.clave.startsWith('adjudicacion:'));

test('should_accept_an_outline_without_award_documents', () => {
  const { documentos_adjudicacion: _quitado, ...sin } = casoC().guiones.at(-1)!.datos;
  const r = GuionBase.safeParse(sin);
  assert.equal(r.success, true);
  assert.deepEqual(r.data?.documentos_adjudicacion, []);
});

test('should_keep_award_documents_out_of_the_submission_checklist', () => {
  const con = entradas('en_preparacion', ADJUDICACION).documentos.del_guion.map((d) => d.doc.nombre);
  const sin = entradas('en_preparacion', []).documentos.del_guion.map((d) => d.doc.nombre);
  assert.deepEqual(con, sin);
  assert.equal(con.includes(ADJUDICACION[0]!.nombre), false);
});

test('should_show_award_documents_in_the_comprobaciones_only_when_submitted', () => {
  const antes = filasAdj(entradas('en_preparacion', ADJUDICACION));
  const despues = filasAdj(entradas('presentada', ADJUDICACION));
  assert.equal(antes.length, 0);
  assert.equal(despues.length, 2);
  assert.deepEqual(
    despues.map((b) => [b.categoria, b.actor, b.gravedad]),
    [
      ['documentos', 'tu', 'riesgo'],
      ['documentos', 'tu', 'riesgo'],
    ],
  );
  assert.equal(despues[0]!.clave, 'adjudicacion:-:anexo_viii_compromiso_de_confidencialidad');
  assert.equal(despues[1]!.cita?.pagina, 32);
});

test('should_mention_award_documents_in_outline_instructions', () => {
  assert.match(instruccionesGuion('p-1', 'Analítica Ejemplo'), /documentos_adjudicacion/);
});
