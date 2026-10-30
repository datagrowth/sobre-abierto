// Huecos de la Biblioteca: lo que piden los pliegos de los últimos 6 meses y la Biblioteca no respalda.
import { z } from 'zod';
import { catalogoDe } from '../../biblioteca/motor/catalogo.js';
import { estadoIndexador } from '../../biblioteca/motor/documentos/servicioIndice.js';
import { buscarEnBiblioteca, type ResultadoBiblioteca } from '../../biblioteca/motor/documentos/busquedaHibrida.js';
import { leerNota } from '../../biblioteca/motor/notas.js';
import { palabrasSignificativas } from './propuestas/aprendizaje.js';
import type { Db } from './store.js';

// Se miran los criterios de juicio de valor y los requisitos de experiencia, solvencia técnica, certificaciones y
// medios de las fichas aprobadas. Un tema es un hueco si la búsqueda por significado no da nada (o solo
// documentos, o solo una nota sin revisar en 12 meses). Sin el modelo de búsqueda listo no se calcula: daría
// huecos que no lo son.
const MESES = 6;
const MAX_TEMAS = 25;
const TIPOS_QUE_SE_RESPALDAN = new Set(['experiencia', 'solvencia_tecnica', 'certificacion', 'medios_materiales']);
const CACHE_MS = 60 * 60_000;

const FichaTemas = z.object({
  requisitos: z.array(z.object({ tipo: z.string(), descripcion: z.string() })).catch([]),
  criterios: z.array(z.object({ tipo: z.string(), descripcion: z.string() })).catch([]),
});

type Tema = { tema: string; de: 'criterio' | 'requisito'; licitaciones: Set<string> };
type Tenemos = 'nada' | 'solo_documentos' | 'nota_antigua';
type Hueco = {
  tema: string;
  de: 'criterio' | 'requisito';
  pliegos: number;
  licitaciones: string[];
  tenemos: Tenemos;
  nota: { ruta: string; titulo: string; revisada_en: string } | null;
};
export type Huecos = { estado: 'ok' | 'sin_busqueda'; calculado_en: string; temas: number; huecos: Hueco[] };

// Dos textos son el mismo tema si comparten sus palabras significativas (en cualquier orden).
const claveDe = (t: string) => [...palabrasSignificativas(t)].sort().slice(0, 6).join(' ');

/** Los temas pedidos en las fichas aprobadas de los últimos meses, los más repetidos primero. */
export function temasPedidos(db: Db, ahoraMs = Date.now()): Tema[] {
  const desde = new Date(ahoraMs - MESES * 30 * 86_400_000).toISOString();
  const fichas = db
    .prepare("SELECT licitacion_id, datos FROM fichas WHERE estado = 'aprobada' AND creada_en >= ?")
    .all(desde) as { licitacion_id: string; datos: string }[];
  const temas = new Map<string, Tema>();
  const anotar = (texto: string, de: Tema['de'], id: string) => {
    const clave = claveDe(texto);
    if (clave.split(' ').length < 2) return;
    const t = temas.get(clave) ?? {
      tema: texto.length > 140 ? `${texto.slice(0, 139)}…` : texto,
      de,
      licitaciones: new Set<string>(),
    };
    temas.set(clave, { ...t, licitaciones: t.licitaciones.add(id) });
  };
  for (const f of fichas) {
    const d = FichaTemas.parse(JSON.parse(f.datos));
    for (const c of d.criterios) if (c.tipo === 'juicio_valor') anotar(c.descripcion, 'criterio', f.licitacion_id);
    for (const r of d.requisitos)
      if (TIPOS_QUE_SE_RESPALDAN.has(r.tipo)) anotar(r.descripcion, 'requisito', f.licitacion_id);
  }
  return [...temas.values()].sort((a, b) => b.licitaciones.size - a.licitaciones.size).slice(0, MAX_TEMAS);
}

async function notaDe(hit: ResultadoBiblioteca): Promise<Hueco['nota'] & { revisar: boolean }> {
  const n = await leerNota(hit.path);
  const c = catalogoDe(n.frontmatter, n.path, n.mtime);
  return { ruta: n.path, titulo: n.title, revisada_en: c.revisada_en, revisar: c.revisar };
}

// null: lo respalda una nota al día.
async function queTenemos(t: Tema, buscar: typeof buscarEnBiblioteca): Promise<Pick<Hueco, 'tenemos' | 'nota'> | null> {
  const hits = (await buscar(t.tema, 5)).filter((h) => h.matched_in.includes('semantic'));
  if (!hits.length) return { tenemos: 'nada', nota: null };
  const notas = hits.filter((h) => h.kind === 'note');
  if (!notas.length) return { tenemos: 'solo_documentos', nota: null };
  const leidas = await Promise.all(notas.map(notaDe));
  if (leidas.some((n) => !n.revisar)) return null;
  const { revisar: _r, ...nota } = leidas[0]!;
  return { tenemos: 'nota_antigua', nota };
}

const modeloListo = (): boolean => {
  const s = estadoIndexador().status;
  return Boolean(s && !s.modelError && s.embedded > 0);
};

let cache: { clave: string; en: number; valor: Huecos } | null = null;

/** Los huecos, como mucho uno por hora (cada tema es una búsqueda por significado). */
export async function huecosBiblioteca(
  db: Db,
  op: { ahoraMs?: number; buscar?: typeof buscarEnBiblioteca; listo?: () => boolean } = {},
): Promise<Huecos> {
  const ahoraMs = op.ahoraMs ?? Date.now();
  const temas = temasPedidos(db, ahoraMs);
  const calculado_en = new Date(ahoraMs).toISOString();
  if (!(op.listo ?? modeloListo)()) return { estado: 'sin_busqueda', calculado_en, temas: temas.length, huecos: [] };
  const clave = temas.map((t) => `${t.tema}:${t.licitaciones.size}`).join('|');
  if (!op.buscar && cache && cache.clave === clave && ahoraMs - cache.en < CACHE_MS) return cache.valor;
  const huecos: Hueco[] = [];
  for (const t of temas) {
    const tenemos = await queTenemos(t, op.buscar ?? buscarEnBiblioteca);
    if (tenemos)
      huecos.push({
        tema: t.tema,
        de: t.de,
        pliegos: t.licitaciones.size,
        licitaciones: [...t.licitaciones],
        ...tenemos,
      });
  }
  const valor: Huecos = { estado: 'ok', calculado_en, temas: temas.length, huecos };
  if (!op.buscar) cache = { clave, en: ahoraMs, valor };
  return valor;
}
