// Perfil de la empresa (un único registro en nucleo.db): lo que puede acreditar ante un órgano de contratación.
import { z } from 'zod';
import { ahora, type Db } from './db.js';
import { emitir } from './eventos.js';
import { ZONA_PENINSULAR, ZONAS_HORARIAS, type ZonaHoraria } from './fechas.js';
import { FORMA_JURIDICA } from './identidad.js';
import { logger } from './log.js';
import { normalizarNif } from './organizaciones.js';
import { IDIOMAS, type CodigoIdioma } from './idioma.js';
import { fail, ok, type Result } from './result.js';

// También vale ante uno que concede ayudas. Lo comparten todos los dominios; lo guarda una persona en la web. Un
// agente puede proponer uno completo, que queda pendiente hasta que esa persona lo revisa y lo guarda.
// Clasificación empresarial (RGLCAP): grupo (letra), subgrupo (número) y categoría,
// en números (RD 773/2015) o en letras (anterior), p. ej. V-2-C o V-2-3.
const Clasificacion = z.strictObject({
  grupo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]$/, 'grupo: una letra (A–V)'),
  subgrupo: z.number().int().min(1).max(9),
  categoria: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[1-6A-F]$/, 'categoría: 1–6 o A–F'),
});

const Volumen = z.strictObject({
  anio: z.number().int().min(1990).max(2100),
  importe: z.number().finite().nonnegative(),
});

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');

// Certificado de la empresa. El nivel solo lo tiene el ENS (básica, media o alta).
const Certificado = z.strictObject({
  nombre: z.string().trim().min(2).max(80),
  nivel: z.enum(['basica', 'media', 'alta']).nullable().default(null),
  caduca: Fecha.nullable().default(null),
});
export type CertificadoData = z.infer<typeof Certificado>;

const Direccion = z.strictObject({
  calle: z.string().trim().min(2).max(200),
  codigo_postal: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'código postal: 5 cifras'),
  municipio: z.string().trim().min(2).max(120),
  provincia: z.string().trim().min(2).max(80),
});

const sinAniosRepetidos = (v: { anio: number }[]) => new Set(v.map((x) => x.anio)).size === v.length;

const Nif = z
  .string()
  .trim()
  .transform(normalizarNif)
  .pipe(z.string().regex(/^[A-Z0-9]{9}$/, 'NIF de 9 caracteres'));
// El formulario manda «» en un campo que se deja en blanco: cuenta como sin indicar.
const opcional = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable().default(null));

// Quien firma las declaraciones y los anexos en nombre de la empresa, y cómo se la contacta:
// van en los modelos de la oferta (hoja de datos). Nadie firma por ella: solo se rellena.
const Representante = z.strictObject({
  nombre: z.string().trim().min(2).max(200),
  nif: Nif,
  cargo: opcional(z.string().trim().min(2).max(120)),
});
const Contacto = z.strictObject({
  email: opcional(z.email().max(200)),
  telefono: opcional(
    z
      .string()
      .trim()
      .regex(/^\+?[\d\s().-]{9,20}$/, 'teléfono: de 9 a 20 cifras'),
  ),
});

