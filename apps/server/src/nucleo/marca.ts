// La marca de cada instalación (nombre de la app, colores y logo), que edita un admin en Ajustes › Marca.
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { nucleo } from './contexto.js';
import { ahora, type Db } from './db.js';
import { zonaEmpresa } from './empresa.js';
import type { ZonaHoraria } from './fechas.js';
import { fail, ok, type Result } from './result.js';
import { versionDelPaquete } from './paquete.js';
import { problemasDeContraste, Tema, type TemaData } from './tema.js';

// Vive en nucleo.db: va en la copia de las bases y se cambia sin redesplegar. La web la lee de GET /api/config y
// el logo de GET /api/marca/logo, sin sesión porque la pantalla de acceso ya la enseña; los colores van además
// dentro de la página, para que no se vea el tema neutro un instante.
const NOMBRE_NEUTRO = 'Sobre Abierto';
export const MAX_LOGO = 200 * 1024;
export const EXTENSIONES_LOGO = ['.svg', '.png', '.webp'];
// Sin scripts ni recursos de fuera: un SVG abierto en una pestaña del mismo dominio no ejecuta nada.
export const CSP_SVG = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

type LogoInfo = { tipo: string; hash: string };
export type Marca = { nombre: string; tema: TemaData; logo: LogoInfo | null; actualizado_en: string | null };
type ConfigWeb = {
  nombre: string;
  logo: string | null;
  fuente: string | null;
  version: string | null;
  zona_horaria: ZonaHoraria;
};

const MarcaEntrada = z.strictObject({ nombre: z.string().trim().min(1).max(60), tema: Tema.default({}) });

type Fila = {
  nombre: string;
  tema: string;
  logo_tipo: string | null;
  logo_hash: string | null;
  actualizado_en: string;
};

/** La marca guardada o, sin fila, la neutra. Un tema que ya no valida se ignora entero. */
export function leerMarca(db: Db): Marca {
  const f = db.prepare('SELECT nombre, tema, logo_tipo, logo_hash, actualizado_en FROM marca WHERE id = 1').get() as
    Fila | undefined;
  if (!f) return { nombre: NOMBRE_NEUTRO, tema: {}, logo: null, actualizado_en: null };
  const tema = Tema.safeParse(JSON.parse(f.tema));
  return {
    nombre: f.nombre,
    tema: tema.success ? tema.data : {},
    actualizado_en: f.actualizado_en,
    logo: f.logo_tipo && f.logo_hash ? { tipo: f.logo_tipo, hash: f.logo_hash } : null,
  };
}

/** Nombre y colores; el logo se cambia aparte. Un tema que deja algún texto sin contraste AA no se guarda. */
export function guardarMarca(db: Db, entrada: unknown): Result<Marca> {
  const m = MarcaEntrada.safeParse(entrada);
  if (!m.success) return fail('invalid_input', z.prettifyError(m.error));
  const problemas = problemasDeContraste(m.data.tema);
  if (problemas.length)
    return fail('invalid_input', `Estos colores no se leen bien (WCAG AA): ${problemas.join('; ')}.`);
  db.prepare(
    `INSERT INTO marca (id, nombre, tema, actualizado_en) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, tema = excluded.tema, actualizado_en = excluded.actualizado_en`,
  ).run(m.data.nombre, JSON.stringify(m.data.tema), ahora());
  return ok(leerMarca(db));
}

// El tipo sale del contenido, no del nombre del archivo: un .svg que es otra cosa no pasa.
function tipoDeLogo(datos: Buffer): string | null {
  if (datos.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (datos.subarray(0, 4).toString('latin1') === 'RIFF' && datos.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  const inicio = datos
    .subarray(0, 2048)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(inicio)
    ? 'image/svg+xml'
    : null;
}

/** El logo (svg, png o webp de hasta 200 KB), con su hash para la caché del navegador. */
export function guardarLogo(db: Db, datos: Buffer): Result<Marca> {
  if (!datos.length) return fail('invalid_input', 'El archivo está vacío.');
  if (datos.length > MAX_LOGO) return fail('too_large', 'El logo pasa de 200 KB.');
  const tipo = tipoDeLogo(datos);
  if (!tipo) return fail('invalid_input', 'El logo tiene que ser una imagen SVG, PNG o WebP.');
  const hash = crypto.createHash('sha256').update(datos).digest('hex').slice(0, 16);
  db.prepare(
    `INSERT INTO marca (id, nombre, tema, logo, logo_tipo, logo_hash, actualizado_en) VALUES (1, ?, '{}', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET logo = excluded.logo, logo_tipo = excluded.logo_tipo, logo_hash = excluded.logo_hash, actualizado_en = excluded.actualizado_en`,
  ).run(NOMBRE_NEUTRO, datos, tipo, hash, ahora());
  return ok(leerMarca(db));
}

export function quitarLogo(db: Db): Marca {
  db.prepare('UPDATE marca SET logo = NULL, logo_tipo = NULL, logo_hash = NULL, actualizado_en = ? WHERE id = 1').run(
    ahora(),
  );
  return leerMarca(db);
}

const escaparHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** «:root{--so-accion:#B5FF82;…}», o '' sin tema propio. Los valores ya vienen validados (#RRGGBB). */
export function cssDelTema(tema: TemaData): string {
  const reglas = Object.entries(tema).map(([token, color]) => `--so-${token}:${color}`);
  return reglas.length ? `:root{${reglas.join(';')}}` : '';
}

/** La página de la web con el nombre de la app en la pestaña y los colores propios de la instalación. */
export function paginaConMarca(html: string, marca: Pick<Marca, 'nombre' | 'tema'>): string {
  const css = cssDelTema(marca.tema);
  const conTitulo = html.replace(/<title>[^<]*<\/title>/, `<title>${escaparHtml(marca.nombre)}</title>`);
  return css ? conTitulo.replace('</head>', `<style id="tema-instalacion">${css}</style></head>`) : conTitulo;
}

/** Lo que la web necesita para pintarse: nada de la empresa salvo su zona horaria. */
function configWeb(marca: Marca, fuente: string | null, zona: ZonaHoraria): ConfigWeb {
  return {
    nombre: marca.nombre,
    logo: marca.logo ? `/api/marca/logo?v=${marca.logo.hash}` : null,
    fuente,
    version: versionDelPaquete(),
    zona_horaria: zona,
  };
}

/** GET /api/config. */
export function rutaConfigWeb(_req: Request, res: Response): void {
  const { config, db } = nucleo();
  res.json(configWeb(leerMarca(db), config.fuente, zonaEmpresa(db)));
}

/** GET /api/marca/logo: con ETag (el hash) y sin que el navegador adivine el tipo. */
export function rutaLogo(req: Request, res: Response): void {
  const f = nucleo()
    .db.prepare('SELECT logo, logo_tipo, logo_hash FROM marca WHERE id = 1 AND logo IS NOT NULL')
    .get() as { logo: Buffer; logo_tipo: string; logo_hash: string } | undefined;
  if (!f) {
    res.status(404).end();
    return;
  }
  const etag = `"${f.logo_hash}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (f.logo_tipo === 'image/svg+xml') res.setHeader('Content-Security-Policy', CSP_SVG);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type(f.logo_tipo).send(f.logo);
}
