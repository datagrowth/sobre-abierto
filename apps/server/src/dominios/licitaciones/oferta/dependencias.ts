// «Qué cambia» antes de guardar: qué apartados y anexos dependen de un cambio de personas o de lotes.
import crypto from 'node:crypto';
import { z } from 'zod';
import { PerfilEmpresa } from '../../../nucleo/empresa.js';
import { numeroDeAnexo } from './anexosModelo.js';
import { DATOS_ANEXO, type DatoAnexo } from './datosAnexo.js';
import { enumerar, FRASE_DATO_ANEXO } from './dependenciasAnexo.js';
import { nombreBuscable, nombresDelEquipoEn } from './hechos.js';
import type { GuionBaseData } from './guion.js';
import { lotesMencionados } from './lotesMencionados.js';
import { DURACION_MIN, duracionMejoraMin } from './plazo.js';
import { textoComparable } from '../temas.js';

// Cada apartado guarda de qué depende al recibirlo (dependenciasDeApartado): los lotes,
// las personas y sus roles que nombra. Un cambio de persona o de lotes mira esas dependencias; los
// apartados de antes de guardarlas, y los anexos, siguen por reglas: el tipo y el lote de cada
// anexo y lo que nombra el texto de cada apartado. Ante la duda (un texto vacío, una persona que
// no está en el equipo) se marca para revisar y nunca se da por mantenido: lo peor es presentar
// un anexo con un dato viejo sin saberlo. El importe no entra nunca, ni en el cambio, ni en el
// resultado, ni en las dependencias: la memoria no puede mencionarlo (lo vigilan las fugas) y
// este cálculo no lo necesita. Puro: sin base de datos.

const Lote = z.string().trim().min(1).max(20);

