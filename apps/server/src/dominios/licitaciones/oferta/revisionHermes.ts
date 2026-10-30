// Bandeja «Revisar lo que hizo Hermes» de las comprobaciones: una tarjeta por cosa que revisar.
import type { Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { emitir } from '../../../nucleo/eventos.js';
import { invalido, responder } from '../../../nucleo/http.js';
import { conQuien, quienDe } from '../../../nucleo/permisos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { huellaDe } from './comprobacionesTipos.js';
import { decisionesDe, type DecisionesData } from './decisiones.js';
import { documentoDelGuion, type FilaDocumento } from './documentos.js';
import { guionPorId, guionVigente, type GuionGuardado } from './guion.js';
import { automaticoDe } from './guionLotes.js';
import { cierreDe, lotesDeLaMemoria } from './memoriaPresentada.js';
import { paqueteVigente } from './paqueteManifiesto.js';
import { pideEvidencia, propuestaDecisionesDe, type PropuestaGuardada } from './propuestaDecisiones.js';
import { sinCitasInternas } from './textoPliego.js';

// Las tarjetas salen de las filas de siempre (propuesta, memoria, anexos, paquete y revisión previa);
// revision_tarjetas solo guarda los cierres, así el GET no escribe. Una tarjeta se cierra para la oferta cuando
// cualquiera la acepta o la descarta; revisiones_usuario solo decide qué es «nuevo para ti». Aceptar no aplica
// nada: cada tarjeta tiene su acción propia.
export const TIPOS_TARJETA = ['propuesta', 'memoria', 'anexo', 'deuc', 'revision_previa'] as const;
type TipoTarjeta = (typeof TIPOS_TARJETA)[number];
type EstadoTarjeta = 'pendiente' | 'aceptada' | 'descartada';
// cierre: quién la aceptó o descartó, cuándo y por qué (null mientras está pendiente), para el historial.
type CierreVisto = { quien: string | null; motivo: string | null; en: string | null };
export type Tarjeta = {
  clave: string;
  tipo: TipoTarjeta;
  titulo: string;
  lote: string | null;
  creada_en: string;
  huella: string;
  estado: EstadoTarjeta;
  nueva_para_ti: boolean;
  acreditacion: boolean;
  resumen: string;
  cierre: CierreVisto | null;
};
export type Bandeja = { tarjetas: Tarjeta[]; nuevas: number };
// Lo que sale de cada fuente, antes de cruzarlo con los cierres y con la última revisión de la persona.
type Candidata = Omit<Tarjeta, 'estado' | 'nueva_para_ti' | 'cierre'>;

export const TIPO_EVENTO_REVISION = 'licitacion.revision';
// Sin login por persona (pregunta de), quien no se identifica cuenta como «web», igual que en las comprobaciones.
export const USUARIO_POR_DEFECTO = 'web';
const DEUC_GUIA = /(^|\/)DEUC_GUIA(-v\d+)?\.md$/i;
const log = logger('licitaciones');

// ── Propuesta de decisiones ─────────────────────────────────────────────────────────────────────

const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

function equipoSinAplicar(g: DecisionesData | null, p: DecisionesData): boolean {
  const guardado = new Set((g?.equipo ?? []).map((m) => `${m.persona_id}|${comparable(m.rol_en_la_oferta)}`));
  return p.equipo.some((m) => !guardado.has(`${m.persona_id}|${comparable(m.rol_en_la_oferta)}`));
}

function automaticosSinAplicar(g: DecisionesData | null, p: DecisionesData): DecisionesData['automaticos'] {
  const guardado = new Map((g?.automaticos ?? []).map((a) => [`${comparable(a.criterio)}|${a.lote ?? ''}`, a]));
  return p.automaticos.filter((a) => {
    const s = guardado.get(`${comparable(a.criterio)}|${a.lote ?? ''}`);
    return !s || s.nos_acogemos !== a.nos_acogemos || (s.tramo ?? null) !== (a.tramo ?? null);
  });
}

/** Las secciones en las que la propuesta trae algo que no está en lo guardado (sin el precio: no lo propone). */
export function seccionesSinAplicar(guardadas: DecisionesData | null, propuesta: DecisionesData): string[] {
  const lotes = new Set(guardadas?.lotes ?? []);
  const herramientas = new Set((guardadas?.herramientas ?? []).map(comparable));
  const fuera: [string, boolean][] = [
    ['lotes', propuesta.lotes.some((l) => !lotes.has(l))],
    ['equipo', equipoSinAplicar(guardadas, propuesta)],
    ['automaticos', automaticosSinAplicar(guardadas, propuesta).length > 0],
    ['herramientas', propuesta.herramientas.some((h) => !herramientas.has(comparable(h)))],
    // Al guardar, el enfoque pierde las citas del pliego (como en diffPropuesta.ts): aplicado, ya no queda sin aplicar.
    ['enfoque', comparable(sinCitasInternas(propuesta.enfoque)) !== comparable(guardadas?.enfoque ?? '')],
  ];
  return fuera.filter(([, sin]) => sin).map(([s]) => s);
}

// Un criterio que hay que acreditar con un documento o un hecho no se acepta sin mirarlo uno a uno.
function propuestaAcredita(p: PropuestaGuardada, guardadas: DecisionesData | null, g: GuionGuardado): boolean {
  const pendientes = new Set(
    automaticosSinAplicar(guardadas, p.decisiones).map((a) => `${comparable(a.criterio)}|${a.lote ?? ''}`),
  );
  return p.datos.automaticos.some((a) => {
    if (!pendientes.has(`${comparable(a.criterio)}|${a.lote ?? ''}`)) return false;
    const delGuion = automaticoDe(g.datos, a.criterio, a.lote);
    return (
      a.tipo === 'acreditacion' || Boolean(delGuion?.exige_documento) || pideEvidencia(delGuion?.como_se_acredita ?? '')
    );
  });
}

// Una propuesta de otro guion sale marcada: no se puede aplicar (diffPropuesta la rechaza) y la regla
// propuesta_obsoleta de las comprobaciones la manda rehacer, pero la persona tiene que ver que existe.
function textosPropuesta(
  db: Db,
  p: PropuestaGuardada,
  g: GuionGuardado,
  sin: string[],
): { titulo: string; resumen: string } {
  if (p.guion_id !== g.id) {
    const v = guionPorId(db, p.guion_id)?.version;
    const hecha = v ? `hecha con el guion v${v}` : 'hecha con un guion anterior';
    return {
      titulo: `Propuesta de decisiones (${hecha})`,
      resumen: `Es de un guion anterior al v${g.version}: Hermes la rehace. ${p.datos.resumen}`,
    };
  }
  const resumen = sin.length ? `Sin aplicar: ${sin.join(', ')}. ${p.datos.resumen}` : p.datos.resumen;
  return { titulo: `Propuesta de decisiones (guion v${g.version})`, resumen };
}

function tarjetaPropuesta(db: Db, id: string, g: GuionGuardado | null): Candidata[] {
  const p = propuestaDecisionesDe(db, id);
  if (!p || !g) return [];
  const guardadas = decisionesDe(db, id);
  const sin = seccionesSinAplicar(guardadas?.datos ?? null, p.decisiones);
  if (!sin.length && guardadas && p.creada_en <= guardadas.actualizada_en) return [];
  const { titulo, resumen } = textosPropuesta(db, p, g, sin);
  return [
    {
      clave: `propuesta:${p.guion_id}:${p.creada_en}`,
      tipo: 'propuesta',
      titulo,
      lote: null,
      creada_en: p.creada_en,
      huella: huellaDe(p.datos),
      acreditacion: propuestaAcredita(p, guardadas?.datos ?? null, g),
      resumen: resumen.slice(0, 600),
    },
  ];
}

// ── Memoria, anexos, DEUC y revisión previa ─────────────────────────────────────────────────────

type FilaMemoria = {
  version: number;
  ensamblada_en: string | null;
  sha256: string;
  paginas: number | null;
  revision: string;
};

const SELECT_MEMORIA = `SELECT m.version, m.ensamblada_en, b.sha256, b.paginas, b.estado AS revision FROM memorias m JOIN borradores b ON b.id = m.borrador_id
  WHERE m.licitacion_id = ? AND m.ensayo = 0`;

function candidataMemoria(m: FilaMemoria | undefined, lote: string | null): Candidata[] {
  // Dada por buena o descartada, ya la decidió una persona (PATCH /borradores/:n): no hay nada que revisar.
  if (!m || !m.ensamblada_en || m.revision !== 'pendiente') return [];
  const paginas = m.paginas === null ? '' : ` · ${m.paginas} páginas`;
  const delLote = lote ? ` del lote ${lote}` : '';
  return [
    {
      clave: `memoria:v${m.version}`,
      tipo: 'memoria',
      titulo: `Memoria técnica${delLote} v${m.version}`,
      lote,
      creada_en: m.ensamblada_en,
      huella: huellaDe(m.sha256),
      acreditacion: false,
      resumen: `Hermes montó la memoria${delLote} v${m.version}${paginas}: léela y dala por buena.`,
    },
  ];
}

// La última de la oferta (las de ensayo se miden contra la presentada: no son la memoria de la
// oferta). Con memoria por lote, la última de cada lote que sigue abierto, sin la presentada: la
// presentada de un lote no tapa la que otro tiene por revisar. Si ningún lote tiene aún la suya,
// cuenta la común que se hizo antes, como en las comprobaciones (memoriasDeTrabajo).
function tarjetaMemoria(db: Db, id: string): Candidata[] {
  const lotes = lotesDeLaMemoria(db, id);
  const ultima = (): FilaMemoria | undefined =>
    db.prepare(`${SELECT_MEMORIA} ORDER BY m.version DESC LIMIT 1`).get(id) as FilaMemoria | undefined;
  if (!lotes) return candidataMemoria(ultima(), null);
  const cerrado = cierreDe(db, id);
  const delLote = db.prepare(`${SELECT_MEMORIA} AND m.presentada = 0 AND m.lote = ? ORDER BY m.version DESC LIMIT 1`);
  const porLote = lotes
    .filter((l) => !cerrado(l))
    .map((l) => ({ l, m: delLote.get(id, l) as FilaMemoria | undefined }));
  if (porLote.every((x) => !x.m)) {
    const comun = db
      .prepare(`${SELECT_MEMORIA} AND m.presentada = 0 AND m.lote IS NULL ORDER BY m.version DESC LIMIT 1`)
      .get(id) as FilaMemoria | undefined;
    return porLote.length ? candidataMemoria(comun, null) : [];
  }
  return porLote.flatMap((x) => candidataMemoria(x.m, x.l));
}

// «Anexo VII», «anexo 3»: el modelo del que habla un criterio («Anexo VII, casilla 2») o un documento.
const modeloDe = (t: string): string | null =>
  /\banexo\s+([ivxlcdm]+|\d+)\b/i.exec(textoComparable(t))?.[0].replace(/\s+/g, ' ') ?? null;

/** Un anexo de acreditación: el guion lo tipa así o en él se marca un criterio al que se acoge la empresa y que pide evidencia. */
function anexoAcredita(f: FilaDocumento, g: GuionGuardado | null, d: DecisionesData | null): boolean {
  if (!g) return false;
  const doc = documentoDelGuion(g.datos, f.clave);
  if (doc?.doc.tipo === 'acreditacion') return true;
  const modelo = modeloDe(f.nombre);
  if (!modelo) return false;
  return (d?.automaticos ?? [])
    .filter((a) => a.nos_acogemos)
    .some((a) => {
      const delGuion = automaticoDe(g.datos, a.criterio, a.lote);
      if (!delGuion || modeloDe(delGuion.casilla_en) !== modelo) return false;
      return Boolean(delGuion.exige_documento) || pideEvidencia(delGuion.como_se_acredita);
    });
}

const loteDeClave = (clave: string): string | null => /-l(.+)$/.exec(clave)?.[1] ?? null;

// Sin las ocultas (lote quitado, o el guion ya no lo pide): su vista y su aceptación las rechazan.
function tarjetasAnexo(db: Db, id: string, g: GuionGuardado | null): Candidata[] {
  const filas = db
    .prepare(
      "SELECT * FROM oferta_documentos WHERE licitacion_id = ? AND estado = 'borrador' AND anexo_en IS NOT NULL AND oculto = 0 ORDER BY clave",
    )
    .all(id) as FilaDocumento[];
  const d = decisionesDe(db, id)?.datos ?? null;
  return filas
    .filter((f) => !DEUC_GUIA.test(f.ruta ?? ''))
    .map((f) => ({
      clave: `anexo:${f.clave}:${f.anexo_en}`,
      tipo: 'anexo',
      titulo: f.nombre,
      lote: loteDeClave(f.clave),
      creada_en: f.anexo_en as string,
      huella: huellaDe(f.ruta, f.ruta_pdf, f.sustituciones),
      acreditacion: anexoAcredita(f, g, d),
      resumen: 'Hermes rellenó este anexo: revisa los valores y acéptalo.',
    }));
}

type Guia = { ruta: string; creada_en: string; huella: string };

// La guía llega en el paquete (su manifiesto) o como ruta de la fila del DEUC; la más reciente manda.
function guiasDeuc(db: Db, id: string): Guia[] {
  const filas = db
    .prepare(
      'SELECT ruta, actualizado_en FROM oferta_documentos WHERE licitacion_id = ? AND ruta IS NOT NULL AND oculto = 0',
    )
    .all(id) as { ruta: string; actualizado_en: string }[];
  const deFilas = filas
    .filter((f) => DEUC_GUIA.test(f.ruta))
    .map((f) => ({ ruta: f.ruta, creada_en: f.actualizado_en, huella: huellaDe(f.ruta, f.actualizado_en) }));
  const p = paqueteVigente(db, id);
  const delPaquete = (p?.manifiesto.carpetas ?? []).flatMap((c) =>
    c.documentos.map((d) => ({ ruta: `${c.ruta}/${d.archivo}`, creada_en: p!.creado_en, huella: d.sha256 })),
  );
  return [...deFilas, ...delPaquete.filter((x) => DEUC_GUIA.test(x.ruta))];
}

function tarjetaDeuc(db: Db, id: string): Candidata[] {
  const ultima = guiasDeuc(db, id)
    .sort((a, b) => a.creada_en.localeCompare(b.creada_en) || a.ruta.localeCompare(b.ruta))
    .at(-1);
  if (!ultima) return [];
  return [
    {
      clave: `deuc:${ultima.ruta}`,
      tipo: 'deuc',
      titulo: 'Guía del DEUC',
      lote: null,
      creada_en: ultima.creada_en,
      huella: ultima.huella,
      acreditacion: false,
      resumen: 'Hermes preparó la guía del DEUC campo a campo: revísala antes de importarlo en el servicio.',
    },
  ];
}

type FilaRevisionPrevia = {
  paquete_version: number;
  resumen: string | null;
  ruta_md: string | null;
  terminada_en: string | null;
  pedida_en: string;
};

function tarjetaRevisionPrevia(db: Db, id: string): Candidata[] {
  const r = db
    .prepare(
      `SELECT paquete_version, resumen, ruta_md, terminada_en, pedida_en FROM revisiones_previas
    WHERE licitacion_id = ? AND estado = 'terminada' ORDER BY paquete_version DESC LIMIT 1`,
    )
    .get(id) as FilaRevisionPrevia | undefined;
  if (!r) return [];
  return [
    {
      clave: `revision_previa:v${r.paquete_version}`,
      tipo: 'revision_previa',
      titulo: `Revisión previa del paquete v${r.paquete_version}`,
      lote: null,
      creada_en: r.terminada_en ?? r.pedida_en,
      huella: huellaDe(r.resumen, r.ruta_md),
      acreditacion: false,
      resumen: (r.resumen ?? 'Hermes revisó el paquete antes del envío.').slice(0, 600),
    },
  ];
}

// ── Cruce con los cierres y con la última revisión de cada persona ──────────────────────────────

type FilaCierre = {
  clave: string;
  huella: string;
  estado: EstadoTarjeta;
  quien: string | null;
  motivo: string | null;
  cerrada_en: string | null;
};

function candidatas(db: Db, id: string): Candidata[] {
  const g = guionVigente(db, id);
  return [
    ...tarjetaPropuesta(db, id, g),
    ...tarjetaMemoria(db, id),
    ...tarjetasAnexo(db, id, g),
    ...tarjetaDeuc(db, id),
    ...tarjetaRevisionPrevia(db, id),
  ];
}

function revisadoEn(db: Db, id: string, usuario: string): string | null {
  const f = db
    .prepare('SELECT revisado_en FROM revisiones_usuario WHERE licitacion_id = ? AND usuario = ?')
    .get(id, usuario) as { revisado_en: string } | undefined;
  return f?.revisado_en ?? null;
}

/** Las tarjetas de la oferta, de la más reciente a la más antigua. Una cerrada cuya huella cambió vuelve a pendiente. */
export function tarjetasDe(db: Db, id: string, usuario: string): Tarjeta[] {
  const cierres = new Map(
    (
      db
        .prepare(
          'SELECT clave, huella, estado, quien, motivo, cerrada_en FROM revision_tarjetas WHERE licitacion_id = ?',
        )
        .all(id) as FilaCierre[]
    ).map((c) => [c.clave, c]),
  );
  const visto = revisadoEn(db, id, usuario);
  return candidatas(db, id)
    .map((c): Tarjeta => {
      const f = cierres.get(c.clave);
      const vale = f !== undefined && f.huella === c.huella && f.estado !== 'pendiente';
      const estado: EstadoTarjeta = vale ? f.estado : 'pendiente';
      const cierre = vale ? { quien: f.quien, motivo: f.motivo, en: f.cerrada_en } : null;
      return { ...c, estado, cierre, nueva_para_ti: estado === 'pendiente' && (visto === null || c.creada_en > visto) };
    })
    .sort((a, b) => b.creada_en.localeCompare(a.creada_en));
}

function bandejaDe(db: Db, id: string, usuario: string): Bandeja {
  const tarjetas = tarjetasDe(db, id, usuario);
  return { tarjetas, nuevas: tarjetas.filter((t) => t.nueva_para_ti).length };
}

// ── Cerrar y marcar vista ───────────────────────────────────────────────────────────────────────

export type CierreTarjeta = { accion: 'aceptar' | 'descartar'; motivo?: string; quien: string; en?: string };
const Motivo = z.string().trim().min(3).max(500);

function rechazoCierre(tarjetas: Tarjeta[], claves: string[], c: CierreTarjeta): Result<Tarjeta[]> {
  if (c.accion === 'descartar' && !Motivo.safeParse(c.motivo ?? '').success)
    return fail('invalid_input', 'Al descartar, di por qué (de 3 a 500 caracteres).');
  const elegidas = claves.map((k) => tarjetas.find((t) => t.clave === k));
  if (elegidas.some((t) => !t)) return fail('not_found', 'Esa tarjeta ya no está en la bandeja.');
  const cerrada = (elegidas as Tarjeta[]).find((t) => t.estado !== 'pendiente');
  if (cerrada) return fail('conflicto', `«${cerrada.titulo}» ya está ${cerrada.estado}.`);
  if (claves.length > 1 && (elegidas as Tarjeta[]).some((t) => t.acreditacion))
    return fail('invalid_input', 'Las tarjetas de acreditación se revisan una a una.');
  return ok(elegidas as Tarjeta[]);
}

function guardarCierres(db: Db, id: string, tarjetas: Tarjeta[], c: CierreTarjeta): void {
  const estado: EstadoTarjeta = c.accion === 'aceptar' ? 'aceptada' : 'descartada';
  const en = c.en ?? new Date().toISOString();
  const upsert =
    db.prepare(`INSERT INTO revision_tarjetas (licitacion_id, clave, tipo, huella, estado, quien, motivo, creada_en, cerrada_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(licitacion_id, clave) DO UPDATE SET huella = excluded.huella, estado = excluded.estado,
    quien = excluded.quien, motivo = excluded.motivo, creada_en = excluded.creada_en, cerrada_en = excluded.cerrada_en`);
  db.transaction(() => {
    for (const t of tarjetas)
      upsert.run(id, t.clave, t.tipo, t.huella, estado, c.quien, c.motivo?.trim() ?? null, t.creada_en, en);
  })();
}

function avisarRevision(id: string, datos: { clave: string; accion: string }): void {
  try {
    emitir(nucleo().db, { tipo: TIPO_EVENTO_REVISION, dominio: 'licitaciones', recurso: id, datos });
  } catch (err) {
    log.error('evento de la revisión sin emitir', { id, error: errorMessage(err) });
  }
}

/**
 * Cierra varias tarjetas de una vez (para la oferta, no para quien la cierra). Las de acreditación
 * no van en bloque: con más de una clave y alguna de acreditación, no se cierra ninguna.
 */
export function cerrarTarjetas(db: Db, id: string, claves: string[], c: CierreTarjeta): Result<Tarjeta[]> {
  const r = rechazoCierre(tarjetasDe(db, id, c.quien), claves, c);
  if (r.error) return r;
  try {
    guardarCierres(db, id, r.data, c);
  } catch (err) {
    log.error('tarjeta de revisión sin cerrar', { id, error: errorMessage(err) });
    return fail('io_error', 'No se pudo guardar la revisión.');
  }
  for (const t of r.data) avisarRevision(id, { clave: t.clave, accion: c.accion });
  return ok(tarjetasDe(db, id, c.quien).filter((t) => claves.includes(t.clave)));
}

export function cerrarTarjeta(db: Db, id: string, clave: string, c: CierreTarjeta): Result<Tarjeta> {
  const r = cerrarTarjetas(db, id, [clave], c);
  return r.error ? r : ok(r.data[0]!);
}

/**
 * «Vista» avanza la última revisión de la persona hasta esa tarjeta (no hasta ahora): así abrir una
 * no da por vistas las que llegaron después y aún no ha mirado.
 */
function marcarVista(db: Db, id: string, clave: string, usuario: string): Result<null> {
  const t = tarjetasDe(db, id, usuario).find((x) => x.clave === clave);
  if (!t) return fail('not_found', 'Esa tarjeta ya no está en la bandeja.');
  try {
    db.prepare(
      `INSERT INTO revisiones_usuario (licitacion_id, usuario, revisado_en) VALUES (?, ?, ?)
      ON CONFLICT(licitacion_id, usuario) DO UPDATE SET revisado_en = max(revisado_en, excluded.revisado_en)`,
    ).run(id, usuario, t.creada_en);
    return ok(null);
  } catch (err) {
    log.error('revisión del usuario sin guardar', { id, error: errorMessage(err) });
    return fail('io_error', 'No se pudo guardar que la viste.');
  }
}

// ── API web ─────────────────────────────────────────────────────────────────────────────────────

const Usuario = z.string().trim().min(2).max(60);
const AccionRevision = z.strictObject({
  accion: z.enum(['aceptar', 'descartar', 'vista']),
  motivo: z.string().trim().min(3, 'Escribe el motivo en pocas palabras.').max(500).optional(),
  quien: Usuario.optional(),
});
const ClaveTarjeta = z.string().trim().min(3).max(400);

function accionRevision(db: Db, id: string, clave: string, e: z.infer<typeof AccionRevision>): Result<Bandeja> {
  const quien = e.quien ?? USUARIO_POR_DEFECTO;
  const r =
    e.accion === 'vista'
      ? marcarVista(db, id, clave, quien)
      : cerrarTarjeta(db, id, clave, { accion: e.accion, motivo: e.motivo, quien });
  return r.error ? r : ok(bandejaDe(db, id, quien));
}

export function rutasRevisionHermes(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/revision',
    conId((id, req, res) => {
      responder(res, ok(bandejaDe(dbLicitaciones(), id, quienDe(req))));
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/revision/:clave',
    conId((id, req, res) => {
      const clave = ClaveTarjeta.safeParse(req.params['clave']);
      if (!clave.success) return invalido(res, clave.error);
      const e = AccionRevision.safeParse(conQuien(req));
      if (!e.success) return invalido(res, e.error);
      responder(res, accionRevision(dbLicitaciones(), id, clave.data, e.data));
    }),
  );
}
