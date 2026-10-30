// Migración a la carpeta única por licitación, lanzada por una persona desde Ajustes › Drive.
// Sigue el plan de carpetaUnica.ts (docs/como-esta-hecho/carpetas.md, «Carpeta única por licitación»).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { nucleo } from '../../nucleo/contexto.js';
import {
  carpetaDeSalidasPorRuta,
  carpetaPorRuta,
  driveConectado,
  hijosDe,
  mover,
  pendienteDeSubir,
} from '../../nucleo/drive.js';
import { moverFuentesPropuestas } from '../../nucleo/documentos.js';
import { emitir } from '../../nucleo/eventos.js';
import { logger } from '../../nucleo/log.js';
import { guardarOperacion, leerOperacion } from '../../nucleo/operaciones.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { raicesActuales, type Raices } from '../../nucleo/salidas.js';
import { candidatas, destinoDe, enDisco, pasosDe, type Paso } from './carpetaUnica.js';
import { apuntarCarpetaUnica, carpetaUnicaEnDb } from './carpetasUnicas.js';
import { dbLicitaciones } from './db.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from './store.js';

// Se lanza tras revisar el ensayo; nunca sola. Antes, copia de las bases
// (licitaciones.db y nucleo.db) y un manifiesto con cada movimiento, para poder deshacerla. Con
// Drive conectado se mueve con su API (carpetas enteras, también los Google Docs, y bisync lo trae
// al disco); sin Drive, en el disco. Nunca pisa: un destino ocupado es un error de esa licitación,
// que se queda como estaba. Tras cada carpeta movida se reescriben las rutas guardadas que
// apuntaban dentro. Una licitación queda migrada (carpetas_unicas) cuando se movió todo lo suyo;
// desde entonces su oferta se escribe en su Oferta/ y sus pliegos bajan a su Pliegos/.

export const CLAVE_MIGRACION = 'licitaciones.carpeta_unica';
const log = logger('licitaciones.carpeta_unica');

const Movida = z.object({ licitacion: z.string(), de: z.string(), a: z.string(), id_drive: z.string().nullable() });
const ConError = z.object({ licitacion: z.string(), motivo: z.string() });
const InformeMigracion = z
  .object({
    copia: z.string().nullable().default(null),
    movidas: z.array(Movida).default([]),
    errores: z.array(ConError).default([]),
    hechas: z.array(z.string()).default([]),
    empezada_en: z.string().nullable().default(null),
    mensaje: z.string().default(''),
  })
  .catch({ copia: null, movidas: [], errores: [], hechas: [], empezada_en: null, mensaje: '' });
type InformeMigracionData = z.infer<typeof InformeMigracion>;
export type EstadoMigracion = InformeMigracionData & { estado: string; actualizada_en: string | null };

export function leerMigracion(): EstadoMigracion {
  const op = leerOperacion(nucleo().db, CLAVE_MIGRACION, (raw) => InformeMigracion.parse(raw ?? {}));
  return {
    ...(op?.datos ?? InformeMigracion.parse({})),
    estado: op?.estado ?? 'sin_lanzar',
    actualizada_en: op?.actualizada_en ?? null,
  };
}

/** ¿Se lanzó ya la migración? Desde entonces, cada oferta nueva nace con su carpeta única. */
const migracionLanzada = (): boolean => leerMigracion().estado !== 'sin_lanzar';

// ── Rutas guardadas ──

// Tablas sin rutas de documentos (o enormes y sin ellas): no se recorren.
const SIN_RUTAS = new Set([
  'licitaciones',
  'adjudicaciones',
  'lotes_criba',
  'expedientes_placsp',
  'filtros',
  'sync_estado',
  'historico_estado',
  'cobertura_semanal',
  'cobertura_autonomica',
  'seguidos',
  'carpetas_unicas',
  'eventos',
  'auditoria_agentes',
  'operaciones_unicas',
  'mcp_huellas',
  'mcp_listados',
  'sesiones_revocadas',
  'telemetria_tareas',
  'personas',
  'personas_propuestas',
  'perfil_empresa',
  'perfil_costes',
  'perfil_empresa_propuesta',
  'organizaciones',
  'cola_marcas',
  'trabajos_lanzamientos',
  'empresa_documentos',
  'cpv',
  'licitacion_cpv',
  'lotes',
  'usuarios',
  'busquedas_guardadas',
]);
// Los índices de texto (FTS5) y sus tablas internas, que SQLite no deja tocar a mano: no guardan rutas.
const ES_INDICE_DE_TEXTO = (t: string) => t.includes('_fts') || t === 'busca_texto' || t.startsWith('busca_texto_');

