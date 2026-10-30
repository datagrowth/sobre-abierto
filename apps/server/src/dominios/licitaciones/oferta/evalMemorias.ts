// Banco de pruebas de memorias (docs/como-esta-hecho/memoria-tecnica.md, paso 8): mide si la plataforma redacta como una de referencia.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { memoriaAMarkdown, MemoriaEntrada } from '../../../nucleo/documentos/docx.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { encolar } from '../../../nucleo/trabajos.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { LEER_HASTA_EL_CIERRE, trozoDelPaquete } from './critica.js';
import { localizarCitas } from './evaluacionMemoria.js';
import { puntosTexto } from './guionRevision.js';

// Un caso es una rúbrica, lo que el juez necesita del pliego y varias memorias anonimizadas; un juez ciego (el
// perfil del crítico, en Hermes) las compara por pares en los dos órdenes con el mismo lote. Si cada orden
// prefiere la que va primero es sesgo de posición: empate y alerta. El código revisa el juicio (puntos por
// criterio, sumas y citas literales del documento que favorece) y da el veredicto.
export const TIPO_EVAL_JUICIO = 'licitaciones.eval_juicio';
export const PayloadJuicio = z.object({
  caso: z.string().min(2),
  doc_1: z.number().int().positive(),
  doc_2: z.number().int().positive(),
  lote: z.string().min(1),
});
export type PayloadJuicioData = z.infer<typeof PayloadJuicio>;

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
export const Rubrica = z.strictObject({
  titulo: Texto(2, 300),
  criterios: z
    .array(
      z.strictObject({
        titulo: Texto(2, 300),
        puntos: z.number().positive().max(1000),
        escala: z.array(z.strictObject({ puntos: z.number().min(0), descripcion: Texto(2, 1000) })).max(10),
      }),
    )
    .min(1)
    .max(20),
  advertencias: z.array(Texto(3, 2000)).max(20).default([]),
});
export type RubricaData = z.infer<typeof Rubrica>;

const Lado = z.enum(['1', '2', 'empate']);
export const JuicioEntrada = z.strictObject({
  caso: Texto(2, 60),
  lote: Texto(1, 80),
  doc_1: z.number().int().positive(),
  doc_2: z.number().int().positive(),
  por_criterio: z
    .array(
      z.strictObject({
        criterio: Texto(2, 300),
        preferido: Lado,
        margen: z.number().int().min(0).max(3).describe('0 igual, 1 algo mejor, 2 claramente mejor, 3 mucho mejor'),
        puntos_1: z.number().min(0).max(1000),
        puntos_2: z.number().min(0).max(1000),
        razon: Texto(10, 3000),
        cita: Texto(10, 1500)
          .optional()
          .describe('Frase literal del documento preferido que lo justifica (obligatoria si no es empate)'),
      }),
    )
    .min(1)
    .max(20),
  total_1: z.number().min(0).max(1000),
  total_2: z.number().min(0).max(1000),
  maximo: z.number().positive().max(1000),
  preferido_global: Lado,
  que_marca_la_diferencia: z.array(Texto(5, 1500)).min(1).max(8),
});
export type JuicioEntradaData = z.infer<typeof JuicioEntrada>;
export const recursoJuicio = (a: { caso: string; doc_1: number; doc_2: number; lote: string }) =>
  `eval#${a.caso}#${a.doc_1}-${a.doc_2}#${a.lote}`;

// ── Puros ──

const EPSILON = 0.05;
const letra = (i: number) => String.fromCharCode(65 + (i % 26));

