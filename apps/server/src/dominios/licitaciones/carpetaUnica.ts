// Plan de la carpeta única por licitación y su ensayo en seco (docs/operacion.md, «Carpeta de cada licitación»).
import fs from 'node:fs';
import path from 'node:path';
import { limpiarNombre } from '../../nucleo/nombres.js';
import { raicesActuales, type Raices } from '../../nucleo/salidas.js';
import { carpetaDe } from './carpetas.js';
import { CARPETA_OFERTAS, carpetaUnicaEnDb, SUBCARPETAS_UNICA } from './carpetasUnicas.js';
import { tituloCorto } from './pipeline.js';
import { CARPETA_PLIEGOS, SUBCARPETAS, rutaPresentada } from './presentadas.js';
import { carpetaEnSalidas } from './propuestas/borrador.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from './store.js';

export { CARPETA_OFERTAS };
const MAX_NOMBRE = 100;
const ES_DE_LICITACION = / \(([pa]-[A-Za-z0-9_-]{1,30})\)$/;

/** Un movimiento de carpeta: `de` con su raíz («Conocimiento/…» o «Salidas/…»), `a` en Conocimiento. */
export type Paso = { de: string; a: string };
type PasoContado = Paso & { archivos: number; bytes: number };
type EnsayoLicitacion = {
  id: string;
  expediente: string;
  destino: string;
  pasos: PasoContado[];
  filas: number;
  avisos: string[];
};
export type Ensayo = {
  generado_en: string;
  sin_disco: string | null;
  licitaciones: EnsayoLicitacion[];
  sin_licitacion: string[];
  totales: { licitaciones: number; pasos: number; archivos: number; bytes: number; filas: number; avisos: number };
};

/** «<expediente> · <título corto> (<id>)», hasta 100 caracteres con el id siempre entero. */
export function nombreCarpetaUnica(l: Pick<FilaLicitacion, 'id' | 'expediente' | 'titulo'>): string {
  const expediente = limpiarNombre(l.expediente.replace(/\//g, '-'), 30) || 'sin-expediente';
  const cola = ` (${l.id})`;
  const cabe = Math.max(10, MAX_NOMBRE - cola.length - expediente.length - 3);
  const titulo = limpiarNombre(tituloCorto(l.titulo, cabe).replace(/…$/, ''), cabe);
  return `${expediente} · ${titulo}${cola}`;
}

// Cada licitación del Pipeline (o con carpeta de presentada o de Salidas) pasa a
// Licitaciones/Ofertas/<expediente> · <título corto> (<id>)/: la carpeta del radar (o PLIEGOS de la presentada)
// a Pliegos/, DOCUMENTACION PRESENTADA y OTROS DOCUMENTOS a Presentada/, su carpeta de Salidas a Oferta/ y,
// dentro, PRESENTACION a Sobres/. El ensayo solo lee el disco (drive-sync lo tiene al día) y la base; la
// migración (migracionCarpetaUnica.ts) sigue el mismo plan.
/** La carpeta única de una licitación (relativa a Conocimiento): la guardada o la que le toca. */
export function destinoDe(db: Db, l: FilaLicitacion): string {
  return carpetaUnicaEnDb(db, l.id) ?? `${CARPETA_OFERTAS}/${nombreCarpetaUnica(l)}`;
}

// Las carpetas donde están sus pliegos y documentos (pueden ser varias si cambió el año); sin
// ninguno guardado, la del radar.
function carpetasDePliegos(db: Db, l: FilaLicitacion): string[] {
  const filas = db
    .prepare(
      `SELECT ruta FROM pliegos WHERE licitacion_id = ? AND ruta IS NOT NULL
    UNION ALL SELECT ruta FROM documentos_licitacion WHERE licitacion_id = ? AND ruta IS NOT NULL`,
    )
    .all(l.id, l.id) as { ruta: string }[];
  const dirs = [...new Set(filas.map((f) => path.posix.dirname(f.ruta)))];
  return dirs.length ? dirs : [carpetaDe(l)];
}

// De la presentada, cada subcarpeta a su sitio; sin ella, la primera carpeta de pliegos a
// Pliegos/ y las demás dentro, con su nombre.
function pasosConocimiento(db: Db, l: FilaLicitacion, destino: string): Paso[] {
  const { pliegos, presentada: aPresentada } = SUBCARPETAS_UNICA;
  const presentada = rutaPresentada(db, l.id);
  if (presentada && !presentada.startsWith(`${destino}`)) {
    const pares: [string, string][] = [
      [CARPETA_PLIEGOS, pliegos],
      [SUBCARPETAS[0], aPresentada],
      [SUBCARPETAS[1], `${aPresentada}/Otros documentos`],
    ];
    return pares.map(([de, a]) => ({ de: `Conocimiento/${presentada}/${de}`, a: `Conocimiento/${destino}/${a}` }));
  }
  return carpetasDePliegos(db, l).map((dir, i) => ({
    de: `Conocimiento/${dir}`,
    a: `Conocimiento/${destino}/${pliegos}${i === 0 ? '' : `/${path.posix.basename(dir)}`}`,
  }));
}

/** Los movimientos de una licitación, en orden. Lo que ya está dentro de su carpeta única no se mueve. */
export function pasosDe(db: Db, l: FilaLicitacion): Paso[] {
  const destino = destinoDe(db, l);
  const oferta = `Conocimiento/${destino}/${SUBCARPETAS_UNICA.oferta}`;
  const pasos = [
    ...pasosConocimiento(db, l, destino),
    { de: carpetaEnSalidas(l), a: oferta },
    { de: `${oferta}/PRESENTACION`, a: `Conocimiento/${destino}/${SUBCARPETAS_UNICA.sobres}` },
  ];
  return pasos.filter((p) => !p.de.startsWith(`Conocimiento/${destino}/`) || p.de === `${oferta}/PRESENTACION`);
}

/** Ruta en el disco de una ruta con raíz («Salidas/…» o «Conocimiento/…»). */
export function enDisco(raices: Raices, ruta: string): string | null {
  const [raiz, ...resto] = ruta.split('/');
  const base = raiz === 'Salidas' ? raices.salidas : raiz === 'Conocimiento' ? raices.conocimiento : null;
  return base ? path.join(base, ...resto) : null;
}

function contar(abs: string | null): { archivos: number; bytes: number } | null {
  const stat = abs ? fs.statSync(abs, { throwIfNoEntry: false }) : undefined;
  if (!abs || !stat) return null;
  if (stat.isFile()) return { archivos: 1, bytes: stat.size };
  let archivos = 0;
  let bytes = 0;
  const pendientes = [abs];
  while (pendientes.length) {
    const dir = pendientes.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) pendientes.push(path.join(dir, e.name));
      else if (e.isFile()) {
        archivos++;
        bytes += fs.statSync(path.join(dir, e.name)).size;
      }
    }
  }
  return { archivos, bytes };
}

