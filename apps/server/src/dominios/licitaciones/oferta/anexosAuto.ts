// Anexos automáticos: al guardar las decisiones se piden los anexos cuyo contenido cambió; lo que una
// persona ya dio por bueno o corrigió no se rehace, solo se avisa.
import fs from 'node:fs';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { encolar } from '../../../nucleo/trabajos.js';
import type { FichaDatosData } from '../ficha.js';
import type { Db } from '../store.js';
import { decisionesDe } from './decisiones.js';
import { leerPlan, type PlanAnexoData } from './anexoPlan.js';
import { decisionesEn } from './decisionesHistorial.js';
import {
  cambiosEntre,
  enumerar,
  FRASE_DATO_ANEXO,
  huella,
  SeccionesAnexo,
  seccionesDeAnexo,
} from './dependenciasAnexo.js';
import {
  documentoDelGuion,
  documentosDe,
  filaDocumento,
  sincronizarDocumentos,
  type DocumentoConClave,
  type FilaDocumento,
} from './documentos.js';
import { guionVigente } from './guion.js';
import { hojaDeDatos } from './hojaDatos.js';
import { guardaPlazo, licitacionesEnPreparacion } from './plazo.js';
import { TIPO_ANEXO, trabajoAnexo } from './anexosTrabajo.js';
import { type Modelo, comparable, modeloDe } from './anexosModelo.js';
import { rutaDePdf } from './anexosModeloPdf.js';
import { estadoElegibilidad, fichaDe, requisitoDeLaVia } from './anexosVia.js';
import { logger } from '../../../nucleo/log.js';

const log = logger('licitaciones');

const TIPOS_AUTO = new Set(['declaracion', 'oferta_economica', 'acreditacion', 'otro']);
type Decididas = NonNullable<ReturnType<typeof decisionesDe>>;

// El anexo económico de un lote espera a que el precio de su lote no esté pendiente.
function precioListo(d: DocumentoConClave, ofertas: Decididas['datos']['ofertas']): boolean {
  if (d.doc.tipo !== 'oferta_economica') return true;
  const suyas = d.lote === null ? ofertas : ofertas.filter((o) => o.lote === d.lote);
  return suyas.length > 0 && suyas.every((o) => !o.pendiente);
}

export const PREFIJO_ANTERIOR = 'El anexo es anterior a';

// Lo que una persona ya dio por bueno no se rehace: queda un aviso en la fila con lo que cambió
// (sin dependencias guardadas, un anexo de antes solo sabe la hora). Sustituye al aviso anterior.
function avisarAnterior(db: Db, f: FilaDocumento, c: { id: string; decididasEn: string; cambios: string[] }): void {
  const hora = horaLocalEspana(Date.parse(c.decididasEn)).slice(11, 16);
  const que = c.cambios.length
    ? `${PREFIJO_ANTERIOR} que cambiara ${enumerar(c.cambios)} (decisiones de las ${hora})`
    : `${PREFIJO_ANTERIOR} las decisiones de las ${hora}`;
  const aviso = `${que}: si cambió algo que lleva, rehazlo con «Rellenar con Hermes».`;
  const avisos = JSON.parse(f.avisos) as string[];
  if (avisos.includes(aviso)) return;
  const otros = avisos.filter((a) => !a.startsWith(PREFIJO_ANTERIOR));
  db.prepare('UPDATE oferta_documentos SET avisos = ? WHERE licitacion_id = ? AND clave = ?').run(
    JSON.stringify([...otros, aviso]),
    c.id,
    f.clave,
  );
}

// Volver a lo que el anexo ya lleva (guardar el precio A, luego el B y otra vez el A) lo deja al
// día: su aviso de «anterior a…» ya no es cierto.
function quitarAvisoAnterior(db: Db, id: string, f: FilaDocumento): void {
  const avisos = JSON.parse(f.avisos) as string[];
  const otros = avisos.filter((a) => !a.startsWith(PREFIJO_ANTERIOR));
  if (otros.length === avisos.length) return;
  db.prepare('UPDATE oferta_documentos SET avisos = ? WHERE licitacion_id = ? AND clave = ?').run(
    JSON.stringify(otros),
    id,
    f.clave,
  );
}

