// La versión editada a mano que no encaja en subida.ts (un PDF o un Word con otra estructura): se guarda entera.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paginasDe } from '../../../nucleo/documentos/paginas.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, type Raices } from '../../../nucleo/salidas.js';
import type { ArchivoRecibido } from '../../../nucleo/subidas.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import { avisoDescartadas, descartarVersionesSinRevisar } from '../propuestas/revision.js';
import type { Db } from '../store.js';
import { autoevaluar, filaMemoria, nombreLibre } from './ensamblado.js';
import { avisosDeFugas, contextoFugasDe, fugasDeApartados, fugasDeTexto } from './fugasMemoria.js';
import type { GuionGuardado } from './guion.js';
import { pedirLecciones } from './lecciones.js';
import { baseDependencias, dependenciasDeTexto } from './memoria.js';
import { comprobarFirma, leerDocx, leerPdf, type Lectura } from './memoriaPresentada.js';
import {
  caracteresDe,
  CARACTERES_POR_PAGINA,
  paginasEstimadasDe,
  textoDeBloque,
  type ApartadoDatosData,
} from './memoriaRevision.js';
import { apartadosDeTexto, localizarTitulos } from './memoriaTexto.js';
import type { MemoriaSubida } from './subida.js';
import { parrafosDeElementos, parrafosDeVersionEntera, textoSinApartado } from './textoEntero.js';

// Retitularlo no es una opción (se presenta así), así que no se rechaza: se guarda entera como la presentada
// (memoriaPresentada.ts, de la que reutiliza la lectura y la firma): el archivo tal cual en
// Salidas, su texto en .md (con [pág. N] si es PDF o se pudo convertir) y sus párrafos en .json,
// marcada sin_repartir. Se revisa, se evalúa sobre el texto entero y enseña lecciones (texto
// contra la última de Hermes, lecciones.ts), pero Hermes no la rehace, como ninguna subida a mano
// (actualizarMemoria.ts). Un PDF con algunos títulos sí se reparte, a medias: lo que va antes del primer
// título queda «sin apartado». Un Word con algún título sigue en subida.ts, con sus imágenes.

// Se guarda sin repartir por apartados.
const log = logger('licitaciones.memoria');

export const AVISO_SIN_REPARTIR =
  'Guardada entera: no se encontraron los títulos del guion; «Pedir cambios» por apartado no está disponible para esta versión.';

// lote: de qué lote es la versión si el pliego pide una memoria por lote (memoriaLote.ts); null = común.
export type BaseSubida = {
  l: { id: string; expediente: string };
  guion: GuionGuardado;
  version: number;
  anterior: number | null;
  anteriorId: number | null;
  lote: string | null;
};
export type SubidaFlexible = MemoriaSubida & { sin_repartir: boolean };
// paginasTexto: el texto por páginas para el .md (de una pieza si no se pudo paginar).
type Leida = { lectura: Lectura; pdf: Buffer | null; paginas: number | null; paginasTexto: string[] };
type Reparto = { datos: (ApartadoDatosData | null)[]; avisos: string[]; sinApartado: string | null } | null;
type Rutas = { ruta: string; ruta_pdf: string | null; ruta_md: string; ruta_json: string };
type Registro = {
  a: ArchivoRecibido;
  t: Reparto;
  avisos: string[];
  rutas: Rutas;
  paginas: number | null;
  notas: string | null;
};

const titulosDe = (b: BaseSubida) => b.guion.datos.memoria!.apartados.map((x) => x.titulo);