// Columnas con rutas de una licitación (nombres fijos del código), para contar lo que cambiaría.
const COLUMNAS: readonly [string, string][] = [
  ['pliegos', 'ruta'],
  ['documentos_licitacion', 'ruta'],
  ['carpetas_presentadas', 'ruta'],
  ['aprendizajes', 'carpeta'],
  ['aprendizajes', 'documento'],
  ['evaluaciones', 'documento'],
  ['borradores', 'ruta'],
  ['borradores', 'ruta_pdf'],
  ['borradores', 'ruta_md'],
  ['borradores', 'ruta_json'],
  ['oferta_documentos', 'ruta'],
  ['oferta_documentos', 'ruta_pdf'],
  ['oferta_documentos', 'anexo_modelo'],
  ['paquetes_presentacion', 'ruta'],
  ['paquetes_presentacion', 'copia_ruta'],
  ['deuc_respuestas', 'ruta'],
  ['modelos_pdf', 'ruta'],
  ['memoria_dossiers', 'ruta_md'],
  ['memoria_estrategias', 'ruta_md'],
  ['revisiones_previas', 'ruta_md'],
  ['nucleo.documentos', 'ruta'],
];

function columnasExistentes(db: Db): [string, string][] {
  return COLUMNAS.filter(([tabla, columna]) => {
    const [esquema, nombre] = tabla.includes('.') ? tabla.split('.') : ['main', tabla];
    const info = db.prepare('SELECT name FROM pragma_table_info(?, ?)').all(nombre, esquema) as { name: string }[];
    return info.some((c) => c.name === columna);
  });
}

