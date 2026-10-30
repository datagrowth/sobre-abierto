// Criba por IA de lo que deja pasar el prefiltro: un trabajo de Hermes por lote de candidatas.
import fs from 'node:fs';
import path from 'node:path';
import { idiomaDelTexto } from '../../nucleo/idioma.js';
import { z } from 'zod';
import { nombreDe, PROCEDIMIENTOS, TIPOS_CONTRATO } from './placsp/codigos.js';
import type { Db, FilaLicitacion } from './store.js';
import { cpvsDe } from './oportunidades.js';
import { dentroDeImporte, leerFiltros, normalizar, sigueAbierta, type FiltrosData } from './prefiltro.js';
import { encolarPliegos } from './pliegos.js';
import { eurosTexto, leerIds, lotesDeDatos, lotesDeFila, TODOS_LOS_LOTES, UN_LOTE } from './lotes.js';
import { emitir } from '../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { resumenAntecedentes } from './antecedentes/index.js';
import type { CacheOrganos } from './antecedentes/ediciones.js';
import { reglaFormacionesCriba } from './formaciones.js';

// Cada lote es un trabajo para el perfil «licitaciones» de Hermes, que lee el perfil de la empresa y devuelve un
// veredicto por candidata con licitaciones_cribar. Se valida todo antes de tocar nada.
export const TIPO_CRIBA = 'licitaciones.cribar';
const PERFIL_EMPRESA = 'Empresa/perfil-licitaciones.md';
export const AVISO_SIN_PERFIL = `La criba por IA espera: falta el perfil de licitaciones (Conocimiento/${PERFIL_EMPRESA}), con el que Hermes decide qué nos interesa. Escríbelo en la Biblioteca y las candidatas se cribarán solas`;

/**
 * ¿Está en la Biblioteca el perfil con el que se criba? Sin él Hermes no criba, el run acaba
 * sin resultado y el lote cuenta como fallido (Hermes contesta «falta el perfil de
 * licitaciones»), así que no se gasta un trabajo.
 */
export function hayPerfilCriba(conocimiento: string | null): boolean {
  if (!conocimiento) return false;
  try {
    return fs.statSync(path.join(conocimiento, PERFIL_EMPRESA)).size > 0;
  } catch {
    // No existe o no se puede leer: para la criba es lo mismo, no hay perfil.
    return false;
  }
}

const LoteVeredicto = z.object({
  id: z.string().trim().min(1).max(20).describe('Id del lote, como en «lotes[].id» de la candidata'),
  motivo: z.string().trim().min(3).max(300).describe('Por qué interesa este lote (encaje, importe, requisitos)'),
});

const Veredicto = z.object({
  id: z.string().trim().min(3).max(40),
  veredicto: z.enum(['interesa', 'descartar', 'revisar']),
  motivo: z.string().trim().min(3).max(300),
  confianza: z.number().min(0).max(1),
  lotes: z
    .array(LoteVeredicto)
    .max(50)
    .optional()
    .describe(
      'Lotes de interés (solo con interesa o revisar, en licitaciones con lotes a las que se puede ir por lotes sueltos)',
    ),
});
export const Criba = z.object({ lote: z.number().int().positive(), veredictos: z.array(Veredicto).min(1).max(100) });
export type CribaData = z.infer<typeof Criba>;

// «revisar» también es nueva: la ficha de Hermes resuelve las dudas; el veredicto se guarda.
const ESTADO_POR_VEREDICTO = { interesa: 'nueva', revisar: 'nueva', descartar: 'descartada' } as const;