// null: es un Word con algún título del guion y lo sube subida.ts como siempre.
async function leer(a: ArchivoRecibido, titulos: string[]): Promise<Result<Leida> | null> {
  if (path.extname(a.nombre).toLowerCase() === '.pdf') {
    const lectura = await leerPdf(a.datos, titulos);
    return ok({ lectura, pdf: null, paginas: lectura.numPaginas, paginasTexto: lectura.paginas });
  }
  const word = leerDocx(a.datos);
  if (word.error) return word;
  if (localizarTitulos(word.data.elementos, titulos).some((x) => x !== null)) return null;
  const conv = await paginasDe(a.datos);
  if (conv.error) return ok({ lectura: word.data, pdf: null, paginas: null, paginasTexto: word.data.paginas });
  return ok({ lectura: word.data, pdf: conv.data.pdf, paginas: conv.data.paginas, paginasTexto: conv.data.porPagina });
}

function repartir(l: Lectura, titulos: string[]): Reparto {
  if (!l.elementos.length || !localizarTitulos(l.elementos, titulos).some((x) => x !== null)) return null;
  return { ...apartadosDeTexto(l.elementos, titulos), sinApartado: textoSinApartado(l.elementos, titulos) };
}

// Entera, las fugas no se pueden situar en un apartado: se buscan en sus párrafos, los mismos
// que guarda el .json y lee fugasDeMemoria al darla por buena.
function avisosDe(db: Db, b: BaseSubida, l: Lectura, t: Reparto): string[] {
  const ctx = contextoFugasDe(db, b.guion);
  const fugas = avisosDeFugas(
    t ? fugasDeApartados(b.guion, t.datos, ctx) : fugasDeTexto(parrafosDeElementos(l.elementos).join('\n'), ctx),
  );
  return [l.aviso, t ? null : AVISO_SIN_REPARTIR, ...fugas, ...(t?.avisos ?? [])].filter(
    (x): x is string => x !== null,
  );
}

function markdown(b: BaseSubida, nombre: string, x: Leida, t: Reparto): string {
  const cabecera = [
    `# Memoria técnica v${b.version}${b.lote ? ` · lote ${b.lote}` : ''}`,
    '',
    `Subida a mano («${nombre}»)${t ? '' : ', guardada entera: no trae los títulos de los apartados del guion'}.`,
    '',
  ];
  if (!t) {
    const cuerpo =
      x.lectura.texto === null
        ? ['[Sin texto: el archivo no lo deja sacar.]']
        : x.paginasTexto.map((p, i) => (x.paginasTexto.length > 1 ? `[pág. ${i + 1}]\n\n${p}` : p));
    return [...cabecera, ...cuerpo].join('\n');
  }
  const apartados = b.guion.datos.memoria!.apartados.flatMap((a, i) => {
    const d = t.datos[i];
    return [
      `## ${i + 1}. ${a.titulo}`,
      '',
      d ? d.bloques.map(textoDeBloque).join('\n\n') : '[No se encontró en el documento subido]',
      '',
    ];
  });
  const sinApartado = t.sinApartado ? ['## Sin apartado', '', t.sinApartado] : [];
  return [...cabecera, ...apartados, ...sinApartado].join('\n');
}

// Con su extensión (un PDF va como .pdf): memoria-vN.pdf o .docx, y sus hermanos .md y .json.
function escribirArchivos(
  raices: Raices,
  b: BaseSubida,
  a: ArchivoRecibido,
  x: Leida,
  md: string,
  json: string,
): Result<Rutas> {
  const carpeta = carpetaSalidas(b.l);
  const dir = documentoEnDisco(raices, carpeta);
  if (dir.error) return dir;
  fs.mkdirSync(dir.data, { recursive: true });
  const base = nombreLibre(dir.data, b.version, '');
  const poner = (ext: string, contenido: Buffer | string) => {
    fs.writeFileSync(path.join(dir.data, base + ext), contenido, { flag: 'wx' });
    return `${carpeta}/${base}${ext}`;
  };
  const ruta = poner(path.extname(a.nombre).toLowerCase(), a.datos);
  return ok({
    ruta,
    ruta_pdf: x.pdf ? poner('.pdf', x.pdf) : null,
    ruta_md: poner('.md', md),
    ruta_json: poner('.json', json),
  });
}