export const PerfilEmpresa = z.strictObject({
  nif: Nif,
  nombre: z.string().trim().min(1).max(200),
  // Va en la portada de las memorias; con valor por defecto para que un perfil guardado antes siga validando.
  domicilio: z.string().trim().max(300).nullable().default(null),
  // Estructurada: al guardar se deriva `domicilio` de ella para quien aún lee el texto.
  direccion: Direccion.nullable().default(null),
  representante: Representante.nullable().default(null),
  contacto: Contacto.nullable().default(null),
  clasificaciones: z.array(Clasificacion).max(60).default([]),
  volumen_negocio: z.array(Volumen).max(15).refine(sinAniosRepetidos, 'un importe por año').default([]),
  certificaciones: z.array(z.string().trim().min(2).max(80)).max(50).default([]),
  // null = sin indicar; [] = «no tenemos ninguno». Al guardar, `certificaciones` se deriva de los nombres.
  certificados: z.array(Certificado).max(50).nullable().default(null),
  seguro_rc: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .default(null)
    .describe('Importe asegurado de responsabilidad civil, en euros'),
  plantilla_media: z.number().int().nonnegative().nullable().default(null),
  anios_actividad: z.number().int().nonnegative().max(300).nullable().default(null),
  cpv_experiencia: z
    .array(z.string().regex(/^\d{2,8}$/, 'CPV: de 2 a 8 cifras'))
    .max(200)
    .default([]),
  mayor_contrato_similar: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .default(null)
    .describe('Importe del mayor contrato similar ejecutado en los últimos 3 años, sin IVA'),
  notas: z.string().max(5000).default(''),
  // Con valor por defecto para que un perfil guardado antes siga validando.
  fecha_constitucion: Fecha.nullable().default(null),
  tamano: z.enum(['micro', 'pequena', 'mediana', 'grande']).nullable().default(null),
  // Idiomas en que el equipo puede trabajar: con ellos se descarta lo que exige otra lengua.
  idiomas: z
    .array(z.enum(Object.keys(IDIOMAS) as [CodigoIdioma, ...CodigoIdioma[]]))
    .max(9)
    .default([]),
  // Cómo se llama la empresa en sus textos y en los prompts («Acme», no «ACME SOLUCIONES, S.L.»).
  nombre_comercial: opcional(z.string().trim().min(1).max(80)),
  // La hora de la empresa: la de los avisos y la que se enseña junto a la peninsular de los plazos.
  zona_horaria: z.enum(ZONAS_HORARIAS).default(ZONA_PENINSULAR),
  // Materias de las formaciones que da la empresa: con ellas Hermes descarta las de otra materia.
  // Vacío = sin esa regla, una formación se juzga como cualquier otro contrato.
  areas_formacion: z.array(z.string().trim().min(2).max(120)).max(30).default([]),
});
export type PerfilEmpresaData = z.infer<typeof PerfilEmpresa>;

export type PerfilGuardado = { perfil: PerfilEmpresaData; actualizado_en: string };

// de-DE escribe los euros igual que el español (186.420,35 €) pero pone el punto también en
// los miles de 4 cifras (3.000,00 €), que es-ES deja sin agrupar.
const EUROS = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const enEuros = (n: number | null) => (n === null ? null : EUROS.format(n));

/** Un importe escrito en español, como en los modelos de la oferta: «48.000,00 €» (con espacio normal: se copia en formularios). */
export const textoEuros = (n: number): string => EUROS.format(n).replace(/\s/g, ' ');

export type ImportesEnTexto = {
  volumen_negocio: Record<string, string>;
  seguro_rc: string | null;
  mayor_contrato_similar: string | null;
};

/**
 * Los importes del perfil escritos en español («186.420,35 €»). En JSON van con punto
 * decimal (186420.35) y un modelo que piensa en español lee ese punto como de miles
 * (18.642.035 €, cien veces más): los agentes citan y comparan estos.
 */
export function importesEnTexto(p: PerfilEmpresaData): ImportesEnTexto {
  return {
    volumen_negocio: Object.fromEntries(p.volumen_negocio.map((v) => [String(v.anio), EUROS.format(v.importe)])),
    seguro_rc: enEuros(p.seguro_rc),
    mayor_contrato_similar: enEuros(p.mayor_contrato_similar),
  };
}

export const AVISO_IMPORTES =
  'Los importes van en euros enteros (186420 son ciento ochenta y seis mil euros) y, escritos, en importes_en_texto: cítalos y compáralos con esos.';

/**
 * El perfil para los agentes, con los importes en euros enteros: sin punto decimal no hay
 * nada que leer como separador de miles. Para comparar con un pliego sobran los céntimos.
 */
export function perfilParaAgentes(p: PerfilEmpresaData): PerfilEmpresaData {
  const entero = (n: number | null) => (n === null ? null : Math.round(n));
  return {
    ...p,
    volumen_negocio: p.volumen_negocio.map((v) => ({ ...v, importe: Math.round(v.importe) })),
    seguro_rc: entero(p.seguro_rc),
    mayor_contrato_similar: entero(p.mayor_contrato_similar),
  };
}

/** Cifras de un texto, al estilo español («18.642.035», «186.420,35») o con punto decimal («186420.35»). */
export function cifras(texto: string): number[] {
  return [...texto.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?(?:\.\d{1,2})?/g)].map(([t]) =>
    /^\d{1,3}(?:\.\d{3})+/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(',', '.')),
  );
}