/** Agrupa las candidatas sin lote (las de plazo más cercano primero). Devuelve los lotes creados. */
export function crearLotes(db: Db, tamano: number): number[] {
  const ids = (
    db
      .prepare(
        `SELECT o.licitacion_id AS id FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'candidata' AND o.lote_criba IS NULL ORDER BY COALESCE(l.fecha_limite, '9999'), l.id`,
      )
      .all() as { id: string }[]
  ).map((r) => r.id);
  const lotes: number[] = [];
  db.transaction(() => {
    for (let i = 0; i < ids.length; i += tamano) {
      const parte = ids.slice(i, i + tamano);
      const lote = Number(
        db
          .prepare("INSERT INTO lotes_criba (ids, estado, creado_en) VALUES (?, 'abierto', ?)")
          .run(JSON.stringify(parte), new Date().toISOString()).lastInsertRowid,
      );
      const marcar = db.prepare('UPDATE oportunidades SET lote_criba = ? WHERE licitacion_id = ?');
      parte.forEach((id) => marcar.run(lote, id));
      lotes.push(lote);
    }
  })();
  return lotes;
}

/**
 * ¿Toca crear lotes? Si hay uno lleno, o si pasó el intervalo y queda alguna candidata.
 * Si en el último intervalo falló un lote, sus candidatas esperan al intervalo: sin esto,
 * un fallo que se repite siempre crearía lotes nuevos en cada vuelta.
 */
export function tocaCribar(db: Db, tamano: number, cribasDia: number, ahoraMs = Date.now()): boolean {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM oportunidades WHERE estado = 'candidata' AND lote_criba IS NULL")
    .get() as { n: number };
  if (n === 0 || cribasDia === 0) return false;
  const intervalo = 86_400_000 / cribasDia;
  const { t: ultimo, fallo } = db
    .prepare(
      "SELECT MAX(creado_en) AS t, MAX(CASE WHEN estado = 'fallido' THEN creado_en END) AS fallo FROM lotes_criba",
    )
    .get() as { t: string | null; fallo: string | null };
  const falloReciente = fallo !== null && ahoraMs - Date.parse(fallo) < intervalo;
  if (n >= tamano && !falloReciente) return true;
  return !ultimo || ahoraMs - Date.parse(ultimo) >= intervalo;
}

/**
 * Un lote cuyo trabajo de Hermes acabó fallido o cancelado devuelve sus candidatas a la
 * cola para que entren en un lote nuevo; si no, no se cribarían nunca.
 */
export function liberarLotesFallidos(db: Db): number {
  const lotes = db
    .prepare(
      `SELECT l.id FROM lotes_criba l WHERE l.estado = 'abierto' AND EXISTS (SELECT 1 FROM nucleo.trabajos_ia t
    WHERE t.clave = 'cribar-lote-' || l.id AND t.estado IN ('fallido', 'cancelado'))`,
    )
    .all() as { id: number }[];
  db.transaction(() => {
    for (const { id } of lotes) {
      db.prepare("UPDATE oportunidades SET lote_criba = NULL WHERE lote_criba = ? AND estado = 'candidata'").run(id);
      db.prepare("UPDATE lotes_criba SET estado = 'fallido' WHERE id = ?").run(id);
    }
  })();
  return lotes.length;
}

/**
 * Las candidatas que cierran antes de la criba (plazo vencido, adjudicada, anulada,
 * retirada del feed o sin fecha límite) salen del embudo: ya no se puede presentar nada, así que ni esperan
 * en «Sin cribar» ni gastan IA. Si la licitación reabre (plazo ampliado), llega como
 * cambio y el prefiltro la vuelve a crear. Las que ya están en un lote esperan su veredicto.
 */
export function retirarCandidatasCerradas(db: Db, ahoraMs = Date.now()): number {
  const filas = db
    .prepare(
      `SELECT l.id, l.estado, l.fecha_limite, l.borrada_en FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'candidata' AND o.lote_criba IS NULL`,
    )
    .all() as Pick<FilaLicitacion, 'id' | 'estado' | 'fecha_limite' | 'borrada_en'>[];
  const cerradas = filas.filter((l) => !sigueAbierta(l, ahoraMs)).map((l) => l.id);
  const borrar = db.prepare(
    "DELETE FROM oportunidades WHERE licitacion_id = ? AND estado = 'candidata' AND lote_criba IS NULL",
  );
  db.transaction(() => {
    cerradas.forEach((id) => borrar.run(id));
  })();
  return cerradas.length;
}