// Repartida a medias, como en subida.ts: editado = 1 (una regeneración no la pisa sin avisar) y
// sus dependencias, para que «qué rehace un cambio» sepa a qué apartados toca.
function insertarApartados(db: Db, b: BaseSubida, memoria: number, t: Reparto, ahora: string): void {
  if (!t) return;
  const ins =
    db.prepare(`INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, paginas_estimadas, agente, recibido_en, error, dependencias, editado)
    VALUES (?, ?, ?, ?, ?, ?, 'persona', ?, ?, ?, 1)`);
  const base = baseDependencias(db, b.guion);
  t.datos.forEach((d, i) => {
    const c = d ? caracteresDe(d.bloques) : null;
    const deps = d ? dependenciasDeTexto(base, b.guion, i + 1, d) : null;
    ins.run(
      memoria,
      i + 1,
      d ? 'recibido' : 'fallido',
      d ? JSON.stringify(d) : null,
      c,
      c === null ? null : paginasEstimadasDe(c),
      ahora,
      d ? null : 'No se encontró en el documento subido.',
      JSON.stringify(deps ?? {}),
    );
  });
}

function resumenDe(b: BaseSubida, r: Registro): string {
  const que = `Memoria técnica v${b.version} subida a mano («${r.a.nombre}»)`;
  if (!r.t) return `${que}, entera: sin los títulos de los apartados del guion.`;
  return `${que}: ${r.t.datos.filter(Boolean).length} de ${r.t.datos.length} apartados reconocidos.`;
}

// La versión, sus apartados (si se repartió) y su borrador, juntos, como en subida.ts.
function registrar(db: Db, b: BaseSubida, r: Registro): { memoria: number; borrador: number; descartadas: number[] } {
  const ahora = new Date().toISOString();
  const datos = r.t?.datos ?? [];
  const estimadas = datos.length
    ? Math.round((datos.reduce((n, d) => n + (d ? caracteresDe(d.bloques) : 0), 0) / CARACTERES_POR_PAGINA) * 10) / 10
    : null;
  return db.transaction(() => {
    const memoria = Number(
      db
        .prepare(
          `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, avisos, version_base, apartados_rehechos, subida, notas_subida, sin_repartir, lote)
      VALUES (?, ?, ?, 'ensamblada', ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
        )
        .run(
          b.l.id,
          b.guion.id,
          b.version,
          ahora,
          ahora,
          JSON.stringify(r.avisos),
          b.anterior,
          r.a.nombre,
          r.notas,
          r.t ? 0 : 1,
          b.lote,
        ).lastInsertRowid,
    );
    insertarApartados(db, b, memoria, r.t, ahora);
    const borrador = Number(
      db
        .prepare(
          `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, memoria_id,
        paginas_estimadas, paginas, ruta_pdf, ruta_md, ruta_json) VALUES (?, ?, ?, ?, ?, 'persona', ?, 'ensamblado', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          b.l.id,
          r.rutas.ruta,
          crypto.createHash('sha256').update(r.a.datos).digest('hex'),
          r.a.datos.length,
          resumenDe(b, r),
          ahora,
          b.guion.id,
          b.version,
          memoria,
          estimadas,
          r.paginas,
          r.rutas.ruta_pdf,
          r.rutas.ruta_md,
          r.rutas.ruta_json,
        ).lastInsertRowid,
    );
    const descartadas = descartarVersionesSinRevisar(db, b.l.id, borrador, b.version);
    const dicho = avisoDescartadas(b.version, descartadas);
    db.prepare('UPDATE memorias SET borrador_id = ?, avisos = ? WHERE id = ?').run(
      borrador,
      JSON.stringify(dicho ? [...r.avisos, dicho] : r.avisos),
      memoria,
    );
    return { memoria, borrador, descartadas };
  })();
}