// Un borrador cuyo .docx se tocó después de que Hermes lo escribiera lleva correcciones de una
// persona (en Drive o en Word): rehacerlo las perdería. El margen cubre el reloj de la sincronización.
const MARGEN_EDICION_MS = 5_000;

export function editadoPorPersona(raices: Raices, f: FilaDocumento): boolean {
  if (f.ruta === null || f.anexo_en === null) return false;
  const abs = documentoEnDisco(raices, f.ruta);
  if (abs.error) return false;
  try {
    return fs.statSync(abs.data).mtimeMs > Date.parse(f.anexo_en) + MARGEN_EDICION_MS;
  } catch {
    return false;
  }
}

export const AVISO_EDITADO =
  'El borrador tiene correcciones tuyas: Hermes no lo rehace solo. Si cambió algo que lleva, rehazlo con «Rellenar con Hermes».';

function avisarEditado(db: Db, id: string, f: FilaDocumento): void {
  const avisos = JSON.parse(f.avisos) as string[];
  if (avisos.includes(AVISO_EDITADO)) return;
  db.prepare('UPDATE oferta_documentos SET avisos = ? WHERE licitacion_id = ? AND clave = ?').run(
    JSON.stringify([...avisos, AVISO_EDITADO]),
    id,
    f.clave,
  );
}

type Candidato = { d: DocumentoConClave; f: FilaDocumento };
type ContextoAuto = {
  db: Db;
  dbNucleo: DbNucleo;
  raices: Raices;
  id: string;
  dec: Decididas;
  ficha: FichaDatosData | null;
};
type ConSecciones = Candidato & { ahora: SeccionesAnexo };

function dependenciasDe(f: FilaDocumento): SeccionesAnexo | null {
  const crudo = f.anexo_dependencias;
  if (!crudo) return null;
  try {
    const s = SeccionesAnexo.safeParse(JSON.parse(crudo));
    return s.success ? s.data : null;
  } catch {
    return null;
  }
}

const guardarDependencias = (db: Db, id: string, clave: string, s: SeccionesAnexo | null) =>
  db
    .prepare('UPDATE oferta_documentos SET anexo_dependencias = ? WHERE licitacion_id = ? AND clave = ?')
    .run(s ? JSON.stringify(s) : null, id, clave);

// Lo que llevó un anexo de antes de guardar dependencias: lo de las decisiones vigentes cuando se
// rellenó (el historial), para comparar valores y no horas; deshacer un cambio aún no rehecho lo
// deja al día. Sin historial de entonces, solo se sabe si es posterior a las decisiones de ahora.
function usadasPorLegado(c: ContextoAuto, x: ConSecciones, anexoEn: string): SeccionesAnexo | null {
  const en = decisionesEn(c.db, c.id, anexoEn);
  const usadas = en ? seccionesDeAnexo(x.d.doc.tipo, x.d.lote, en) : anexoEn >= c.dec.actualizada_en ? x.ahora : null;
  if (usadas) guardarDependencias(c.db, c.id, x.f.clave, usadas);
  return usadas;
}

// Lo que cambió desde que Hermes lo rellenó; null si no se sabe (nunca rellenado, o de antes de
// guardar dependencias y sin historial de entonces).
function cambiosDesdeAnexo(c: ContextoAuto, x: ConSecciones): string[] | null {
  if (x.f.anexo_en === null) return null;
  const antes = dependenciasDe(x.f) ?? usadasPorLegado(c, x, x.f.anexo_en);
  return antes ? cambiosEntre(antes, x.ahora, x.d.lote) : null;
}

// Qué toca con un anexo de la checklist: dejarlo, avisar a quien ya lo dio por bueno o pedirlo
// (sin un documento puesto por una persona ni correcciones suyas y con su precio, si lo lleva).
// La vía alternativa de un excluyente abierto nunca se pide sola: es una apuesta de la persona; si
// el perfil ya cubre la certificación, la vía sobra.
const viaQueNoSePide = (c: ContextoAuto, d: DocumentoConClave): boolean =>
  requisitoDeLaVia(c.ficha, d, (r) => estadoElegibilidad(c.db, c.id, r), ['abierta', 'cubierta']) !== null;