function idsDelLote(db: Db, lote: number): { ids: string[]; estado: string } | null {
  const row = db.prepare('SELECT ids, estado FROM lotes_criba WHERE id = ?').get(lote) as
    { ids: string; estado: string } | undefined;
  return row ? { ids: JSON.parse(row.ids) as string[], estado: row.estado } : null;
}

type FilaCandidata = FilaLicitacion & { motivo_prefiltro: string | null; lotes_prefiltro: string | null };

// Hay contratos con más de 60 lotes: van primero los que encajaron en el prefiltro.
const LOTES_COMPACTOS = 30;

// Regla de presentación, máximos y lotes (id, nombre, importe, CPV) para elegir los de interés.
function lotesCompactos(l: FilaCandidata): Record<string, unknown> {
  const { lotes, presentacion: p } = lotesDeFila(l);
  if (!p) return { presentacion: null, lotes: [] };
  const encajan = new Set(leerIds(l.lotes_prefiltro));
  const ordenados = [...lotes.filter((x) => encajan.has(x.id)), ...lotes.filter((x) => !encajan.has(x.id))];
  return {
    presentacion: {
      regla: p.regla,
      codigo: p.codigo,
      se_eligen_lotes: p.codigo !== TODOS_LOS_LOTES,
      maximo_lotes: p.codigo === UN_LOTE ? 1 : p.maximo_lotes,
      maximo_adjudicables: p.maximo_adjudicables,
      combinacion: p.combinacion?.slice(0, 300) ?? null,
    },
    lotes: ordenados.slice(0, LOTES_COMPACTOS).map((x) => ({
      id: x.id,
      nombre: x.nombre?.slice(0, 150) ?? null,
      importe_sin_iva: x.presupuesto_sin_iva,
      cpvs: x.cpvs,
      encaja_prefiltro: encajan.has(x.id),
    })),
    lotes_total: lotes.length,
  };
}

function compacta(l: FilaCandidata): Record<string, unknown> {
  const datos = JSON.parse(l.datos) as {
    criterios?: { descripcion: string; peso: number | null }[];
    requisitos?: { clase: string; descripcion: string; lote?: string | null }[];
  };
  return {
    id: l.id,
    titulo: l.titulo,
    organo: l.organo_nombre,
    importe_sin_iva: l.presupuesto_sin_iva,
    valor_estimado: l.valor_estimado,
    tipo: nombreDe(TIPOS_CONTRATO, l.tipo_contrato),
    procedimiento: nombreDe(PROCEDIMIENTOS, l.procedimiento),
    cpvs: cpvsDe(l.cpvs),
    lugar: l.lugar,
    plazo: l.fecha_limite,
    motivo_prefiltro: l.motivo_prefiltro,
    idioma_titulo: idiomaDelTexto(l.titulo),
    criterios: (datos.criterios ?? [])
      .slice(0, 10)
      .map((c) => `${c.descripcion.slice(0, 120)}${c.peso !== null ? ` (${c.peso})` : ''}`),
    requisitos: (datos.requisitos ?? [])
      .filter((r) => r.clase !== 'declaracion')
      .slice(0, 6)
      .map((r) => `${r.lote ? `[lote ${r.lote}] ` : ''}${r.descripcion.slice(0, 200)}`),
    ...lotesCompactos(l),
  };
}

// Indicios de «licitación con nombre», en corto: Hermes los tiene en cuenta al cribar.
function antecedentesCompactos(db: Db, id: string, cache: CacheOrganos): Record<string, unknown> | null {
  const r = resumenAntecedentes(db, id, cache).data;
  return (
    r && {
      nivel: r.nivel,
      ambito: r.ambito,
      ediciones_anteriores: r.ediciones,
      adjudicatario_anterior: r.incumbente,
      indicios: r.indicios.slice(0, 3).map((i) => i.slice(0, 200)),
    }
  );
}