// Como en subida.ts: con una versión anterior con texto (entera, se compara texto contra texto) o con la nota.
function aprender(db: Db, b: BaseSubida, memoria: number, r: Pick<Registro, 't' | 'notas'>): boolean {
  // Entera y sin texto (escaneada) no hay qué comparar: solo la nota.
  const conBase =
    b.anteriorId !== null &&
    Boolean(
      db.prepare("SELECT 1 FROM memoria_apartados WHERE memoria_id = ? AND estado = 'recibido'").get(b.anteriorId),
    ) &&
    (r.t !== null || parrafosDeVersionEntera(db, memoria).length > 0);
  if (!conBase && !r.notas) return false;
  try {
    // Null: la oferta ya llegó a su tope de lecciones del día y no se encoló nada.
    return (
      pedirLecciones(
        nucleo().db,
        { id: memoria, licitacion_id: b.l.id, version: b.version },
        conBase ? b.anteriorId : null,
      ) !== null
    );
  } catch (err) {
    log.warn('lecciones sin pedir', { licitacion: b.l.id, version: b.version, error: errorMessage(err).slice(0, 200) });
    return false;
  }
}

function guardar(db: Db, b: BaseSubida, r: Registro, conTexto: boolean): Result<SubidaFlexible> {
  let g: { memoria: number; borrador: number; descartadas: number[] };
  try {
    g = registrar(db, b, r);
  } catch (err) {
    log.error('memoria subida sin registrar', {
      licitacion: b.l.id,
      version: b.version,
      error: errorMessage(err).slice(0, 200),
    });
    return fail(
      'conflicto',
      'No se pudo registrar la versión (¿se subió otra a la vez?): recarga y vuelve a intentarlo.',
    );
  }
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: b.l.id,
    datos: { accion: 'subida', version: b.version, ...(b.lote ? { lote: b.lote } : {}) },
  });
  emitir(db, {
    tipo: 'licitacion.borrador',
    dominio: 'licitaciones',
    recurso: b.l.id,
    datos: { agente: 'persona', borrador: g.borrador },
  });
  // Sin texto (un PDF escaneado) no hay nada que puntuar.
  if (conTexto) autoevaluar(db, filaMemoria(db, g.memoria)!, r.rutas.ruta);
  const reconocidos = (r.t?.datos ?? []).filter(Boolean).length;
  return ok({
    ...g,
    version: b.version,
    ruta: r.rutas.ruta,
    reconocidos,
    total: titulosDe(b).length,
    paginas: r.paginas,
    avisos: r.avisos,
    aprende: aprender(db, b, g.memoria, r),
    sin_repartir: r.t === null,
    lote: b.lote,
  });
}

/**
 * Sube un PDF o un Word sin los títulos del guion como la versión siguiente (entera o repartida a
 * medias). null si es un Word con algún título: lo sube subirMemoria como siempre.
 */
export async function subidaFlexible(
  db: Db,
  b: BaseSubida,
  a: ArchivoRecibido,
  raices: Raices,
): Promise<Result<SubidaFlexible> | null> {
  const firma = comprobarFirma(a);
  if (firma.error) return firma;
  const titulos = titulosDe(b);
  const x = await leer(a, titulos);
  if (x === null || x.error) return x;
  const t = repartir(x.data.lectura, titulos);
  const json = JSON.stringify(
    {
      licitacion: b.l.id,
      version: b.version,
      lote: b.lote,
      subida: a.nombre,
      sin_repartir: t === null,
      apartados: t?.datos ?? null,
      sin_apartado: t?.sinApartado ?? null,
      parrafos: parrafosDeElementos(x.data.lectura.elementos),
    },
    null,
    2,
  );
  const rutas = escribirArchivos(raices, b, a, x.data, markdown(b, a.nombre, x.data, t), json);
  if (rutas.error) return rutas;
  const notas = (a.campos['notas'] ?? '').trim() || null;
  return guardar(
    db,
    b,
    { a, t, avisos: avisosDe(db, b, x.data.lectura, t), rutas: rutas.data, paginas: x.data.paginas, notas },
    x.data.lectura.texto !== null,
  );
}