function importesDelPerfil(p: PerfilEmpresaData): { nombre: string; importe: number }[] {
  return [
    ...p.volumen_negocio.map((v) => ({ nombre: `volumen de negocio de ${v.anio}`, importe: v.importe })),
    ...(p.seguro_rc ? [{ nombre: 'seguro de responsabilidad civil', importe: p.seguro_rc }] : []),
    ...(p.mayor_contrato_similar ? [{ nombre: 'mayor contrato similar', importe: p.mayor_contrato_similar }] : []),
  ];
}

/**
 * Un importe del perfil citado cien veces mayor en lo que escribe un agente (el punto
 * decimal leído como de miles: 186420.35 → 18.642.035 €). Devuelve el error para que lo
 * corrija, o null.
 */
export function importesMalLeidos(p: PerfilEmpresaData, texto: string): string | null {
  const encontradas = cifras(texto);
  const mal = importesDelPerfil(p).filter(
    ({ importe }) => importe >= 1000 && encontradas.some((c) => Math.abs(c - importe * 100) < 100),
  );
  if (!mal.length) return null;
  const detalle = mal
    .map((m) => `${m.nombre}: ${EUROS.format(m.importe)}, no ${EUROS.format(m.importe * 100)}`)
    .join('; ');
  return `Los importes del perfil están cien veces mayores (${detalle}). Son euros: usa importes_en_texto de plataforma_empresa, corrige y vuelve a enviar.`;
}

const log = logger('plataforma');

/** El nombre comercial o, sin él, la razón social sin la forma jurídica («Acme Soluciones»). */
export function nombreDelPerfil(p: Pick<PerfilEmpresaData, 'nombre' | 'nombre_comercial'>): string {
  if (p.nombre_comercial) return p.nombre_comercial;
  const sinForma = FORMA_JURIDICA.test(p.nombre)
    ? p.nombre.replace(FORMA_JURIDICA, '').replace(/[\s,]+$/, '')
    : p.nombre;
  return sinForma.trim() || p.nombre.trim();
}

/**
 * Los campos de texto que leen docx, hoja de datos, dossier y memorias se derivan de los
 * estructurados: así `municipioDe` encuentra el lugar de la firma y no hay dos fuentes.
 */
function conCamposDerivados(p: PerfilEmpresaData): PerfilEmpresaData {
  const d = p.direccion;
  const domicilio = d ? `${d.calle}, ${d.codigo_postal} ${d.municipio} (${d.provincia})` : p.domicilio;
  const certificaciones = p.certificados
    ? p.certificados.map((c) => (c.nivel ? `${c.nombre} ${c.nivel}` : c.nombre))
    : p.certificaciones;
  return { ...p, domicilio, certificaciones };
}

// Campos retirados (sede NUTS, CNAE, certificados de estar al corriente, y la región y la banda de los
// rankings, que pasaron a Licitaciones): un perfil guardado con ellos tiene que seguir valiendo con el
// esquema estricto, así que se quitan al leerlo.
const RETIRADOS = ['nuts_sede', 'cnae', 'al_corriente', 'region_nuts', 'banda_importe_min', 'banda_importe_max'];
const sinRetirados = (datos: string): unknown => {
  const v: unknown = JSON.parse(datos);
  return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !RETIRADOS.includes(k))) : v;
};

/** El perfil guardado, o null si aún no hay (o si el guardado ya no es válido). */
export function leerPerfilEmpresa(db: Db): PerfilGuardado | null {
  const row = db.prepare('SELECT datos, actualizado_en FROM perfil_empresa WHERE id = 1').get() as
    { datos: string; actualizado_en: string } | undefined;
  if (!row) return null;
  const parsed = PerfilEmpresa.safeParse(sinRetirados(row.datos));
  if (parsed.success) return { perfil: parsed.data, actualizado_en: row.actualizado_en };
  // Sin perfil válido el go/no-go deja de evaluar: que quede rastro (solo rutas de zod, nunca datos).
  log.warn('perfil de empresa guardado no válido: hay que volver a guardarlo', {
    campos: parsed.error.issues
      .map((i) => i.path.join('.'))
      .slice(0, 10)
      .join(','),
  });
  return null;
}

/** El nombre de la empresa (nombreDelPerfil), o null mientras no haya perfil. */
export function nombreGuardado(db: Db): string | null {
  const p = leerPerfilEmpresa(db)?.perfil;
  return p ? nombreDelPerfil(p) : null;
}