/** «hasta 500.000 €», «de 20.000 € a 500.000 €», o null sin rango. */
function rangoImporte(f: FiltrosData): string | null {
  if (f.importe_min === null && f.importe_max === null) return null;
  if (f.importe_min === null) return `hasta ${eurosTexto(f.importe_max)}`;
  return f.importe_max === null
    ? `desde ${eurosTexto(f.importe_min)}`
    : `de ${eurosTexto(f.importe_min)} a ${eurosTexto(f.importe_max)}`;
}

export function candidatasDelLote(
  db: Db,
  lote: number,
): Result<{
  lote: number;
  perfil_empresa: string;
  rango_importe_lotes: string | null;
  candidatas: Record<string, unknown>[];
}> {
  const l = idsDelLote(db, lote);
  if (!l) return fail('not_found', `No existe el lote ${lote}.`);
  const filas = l.ids
    .map(
      (id) =>
        db
          .prepare(
            `SELECT l.*, o.motivo_prefiltro, o.lotes_prefiltro FROM licitaciones l JOIN oportunidades o ON o.licitacion_id = l.id
    WHERE l.id = ?`,
          )
          .get(id) as FilaCandidata | undefined,
    )
    .filter((f) => f !== undefined);
  const cache: CacheOrganos = new Map();
  return ok({
    lote,
    perfil_empresa: PERFIL_EMPRESA,
    rango_importe_lotes: rangoImporte(leerFiltros(db)),
    candidatas: filas.map((f) => ({ ...compacta(f), antecedentes: antecedentesCompactos(db, f.id, cache) })),
  });
}

function revisarCobertura(ids: string[], veredictos: CribaData['veredictos']): string | null {
  const vistos = veredictos.map((v) => v.id);
  const repetidos = [...new Set(vistos.filter((id, i) => vistos.indexOf(id) !== i))];
  const sobran = vistos.filter((id) => !ids.includes(id));
  const faltan = ids.filter((id) => !vistos.includes(id));
  const partes = [
    repetidos.length ? `repetidos: ${repetidos.join(', ')}` : '',
    sobran.length ? `no son de este lote: ${sobran.join(', ')}` : '',
    faltan.length ? `faltan: ${faltan.join(', ')}` : '',
  ].filter(Boolean);
  return partes.length ? `Hace falta exactamente un veredicto por candidata del lote (${partes.join('; ')}).` : null;
}

type ReglaCandidata = {
  ids: string[];
  importes: Map<string, number | null>;
  codigo: string | null;
  maximo: number | null;
};

function reglaCandidata(db: Db, id: string): ReglaCandidata {
  const f = db.prepare('SELECT datos, presentacion_lotes, max_lotes_oferta FROM licitaciones WHERE id = ?').get(id) as
    Pick<FilaLicitacion, 'datos' | 'presentacion_lotes' | 'max_lotes_oferta'> | undefined;
  if (!f) return { ids: [], importes: new Map(), codigo: null, maximo: null };
  const lotes = lotesDeDatos(f.datos);
  return {
    ids: lotes.map((l) => l.id),
    importes: new Map(lotes.map((l) => [l.id, l.presupuesto_sin_iva])),
    codigo: f.presentacion_lotes,
    maximo: f.presentacion_lotes === UN_LOTE ? 1 : f.max_lotes_oferta,
  };
}

// El rango de importe de los filtros vale también para los lotes que elige Hermes: el
// prefiltro lo aplica lote a lote, pero la criba eligió el lote de 3,4 M€ del SDA del Banco de
// España (pasaron por el prefiltro los de 160.000 y 200.000 €).
function lotesFueraDeImporte(pedidos: string[], r: ReglaCandidata, f: FiltrosData): string | null {
  const fuera = pedidos.filter((id) => !dentroDeImporte(f, r.importes.get(id) ?? null));
  if (!fuera.length) return null;
  const lista = fuera.map((id) => `${id} (${eurosTexto(r.importes.get(id) ?? null)})`).join(', ');
  return `los lotes ${lista} quedan fuera del rango de importe de los filtros (${rangoImporte(f)}): quítalos y, si no queda ninguno, juzga la licitación sin lotes de interés`;
}

