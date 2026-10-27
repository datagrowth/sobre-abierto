// La Biblioteca en la web: documentos sin nota, «Pedir nota» a Hermes, borradores de notas y uso de cada nota.
import { z } from 'zod';
import { usadaDesde } from './agentes/auditoria.js';
import { CARPETA_COLABORADORES, rutaAuditable } from './colaboradores/cvs.js';
import type { Db } from './db.js';
import { carpetasConFicha } from './documentos.js';
import { fail, ok, type Result } from './result.js';
import { encolarUnico } from './trabajos.js';
import { TIPOS_NOTA } from '../biblioteca/motor/catalogo.js';
import {
  listarDocumentos,
  relativaBibliotecaOCruda,
  type EntradaDocumento,
} from '../biblioteca/motor/documentos/lector.js';

// «Pedir nota» es uno a uno o en bloque; un PDF escaneado no se puede leer y no se pide. Se cuenta además en
// cuántas ofertas se ha usado cada nota. Drive sigue siendo la fuente de verdad: Hermes solo propone y una
// persona aprueba.
export const TIPO_NOTA = 'biblioteca.nota';
// Los borradores de un hueco no salen de un documento: van a esta carpeta y ahí se reconoce que llegaron.
const CARPETA_BORRADORES = 'Borradores';
const MAX_SIN_NOTA = 200;

export const PayloadNota = z.object({
  ruta: z.string().min(1).nullable(),
  tema: z.string().min(3).nullable(),
  pedida_en: z.string().min(10),
});
export type PayloadNotaData = z.infer<typeof PayloadNota>;

export const PedidoNota = z
  .strictObject({
    rutas: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
    tema: z.string().trim().min(3).max(300).optional(),
  })
  .refine((p) => (p.rutas?.length ?? 0) > 0 || p.tema !== undefined, {
    message: 'Di qué documentos («rutas») o qué hueco («tema»).',
  });

/** Los documentos sin nota ni propuesta, sin CV ni pliegos (los analiza su dominio con su ficha). */
export async function documentosSinNota(
  limite = MAX_SIN_NOTA,
): Promise<{ total: number; documentos: EntradaDocumento[] }> {
  return listarDocumentos(true, limite, [CARPETA_COLABORADORES, ...carpetasConFicha()]);
}

/**
 * Encola una nota por documento pedido. Solo los que están en la lista de sin nota (así no se
 * pide nada de fuera de la Biblioteca ni de Colaboradores) y que se pueden leer.
 */
export async function pedirNotas(
  db: Db,
  p: z.infer<typeof PedidoNota>,
): Promise<Result<{ pedidas: number; no_se_pueden_leer: string[] }>> {
  const pedida_en = new Date().toISOString();
  if (p.tema) {
    encolarUnico(db, {
      tipo: TIPO_NOTA,
      dominio: 'nucleo',
      base: `nota-hueco-${p.tema
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .slice(0, 60)}`,
      payload: { ruta: null, tema: p.tema, pedida_en },
      aMano: true,
    });
    return ok({ pedidas: 1, no_se_pueden_leer: [] });
  }
  const sinNota = new Map((await documentosSinNota()).documentos.map((d) => [d.ruta, d]));
  const pedidos = (p.rutas ?? []).map((r) => sinNota.get(relativaBibliotecaOCruda(r)) ?? null);
  if (pedidos.some((d) => d === null))
    return fail('invalid_input', 'Alguno de esos documentos ya tiene nota o no es de la Biblioteca: recarga la lista.');
  const legibles = pedidos.filter((d): d is EntradaDocumento => d !== null && d.estado === 'ok');
  for (const d of legibles)
    encolarUnico(db, {
      tipo: TIPO_NOTA,
      dominio: 'nucleo',
      base: `nota-${rutaAuditable(d.ruta) ?? d.ruta}`,
      payload: { ruta: d.ruta, tema: null, pedida_en },
      aMano: true,
    });
  return ok({
    pedidas: legibles.length,
    no_se_pueden_leer: pedidos.filter((d) => d && d.estado !== 'ok').map((d) => d!.ruta),
  });
}