const DecisionesCambio = z
  .strictObject({
    precio: z.strictObject({ lote: Lote.nullable() }).optional(),
    // Hasta 60: un equipo de 30 (el máximo de las decisiones) sustituido entero por otras 30 personas.
    equipo: z
      .array(z.strictObject({ persona_id: z.number().int().positive(), sale: z.boolean() }))
      .min(1)
      .max(60)
      .optional(),
    automaticos: z.literal(true).optional(),
    herramientas: z.literal(true).optional(),
    enfoque: z.literal(true).optional(),
    // Los datos que el anexo pide y el pliego no fija: van a la hoja, como el precio.
    datos_anexo: z.array(z.enum(DATOS_ANEXO)).min(1).max(DATOS_ANEXO.length).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Di qué sección de las decisiones cambia.');

export const CambioImpacto = z
  .strictObject({
    decisiones: DecisionesCambio.optional(),
    lotes: z.array(Lote).max(100).optional(), // como los lotes de las decisiones
    empresa: z.array(PerfilEmpresa.keyof()).min(1).max(40).optional(),
    guion: z.literal('reextraer').optional(),
  })
  .refine(
    (c) => Object.values(c).filter((v) => v !== undefined).length === 1,
    'El cambio trae una sola cosa: decisiones, lotes, empresa o guion.',
  );
export type CambioImpacto = z.infer<typeof CambioImpacto>;

// con_plan: el anexo guardó con qué datos de la hoja se rellenó (anexoPlan.ts) y se puede regenerar por código.
export type DocumentoImpacto = {
  clave: string;
  nombre: string;
  tipo: string;
  lote: string | null;
  estado: string;
  anexo_en: string | null;
  con_plan: boolean;
};
// dependencias: las guardadas del apartado (null en los de antes de guardarlas: se mira su texto).
// lote: el de su memoria cuando el pliego pide una por lote (null o ausente: la común).
// entera: una versión subida sin los títulos del guion (subidaFlexible.ts), n 0 y todo su texto.
// subida: el apartado es de una versión subida a mano. Ninguna de las dos se rehace con Hermes
// (actualizarMemoria.ts la rechaza), así que lo que las toque se revisa a mano.
export type ApartadoImpacto = {
  memoria_version: number;
  lote?: string | null;
  n: number;
  titulo: string;
  texto: string | null;
  dependencias?: DependenciasApartado | null;
  entera?: boolean;
  subida?: boolean;
};
export type PersonaImpacto = { persona_id: number; nombre: string; lotes: string[] };
export type EstadoImpacto = {
  lotes: string[];
  documentos: DocumentoImpacto[];
  apartados: ApartadoImpacto[];
  equipo: PersonaImpacto[];
  paquete: { version: number } | null;
  memoria_ensamblada: boolean;
};

type Pieza = 'anexo' | 'apartado' | 'paquete' | 'decisiones' | 'ficha' | 'guion' | 'documento' | 'portada';
type Accion = 'regenerar' | 'rehacer' | 'revisar' | 'podar' | 'ocultar';
export type Coste = { min: number; runs: number };
export type Afectada = {
  pieza: Pieza;
  clave: string;
  nombre: string;
  accion: Accion;
  por: string[];
  coste: Coste;
  pierde: string[];
};
export type Impacto = { afectadas: Afectada[]; se_mantiene: string[]; resumen: string };

// ── Dependencias de un apartado ──

// Nunca lleva el precio: la memoria no puede mencionarlo (lo vigilan las fugas). El enfoque
// orienta todos los apartados sin ser un dato: es una dependencia blanda, que solo pide revisar.
export const DependenciasApartado = z.strictObject({
  'guion.apartado': z.string().min(1),
  'ambito.lotes': z.array(z.string()),
  'decision.equipo': z.array(z.strictObject({ persona_id: z.number().int().positive(), rol: z.string() })),
  'decision.herramientas': z.array(z.string()),
  'decision.automatico': z.array(z.string()),
  'decision.enfoque': z.literal('blanda'),
});
export type DependenciasApartado = z.infer<typeof DependenciasApartado>;

type MiembroDependencia = { persona_id: number; nombre: string; rol: string };
export type ContextoDependencias = {
  n: number;
  guionApartado: string;
  lotesAmbito: string[];
  equipo: MiembroDependencia[];
  herramientas: string[];
  automaticosVigilados: string[];
};

type ApartadoGuion = NonNullable<GuionBaseData['memoria']>['apartados'][number];

/** La huella de un apartado del guion: título, puntos y escala (si cambian, el apartado ya no es el mismo). */
export function huellaApartadoGuion(a: Pick<ApartadoGuion, 'titulo' | 'puntos' | 'escala'>): string {
  const partes = [
    textoComparable(a.titulo).replace(/\s+/g, ' ').trim(),
    a.puntos,
    a.escala.map((t) => [t.puntos, textoComparable(t.descripcion)]),
  ];
  return crypto.createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 16);
}

const comparable = (t: string) =>
  ` ${textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
const citado = (texto: string, termino: string) =>
  comparable(termino).trim().length > 0 && texto.includes(comparable(termino));
// «Ambos lotes», «los dos lotes», «todos los lotes»: el texto no dice cuáles, así que van todos
// los del ámbito (ante la duda, mejor revisar de más). «Cada lote» describe cómo se hace en
// cualquiera y no depende de cuáles van.
const TODOS_LOS_LOTES = / (?:ambos|todos los|los (?:dos|tres|cuatro|cinco|seis|\d+)) lotes /;

function lotesDelApartado(texto: string, ambito: string[]): string[] {
  if (TODOS_LOS_LOTES.test(comparable(texto))) return [...ambito];
  return lotesMencionados(texto, ambito);
}

// El rol se cita por su cabeza («Docente principal» de «Docente principal del lote 2 (…)»): en
// una memoria por roles el apartado no da el nombre. Una cabeza de una palabra («Tutora») es
// demasiado común para atribuirla a una persona.
function cabezaDeRol(rol: string): string {
  const cabeza = comparable(rol.split(/[(,;:]/)[0] ?? '')
    .split(/ (?:del|de la|de los|de las|de|y|para|en) /)[0]!
    .trim();
  return cabeza.split(' ').length >= 2 ? cabeza : '';
}

function equipoDelApartado(texto: string, equipo: MiembroDependencia[]): DependenciasApartado['decision.equipo'] {
  const t = comparable(texto);
  const nombra = (m: MiembroDependencia) =>
    nombresDelEquipoEn(texto, [m.nombre]).length > 0 ||
    (cabezaDeRol(m.rol) !== '' && t.includes(` ${cabezaDeRol(m.rol)} `));
  const porId = new Map(equipo.filter(nombra).map((m) => [m.persona_id, { persona_id: m.persona_id, rol: m.rol }]));
  return [...porId.values()];
}

/** De qué depende el texto de un apartado: su apartado del guion, los lotes, las personas, las herramientas y los automáticos vigilados. Sin IA. */
export function dependenciasDeApartado(texto: string, ctx: ContextoDependencias): DependenciasApartado {
  const t = comparable(texto);
  return {
    'guion.apartado': ctx.guionApartado,
    'ambito.lotes': lotesDelApartado(texto, ctx.lotesAmbito),
    'decision.equipo': equipoDelApartado(texto, ctx.equipo),
    'decision.herramientas': [...new Set(ctx.herramientas.filter((h) => citado(t, h)))],
    'decision.automatico': [...new Set(ctx.automaticosVigilados)],
    'decision.enfoque': 'blanda',
  };
}

// Lo que sigue valiendo, con su porqué; se descarta si alguna pieza de ese tipo sale afectada
// (de la memoria, si salen solo algunos apartados, se mantiene «el resto»).
type Mantiene = { pieza: Pieza; que: string; porque: string };
type Parte = { afectadas: Afectada[]; mantiene: Mantiene[] };

const SIN_COSTE: Coste = { min: 0, runs: 0 };
// Rehacer un anexo es otro run de Hermes. Si guardó su plan, un dato de la hoja
// que cambia (el precio, la identidad de la empresa) se regenera por código: 0 runs.
const COSTE_ANEXO: Coste = { min: DURACION_MIN.anexo, runs: 1 };
const TIPOS_EMPRESA = new Set(['declaracion', 'oferta_economica', 'acreditacion', 'otro']);
const TIPOS_EQUIPO = new Set(['declaracion', 'acreditacion', 'otro']);
// Los datos de la empresa que se copian en los anexos y en la portada; el resto (solvencia,
// certificados…) puede salir en una declaración, pero no siempre: se revisa.
const IDENTIDAD = new Set(['nif', 'nombre', 'domicilio', 'direccion', 'representante', 'contacto']);
const EN_PORTADA = new Set(['nif', 'nombre', 'domicilio', 'direccion', 'representante']);
// Los anexos que nombran a personas del equipo; «datos personales» (protección de datos) no.
const ADSCRIPCION = /adscrip|equipo|curr[ií]cul|titulaci|docente|medios personales/i;
const RANGO: Record<Accion, number> = { revisar: 0, ocultar: 1, podar: 2, regenerar: 3, rehacer: 4 };

const af = (a: Omit<Afectada, 'coste' | 'pierde'> & Partial<Pick<Afectada, 'coste' | 'pierde'>>): Afectada => ({
  coste: SIN_COSTE,
  pierde: [],
  ...a,
});
const vacia = (): Parte => ({ afectadas: [], mantiene: [] });
const delLote = (lote: string | null, de: string | null) => lote === null || de === null || de === lote;
const rellenados = (e: EstadoImpacto) => e.documentos.filter((d) => d.anexo_en !== null && d.tipo !== 'memoria');
// Un dato de la hoja que cambió: se regenera por código si el anexo guardó su plan; si no, vuelve a Hermes.
const porCodigo = (d: DocumentoImpacto): Accion => (d.con_plan ? 'regenerar' : 'rehacer');
const sinTexto = (a: ApartadoImpacto) => !a.texto?.trim();

function nombreDocumento(d: DocumentoImpacto): string {
  const n = numeroDeAnexo(d.nombre);
  const base = n ? `Anexo ${n}` : d.nombre;
  return d.lote ? `${base} del lote ${d.lote}` : base;
}

const anexo = (d: DocumentoImpacto, accion: Accion, por: string[]): Afectada =>
  af({
    pieza: 'anexo',
    clave: d.clave,
    nombre: nombreDocumento(d),
    accion,
    por,
    coste: accion === 'rehacer' ? COSTE_ANEXO : SIN_COSTE,
  });

// Solo cuenta la última versión de la memoria de cada lote: las anteriores ya no se presentan.
function apartadosVigentes(e: EstadoImpacto): ApartadoImpacto[] {
  const ultima = new Map<string | null, number>();
  for (const a of e.apartados) ultima.set(a.lote ?? null, Math.max(ultima.get(a.lote ?? null) ?? 0, a.memoria_version));
  return e.apartados.filter((a) => a.memoria_version === ultima.get(a.lote ?? null));
}

const nombreApartado = (a: ApartadoImpacto): string =>
  `${a.entera ? `Memoria v${a.memoria_version} entera` : `Apartado ${a.n} · ${a.titulo}`}${a.lote ? ` (memoria del lote ${a.lote})` : ''}`;

// Entera o subida a mano no hay apartado que Hermes rehaga: se revisa a mano.
const apartado = (a: ApartadoImpacto, accion: Accion, por: string[]): Afectada =>
  af({
    pieza: 'apartado',
    clave: `v${a.memoria_version}-${a.n}`,
    nombre: nombreApartado(a),
    accion: (a.entera || a.subida) && accion === 'rehacer' ? 'revisar' : accion,
    por,
  });

// Cómo saber si un apartado nombra lo cambiado: por sus dependencias guardadas o, en los de antes
// de guardarlas, por su texto (null: no se puede buscar en el texto y se revisa).
type Nombra = { guardada: (d: DependenciasApartado) => boolean; texto: ((t: string) => boolean) | null };

function accionPorNombrar(a: ApartadoImpacto, nombra: Nombra): Accion | null {
  if (a.dependencias) return nombra.guardada(a.dependencias) ? 'rehacer' : null;
  if (sinTexto(a) || !nombra.texto) return 'revisar';
  return nombra.texto(a.texto!) ? 'rehacer' : null;
}

// Los apartados que nombran lo cambiado se rehacen; los que no se pueden leer, se revisan.
function apartadosQueNombran(e: EstadoImpacto, por: string[], nombra: Nombra): Parte {
  const p = vacia();
  const vigentes = apartadosVigentes(e);
  for (const a of vigentes) {
    const accion = accionPorNombrar(a, nombra);
    if (accion) p.afectadas.push(apartado(a, accion, por));
  }
  // Si todos se rehacen o se revisan, no queda memoria que «se mantiene».
  if (p.afectadas.length < vigentes.length)
    p.mantiene.push({ pieza: 'apartado', que: 'la memoria', porque: 'no nombra lo que cambia' });
  return p;
}

const revisarMemoria = (e: EstadoImpacto, por: string[]): Afectada[] =>
  apartadosVigentes(e).map((a) => apartado(a, 'revisar', por));

function unir(partes: Parte[]): Parte {
  return { afectadas: partes.flatMap((p) => p.afectadas), mantiene: partes.flatMap((p) => p.mantiene) };
}

// ── Reglas ──

function reglaPrecio(e: EstadoImpacto, lote: string | null): Parte {
  const por = [`decision.precio[${lote ?? 'sin lote'}]`];
  const anexos = rellenados(e).filter((d) => d.tipo === 'oferta_economica' && delLote(lote, d.lote));
  return {
    afectadas: anexos.map((d) => anexo(d, porCodigo(d), por)),
    mantiene: [{ pieza: 'apartado', que: 'la memoria', porque: 'no puede mencionar el precio' }],
  };
}

function anexosDeAdscripcion(e: EstadoImpacto, persona: PersonaImpacto | undefined): DocumentoImpacto[] {
  const lotes = persona?.lotes.length ? persona.lotes : null;
  return rellenados(e).filter(
    (d) =>
      TIPOS_EQUIPO.has(d.tipo) &&
      ADSCRIPCION.test(d.nombre) &&
      (lotes === null || d.lote === null || lotes.includes(d.lote)),
  );
}

// Quien sale: se rehacen los apartados que la nombran o citan su rol. Quien entra o cambia de rol:
// se revisan. Una persona que no está en el equipo no se puede buscar en los textos: se revisan
// los apartados sin dependencias guardadas (las guardadas la llevan por su id).
function reglaPersona(e: EstadoImpacto, cambio: { persona_id: number; sale: boolean }): Parte {
  const por = [`decision.equipo[${cambio.persona_id}]${cambio.sale ? ': sale' : ''}`];
  const persona = e.equipo.find((p) => p.persona_id === cambio.persona_id);
  const anexos = { afectadas: anexosDeAdscripcion(e, persona).map((d) => anexo(d, 'rehacer', por)), mantiene: [] };
  const memoria = apartadosQueNombran(e, por, {
    guardada: (d) => d['decision.equipo'].some((m) => m.persona_id === cambio.persona_id),
    // Un nombre que no se puede buscar (una sola palabra, una inicial) no dice «se mantiene»: se revisa.
    texto: persona && nombreBuscable(persona.nombre) ? (t) => nombresDelEquipoEn(t, [persona.nombre]).length > 0 : null,
  });
  if (!cambio.sale) memoria.afectadas = memoria.afectadas.map((a) => ({ ...a, accion: 'revisar' }));
  return unir([anexos, memoria]);
}

function reglaAutomaticos(e: EstadoImpacto): Parte {
  const por = ['decision.automaticos'];
  // El anexo económico lleva los criterios por fórmula; en las declaraciones puede que no.
  const anexos = rellenados(e)
    .filter((d) => TIPOS_EMPRESA.has(d.tipo))
    .map((d) => anexo(d, d.tipo === 'oferta_economica' ? 'rehacer' : 'revisar', por));
  return { afectadas: [...anexos, ...revisarMemoria(e, por)], mantiene: [] };
}

// El impuesto y el orden de los lotes van en el económico; la subcontratación, en las declaraciones.
// Son datos de la hoja: se regeneran por código si el anexo guardó su plan. La memoria no los lleva.
function reglaDatosAnexo(e: EstadoImpacto, datos: DatoAnexo[]): Parte {
  const por = datos.map((x) => `decision.datos_anexo.${x}`);
  const tipos = new Set([
    ...(datos.some((x) => x !== 'subcontratacion_servidores') ? ['oferta_economica'] : []),
    ...(datos.includes('subcontratacion_servidores') ? TIPOS_EQUIPO : []),
  ]);
  const anexos = rellenados(e)
    .filter((d) => tipos.has(d.tipo))
    .map((d) => anexo(d, porCodigo(d), por));
  return {
    afectadas: anexos,
    mantiene: [
      { pieza: 'apartado', que: 'la memoria', porque: `no lleva ${enumerar(datos.map((x) => FRASE_DATO_ANEXO[x]))}` },
    ],
  };
}

// El enfoque y las herramientas orientan la memoria, no son un dato: se revisa, no se rehace.
function reglaBlanda(e: EstadoImpacto, seccion: 'enfoque' | 'herramientas'): Parte {
  return {
    afectadas: revisarMemoria(e, [`decision.${seccion}`]),
    mantiene: [{ pieza: 'anexo', que: 'los anexos', porque: 'no llevan el enfoque ni las herramientas' }],
  };
}

function reglaDecisiones(e: EstadoImpacto, d: NonNullable<CambioImpacto['decisiones']>): Parte {
  return unir([
    d.precio ? reglaPrecio(e, d.precio.lote) : vacia(),
    ...(d.equipo ?? []).map((c) => reglaPersona(e, c)),
    d.automaticos ? reglaAutomaticos(e) : vacia(),
    d.enfoque ? reglaBlanda(e, 'enfoque') : vacia(),
    d.herramientas ? reglaBlanda(e, 'herramientas') : vacia(),
    d.datos_anexo ? reglaDatosAnexo(e, d.datos_anexo) : vacia(),
  ]);
}

function pierdeDelLote(e: EstadoImpacto, lote: string, quitados: string[]): string[] {
  const solo = e.equipo.filter(
    (p) => p.lotes.length > 0 && p.lotes.every((l) => quitados.includes(l)) && p.lotes.includes(lote),
  );
  return [
    `el precio del lote ${lote}`,
    `los criterios por fórmula del lote ${lote}`,
    ...solo.map((p) => `${p.nombre} (solo va en el lote ${lote})`),
  ];
}

// Quitar lotes: la ficha y el guion siguen valiendo; se poda lo del lote y se ocultan sus filas.
function reglaQuitarLotes(e: EstadoImpacto, quitados: string[]): Parte {
  const por = [`ambito.lotes: quita ${enumerar(quitados)}`];
  const decisiones = quitados.map((l) =>
    af({
      pieza: 'decisiones',
      clave: `lote-${l}`,
      nombre: `Las decisiones del lote ${l}`,
      accion: 'podar',
      por,
      pierde: pierdeDelLote(e, l, quitados),
    }),
  );
  const filas = e.documentos
    .filter((d) => d.lote !== null && quitados.includes(d.lote))
    .map((d) => af({ pieza: 'documento', clave: d.clave, nombre: nombreDocumento(d), accion: 'ocultar', por }));
  const memoria = apartadosQueNombran(e, por, {
    guardada: (d) => d['ambito.lotes'].some((l) => quitados.includes(l)),
    texto: (t) => lotesMencionados(t, e.lotes).some((l) => quitados.includes(l)),
  });
  const mantiene: Mantiene[] = [
    { pieza: 'ficha', que: 'la ficha', porque: 'sigue valiendo' },
    { pieza: 'guion', que: 'el guion', porque: 'sigue valiendo' },
  ];
  return unir([{ afectadas: [...decisiones, ...filas], mantiene }, memoria]);
}

function reglaAnadirLotes(nuevos: string[]): Parte {
  const por = [`ambito.lotes: añade ${enumerar(nuevos)}`];
  const rehacer = (pieza: Pieza, clave: string, nombre: string, min: number) =>
    af({ pieza, clave, nombre, accion: 'rehacer', por, coste: { min, runs: 1 } });
  return {
    afectadas: [
      rehacer('ficha', 'ficha', 'La ficha', DURACION_MIN.ficha),
      rehacer('guion', 'guion', 'El guion', DURACION_MIN.guion),
      rehacer('decisiones', 'propuesta', 'La propuesta de decisiones', DURACION_MIN.decisiones),
    ],
    mantiene: [],
  };
}

function reglaLotes(e: EstadoImpacto, lotes: string[]): Parte {
  const quitados = e.lotes.filter((l) => !lotes.includes(l));
  const nuevos = [...new Set(lotes.filter((l) => !e.lotes.includes(l)))];
  return unir([
    quitados.length ? reglaQuitarLotes(e, quitados) : vacia(),
    nuevos.length ? reglaAnadirLotes(nuevos) : vacia(),
  ]);
}

function reglaEmpresa(e: EstadoImpacto, campos: string[]): Parte {
  const por = campos.map((c) => `empresa.${c}`);
  const identidad = campos.some((c) => IDENTIDAD.has(c));
  const anexos = rellenados(e)
    .filter((d) => TIPOS_EMPRESA.has(d.tipo))
    .map((d) => anexo(d, identidad ? porCodigo(d) : 'revisar', por));
  const portada =
    e.memoria_ensamblada && campos.some((c) => EN_PORTADA.has(c))
      ? [
          af({
            pieza: 'portada',
            clave: 'portada',
            nombre: 'La portada y la firma de la memoria',
            accion: 'regenerar',
            por,
          }),
        ]
      : [];
  // El nombre de la empresa sí puede salir en el texto de los apartados.
  if (campos.includes('nombre')) return { afectadas: [...anexos, ...portada, ...revisarMemoria(e, por)], mantiene: [] };
  return {
    afectadas: [...anexos, ...portada],
    mantiene: [{ pieza: 'apartado', que: 'los apartados de la memoria', porque: 'no llevan esos datos' }],
  };
}

function reglaGuion(e: EstadoImpacto): Parte {
  const por = ['guion: reextraer'];
  return {
    afectadas: [
      af({
        pieza: 'guion',
        clave: 'guion',
        nombre: 'El guion',
        accion: 'rehacer',
        por,
        coste: { min: DURACION_MIN.guion, runs: 1 },
      }),
      af({ pieza: 'decisiones', clave: 'decisiones', nombre: 'Las decisiones', accion: 'revisar', por }),
      ...revisarMemoria(e, por),
      ...e.documentos.map((d) =>
        af({ pieza: 'documento', clave: d.clave, nombre: nombreDocumento(d), accion: 'revisar', por }),
      ),
    ],
    mantiene: [],
  };
}

function reglas(e: EstadoImpacto, c: CambioImpacto): Parte {
  if (c.decisiones) return reglaDecisiones(e, c.decisiones);
  if (c.lotes) return reglaLotes(e, c.lotes);
  if (c.empresa) return reglaEmpresa(e, c.empresa);
  return reglaGuion(e);
}

// ── Composición ──

// Una pieza que tocan dos reglas sale una vez, con la acción más fuerte y los dos porqués.
function fusionar(afectadas: Afectada[]): Afectada[] {
  const porClave = new Map<string, Afectada>();
  for (const a of afectadas) {
    const k = `${a.pieza}#${a.clave}`;
    const b = porClave.get(k);
    if (!b) {
      porClave.set(k, a);
      continue;
    }
    const fuerte = RANGO[a.accion] > RANGO[b.accion] ? a : b;
    porClave.set(k, {
      ...fuerte,
      por: [...new Set([...b.por, ...a.por])],
      pierde: [...new Set([...b.pierde, ...a.pierde])],
    });
  }
  return [...porClave.values()];
}