// Los lotes de interés se validan contra los lotes reales, la regla de presentación publicada
// y el rango de importe de los filtros.
function problemaDeLotes(v: CribaData['veredictos'][number], r: ReglaCandidata, f: FiltrosData): string | null {
  const pedidos = (v.lotes ?? []).map((l) => l.id);
  if (!pedidos.length) return null;
  if (v.veredicto === 'descartar') return `${v.id}: un descarte no lleva lotes`;
  if (!r.ids.length) return `${v.id}: no tiene lotes (quita «lotes»)`;
  if (r.codigo === TODOS_LOS_LOTES)
    return `${v.id}: hay que presentarse a todos los lotes, no se eligen lotes sueltos (quita «lotes»)`;
  const repetidos = [...new Set(pedidos.filter((id, i) => pedidos.indexOf(id) !== i))];
  const ajenos = pedidos.filter((id) => !r.ids.includes(id));
  if (repetidos.length) return `${v.id}: lotes repetidos: ${repetidos.join(', ')}`;
  if (ajenos.length) return `${v.id}: no tiene los lotes ${ajenos.join(', ')} (tiene ${r.ids.slice(0, 60).join(', ')})`;
  if (r.maximo !== null && pedidos.length > r.maximo)
    return `${v.id}: solo se puede presentar a ${r.maximo === 1 ? 'un lote' : `${r.maximo} lotes`}: elige los de más interés`;
  const fuera = lotesFueraDeImporte(pedidos, r, f);
  return fuera ? `${v.id}: ${fuera}` : null;
}

function revisarLotes(db: Db, veredictos: CribaData['veredictos']): string | null {
  const f = leerFiltros(db);
  const problemas = veredictos
    .filter((v) => v.lotes?.length)
    .map((v) => problemaDeLotes(v, reglaCandidata(db, v.id), f))
    .filter((p): p is string => p !== null);
  return problemas.length ? `Lotes de interés no válidos (${problemas.join('; ')}).` : null;
}

// Una criba hecha sin leer el perfil decide a ciegas (una vez dejó 37 en «revisar»
// sin mirarlas): se rechaza para que el run acabe sin resultado y se reintente. Solo cuenta
// la frase de Hermes sobre el perfil de la empresa o su archivo: «nos falta perfil de ingeniero» es
// un motivo normal.
const SIN_PERFIL = /falta el perfil de licitaciones|perfil-licitaciones/;

function sinPerfil(veredictos: CribaData['veredictos']): string | null {
  return veredictos.some((v) => SIN_PERFIL.test(normalizar(v.motivo)))
    ? 'No se criba sin el perfil de licitaciones: si no puedes leer Empresa/perfil-licitaciones.md, termina sin enviar veredictos.'
    : null;
}

/** Aplica los veredictos de un lote. No pisa lo que una persona ya haya cambiado a mano. */
export function aplicarCriba(db: Db, criba: CribaData): Result<Record<'interesa' | 'revisar' | 'descartar', number>> {
  const lote = idsDelLote(db, criba.lote);
  if (!lote) return fail('not_found', `No existe el lote ${criba.lote}.`);
  if (lote.estado === 'cribado') return fail('ya_cribado', `El lote ${criba.lote} ya se cribó.`);
  const problema =
    sinPerfil(criba.veredictos) ?? revisarCobertura(lote.ids, criba.veredictos) ?? revisarLotes(db, criba.veredictos);
  if (problema) return fail('invalid_input', problema);
  const cuenta = { interesa: 0, revisar: 0, descartar: 0 };
  const ts = new Date().toISOString();
  const actualizar =
    db.prepare(`UPDATE oportunidades SET estado = ?, veredicto_ia = ?, motivo_ia = ?, confianza_ia = ?, lotes_interes = ?, actualizada_en = ?
    WHERE licitacion_id = ? AND estado = 'candidata'`);
  db.transaction(() => {
    for (const v of criba.veredictos) {
      const lotes = v.lotes?.length ? JSON.stringify(v.lotes) : null;
      // Lo que una persona ya sacó de candidata no cambia: ni cuenta ni baja pliegos.
      if (
        actualizar.run(ESTADO_POR_VEREDICTO[v.veredicto], v.veredicto, v.motivo, v.confianza, lotes, ts, v.id)
          .changes === 0
      )
        continue;
      cuenta[v.veredicto] += 1;
      if (v.veredicto !== 'descartar') encolarPliegos(db, v.id);
    }
    db.prepare("UPDATE lotes_criba SET estado = 'cribado', cribado_en = ? WHERE id = ?").run(ts, criba.lote);
    emitir(db, { tipo: 'licitaciones.cribado', dominio: 'licitaciones', recurso: `lote-${criba.lote}`, datos: cuenta });
  })();
  return ok(cuenta);
}

