// Sembrador de los fixtures de las comprobaciones (fixtures/comprobaciones/<oferta>.json: textos, equipo y
// memorias sintéticos): deja una base temporal con la oferta
// tal como estaría poco antes del cierre para que comprobacionesDe() la lea por el camino de siempre. Solo para
// tests: escribe con SQL directo lo que en producción traen los runs de Hermes (ficha, guion, memorias).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearPersona } from '../../src/nucleo/colaboradores/personas.js';
import type { Db as DbNucleo } from '../../src/nucleo/db.js';
import { guardarPerfilEmpresa } from '../../src/nucleo/empresa.js';
import { VERSION_PROMPT_FICHA } from '../../src/dominios/licitaciones/ficha.js';
import { guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import { VERSION_PROMPT_GUION } from '../../src/dominios/licitaciones/oferta/guion.js';
import { licitacion } from './sinteticas.js';

type Datos = Record<string, unknown>;
type ApartadoFixture = {
  apartado: number;
  estado: string;
  caracteres: number | null;
  paginas_estimadas: number | null;
  avisos: string[];
  compromisos: unknown[];
  titulo: string;
  texto: string | null;
};
type MemoriaFixture = {
  id: number;
  version: number;
  guion_id: number;
  estado: string;
  pedida_en: string;
  ensamblada_en: string | null;
  // La fase del método con fases; sin ella, la memoria se trata como subida a mano.
  fase?: string;
  revision: string;
  borrador_id: number | null;
  paginas: number | null;
  paginas_estimadas: number | null;
  apartados: ApartadoFixture[];
  coherencia: unknown[];
};
type PersonaFixture = { persona_id: number } & Datos;

export type FixtureComprobaciones = {
  id: string;
  ahora: string;
  licitacion: Datos & { titulo: string; fecha_limite: string | null };
  oportunidad: { estado: string; lotes_interes: string[]; motivo_descarte: string | null };
  ficha: { id: number; datos: Datos; creada_en: string } | null;
  guiones: { id: number; version: number; ficha_id: number | null; datos: Datos; creado_en: string }[];
  decisiones: { guion_id: number; actualizada_en: string; datos: Datos } | null;
  propuesta: { guion_id: number; creada_en: string; agente: string; avisos: string[]; datos: Datos } | null;
  memorias: MemoriaFixture[];
  documentos: {
    clave: string;
    nombre: string;
    estado: string;
    ruta: string | null;
    ruta_pdf: string | null;
    nota: string | null;
    actualizado_en: string;
  }[];
  pliegos: { nombre: string; clase: string; estado: string }[];
  perfil: Datos | null;
  personas: PersonaFixture[];
};

export type Esperado = { veredicto: string; impide: string[]; tu: string[]; primer_bloqueo: string };

export const OFERTAS_COMPROBACIONES = ['casoE', 'casoB', 'casoF', 'casoD', 'casoC'] as const;
export type OfertaComprobaciones = (typeof OFERTAS_COMPROBACIONES)[number];

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'licitaciones', 'fixtures', 'comprobaciones');
const leerJson = <T>(nombre: string): T => JSON.parse(fs.readFileSync(path.join(DIR, nombre), 'utf8')) as T;

export const leerFixtureComprobaciones = (oferta: OfertaComprobaciones): FixtureComprobaciones =>
  leerJson<FixtureComprobaciones>(`${oferta}.json`);
export const leerEsperadoComprobaciones = (oferta: OfertaComprobaciones): Esperado =>
  leerJson<Esperado>(`${oferta}.esperado.json`);

// Los pliegos llegaron antes que la ficha: si no, la regla de la ficha anterior a un pliego saltaría sin motivo.
function antesDe(iso: string): string {
  return new Date(Date.parse(iso) - 3_600_000).toISOString();
}