function columnasDeTexto(db: Db): [string, string][] {
  const out: [string, string][] = [];
  for (const esquema of ['main', 'nucleo']) {
    const tablas = db
      .prepare(`SELECT name FROM ${esquema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    for (const { name } of tablas.filter((t) => !SIN_RUTAS.has(t.name) && !ES_INDICE_DE_TEXTO(t.name))) {
      const cols = db.prepare('SELECT name, type FROM pragma_table_info(?, ?)').all(name, esquema) as {
        name: string;
        type: string;
      }[];
      for (const c of cols.filter((x) => x.type.toUpperCase() === 'TEXT' || x.type === ''))
        out.push([`${esquema}.${name}`, c.name]);
    }
  }
  return out;
}

// La carpeta exacta o cualquier cosa dentro, también dentro de un JSON. Con Conocimiento, las
// rutas se guardan con y sin raíz (y en .gdocs/): basta quitarla para cubrir todas.
function reescribir(db: Db, columnas: [string, string][], de: string, a: string): number {
  const [viejo, nuevo] = de.startsWith('Conocimiento/') ? [de.slice(13), a.slice(13)] : [de, a];
  let n = 0;
  for (const [tabla, col] of columnas) {
    n += db
      .prepare(
        `UPDATE ${tabla} SET ${col} = CASE WHEN ${col} = @viejo THEN @nuevo WHEN ${col} = 'Conocimiento/' || @viejo THEN 'Conocimiento/' || @nuevo
      ELSE replace(${col}, @viejo || '/', @nuevo || '/') END
      WHERE ${col} = @viejo OR ${col} = 'Conocimiento/' || @viejo OR instr(${col}, @viejo || '/') > 0`,
      )
      .run({ viejo, nuevo }).changes;
  }
  return n;
}

// ── Mover una carpeta ──

type Mover = (de: string, a: string) => Promise<Result<{ id_drive: string | null } | null>>;

const relDe = (ruta: string) => ruta.split('/').slice(1).join('/');
const idEnDrive = (ruta: string) =>
  ruta.startsWith('Salidas/') ? carpetaDeSalidasPorRuta(ruta) : carpetaPorRuta(relDe(ruta));

// En Drive: la carpeta entera con su nombre nuevo. null si ya no está (se movió en otra pasada).
function moverEnDrive(raices: Raices): Mover {
  return async (de, a) => {
    const abs = enDisco(raices, de);
    if (abs && fs.existsSync(abs) && pendienteDeSubir(abs))
      return fail(
        'sin_subir',
        `«${de}» tiene archivos que drive-sync aún no ha subido: se mueve en el siguiente intento.`,
      );
    const id = await idEnDrive(de);
    if (id.error || id.data === null) return id.error ? id : ok(null);
    const padre = await idEnDrive(path.posix.dirname(de));
    const destino = await carpetaPorRuta(relDe(path.posix.dirname(a)), true);
    if (padre.error || destino.error) return (padre.error ? padre : destino) as Result<never>;
    const hijos = await hijosDe(destino.data!);
    if (hijos.error) return hijos;
    if (hijos.data.some((h) => h.name === path.posix.basename(a)))
      return fail('ocupado', `«${a}» ya existe en Drive: no se pisa.`);
    const r = await mover(id.data, padre.data!, destino.data!, path.posix.basename(a));
    return r.error ? r : ok({ id_drive: id.data });
  };
}

// Sin Drive (o en las pruebas): en el disco.
function moverEnDisco(raices: Raices): Mover {
  return async (de, a) => {
    const [origen, destino] = [enDisco(raices, de), enDisco(raices, a)];
    if (!origen || !destino)
      return fail('no_configurado', 'Falta la carpeta de Salidas o de Conocimiento en el servidor.');
    if (!fs.existsSync(origen)) return ok(null);
    if (fs.existsSync(destino)) return fail('ocupado', `«${a}» ya existe: no se pisa.`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.renameSync(origen, destino);
    return ok({ id_drive: null });
  };
}

// `persistir`: la migración guarda su progreso; Aplicar (una sola licitación) no toca su informe.
type Ctx = {
  db: Db;
  raices: Raices;
  informe: InformeMigracionData;
  mover: Mover;
  columnas: [string, string][];
  persistir: boolean;
};

function guardar(estado: string, informe: InformeMigracionData): void {
  guardarOperacion(nucleo().db, CLAVE_MIGRACION, estado, informe);
}

async function aplicarPaso(ctx: Ctx, l: FilaLicitacion, p: Paso): Promise<Result<null>> {
  const r = await ctx.mover(p.de, p.a);
  if (r.error || r.data === null) return r.error ? r : ok(null);
  ctx.informe.movidas.push({ licitacion: l.id, de: p.de, a: p.a, id_drive: r.data.id_drive });
  if (ctx.persistir) guardar('en_curso', ctx.informe);
  const filas = reescribir(ctx.db, ctx.columnas, p.de, p.a);
  if (p.de.startsWith('Conocimiento/')) await moverFuentesPropuestas(relDe(p.de), relDe(p.a));
  log.info('carpeta movida a la carpeta única', { licitacion: l.id, de: p.de, a: p.a, filas });
  return ok(null);
}

/** Mueve lo de una licitación a su carpeta única y la apunta. Un fallo la deja sin apuntar (se reintenta). */
async function migrarLicitacion(ctx: Ctx, l: FilaLicitacion): Promise<Result<null>> {
  const destino = destinoDe(ctx.db, l);
  for (const p of pasosDe(ctx.db, l)) {
    const r = await aplicarPaso(ctx, l, p);
    if (r.error) return r;
  }
  // Aunque no tuviera nada que mover, la carpeta existe (Aplicar la crea).
  if (driveConectado()) {
    const c = await carpetaPorRuta(destino, true);
    if (c.error) return c;
  } else {
    const abs = enDisco(ctx.raices, `Conocimiento/${destino}`);
    if (abs) fs.mkdirSync(abs, { recursive: true });
  }
  apuntarCarpetaUnica(ctx.db, l.id, destino);
  // Lo presentado es ya su carpeta única: si faltaba crear la de Presentadas, no se crea.
  ctx.db
    .prepare("UPDATE carpetas_presentadas SET ruta = ?, estado = 'hecha', error = NULL WHERE licitacion_id = ?")
    .run(destino, l.id);
  emitir(ctx.db, {
    tipo: 'licitacion.carpeta_unica',
    dominio: 'licitaciones',
    recurso: l.id,
    datos: { ruta: destino },
  });
  return ok(null);
}

// ── Copia previa ──

async function copiaPrevia(db: Db): Promise<string> {
  const dir = path.join(
    nucleo().config.dataDir,
    'copias',
    `carpeta-unica-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  await db.backup(path.join(dir, 'licitaciones.db'));
  await nucleo().db.backup(path.join(dir, 'nucleo.db'));
  return dir;
}

function trabajosLanzados(): number {
  return (nucleo().db.prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE estado = 'lanzado'").get() as { n: number })
    .n;
}

function contexto(db: Db, raices: Raices, informe: InformeMigracionData, persistir: boolean): Ctx {
  return {
    db,
    raices,
    informe,
    persistir,
    mover: driveConectado() ? moverEnDrive(raices) : moverEnDisco(raices),
    columnas: columnasDeTexto(db),
  };
}

async function migrarTodas(ctx: Ctx, raices: Raices): Promise<void> {
  for (const l of candidatas(ctx.db, raices).licitaciones.filter((x) => !carpetaUnicaEnDb(ctx.db, x.id))) {
    const r = await migrarLicitacion(ctx, l);
    if (r.error) ctx.informe.errores.push({ licitacion: l.id, motivo: r.error.message });
    else ctx.informe.hechas.push(l.id);
    guardar('en_curso', ctx.informe);
  }
}

let enMarcha: Promise<EstadoMigracion> | null = null;

async function migrarYa(raices: Raices): Promise<EstadoMigracion> {
  const db = dbLicitaciones();
  const informe = InformeMigracion.parse({ empezada_en: new Date().toISOString() });
  informe.copia = await copiaPrevia(db);
  guardar('en_curso', informe);
  const ctx = contexto(db, raices, informe, true);
  await migrarTodas(ctx, raices);
  const json = JSON.stringify({ movidas: informe.movidas, errores: informe.errores }, null, 2);
  fs.writeFileSync(path.join(informe.copia, 'manifiesto.json'), `${json}\n`);
  informe.mensaje = `${informe.hechas.length} licitaciones en su carpeta única, ${informe.movidas.length} carpetas movidas, ${informe.errores.length} con error.`;
  guardar(informe.errores.length ? 'error' : 'hecha', informe);
  return leerMigracion();
}

/**
 * Lanza la migración (o la repite con lo que falta: lo migrado no se toca). Se niega con trabajos
 * de Hermes en marcha, que escriben en las carpetas que se mueven.
 */
export function migrarCarpetaUnica(raices: Raices = raicesActuales()): Result<Promise<EstadoMigracion>> {
  if (enMarcha) return ok(enMarcha);
  const lanzados = trabajosLanzados();
  if (lanzados)
    return fail(
      'conflicto',
      `Hay ${lanzados} trabajos de Hermes en marcha: espera a que terminen y vuelve a lanzarla.`,
    );
  enMarcha = migrarYa(raices)
    .catch((err: unknown) => {
      log.error('migración a la carpeta única fallida', { error: errorMessage(err) });
      guardar('error', { ...leerMigracion(), mensaje: `Falló: ${errorMessage(err)}` });
      return leerMigracion();
    })
    .finally(() => {
      enMarcha = null;
    });
  return ok(enMarcha);
}

/** Tras la migración, una oferta que entra en preparación nace con su carpeta única (Aplicar). */
export async function asegurarCarpetaUnica(id: string, raices: Raices = raicesActuales()): Promise<Result<null>> {
  const db = dbLicitaciones();
  const l = obtenerLicitacion(db, id);
  if (!l || !migracionLanzada() || carpetaUnicaEnDb(db, id)) return ok(null);
  const ctx = contexto(db, raices, InformeMigracion.parse({}), false);
  const r = await migrarLicitacion(ctx, l);
  if (r.error) log.warn('carpeta única sin crear', { licitacion: id, error: r.error.code });
  return r;
}