/** Cómo se rehace cada apartado cuando no es dentro de una mejora (p. ej. «Actualizar los apartados afectados»). */
export type RehacerApartado = { coste: Coste; pierde: string[] };

// Los apartados se rehacen en una sola mejora: su tiempo es el de la mejora entera, repartido. Con
// `porApartado`, cada uno cuesta lo suyo y pierde lo que diga.
function costeApartados(afectadas: Afectada[], porApartado?: RehacerApartado): Afectada[] {
  const rehechos = afectadas.filter((a) => a.pieza === 'apartado' && a.accion === 'rehacer');
  if (!rehechos.length) return afectadas;
  if (porApartado) {
    return afectadas.map((a) =>
      rehechos.includes(a)
        ? { ...a, coste: porApartado.coste, pierde: [...new Set([...a.pierde, ...porApartado.pierde])] }
        : a,
    );
  }
  const total = duracionMejoraMin(rehechos.length);
  const cada = Math.floor(total / rehechos.length);
  return afectadas.map((a) => {
    const i = rehechos.indexOf(a);
    return i < 0 ? a : { ...a, coste: { min: cada + (i === 0 ? total - cada * rehechos.length : 0), runs: 1 } };
  });
}

// Lo que se presenta cambia: el paquete vigente se vuelve a montar (por código, sin runs).
function conPaquete(e: EstadoImpacto, afectadas: Afectada[]): Afectada[] {
  const cambian = afectadas.filter((a) => a.accion !== 'revisar');
  if (!e.paquete || !cambian.length) return afectadas;
  const por = [...new Set(cambian.flatMap((a) => a.por))];
  return [
    ...afectadas,
    af({ pieza: 'paquete', clave: `v${e.paquete.version}`, nombre: 'El paquete', accion: 'regenerar', por }),
  ];
}