export function loteCribado(db: Db, lote: number): boolean {
  return idsDelLote(db, lote)?.estado === 'cribado';
}

export function instruccionesCriba(lote: number, empresa: string, areasFormacion: readonly string[] = []): string {
  const formaciones = reglaFormacionesCriba(areasFormacion);
  return [
    `Tarea automática de la plataforma de ${empresa}: criba el lote ${lote} de licitaciones candidatas.`,
    `1. Lee el perfil de la empresa con la herramienta biblioteca_leer (ruta «${PERFIL_EMPRESA}»). Si no puedes leerlo (no existe o la herramienta falla), no cribes: termina sin enviar veredictos y la plataforma lo reintentará; cribar sin el perfil no sirve.`,
    `2. Pide las candidatas con licitaciones_candidatas (lote=${lote}).`,
    '3. Para cada una decide «interesa» (encaja claramente con el perfil), «descartar» (claramente fuera: sector, tamaño, requisitos que no cumplimos) o «revisar» (hay dudas). Básate solo en los datos de la candidata y en el perfil; no inventes. Motivo breve (máximo 300 caracteres) y confianza entre 0 y 1.',
    '   Si tiene lotes y «presentacion.se_eligen_lotes» es true, juzga cada lote por su importe y su CPV (un contrato grande puede tener un lote a nuestra medida) y, con «interesa» o «revisar», di en «lotes» los de interés ([{id, motivo}], como mucho «presentacion.maximo_lotes»; un solo lote si la regla es «A un solo lote»; solo lotes dentro de «rango_importe_lotes», que la plataforma rechaza los demás). Si la regla está «sin confirmar», elige igual y dilo en el motivo. Si hay que presentarse a todos los lotes, juzga el total y no envíes «lotes».',
    '   «idioma_titulo» es la lengua en que está escrito el título (ca catalán o valenciano, eu euskera, gl gallego, es español; null si no se sabe). El perfil de la empresa (plataforma_empresa, campo «idiomas») dice en qué idiomas trabaja el equipo: si la licitación exige trabajar o atender en una lengua que no está ahí (personal con euskera, atención en catalán…), «descartar»; si solo está publicada en esa lengua y no consta que la exija, «revisar» y dilo en el motivo.',
    ...(formaciones ? [`   ${formaciones}`] : []),
    '   «antecedentes.nivel» resume los indicios de que la licitación esté pensada para quien ya presta el servicio (mismo adjudicatario en ediciones anteriores, una sola oferta, bajas mínimas, plazo justo, solvencia alta). Con nivel alto, dilo en el motivo y baja la confianza; no descartes solo por eso, pero si además encaja a medias, prefiere «revisar».',
    `4. Envía todos los veredictos de una vez con licitaciones_cribar (lote=${lote}), exactamente uno por candidata. Si la herramienta responde con un error, corrige lo que indique y vuelve a enviarlo.`,
    'No hagas nada más: no escribas en la Biblioteca ni en Salidas y no respondas en ningún canal.',
  ].join('\n');
}