/** «hecho»: llegó una propuesta con ese documento como fuente (o a Borradores, para un hueco). */
export function notaRecibida(db: Db, p: PayloadNotaData): boolean {
  return usadaDesde(
    db,
    'biblioteca_proponer',
    p.ruta ? (rutaAuditable(p.ruta) ?? p.ruta) : CARPETA_BORRADORES,
    p.pedida_en,
  );
}

const FRONTMATTER = `Empieza el contenido con un frontmatter con «tipo» (uno de: ${TIPOS_NOTA.join(', ')}), «sector» (una o dos palabras: formación, salud, turismo…) y «revisada_en» (la fecha de hoy, AAAA-MM-DD).`;

export function instruccionesNota(p: PayloadNotaData, empresa: string): string {
  if (p.ruta) {
    return [
      `Tarea de la plataforma de ${empresa}: resume en una nota de la Biblioteca el documento «${p.ruta}».`,
      `1. Léelo entero con biblioteca_leer (ruta «${p.ruta}»), por páginas hasta la última.`,
      '2. Mira con biblioteca_buscar si ya hay una nota parecida: si la hay, propón solo lo que añade.',
      `3. Propón la nota con biblioteca_proponer: titulo claro, fuente «${p.ruta}» y un contenido que sirva para redactar ofertas (qué es, para quién, qué se hizo, cifras y resultados, lo que se puede citar). ${FRONTMATTER}`,
      'Sin nombres ni datos de personas. No inventes: solo lo que diga el documento. No hagas nada más ni respondas en ningún canal.',
    ].join('\n');
  }
  return [
    `Tarea de la plataforma de ${empresa}: los pliegos de los últimos meses piden «${p.tema}» y la Biblioteca no tiene nada que lo respalde. Prepara un borrador de nota.`,
    '1. Busca con biblioteca_buscar lo que tengamos relacionado (ofertas presentadas, casos, metodologías) y léelo con biblioteca_leer.',
    `2. Propón con biblioteca_proponer un borrador en la carpeta «${CARPETA_BORRADORES}» (sin fuente), con lo que de verdad podemos acreditar y, marcado como «Por completar», lo que falta para respaldarlo. ${FRONTMATTER}`,
    'Sin nombres ni datos de personas. No inventes experiencia que no esté en los documentos. No hagas nada más ni respondas en ningún canal.',
  ].join('\n');
}

// ── Uso en ofertas ──

// La auditoría guarda qué nota leyó cada agente, no para qué oferta: se atribuye a la licitación
// sobre la que el mismo agente trabajaba en la hora de alrededor (su tool de licitaciones con un
// recurso «p-…»). Es una estimación: cuenta ofertas distintas, no lecturas.
const VENTANA_MIN = 60;

export function usosDeNotas(db: Db): Record<string, number> {
  const filas = db
    .prepare(
      `SELECT l.recurso AS nota, (SELECT substr(o.recurso, 1, instr(o.recurso || '#', '#') - 1) FROM auditoria_agentes o
      WHERE o.agente = l.agente AND o.herramienta LIKE 'licitaciones_%' AND o.recurso LIKE 'p-%'
        AND o.creado_en BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', l.creado_en, '-${VENTANA_MIN} minutes') AND strftime('%Y-%m-%dT%H:%M:%fZ', l.creado_en, '+${VENTANA_MIN} minutes')
      ORDER BY abs(julianday(o.creado_en) - julianday(l.creado_en)) LIMIT 1) AS licitacion
    FROM auditoria_agentes l WHERE l.herramienta = 'biblioteca_leer' AND l.resultado IN ('ok', 'recortada') AND l.recurso LIKE '%.md'`,
    )
    .all() as { nota: string; licitacion: string | null }[];
  const porNota = new Map<string, Set<string>>();
  for (const f of filas) {
    if (!f.licitacion) continue;
    porNota.set(f.nota, (porNota.get(f.nota) ?? new Set()).add(f.licitacion));
  }
  return Object.fromEntries([...porNota].map(([nota, ofertas]) => [nota, ofertas.size]));
}