const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

const numeros = (as: Afectada[]) => enumerar(as.map((a) => a.clave.split('-').at(-1)!));
const frasesApartados = (as: Afectada[]) =>
  as.length === 1 ? [`el apartado ${numeros(as)}`] : [`los apartados ${numeros(as)}`];

function frasesFilas(as: Afectada[]): string[] {
  const lotes = [
    ...new Set(as.map((a) => /del lote (\S+)$/.exec(a.nombre)?.[1]).filter((l): l is string => Boolean(l))),
  ];
  if (!lotes.length) return [`${as.length} filas de la lista`];
  return [lotes.length === 1 ? `las filas del lote ${lotes[0]}` : `las filas de los lotes ${enumerar(lotes)}`];
}

// Cada pieza en su frase, en el orden en que salen; apartados y filas, agrupados.
function frases(as: Afectada[]): string[] {
  const anexos = as.filter((a) => a.pieza === 'anexo');
  const grupos: [Pieza, (g: Afectada[]) => string[]][] = [
    ['anexo', (g) => (g.length > 2 ? [`${g.length} anexos`] : g.map((a) => `el ${a.nombre}`))],
    ['apartado', frasesApartados],
    ['documento', frasesFilas],
  ];
  const hechas = new Set<Pieza>();
  return as.flatMap((a) => {
    const grupo = grupos.find(([p]) => p === a.pieza);
    if (!grupo) return [minuscula(a.nombre)];
    if (hechas.has(a.pieza)) return [];
    hechas.add(a.pieza);
    return grupo[1](a.pieza === 'anexo' ? anexos : as.filter((b) => b.pieza === a.pieza));
  });
}