function sembrarLicitacion(db: Db, f: FixtureComprobaciones): void {
  const base = licitacion({ titulo: f.licitacion.titulo, publicada: '2026-09-24' });
  guardarLicitacion(db, { ...base, ...f.licitacion, id: f.id, atom_id: `atom-${f.id}` } as typeof base);
  const interes = JSON.stringify(f.oportunidad.lotes_interes.map((id) => ({ id, motivo: 'criba' })));
  db.prepare(
    'INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, motivo_descarte, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(f.id, f.oportunidad.estado, 'CPV 80', interes, f.oportunidad.motivo_descarte, f.ahora, f.ahora);
}

function sembrarPliegos(db: Db, f: FixtureComprobaciones): void {
  const en = antesDe(f.ficha?.creada_en ?? f.ahora);
  const insertar = db.prepare(
    'INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  // El mismo nombre llega a publicarse dos veces (pcap y ppt): la URL lleva el orden.
  f.pliegos.forEach((p, i) => {
    insertar.run(
      f.id,
      `https://contrataciondelestado.es/${i}/${encodeURIComponent(p.nombre)}`,
      p.clase,
      p.nombre,
      p.estado,
      `Licitaciones/Radar/2026/${f.id}/${i}-${p.nombre}`,
      en,
    );
  });
}

// La ficha y el guion van con la versión del análisis de ahora: al desplegar, la regeneración
// (fichaRegeneracion.ts) rehace las fichas vivas una vez, y lo que se mide aquí son las reglas
// sobre su contenido, no el aviso de «ficha con una regla anterior», que saldría en las cinco.
function sembrarFichaYGuiones(db: Db, f: FixtureComprobaciones): void {
  if (f.ficha) {
    db.prepare(
      "INSERT INTO fichas (id, licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en, version_prompt) VALUES (?, ?, 'aprobada', ?, 'licitaciones', ?, ?, ?, ?)",
    ).run(
      f.ficha.id,
      f.id,
      JSON.stringify(f.ficha.datos),
      f.ficha.creada_en,
      f.ficha.creada_en,
      f.ficha.creada_en,
      VERSION_PROMPT_FICHA,
    );
  }
  const insertar = db.prepare(
    "INSERT INTO guiones (id, licitacion_id, version, ficha_id, datos, agente, version_prompt, creado_en) VALUES (?, ?, ?, ?, ?, 'licitaciones', ?, ?)",
  );
  for (const g of f.guiones)
    insertar.run(g.id, f.id, g.version, g.ficha_id, JSON.stringify(g.datos), VERSION_PROMPT_GUION, g.creado_en);
}

// Los persona_id del fixture son seudónimos (1001…): apuntan a las personas sembradas en esta base.
function conPersonas(datos: Datos, ids: Map<number, number>): Datos {
  return JSON.parse(JSON.stringify(datos), (clave, valor: unknown) =>
    clave === 'persona_id' && typeof valor === 'number' ? (ids.get(valor) ?? valor) : valor,
  ) as Datos;
}

function sembrarDecisiones(db: Db, f: FixtureComprobaciones, ids: Map<number, number>): void {
  const d = f.decisiones;
  if (d) {
    db.prepare(
      'INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)',
    ).run(f.id, d.guion_id, JSON.stringify(conPersonas(d.datos, ids)), d.actualizada_en);
  }
  const p = f.propuesta;
  if (!p) return;
  db.prepare(
    'INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, avisos, agente, creada_en) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(f.id, p.guion_id, JSON.stringify(conPersonas(p.datos, ids)), JSON.stringify(p.avisos), p.agente, p.creada_en);
}

// El texto capturado vuelve a la forma de los apartados de Hermes: párrafos de un bloque, sin los títulos.
function datosApartado(a: ApartadoFixture): string | null {
  if (a.estado !== 'recibido' || !a.texto) return null;
  const parrafos = a.texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 20 && !p.startsWith('#'));
  const bloques = [];
  for (let i = 0; i < parrafos.length; i += 30)
    bloques.push({ parrafos: parrafos.slice(i, i + 30).map((p) => p.slice(0, 3000)) });
  return JSON.stringify({
    titulo: a.titulo,
    bloques: bloques.length ? bloques : [{ parrafos: [] }],
    cubre: [],
    compromisos: a.compromisos,
  });
}

function sembrarBorrador(db: Db, f: FixtureComprobaciones, m: MemoriaFixture): number | null {
  if (m.borrador_id === null) return null;
  const estado = m.revision === 'aceptada' || m.revision === 'descartada' ? m.revision : 'pendiente';
  db.prepare(
    `INSERT INTO borradores (id, licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, guion_id, version, memoria_id, paginas, paginas_estimadas)
    VALUES (?, ?, ?, 'h', 10, 'plataforma', ?, ?, 'ensamblado', ?, ?, ?, ?, ?)`,
  ).run(
    m.borrador_id,
    f.id,
    `Salidas/Licitaciones/${f.id}/memoria-v${m.version}.docx`,
    m.ensamblada_en ?? m.pedida_en,
    estado,
    m.guion_id,
    m.version,
    m.id,
    m.paginas,
    m.paginas_estimadas,
  );
  return m.borrador_id;
}

function sembrarMemoria(db: Db, f: FixtureComprobaciones, m: MemoriaFixture): void {
  db.prepare(
    `INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, fase, coherencia, ensayo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    m.id,
    f.id,
    m.guion_id,
    m.version,
    m.estado,
    m.pedida_en,
    m.ensamblada_en,
    m.fase ?? null,
    JSON.stringify(m.coherencia),
  );
  db.prepare('UPDATE memorias SET borrador_id = ? WHERE id = ?').run(sembrarBorrador(db, f, m), m.id);
  const insertar = db.prepare(
    'INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, paginas_estimadas, avisos) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const a of m.apartados)
    insertar.run(
      m.id,
      a.apartado,
      a.estado,
      datosApartado(a),
      a.caracteres,
      a.paginas_estimadas,
      JSON.stringify(a.avisos),
    );
}

function sembrarDocumentos(db: Db, f: FixtureComprobaciones): void {
  const insertar = db.prepare(
    'INSERT INTO oferta_documentos (licitacion_id, clave, nombre, estado, ruta, ruta_pdf, nota, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const d of f.documentos)
    insertar.run(f.id, d.clave, d.nombre, d.estado, d.ruta, d.ruta_pdf, d.nota, d.actualizado_en);
}

// Perfil y personas viven en el núcleo y se guardan por su validación de siempre.
function sembrarNucleo(dbNucleo: DbNucleo, f: FixtureComprobaciones): Map<number, number> {
  if (f.perfil) {
    const r = guardarPerfilEmpresa(dbNucleo, f.perfil);
    if (r.error) throw new Error(`perfil de ${f.id}: ${r.error.message}`);
  }
  const ids = new Map<number, number>();
  for (const { persona_id, ...datos } of f.personas) {
    const r = crearPersona(dbNucleo, datos);
    if (r.error) throw new Error(`persona ${persona_id} de ${f.id}: ${r.error.message}`);
    ids.set(persona_id, r.data.id);
  }
  return ids;
}

/**
 * Siembra una oferta del fixture. El perfil de empresa y las personas son del núcleo, uno para
 * todas: con varias ofertas en la misma base, calcula las comprobaciones de cada una antes de sembrar la siguiente.
 */
export function sembrarFixture(db: Db, dbNucleo: DbNucleo, f: FixtureComprobaciones): void {
  const ids = sembrarNucleo(dbNucleo, f);
  db.transaction(() => {
    sembrarLicitacion(db, f);
    sembrarPliegos(db, f);
    sembrarFichaYGuiones(db, f);
    sembrarDecisiones(db, f, ids);
    for (const m of f.memorias) sembrarMemoria(db, f, m);
    sembrarDocumentos(db, f);
  })();
}