function decidirAuto(c: ContextoAuto, x: ConSecciones): 'saltar' | 'avisar' | 'encolar' {
  const { d, f } = x;
  if (!TIPOS_AUTO.has(d.doc.tipo) || f.estado === 'no_aplica' || f.oculto || viaQueNoSePide(c, d)) return 'saltar';
  if (cambiosDesdeAnexo(c, x)?.length === 0) {
    quitarAvisoAnterior(c.db, c.id, f);
    return 'saltar';
  }
  if (f.ruta !== null && f.anexo_en === null) return 'saltar';
  if (f.estado === 'preparado') return f.anexo_en !== null ? 'avisar' : 'saltar';
  if (editadoPorPersona(c.raices, f)) {
    avisarEditado(c.db, c.id, f);
    return 'saltar';
  }
  return precioListo(d, c.dec.datos.ofertas) && !trabajoAnexo(c.db, c.id, d.clave) ? 'encolar' : 'saltar';
}

// ruta: la que se guarda en anexo_modelo para el run, la misma que daría modeloParaPedir.
type Auto = { ruta: string; secciones: SeccionesAnexo };

const DE_LA_HOJA = Object.values(FRASE_DATO_ANEXO);

/**
 * Si lo que cambió en las decisiones es solo el precio o los datos del anexo (impuesto, orden de
 * los lotes, subcontratación): la hoja de datos los lleva y el plan del anexo los puede volver a poner.
 */
export const soloPrecio = (cambios: string[]): boolean =>
  cambios.every((c) => c.startsWith('el precio') || DE_LA_HOJA.includes(c));

// El `dato` de cada hueco lo escribe Hermes: si no casa con ninguna etiqueta de la oferta de la
// hoja, el plan guardó null y la regeneración nunca verá cambiar el precio (null antes y después).
function planLlevaPrecio(c: ContextoAuto, plan: PlanAnexoData): boolean {
  const hoja = hojaDeDatos(c.db, c.dbNucleo, c.id, { lote: plan.lote });
  if (hoja.error) return false;
  const deOferta = new Set(
    hoja.data.campos.filter((h) => h.grupo.startsWith('Oferta')).map((h) => comparable(h.etiqueta)),
  );
  const usados =
    plan.formato === 'docx'
      ? plan.items.map((i) => ({ dato: i.dato, valor: i.valor }))
      : plan.campos.map((x) => ({ dato: x.dato, valor: x.valor_hoja }));
  return usados.some((u) => u.valor !== null && deOferta.has(comparable(u.dato)));
}

// Con el plan guardado, el mismo modelo y algún hueco atado al precio de la hoja, el cambio de
// precio lo regenera el código (anexosRegeneracion.ts) sin run. El equipo, los criterios
// automáticos o los lotes no están en la hoja que guarda el plan (las casillas no tienen valor que
// comparar): esos siguen pidiendo el run.
function loRegeneraElCodigo(c: ContextoAuto, x: ConSecciones, ruta: string): boolean {
  const plan = leerPlan(x.f.sustituciones);
  if (plan === null) return false;
  if (x.f.anexo_modelo !== null && x.f.anexo_modelo !== ruta) return false;
  const cambios = cambiosDesdeAnexo(c, x);
  return cambios !== null && soloPrecio(cambios) && planLlevaPrecio(c, plan);
}

// Lo que se rellena solo: un .docx, o un PDF ya analizado con campos o transcrito. Un .doc espera
// a que alguien lo pida (necesita LibreOffice) y un PDF sin analizar, a la vuelta siguiente.
function rutaAuto(db: Db, id: string, m: Modelo, d: DocumentoConClave): string | null {
  if (m.ext === '.docx') return m.abs;
  return m.ext === '.pdf' ? (rutaDePdf(db, id, m, d).data ?? null) : null;
}