/** El nombre de la empresa para los prompts: «la empresa» mientras no haya perfil, nunca vacío. */
export function nombreEmpresa(db: Db): string {
  return nombreGuardado(db) ?? 'la empresa';
}

/** La zona horaria de la empresa; sin perfil, la peninsular. */
export function zonaEmpresa(db: Db): ZonaHoraria {
  return leerPerfilEmpresa(db)?.perfil.zona_horaria ?? ZONA_PENINSULAR;
}

/** Las áreas de formación de la empresa; sin perfil, ninguna. */
export function areasFormacion(db: Db): string[] {
  return leerPerfilEmpresa(db)?.perfil.areas_formacion ?? [];
}

/** Valida y guarda el perfil; avisa con el evento «plataforma.empresa» (sin contenido). */
export function guardarPerfilEmpresa(db: Db, entrada: unknown): Result<PerfilGuardado> {
  const parsed = PerfilEmpresa.safeParse(entrada);
  if (!parsed.success) return fail('invalid_input', z.prettifyError(parsed.error));
  const perfil = conCamposDerivados(parsed.data);
  const ts = ahora();
  db.prepare(
    `INSERT INTO perfil_empresa (id, datos, actualizado_en) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en`,
  ).run(JSON.stringify(perfil), ts);
  emitir(db, { tipo: 'plataforma.empresa', dominio: 'plataforma', recurso: null, datos: {} });
  return ok({ perfil, actualizado_en: ts });
}

export type PropuestaEmpresa = { perfil: PerfilEmpresaData; agente: string; motivo: string; propuesto_en: string };

/** Guarda la propuesta de un agente (sustituye a la anterior); el perfil vigente no cambia. */
export function proponerPerfilEmpresa(
  db: Db,
  entrada: unknown,
  agente: string,
  motivo: string,
): Result<PropuestaEmpresa> {
  const parsed = PerfilEmpresa.safeParse(entrada);
  if (!parsed.success) return fail('invalid_input', z.prettifyError(parsed.error));
  const perfil = conCamposDerivados(parsed.data);
  const ts = ahora();
  db.prepare(
    `INSERT INTO perfil_empresa_propuesta (id, datos, agente, motivo, propuesto_en) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, agente = excluded.agente, motivo = excluded.motivo, propuesto_en = excluded.propuesto_en`,
  ).run(JSON.stringify(perfil), agente, motivo, ts);
  emitir(db, { tipo: 'plataforma.empresa_propuesta', dominio: 'plataforma', recurso: null, datos: { agente } });
  return ok({ perfil, agente, motivo, propuesto_en: ts });
}

/** La propuesta pendiente, o null si no hay (o si ya no valida con el esquema actual). */
export function leerPropuestaEmpresa(db: Db): PropuestaEmpresa | null {
  const row = db
    .prepare('SELECT datos, agente, motivo, propuesto_en FROM perfil_empresa_propuesta WHERE id = 1')
    .get() as { datos: string; agente: string; motivo: string; propuesto_en: string } | undefined;
  if (!row) return null;
  const parsed = PerfilEmpresa.safeParse(sinRetirados(row.datos));
  if (parsed.success)
    return { perfil: parsed.data, agente: row.agente, motivo: row.motivo, propuesto_en: row.propuesto_en };
  log.warn('propuesta de perfil de empresa no válida: se ignora', {
    campos: parsed.error.issues
      .map((i) => i.path.join('.'))
      .slice(0, 10)
      .join(','),
  });
  return null;
}

/** Quita la propuesta pendiente (se aplicó en el formulario y se guardó, o se descartó). */
export function cerrarPropuestaEmpresa(db: Db): boolean {
  return db.prepare('DELETE FROM perfil_empresa_propuesta WHERE id = 1').run().changes > 0;
}

/**
 * El municipio del domicilio, si va tras el código postal («…, 38003 Santa Cruz de Tenerife»):
 * sin él no hay forma fiable de saber el lugar de la firma.
 */
export function municipioDe(domicilio: string | null | undefined): string | null {
  return /\b\d{5}\s+([^,()]+?)\s*(?:[,()]|\s[-–]\s|$)/u.exec(domicilio ?? '')?.[1] ?? null;
}