// Una persona, de la forma más larga a la más corta: «Ana María López Vega», «Ana
// María», «López Vega» y el nombre de pila solo («Ana»), tal cual (con mayúscula).
function formas(nombre: string): string[] {
  const t = nombre.trim().split(/\s+/);
  return [...new Set([t.join(' '), t.slice(0, 2).join(' '), t.length >= 3 ? t.slice(-2).join(' ') : '', t[0] ?? ''])]
    .filter((f) => f.length >= 3)
    .sort((a, b) => b.length - a.length);
}
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NIF = /\b(?:[A-HJ-NP-SUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/g;

/** Personas → «Persona A/B/C…» (en el orden dado), con sus roles intactos; los NIF, fuera. */
export function anonimizar(texto: string, nombres: string[]): string {
  const sustituciones = nombres
    .flatMap((n, i) => formas(n).map((f) => ({ f, por: `Persona ${letra(i)}` })))
    .sort((a, b) => b.f.length - a.f.length);
  const conPersonas = sustituciones.reduce(
    (t, s) => t.replace(new RegExp(`(?<![\\p{L}])${escapar(s.f)}(?![\\p{L}])`, 'gu'), s.por),
    texto,
  );
  return conPersonas.replace(NIF, '[NIF]');
}

// La portada dice quién presenta: «**Licitadora:** X (NIF …)» en el .md de la plataforma o
// «Presentada por X» en el texto de un Word. Con una memoria que la trae y otra que no, los
// jueces juzgaban la portada (castigaron el NIF de una sola) y no la memoria.
// En el Word el domicilio va en la línea siguiente a «Presentada por» (en el .md, en la misma):
// se quita con ella si parece una dirección (código postal o vía), para que todas queden igual.
const DOMICILIO = String.raw`(?:[ \t]*\n)*[ \t]*[^\n]*(?:\b\d{5}\b|\b(?:calle|c\/|avda\.?|avenida|plaza|pza\.?|paseo|ctra\.?|carretera|camino|ronda|pol[ií]gono|parque empresarial|edificio)\s)[^\n]*\n?`;
const LICITADORA = [
  /[ \t]*·[ \t]*\*\*Licitadora:\*\*[^·\n]*?(?=[ \t]*·|[ \t]*$)/gm,
  /^[ \t]*\*\*Licitadora:\*\*[^\n]*\n?/gm,
  new RegExp(String.raw`^[ \t]*Presentada por [^\n]*\n?(?:${DOMICILIO})?`, 'gmi'),
];

/** La misma normalización para todas las memorias de un caso: sin la línea de la licitadora, personas anonimizadas y sin NIF. */
export function normalizarMemoria(texto: string, nombres: string[] = []): string {
  return anonimizar(
    LICITADORA.reduce((t, re) => t.replace(re, ''), texto),
    nombres,
  );
}

// Una figura que en el .md es solo un marcador: el juez no ve lo que la otra memoria sí enseña.
const FIGURA_CIEGA = /\(dibujo en el \.docx\)/g;
const numerosDeFigura = (t: string) => new Set([...t.matchAll(/\bFigura (\d+)[.:]/g)].map((m) => m[1]));

/** Avisos de un caso cuyas memorias no se comparan en igualdad: figuras en unas y no en otras, o figuras sin su contenido. */
export function avisosDeFiguras(docs: Record<string, string>): string[] {
  const n = Object.entries(docs).map(([etiqueta, t]) => ({
    etiqueta,
    figuras: numerosDeFigura(t).size,
    ciegas: (t.match(FIGURA_CIEGA) ?? []).length,
  }));
  const con = n.filter((x) => x.figuras > 0).map((x) => x.etiqueta);
  const sin = n.filter((x) => x.figuras === 0).map((x) => x.etiqueta);
  return [
    ...(con.length && sin.length
      ? [
          `${con.join(', ')} trae figuras y ${sin.join(', ')} no: el juicio compara también eso; comprueba que no falten al pasarlas a .md.`,
        ]
      : []),
    ...n
      .filter((x) => x.ciegas > 0)
      .map(
        (x) =>
          `${x.etiqueta} tiene ${x.ciegas} figuras sin su contenido («dibujo en el .docx»): pon junto a su .md el .json del ensamblado para leerlas.`,
      ),
  ];
}

type ProblemasJuicio = { duros: string[]; blandos: string[] };

function sumas(j: JuicioEntradaData, r: RubricaData): string[] {
  const suma = (k: 'puntos_1' | 'puntos_2') => j.por_criterio.reduce((s, c) => s + c[k], 0);
  const maximo = r.criterios.reduce((s, c) => s + c.puntos, 0);
  return [
    ...(Math.abs(suma('puntos_1') - j.total_1) > EPSILON
      ? [`total_1 (${puntosTexto(j.total_1)}) debe ser la suma de puntos_1 (${puntosTexto(suma('puntos_1'))}).`]
      : []),
    ...(Math.abs(suma('puntos_2') - j.total_2) > EPSILON
      ? [`total_2 (${puntosTexto(j.total_2)}) debe ser la suma de puntos_2 (${puntosTexto(suma('puntos_2'))}).`]
      : []),
    ...(Math.abs(maximo - j.maximo) > EPSILON
      ? [`maximo debe ser ${puntosTexto(maximo)}, la suma de los criterios de la rúbrica.`]
      : []),
  ];
}

/** Lo que impide aceptar un juicio: duros (criterios, topes, sumas) siempre; citas que no están, hasta el tercer envío. */
function problemasDeJuicio(j: JuicioEntradaData, r: RubricaData, textos: [string, string]): ProblemasJuicio {
  const duros =
    j.por_criterio.length !== r.criterios.length
      ? [`Juzga los ${r.criterios.length} criterios de la rúbrica, uno por elemento y en orden.`]
      : [];
  j.por_criterio.forEach((c, i) => {
    const peso = r.criterios[i]?.puntos ?? 0;
    if (c.puntos_1 > peso + EPSILON || c.puntos_2 > peso + EPSILON)
      duros.push(`En el criterio ${i + 1} los puntos pasan de su máximo (${puntosTexto(peso)}).`);
  });
  duros.push(...sumas(j, r));
  const blandos = j.por_criterio.flatMap((c, i) => {
    if (c.preferido === 'empate') return [];
    if (!c.cita)
      return [
        `El criterio ${i + 1} prefiere el documento ${c.preferido}: copia en «cita» la frase literal suya que lo justifica.`,
      ];
    return localizarCitas([textos[c.preferido === '1' ? 0 : 1]], [c.cita])[0] === null
      ? [`La cita del criterio ${i + 1} no está tal cual en el documento ${c.preferido}.`]
      : [];
  });
  return { duros, blandos };
}

export type JuicioPar = { doc_1: number; doc_2: number; total_1: number; total_2: number };
export type Veredicto = {
  preferido: number | null;
  medias: Record<number, number>;
  sesgo_posicion: boolean;
  juicios: number;
  alerta: string | null;
};

/** El veredicto de los juicios de un par en los dos órdenes: medias por documento, o empate si es sesgo de posición. */
export function veredictoPorPares(juicios: JuicioPar[]): Veredicto {
  const docs = [...new Set(juicios.flatMap((j) => [j.doc_1, j.doc_2]))];
  const medias = Object.fromEntries(
    docs.map((d) => {
      const ts = juicios.flatMap((j) => (j.doc_1 === d ? [j.total_1] : j.doc_2 === d ? [j.total_2] : []));
      return [d, Math.round((ts.reduce((s, x) => s + x, 0) / Math.max(1, ts.length)) * 100) / 100];
    }),
  ) as Record<number, number>;
  const ordenes = new Set(juicios.map((j) => `${j.doc_1}-${j.doc_2}`)).size;
  const sesgo = ordenes > 1 && juicios.every((j) => j.total_1 > j.total_2 + EPSILON);
  if (sesgo)
    return {
      preferido: null,
      medias,
      sesgo_posicion: true,
      juicios: juicios.length,
      alerta: 'Cada orden prefiere el documento que va primero: sesgo de posición, el juicio no vale.',
    };
  const [a, b] = [...docs].sort((x, y) => medias[y]! - medias[x]!);
  const empate = b === undefined || Math.abs(medias[a!]! - medias[b]!) <= EPSILON;
  return { preferido: empate ? null : a!, medias, sesgo_posicion: false, juicios: juicios.length, alerta: null };
}

// ── Casos y juicios en la base ──

export type CasoCargado = { caso: number; clave: string; documentos: Record<string, number>; avisos: string[] };

const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

// El .md de una memoria ensamblada con el .json al lado (memoria-vN.json) se rehace desde el
// .json: así una memoria de antes de los rótulos de las figuras en el .md también los trae.
function textoDeMemoria(dir: string, f: string, leer: (f: string) => string): string {
  const json = `${path.basename(f, '.md')}.json`;
  if (!fs.existsSync(path.join(dir, json))) return leer(f);
  const m = MemoriaEntrada.safeParse((JSON.parse(leer(json)) as { memoria?: unknown }).memoria);
  return m.success ? memoriaAMarkdown(m.data) : leer(f);
}

/**
 * Carga un caso de una carpeta (rubrica.json, pliego.md, esperado.json opcional, nombres.json
 * opcional con las personas a anonimizar y un .md por memoria): todas pasan por la misma
 * normalización (normalizarMemoria). Idempotente por clave y por el sha256 de cada documento.
 */
export function cargarCaso(db: Db, clave: string, dir: string): Result<CasoCargado> {
  const leer = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  if (!fs.existsSync(path.join(dir, 'rubrica.json'))) return fail('not_found', `No hay rubrica.json en ${dir}.`);
  const rubrica = Rubrica.safeParse(JSON.parse(leer('rubrica.json')));
  if (!rubrica.success)
    return fail(
      'invalid_input',
      `rubrica.json no vale: ${rubrica.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const esperado = fs.existsSync(path.join(dir, 'esperado.json')) ? leer('esperado.json') : null;
  const ts = new Date().toISOString();
  return ok(
    db.transaction(() => {
      db.prepare(
        `INSERT INTO eval_casos (clave, nombre, rubrica, pliego, esperado, creado_en) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(clave) DO UPDATE SET nombre = excluded.nombre, rubrica = excluded.rubrica, pliego = excluded.pliego, esperado = excluded.esperado`,
      ).run(clave, rubrica.data.titulo, JSON.stringify(rubrica.data), leer('pliego.md'), esperado, ts);
      const caso = (db.prepare('SELECT id FROM eval_casos WHERE clave = ?').get(clave) as { id: number }).id;
      const docs = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md') && f !== 'pliego.md')
        .sort();
      const nombres = fs.existsSync(path.join(dir, 'nombres.json'))
        ? (JSON.parse(leer('nombres.json')) as string[])
        : [];
      const textos = Object.fromEntries(
        docs.map((f) => [path.basename(f, '.md'), normalizarMemoria(textoDeMemoria(dir, f, leer), nombres)]),
      );
      const poner =
        db.prepare(`INSERT INTO eval_documentos (caso_id, etiqueta, origen, texto, sha256, creado_en) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(caso_id, etiqueta) DO UPDATE SET texto = excluded.texto, sha256 = excluded.sha256 WHERE eval_documentos.sha256 <> excluded.sha256`);
      for (const f of docs) {
        const t = textos[path.basename(f, '.md')]!;
        poner.run(caso, path.basename(f, '.md'), f, t, sha(t), ts);
      }
      const filas = db.prepare('SELECT id, etiqueta FROM eval_documentos WHERE caso_id = ?').all(caso) as {
        id: number;
        etiqueta: string;
      }[];
      return {
        caso,
        clave,
        documentos: Object.fromEntries(filas.map((x) => [x.etiqueta, x.id])),
        avisos: avisosDeFiguras(textos),
      };
    })(),
  );
}

/** Encola los dos órdenes de un par con el mismo lote (los ejecuta el servidor en el perfil del crítico). */
export function encolarJuicios(
  dbNucleo: DbNucleo,
  caso: string,
  a: number,
  b: number,
  lote = new Date().toISOString(),
): number[] {
  return [
    [a, b],
    [b, a],
  ].map(([d1, d2]) => {
    const payload: PayloadJuicioData = { caso, doc_1: d1!, doc_2: d2!, lote };
    return encolar(dbNucleo, {
      tipo: TIPO_EVAL_JUICIO,
      dominio: 'licitaciones',
      clave: `eval-${caso}-${d1}-${d2}-${lote}`,
      payload,
      aMano: true,
    });
  });
}

type Caso = { id: number; clave: string; rubrica: string; pliego: string; esperado: string | null };
const casoPorClave = (db: Db, clave: string): Caso | null =>
  (db.prepare('SELECT * FROM eval_casos WHERE clave = ?').get(clave) as Caso | undefined) ?? null;
const textoDoc = (db: Db, caso: number, id: number): string | null =>
  (
    db.prepare('SELECT texto FROM eval_documentos WHERE id = ? AND caso_id = ?').get(id, caso) as
      { texto: string } | undefined
  )?.texto ?? null;

/** Guarda un juicio revisado (el de la tool licitaciones_eval_juicio). */
export function guardarJuicio(
  db: Db,
  j: JuicioEntradaData,
  agente: string,
  op: { revisar?: boolean; hoy?: Date } = {},
): Result<{ juicio: number; preferido: number }> {
  const caso = casoPorClave(db, j.caso);
  const t1 = caso ? textoDoc(db, caso.id, j.doc_1) : null;
  const t2 = caso ? textoDoc(db, caso.id, j.doc_2) : null;
  if (!caso || t1 === null || t2 === null)
    return fail('not_found', `No hay caso «${j.caso}» con los documentos ${j.doc_1} y ${j.doc_2}.`);
  const p = problemasDeJuicio(j, Rubrica.parse(JSON.parse(caso.rubrica)), [t1, t2]);
  const exigir = op.revisar === true && exigirRevision(db, 'licitaciones_eval_juicio', recursoJuicio(j), op.hoy);
  if (p.duros.length || (exigir && p.blandos.length))
    return fail('invalid_input', `${[...p.duros, ...p.blandos].join(' ')} Corrige y vuelve a enviar el juicio entero.`);
  const preferido = j.total_1 > j.total_2 + EPSILON ? j.doc_1 : j.total_2 > j.total_1 + EPSILON ? j.doc_2 : 0;
  db.prepare(
    `INSERT INTO eval_juicios (caso_id, doc_1, doc_2, lote, datos, total_1, total_2, preferido, agente, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(caso_id, doc_1, doc_2, lote) DO UPDATE SET datos = excluded.datos, total_1 = excluded.total_1, total_2 = excluded.total_2, preferido = excluded.preferido, agente = excluded.agente, creado_en = excluded.creado_en`,
  ).run(
    caso.id,
    j.doc_1,
    j.doc_2,
    j.lote,
    JSON.stringify(j),
    j.total_1,
    j.total_2,
    preferido,
    agente,
    new Date().toISOString(),
  );
  const id = (
    db
      .prepare('SELECT id FROM eval_juicios WHERE caso_id = ? AND doc_1 = ? AND doc_2 = ? AND lote = ?')
      .get(caso.id, j.doc_1, j.doc_2, j.lote) as { id: number }
  ).id;
  return ok({ juicio: id, preferido });
}

/** «hecho» del trabajo: el juicio de ese orden y lote está guardado. */
export function juicioRecibido(db: Db, p: PayloadJuicioData): boolean {
  return (
    db
      .prepare(
        'SELECT 1 FROM eval_juicios j JOIN eval_casos c ON c.id = j.caso_id WHERE c.clave = ? AND j.doc_1 = ? AND j.doc_2 = ? AND j.lote = ?',
      )
      .get(p.caso, p.doc_1, p.doc_2, p.lote) !== undefined
  );
}

/** Los juicios de un lote de un caso. */
export function juiciosDeLote(db: Db, clave: string, lote: string): (JuicioPar & { datos: JuicioEntradaData })[] {
  const filas = db
    .prepare(
      'SELECT j.doc_1, j.doc_2, j.total_1, j.total_2, j.datos FROM eval_juicios j JOIN eval_casos c ON c.id = j.caso_id WHERE c.clave = ? AND j.lote = ? ORDER BY j.id',
    )
    .all(clave, lote) as (JuicioPar & { datos: string })[];
  return filas.map((f) => ({ ...f, datos: JSON.parse(f.datos) as JuicioEntradaData }));
}

// ── Paquete e instrucciones del juez ──

export const PARTES_JUICIO = ['rubrica', 'pliego', 'documento_1', 'documento_2'] as const;

/** Una parte del paquete del juez, por trozos; los documentos van como «1» y «2», sin su etiqueta. */
export function paqueteJuicio(
  db: Db,
  a: PayloadJuicioData & { parte: (typeof PARTES_JUICIO)[number]; desde?: number | undefined },
): Result<unknown> {
  const caso = casoPorClave(db, a.caso);
  if (!caso) return fail('not_found', `No hay caso «${a.caso}».`);
  const texto =
    a.parte === 'rubrica'
      ? JSON.stringify(JSON.parse(caso.rubrica), null, 1)
      : a.parte === 'pliego'
        ? caso.pliego
        : textoDoc(db, caso.id, a.parte === 'documento_1' ? a.doc_1 : a.doc_2);
  if (texto === null) return fail('not_found', 'Ese documento no es de este caso.');
  return ok({ parte: a.parte, ...trozoDelPaquete(texto, a.desde) });
}

/** Instrucciones del juez ciego por pares. */
export function instruccionesJuicio(p: PayloadJuicioData, empresa: string): string {
  const ids = `caso=«${p.caso}», doc_1=${p.doc_1}, doc_2=${p.doc_2}, lote=«${p.lote}»`;
  return [
    `Tarea de la plataforma de ${empresa} (banco de pruebas de memorias): eres un vocal técnico de la mesa, severo e imparcial, y comparas dos memorias técnicas que responden al mismo pliego. No sabes quién escribió cada una y el orden no significa nada.`,
    `1. Lee con licitaciones_eval_paquete (${ids}) la parte «rubrica», la parte «pliego» y los dos documentos («documento_1» y «documento_2»), cada uno por trozos hasta el final: si la respuesta trae «siguiente» ≠ null, sigue leyendo con «desde» = «siguiente»; no envíes el juicio sin haber llegado a «siguiente» = null en las cuatro partes. ${LEER_HASTA_EL_CIERRE}`,
    '2. Por cada criterio de la rúbrica, en orden: qué documento es mejor («1», «2» o «empate»), por cuánto (margen 0 a 3), los puntos que daría la mesa a cada uno con su escala (como mucho los del criterio), la razón concreta y la cita literal del documento preferido que lo justifica.',
    '3. total_1 y total_2 son la suma de los puntos; maximo, la suma de los criterios; preferido_global y lo que marca la diferencia (de 1 a 8 frases).',
    `4. Envía licitaciones_eval_juicio con ${ids} y todo lo anterior. Si responde con un error, corrige exactamente lo que dice y reenvía el juicio entero.`,
    'Usa solo esas dos herramientas y no respondas en ningún canal.',
  ].join('\n');
}

// ── Informe ──

/** La tabla criterio × orden (puntos de cada documento por su etiqueta), con los totales y el veredicto. */
export function informeDeJuicios(
  juicios: (JuicioPar & { datos: JuicioEntradaData })[],
  etiquetas: Record<number, string>,
  r: RubricaData,
): string {
  const nombre = (id: number) => etiquetas[id] ?? String(id);
  const cabecera = ['Criterio', ...juicios.map((j, i) => `Orden ${i + 1} (${nombre(j.doc_1)} | ${nombre(j.doc_2)})`)];
  const filas = r.criterios.map((c, k) => [
    c.titulo,
    ...juicios.map((j) => {
      const x = j.datos.por_criterio[k];
      return x ? `${puntosTexto(x.puntos_1)} | ${puntosTexto(x.puntos_2)}` : '—';
    }),
  ]);
  const totales = ['Total', ...juicios.map((j) => `${puntosTexto(j.total_1)} | ${puntosTexto(j.total_2)}`)];
  const v = veredictoPorPares(juicios);
  const medias = Object.entries(v.medias)
    .map(([id, m]) => `${nombre(Number(id))} ${puntosTexto(m)}`)
    .join(', ');
  const fin = v.sesgo_posicion
    ? `Veredicto: empate por sesgo de posición. ${v.alerta}`
    : `Veredicto: ${v.preferido === null ? 'empate' : nombre(v.preferido)} (medias: ${medias}).`;
  return [...[cabecera, ...filas, totales].map((f) => `| ${f.join(' | ')} |`), '', fin].join('\n');
}

/** ¿El veredicto contradice el esperado del caso (p. ej. { "preferido": "memoria_fuerte" })? */
export function contradiceEsperado(
  v: Veredicto,
  etiquetas: Record<number, string>,
  esperado: { preferido: string } | null,
): boolean {
  if (!esperado) return false;
  return v.preferido === null || etiquetas[v.preferido] !== esperado.preferido;
}