// El modelo que se rellenará solo, con lo que lleva, o null.
function modeloAuto(c: ContextoAuto, x: Candidato): Auto | null {
  const ahora = seccionesDeAnexo(x.d.doc.tipo, x.d.lote, c.dec.datos);
  const accion = decidirAuto(c, { ...x, ahora });
  if (accion === 'avisar')
    avisarAnterior(c.db, x.f, {
      id: c.id,
      decididasEn: c.dec.actualizada_en,
      cambios: cambiosDesdeAnexo(c, { ...x, ahora }) ?? [],
    });
  if (accion !== 'encolar') return null;
  const m = modeloDe(c.db, c.raices, c.id, x.d);
  const ruta = m.error ? null : rutaAuto(c.db, c.id, m.data, x.d);
  if (ruta === null || loRegeneraElCodigo(c, { ...x, ahora }, ruta)) return null;
  return { ruta, secciones: ahora };
}

// Una vez por contenido y por anexo recibido: volver a un precio anterior tras rellenar otro
// tiene que pedirlo de nuevo, aunque esa huella ya se pidiera antes.
const claveAuto = (id: string, f: FilaDocumento, s: SeccionesAnexo) =>
  `anexo-auto-${id}-${f.clave}-${huella(s)}${f.anexo_en ? `-tras-${f.anexo_en}` : ''}`;

export function anexosAutoDe(dbNucleo: DbNucleo, c: { db: Db; raices: Raices; id: string }, ahoraMs: number): number {
  const dec = decisionesDe(c.db, c.id);
  if (!dec || guardaPlazo(c.db, c.id, 'anexo', { ahoraMs }).error) return 0;
  const guion = guionVigente(c.db, c.id);
  if (!guion) return 0;
  sincronizarDocumentos(c.db, c.id, guion);
  const { documentos } = documentosDe(c.db, c.id);
  const ficha = fichaDe(c.db, c.id);
  let n = 0;
  for (const doc of documentos) {
    const d = documentoDelGuion(guion.datos, doc.clave);
    const f = filaDocumento(c.db, c.id, doc.clave);
    const a = d && f ? modeloAuto({ ...c, dbNucleo, dec, ficha }, { d, f }) : null;
    if (!d || !f || !a) continue;
    c.db
      .prepare('UPDATE oferta_documentos SET anexo_modelo = ? WHERE licitacion_id = ? AND clave = ?')
      .run(a.ruta, c.id, d.clave);
    const pedida = new Date(ahoraMs).toISOString();
    const payload = { id: c.id, clave: d.clave, pedida_en: pedida, dependencias: a.secciones };
    encolar(dbNucleo, { tipo: TIPO_ANEXO, dominio: 'licitaciones', clave: claveAuto(c.id, f, a.secciones), payload });
    n += 1;
  }
  return n;
}

// omitir: las ofertas que no deben gastar cuota en anexos esta vuelta (el freno de elegibilidad de cadena.ts).
export type OpcionesAnexosAuto = { omitir?: ReadonlySet<string> };

/**
 * Anexos automáticos: con las decisiones guardadas, se pide el relleno de cada anexo de la
 * checklist cuyo contenido de las decisiones (precio de su lote, equipo, criterios automáticos,
 * lotes) cambió desde que se rellenó (clave «anexo-auto-<id>-<clave>-<huella de lo que lleva>»,
 * más «-tras-<anexo_en>» si ya tenía uno: una vez por contenido). El botón «Rellenar con Hermes» sigue para rehacerlo.
 */
export function encolarAnexosAuto(
  dbNucleo: DbNucleo,
  dbLic: Db,
  ahoraMs = Date.now(),
  raices: Raices = raicesActuales(),
  op: OpcionesAnexosAuto = {},
): number {
  if (!raices.salidas) return 0;
  let n = 0;
  for (const l of licitacionesEnPreparacion(dbLic, ahoraMs)) {
    if (!op.omitir?.has(l.id)) n += anexosAutoDe(dbNucleo, { db: dbLic, raices, id: l.id }, ahoraMs);
  }
  if (n) log.info('anexos pedidos solos tras las decisiones', { anexos: n });
  return n;
}
