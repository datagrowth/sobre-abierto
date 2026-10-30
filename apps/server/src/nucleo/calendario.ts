// Calendario de plazos por persona: un feed ICS en /cal/<token>.ics que se suscribe desde Google Calendar u Outlook.
import crypto from 'node:crypto';
import { nucleo } from './contexto.js';
import type { Db } from './db.js';
import { fail, ok, type Result } from './result.js';
import { enlaceWeb } from './correoPlantillas.js';
import { leerMarca } from './marca.js';

// Va sin sesión (el calendario no la tiene), así que solo lleva datos públicos: título, órgano y plazo. Los
// plazos van con TZID=Europe/Madrid y su VTIMEZONE, y cada calendario los enseña en su hora (península,
// Canarias…) sin hacer cuentas. El token sale una vez al crearlo; se guarda su hash, y revocarlo (o crear otro)
// lo invalida al momento.
const hashDe = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type EstadoCalendario = { activo: boolean; creado_en: string | null; ultimo_uso: string | null };

export function estadoCalendario(db: Db, usuarioId: number): EstadoCalendario {
  const f = db.prepare('SELECT creado_en, ultimo_uso FROM calendario_tokens WHERE usuario_id = ?').get(usuarioId) as
    { creado_en: string; ultimo_uso: string | null } | undefined;
  return { activo: Boolean(f), creado_en: f?.creado_en ?? null, ultimo_uso: f?.ultimo_uso ?? null };
}

/** Un enlace nuevo (el de antes deja de valer): el token, solo esta vez. */
export function crearEnlaceCalendario(db: Db, usuarioId: number): { token: string; ruta: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO calendario_tokens (usuario_id, hash, creado_en, ultimo_uso) VALUES (?, ?, ?, NULL)
    ON CONFLICT(usuario_id) DO UPDATE SET hash = excluded.hash, creado_en = excluded.creado_en, ultimo_uso = NULL`,
  ).run(usuarioId, hashDe(token), new Date().toISOString());
  return { token, ruta: `/cal/${token}.ics` };
}

export function revocarCalendario(db: Db, usuarioId: number): void {
  db.prepare('DELETE FROM calendario_tokens WHERE usuario_id = ?').run(usuarioId);
}

/** La persona activa de un token, o null; anota el uso. */
export function personaDelToken(db: Db, token: string): number | null {
  if (!TOKEN.test(token)) return null;
  const f = db
    .prepare(
      'SELECT t.usuario_id FROM calendario_tokens t JOIN usuarios u ON u.id = t.usuario_id AND u.activo = 1 WHERE t.hash = ?',
    )
    .get(hashDe(token)) as { usuario_id: number } | undefined;
  if (!f) return null;
  db.prepare('UPDATE calendario_tokens SET ultimo_uso = ? WHERE usuario_id = ?').run(
    new Date().toISOString(),
    f.usuario_id,
  );
  return f.usuario_id;
}

// ─── Los eventos, de cada dominio ────────────────────────────────────────────

/** Un plazo: inicio en hora peninsular sin zona («2026-10-15T08:00:00»), como lo guarda la PLACSP. */
export type EventoCalendario = {
  uid: string;
  titulo: string;
  descripcion: string;
  inicio: string;
  enlace: string | null;
};
type Fuente = (usuarioId: number) => EventoCalendario[];
const fuentes = new Map<string, Fuente>();

export function registrarCalendario(dominio: string, fn: Fuente): void {
  fuentes.set(dominio, fn);
}

// ─── ICS (RFC 5545) ──────────────────────────────────────────────────────────

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Madrid',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Texto de una propiedad: barra, punto y coma, coma y saltos escapados. */
export const escaparIcs = (t: string) =>
  t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Líneas de 75 octetos como mucho, sin partir un carácter UTF-8; las siguientes empiezan por un espacio. */
export function plegar(linea: string): string[] {
  const partes: string[] = [];
  let actual = '';
  let octetos = 0;
  for (const c of linea) {
    const n = Buffer.byteLength(c);
    const max = partes.length ? 74 : 75;
    if (octetos + n > max) {
      partes.push(actual);
      actual = '';
      octetos = 0;
    }
    actual += c;
    octetos += n;
  }
  partes.push(actual);
  return partes.map((p, i) => (i ? ` ${p}` : p));
}

const local = (iso: string) => iso.slice(0, 19).replace(/[-:]/g, '');
const masMediaHora = (iso: string) => {
  const t = new Date(`${iso.slice(0, 19)}Z`).getTime() + 30 * 60_000;
  return new Date(t).toISOString().slice(0, 19);
};
const utc = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

// Los UID solo tienen que ser únicos y estables: llevan el dominio de la web, si se conoce.
const dominioUid = (urlWeb: string | null): string => (urlWeb ? new URL(urlWeb).host : 'sobre-abierto');

function evento(e: EventoCalendario, urlWeb: string | null, ahoraMs: number): string[] {
  const url = enlaceWeb(urlWeb, e.enlace);
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}@${dominioUid(urlWeb)}`,
    `DTSTAMP:${utc(ahoraMs)}`,
    `DTSTART;TZID=Europe/Madrid:${local(e.inicio)}`,
    `DTEND;TZID=Europe/Madrid:${local(masMediaHora(e.inicio))}`,
    `SUMMARY:${escaparIcs(e.titulo)}`,
    `DESCRIPTION:${escaparIcs(url ? `${e.descripcion}\n${url}` : e.descripcion)}`,
    ...(url ? [`URL:${url}`] : []),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

/** El calendario de una persona: los plazos que ponen los dominios. */
export function icsDe(usuarioId: number, ahoraMs = Date.now()): string {
  const eventos = [...fuentes.values()]
    .flatMap((fn) => fn(usuarioId))
    .filter((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.inicio));
  const {
    config: { urlWeb },
    db,
  } = nucleo();
  const marca = leerMarca(db);
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escaparIcs(marca.nombre)}//Plazos//ES`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Plazos · ${escaparIcs(marca.nombre)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    ...VTIMEZONE,
    ...eventos.flatMap((e) => evento(e, urlWeb, ahoraMs)),
    'END:VCALENDAR',
  ];
  return `${lineas.flatMap(plegar).join('\r\n')}\r\n`;
}

/** GET /cal/<token>.ics: el ICS de la persona del token, o not_found (sin decir por qué). */
export function calendarioDelToken(db: Db, token: string, ahoraMs = Date.now()): Result<string> {
  const id = personaDelToken(db, token);
  return id === null ? fail('not_found', 'No existe ese calendario.') : ok(icsDe(id, ahoraMs));
}