function textoCoste(as: Afectada[]): string {
  const min = as.reduce((s, a) => s + a.coste.min, 0);
  const runs = as.reduce((s, a) => s + a.coste.runs, 0);
  if (runs === 0) return 'Se hace en segundos, sin runs.';
  return `Unos ${min} min, ${runs} ${runs === 1 ? 'run' : 'runs'}.`;
}

function resumenDe(afectadas: Afectada[], mantiene: Mantiene[]): string {
  const cambian = afectadas.filter((a) => a.accion !== 'revisar');
  const revisar = afectadas.filter((a) => a.accion === 'revisar');
  const sigue = mantiene.length
    ? `; ${enumerar(mantiene.map((m) => m.que))} ${mantiene.length === 1 ? 'se mantiene' : 'se mantienen'}`
    : '';
  const partes = [
    cambian.length ? `Cambia ${enumerar(frases(cambian))}${sigue}.` : `No cambia nada de lo hecho${sigue}.`,
    revisar.length ? `Hay que revisar ${enumerar(frases(revisar))}.` : '',
    afectadas.length ? textoCoste(afectadas) : '',
  ];
  return partes.filter(Boolean).join(' ');
}

function seMantiene(e: EstadoImpacto, afectadas: Afectada[], mantiene: Mantiene[]): Mantiene[] {
  const tocadas = new Set(afectadas.map((a) => a.pieza));
  const apartados = afectadas.filter((a) => a.pieza === 'apartado').length;
  const resto = apartados > 0 && apartados < apartadosVigentes(e).length;
  const quedan = mantiene.flatMap((m): Mantiene[] => {
    if (m.pieza === 'apartado' && resto) return [{ ...m, que: 'el resto de la memoria' }];
    return tocadas.has(m.pieza) ? [] : [m];
  });
  return [...new Map(quedan.map((m) => [m.que, m])).values()];
}

/** Lo que un cambio obliga a rehacer, regenerar, podar, ocultar o revisar, con su coste, y lo que sigue valiendo. */
export function impactoDe(estado: EstadoImpacto, cambio: CambioImpacto, porApartado?: RehacerApartado): Impacto {
  const parte = reglas(estado, cambio);
  const afectadas = conPaquete(estado, costeApartados(fusionar(parte.afectadas), porApartado));
  const mantiene = seMantiene(estado, afectadas, parte.mantiene);
  return {
    afectadas,
    se_mantiene: mantiene.map((m) => `${m.que}: ${m.porque}`),
    resumen: resumenDe(afectadas, mantiene),
  };
}