/** Cuántas filas guardadas apuntan dentro de `carpeta` (con raíz; las de Conocimiento, también sin ella). */
function filasQueApuntan(db: Db, columnas: [string, string][], carpeta: string): number {
  const variantes = carpeta.startsWith('Conocimiento/') ? [carpeta, carpeta.slice('Conocimiento/'.length)] : [carpeta];
  let n = 0;
  for (const [tabla, columna] of columnas) {
    for (const v of variantes) {
      n += (
        db
          .prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE substr(${columna}, 1, length(?) + 1) = ? || '/'`)
          .get(v, v) as { n: number }
      ).n;
    }
  }
  return n;
}

type Ctx = { db: Db; raices: Raices; columnas: [string, string][] };

function ensayoDe(ctx: Ctx, l: FilaLicitacion): EnsayoLicitacion {
  const destino = destinoDe(ctx.db, l);
  const pasos = pasosDe(ctx.db, l).flatMap((p) => {
    const c = contar(enDisco(ctx.raices, p.de));
    return c ? [{ ...p, ...c }] : [];
  });
  const avisos: string[] = [];
  if (!carpetaUnicaEnDb(ctx.db, l.id) && fs.existsSync(enDisco(ctx.raices, `Conocimiento/${destino}`) ?? '')) {
    avisos.push(`El destino «${destino}» ya existe: se completaría sin pisar nada.`);
  }
  if (!pasos.length && !carpetaUnicaEnDb(ctx.db, l.id))
    avisos.push('No tiene nada en el disco todavía: la carpeta se crearía vacía.');
  const filas = pasos.reduce((n, p) => n + filasQueApuntan(ctx.db, ctx.columnas, p.de), 0);
  return { id: l.id, expediente: l.expediente, destino, pasos, filas, avisos };
}

// Carpetas de Salidas/Licitaciones con el id de la licitación al final.
function idsEnSalidas(raices: Raices): Map<string, string> {
  const abs = enDisco(raices, 'Salidas/Licitaciones');
  if (!abs || !fs.existsSync(abs)) return new Map();
  return new Map(
    fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => [ES_DE_LICITACION.exec(e.name)?.[1] ?? '', `Salidas/Licitaciones/${e.name}`] as [string, string])
      .filter(([id]) => id !== ''),
  );
}

/** Las que tendrán carpeta única: las del Pipeline, las presentadas y las que tienen algo en Salidas. */
export function candidatas(db: Db, raices: Raices): { licitaciones: FilaLicitacion[]; sin_licitacion: string[] } {
  const filas = db
    .prepare(
      `SELECT licitacion_id AS id FROM oportunidades WHERE estado IN ('en_preparacion', 'presentada', 'ganada', 'perdida')
    UNION SELECT licitacion_id FROM carpetas_presentadas WHERE ruta IS NOT NULL`,
    )
    .all() as { id: string }[];
  const enSalidas = idsEnSalidas(raices);
  const ids = [...new Set([...filas.map((f) => f.id), ...enSalidas.keys()])];
  const licitaciones = ids.map((id) => obtenerLicitacion(db, id)).filter((l): l is FilaLicitacion => l !== null);
  const conocidas = new Set(licitaciones.map((l) => l.id));
  return { licitaciones, sin_licitacion: [...enSalidas].filter(([id]) => !conocidas.has(id)).map(([, ruta]) => ruta) };
}

function totales(lista: EnsayoLicitacion[]): Ensayo['totales'] {
  const pasos = lista.flatMap((l) => l.pasos);
  return {
    licitaciones: lista.length,
    pasos: pasos.length,
    archivos: pasos.reduce((n, p) => n + p.archivos, 0),
    bytes: pasos.reduce((n, p) => n + p.bytes, 0),
    filas: lista.reduce((n, l) => n + l.filas, 0),
    avisos: lista.reduce((n, l) => n + l.avisos.length, 0),
  };
}

/** El ensayo en seco de la migración a la carpeta única. Solo lee. Lo ya migrado no sale. */
export function ensayoCarpetaUnica(db: Db, raices: Raices = raicesActuales(), ahora = new Date()): Ensayo {
  const sinDisco = !raices.conocimiento
    ? 'No hay carpeta de Conocimiento en el disco: conecta Drive en Ajustes › Drive.'
    : null;
  const ctx: Ctx = { db, raices, columnas: columnasExistentes(db) };
  const c = candidatas(db, raices);
  const lista = c.licitaciones.map((l) => ensayoDe(ctx, l)).filter((e) => e.pasos.length || e.avisos.length);
  return {
    generado_en: ahora.toISOString(),
    sin_disco: sinDisco,
    licitaciones: lista,
    sin_licitacion: c.sin_licitacion,
    totales: totales(lista),
  };
}
