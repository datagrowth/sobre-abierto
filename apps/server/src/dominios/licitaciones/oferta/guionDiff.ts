// Qué cambió de un guion al siguiente, por sección. Puro: no lee la base de datos.
import { z } from 'zod';
import { textoComparable } from '../temas.js';
import type { GuionBaseData, OfertaEconomicaLoteData } from './guion.js';

// Compara apartados de la memoria por título, criterios automáticos por criterio y lotes, ofertas económicas por
// lotes, documentos por identidad, y archivos, plazo y lotes en bloque. Así un guion nuevo solo desfasa lo que
// tocó. Ante la duda se marca como cambiado: un falso «sin cambios» dejaría pasar decisiones y memorias hechas
// con otro pliego.
const CAMBIOS_APARTADO = ['nuevo', 'quitado', 'movido', 'puntos', 'contenido', 'escala'] as const;
const Cambio = z.enum(['nuevo', 'quitado', 'cambiado']);

export const CambiosGuionSchema = z.object({
  vacio: z.boolean(),
  apartados: z.array(z.object({ n: z.number().int(), titulo: z.string(), cambio: z.enum(CAMBIOS_APARTADO) })),
  memoria: z.object({
    existe: z.enum(['igual', 'nueva', 'quitada']),
    limite: z.boolean(),
    formato: z.boolean(),
    valorable: z.boolean(),
    advertencias: z.boolean(),
  }),
  automaticos: z.array(z.object({ clave: z.string(), cambio: Cambio })),
  ofertas: z.array(z.object({ lotes: z.string(), cambio: Cambio })),
  documentos: z.array(z.object({ identidad: z.string(), cambio: Cambio })),
  archivos: z.boolean(),
  plazo: z.boolean(),
  lotes: z.boolean(),
});
export type CambiosGuion = z.infer<typeof CambiosGuionSchema>;
type CambioApartado = CambiosGuion['apartados'][number];
type CambioSimple = z.infer<typeof Cambio>;
export type SeccionAfectada = 'automaticos' | 'precio' | 'lotes' | 'enfoque';

// El mismo texto de dos extracciones difiere en mayúsculas, acentos y espacios.
const comparable = (t: string | null | undefined) =>
  textoComparable(t ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const cifra = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
const lotesDe = (l: string[] | undefined) =>
  [...(l ?? [])]
    .map((x) => x.trim())
    .sort()
    .join('+');
const iguales = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Lo que hay de una sección en cada versión, con su clave de emparejamiento y su huella comparable. */
type Pieza = { clave: string; etiqueta: string; huella: unknown };

// documento, pagina, marcas y notas cambian de una extracción a otra sin cambiar el fondo: fuera.
// archivo.contenido y plazo.observaciones son paráfrasis de Hermes, no literales del pliego: fuera.
function huellaArchivos(g: GuionBaseData | null): unknown {
  return (g?.archivos ?? []).map((a) => ({
    nombre: comparable(a.nombre),
    prohibiciones: a.prohibiciones.map(comparable),
    firma: comparable(a.firma),
    ambito: a.ambito ?? null,
    indice: a.indice ?? false,
  }));
}

function piezasAutomaticos(g: GuionBaseData | null): Pieza[] {
  return (g?.automaticos ?? []).map((a) => {
    const lotes = lotesDe(a.lotes);
    return {
      clave: `${comparable(a.criterio)}|${lotes}`,
      etiqueta: lotes ? `${a.criterio} · lotes ${lotes}` : a.criterio,
      huella: {
        puntos: cifra(a.puntos),
        acredita: comparable(a.como_se_acredita),
        casilla: comparable(a.casilla_en),
        archivo: comparable(a.archivo),
        tipo: a.tipo ?? null,
        exige: comparable(a.exige_documento),
        penalizacion: comparable(a.penalizacion?.texto),
        tramos: (a.tramos ?? []).map((t) => [comparable(t.descripcion), cifra(t.puntos), comparable(t.valor)]),
      },
    };
  });
}

// Los guiones de antes de las ofertas por lote traen una sola, que vale para el contrato entero.
function ofertasDe(g: GuionBaseData | null): OfertaEconomicaLoteData[] {
  if (!g) return [];
  if (g.ofertas_economicas?.length) return g.ofertas_economicas;
  return g.oferta_economica ? [{ ...g.oferta_economica, lotes: [], precios_unitarios: [] }] : [];
}

function piezasOfertas(g: GuionBaseData | null): Pieza[] {
  return ofertasDe(g).map((o) => ({
    clave: lotesDe(o.lotes),
    etiqueta: lotesDe(o.lotes),
    huella: {
      formula: comparable(o.formula),
      presupuesto: cifra(o.presupuesto_base),
      impuesto: o.impuesto_aparte,
      unitario: o.precio_unitario ? [comparable(o.precio_unitario.unidad), cifra(o.precio_unitario.maximo)] : null,
      anormalidad: comparable(o.umbral_anormalidad),
      baja: cifra(o.umbral_baja),
      redondeo: comparable(o.redondeo),
      modelo: comparable(o.modelo),
      archivo: comparable(o.archivo),
      precios: o.precios_unitarios.map((p) => [
        comparable(p.concepto),
        comparable(p.unidad),
        cifra(p.maximo),
        cifra(p.cantidad),
      ]),
    },
  }));
}

// Identidad de un documento: tipo, nombre, modelo y lotes; no su posición ni su archivo.
function piezasDocumentos(g: GuionBaseData | null): Pieza[] {
  return (g?.archivos ?? []).flatMap((a) =>
    a.documentos.map((d) => {
      const lotes = lotesDe(d.lotes);
      const modelo = d.origen?.modelo ?? '';
      return {
        clave: [d.tipo, comparable(d.nombre), comparable(modelo), lotes].join('|'),
        etiqueta: [d.tipo, d.nombre, ...(modelo ? [modelo] : []), ...(lotes ? [`lotes ${lotes}`] : [])].join(' · '),
        huella: { obligatorio: d.obligatorio, produce: d.produce, archivo: comparable(a.nombre) },
      };
    }),
  );
}

/** Empareja las piezas por clave, en orden, y da las nuevas, las quitadas y las cambiadas. */
function cambiosDePiezas(antes: Pieza[], despues: Pieza[]): { etiqueta: string; cambio: CambioSimple }[] {
  const libres = [...antes];
  const out: { etiqueta: string; cambio: CambioSimple }[] = [];
  for (const d of despues) {
    const i = libres.findIndex((a) => a.clave === d.clave);
    if (i < 0) {
      out.push({ etiqueta: d.etiqueta, cambio: 'nuevo' });
      continue;
    }
    const [a] = libres.splice(i, 1);
    if (!iguales(a!.huella, d.huella)) out.push({ etiqueta: d.etiqueta, cambio: 'cambiado' });
  }
  return [...out, ...libres.map((a) => ({ etiqueta: a.etiqueta, cambio: 'quitado' as const }))];
}

type Apartado = NonNullable<GuionBaseData['memoria']>['apartados'][number];

// El cambio de un apartado emparejado, el primero de la lista: movido, puntos, contenido, escala.
function cambioDeApartado(a: Apartado, d: Apartado, movido: boolean): CambioApartado['cambio'] | null {
  if (movido) return 'movido';
  if (
    cifra(a.puntos) !== cifra(d.puntos) ||
    !iguales((a.puntos_se_valorara ?? []).map(cifra), (d.puntos_se_valorara ?? []).map(cifra))
  )
    return 'puntos';
  if (!iguales(a.se_valorara.map(comparable), d.se_valorara.map(comparable))) return 'contenido';
  if (
    !iguales(
      a.escala.map((e) => [cifra(e.puntos), comparable(e.descripcion)]),
      d.escala.map((e) => [cifra(e.puntos), comparable(e.descripcion)]),
    )
  )
    return 'escala';
  return null;
}

// Las posiciones que siguen en orden: la subsecuencia creciente más larga de los índices de
// antes (son ≤ 20 apartados). Las demás son las que se movieron.
function enOrden(indices: number[]): Set<number> {
  const largo = indices.map(() => 1);
  const previo = indices.map(() => -1);
  indices.forEach((x, i) => {
    for (let j = 0; j < i; j += 1)
      if (indices[j]! < x && largo[j]! + 1 > largo[i]!) {
        largo[i] = largo[j]! + 1;
        previo[i] = j;
      }
  });
  const quedan = new Set<number>();
  for (let i = largo.indexOf(Math.max(0, ...largo)); i >= 0; i = previo[i]!) quedan.add(i);
  return quedan;
}

// Movido es cambiar de orden respecto de los demás que siguen: añadir uno delante, o llevar el
// último al principio, no mueve el resto.
function cambiosApartados(antes: Apartado[], despues: Apartado[]): CambioApartado[] {
  const libres = antes.map((a, i) => ({ a, i }));
  const pares: { a: Apartado; ia: number; d: Apartado; n: number }[] = [];
  const out: CambioApartado[] = [];
  despues.forEach((d, j) => {
    const k = libres.findIndex((l) => comparable(l.a.titulo) === comparable(d.titulo));
    if (k < 0) {
      out.push({ n: j + 1, titulo: d.titulo, cambio: 'nuevo' });
      return;
    }
    const [l] = libres.splice(k, 1);
    pares.push({ a: l!.a, ia: l!.i, d, n: j + 1 });
  });
  const quedan = enOrden(pares.map((p) => p.ia));
  pares.forEach((p, r) => {
    const cambio = cambioDeApartado(p.a, p.d, !quedan.has(r));
    if (cambio) out.push({ n: p.n, titulo: p.d.titulo, cambio });
  });
  return [...out, ...libres.map((l) => ({ n: l.i + 1, titulo: l.a.titulo, cambio: 'quitado' as const }))].sort(
    (x, y) => x.n - y.n,
  );
}

type Memoria = GuionBaseData['memoria'];

// Si la memoria aparece o desaparece, todo lo suyo cuenta como cambiado.
function cambiosMemoria(a: Memoria, d: Memoria): CambiosGuion['memoria'] {
  if (!a || !d) {
    const existe = a === d ? 'igual' : a ? 'quitada' : 'nueva';
    const todo = existe !== 'igual';
    return { existe, limite: todo, formato: todo, valorable: todo, advertencias: todo };
  }
  const formato = (m: NonNullable<Memoria>) => [
    comparable(m.formato?.fuente),
    cifra(m.formato?.tamano_letra),
    cifra(m.formato?.interlineado),
    comparable(m.formato?.otros),
  ];
  const advertencias = (m: NonNullable<Memoria>) => m.advertencias.map(comparable).sort();
  return {
    existe: 'igual',
    limite: a.limite_paginas !== d.limite_paginas || comparable(a.limite_detalle) !== comparable(d.limite_detalle),
    formato: !iguales(formato(a), formato(d)),
    valorable: (a.valorable ?? true) !== (d.valorable ?? true),
    advertencias: !iguales(advertencias(a), advertencias(d)),
  };
}

const huellaPlazo = (g: GuionBaseData | null) => (g ? [g.plazo.fecha_limite, comparable(g.plazo.canal)] : null);

/** ¿No cambió nada? */
function estaVacio(c: Omit<CambiosGuion, 'vacio'>): boolean {
  const m = c.memoria;
  const memoria = m.existe === 'igual' && !m.limite && !m.formato && !m.valorable && !m.advertencias;
  return (
    memoria &&
    !c.apartados.length &&
    !c.automaticos.length &&
    !c.ofertas.length &&
    !c.documentos.length &&
    !c.archivos &&
    !c.plazo &&
    !c.lotes
  );
}

/** Qué cambia de `antes` (null: no había guion) a `despues`, por sección. */
export function diferenciasGuion(antes: GuionBaseData | null, despues: GuionBaseData): CambiosGuion {
  const c = {
    apartados: cambiosApartados(antes?.memoria?.apartados ?? [], despues.memoria?.apartados ?? []),
    memoria: cambiosMemoria(antes?.memoria ?? null, despues.memoria),
    automaticos: cambiosDePiezas(piezasAutomaticos(antes), piezasAutomaticos(despues)).map((x) => ({
      clave: x.etiqueta,
      cambio: x.cambio,
    })),
    ofertas: cambiosDePiezas(piezasOfertas(antes), piezasOfertas(despues)).map((x) => ({
      lotes: x.etiqueta,
      cambio: x.cambio,
    })),
    documentos: cambiosDePiezas(piezasDocumentos(antes), piezasDocumentos(despues)).map((x) => ({
      identidad: x.etiqueta,
      cambio: x.cambio,
    })),
    archivos: !iguales(huellaArchivos(antes), huellaArchivos(despues)),
    plazo: !iguales(huellaPlazo(antes), huellaPlazo(despues)),
    lotes: antes === null ? Boolean(despues.lotes?.length) : lotesDe(antes.lotes) !== lotesDe(despues.lotes),
  };
  return { vacio: estaVacio(c), ...c };
}

/** ¿Siguen valiendo los apartados de una memoria hecha con el guion anterior? */
export function apartadosCompatibles(c: CambiosGuion): boolean {
  const estructura = c.apartados.some((a) => a.cambio === 'nuevo' || a.cambio === 'quitado' || a.cambio === 'movido');
  return c.memoria.existe === 'igual' && !estructura && !c.memoria.limite && !c.memoria.formato;
}

/** Las secciones de las decisiones que tocan los cambios. */
export function seccionesAfectadas(c: CambiosGuion): SeccionAfectada[] {
  const m = c.memoria;
  const enfoque = c.apartados.length > 0 || m.existe !== 'igual' || m.valorable || m.advertencias;
  const todas: [SeccionAfectada, boolean][] = [
    ['automaticos', c.automaticos.length > 0],
    ['precio', c.ofertas.length > 0],
    ['lotes', c.lotes],
    ['enfoque', enfoque],
  ];
  return todas.filter(([, si]) => si).map(([s]) => s);
}

// Dos cambios seguidos de lo mismo. Añadido y luego quitado: como estaba (no existía). Quitado y
// luego añadido: no se sabe si vuelve igual, así que cambiado.
function seguidos(a: CambioSimple, b: CambioSimple): CambioSimple | null {
  if (a === 'nuevo') return b === 'quitado' ? null : 'nuevo';
  if (a === 'quitado') return b === 'nuevo' ? 'cambiado' : b;
  return b === 'quitado' ? 'quitado' : 'cambiado';
}

// Una lista de cambios por versión, emparejados por etiqueta comparable y encadenados con `seguir`.
function componerLista<C extends string, T extends { cambio: C }>(
  listas: T[][],
  etiqueta: (t: T) => string,
  seguir: (a: C, b: C) => C | null,
): T[] {
  const acc = new Map<string, T>();
  for (const c of listas.flat()) {
    const k = comparable(etiqueta(c));
    const previo = acc.get(k);
    const cambio = previo ? seguir(previo.cambio, c.cambio) : c.cambio;
    if (cambio === null) acc.delete(k);
    else acc.set(k, { ...c, cambio });
  }
  return [...acc.values()];
}

// Quitado y vuelto a añadir cuenta como movido: no se sabe si vuelve en el mismo sitio.
function seguidosApartado(a: CambioApartado['cambio'], b: CambioApartado['cambio']): CambioApartado['cambio'] | null {
  if (a === 'nuevo') return b === 'quitado' ? null : 'nuevo';
  if (a === 'quitado') return b === 'nuevo' ? 'movido' : b;
  if (b === 'quitado') return 'quitado';
  return CAMBIOS_APARTADO.indexOf(a) <= CAMBIOS_APARTADO.indexOf(b) ? a : b;
}

function componerMemoria(ms: CambiosGuion['memoria'][]): CambiosGuion['memoria'] {
  const existe = ms.reduce<CambiosGuion['memoria']['existe']>(
    (a, m) => (a === 'igual' ? m.existe : m.existe === 'igual' ? a : 'igual'),
    'igual',
  );
  const alguna = (k: 'limite' | 'formato' | 'valorable' | 'advertencias') => ms.some((m) => m[k]);
  return {
    existe,
    limite: alguna('limite'),
    formato: alguna('formato'),
    valorable: alguna('valorable'),
    advertencias: alguna('advertencias'),
  };
}

/** Los cambios de una cadena de versiones seguidas, de la primera a la última, como uno solo. */
export function componer(cambios: CambiosGuion[]): CambiosGuion {
  const c = {
    apartados: componerLista(
      cambios.map((x) => x.apartados),
      (a) => a.titulo,
      seguidosApartado,
    ).sort((x, y) => x.n - y.n),
    memoria: componerMemoria(cambios.map((x) => x.memoria)),
    automaticos: componerLista(
      cambios.map((x) => x.automaticos),
      (a) => a.clave,
      seguidos,
    ),
    ofertas: componerLista(
      cambios.map((x) => x.ofertas),
      (o) => o.lotes,
      seguidos,
    ),
    documentos: componerLista(
      cambios.map((x) => x.documentos),
      (d) => d.identidad,
      seguidos,
    ),
    archivos: cambios.some((x) => x.archivos),
    plazo: cambios.some((x) => x.plazo),
    lotes: cambios.some((x) => x.lotes),
  };
  return { vacio: estaVacio(c), ...c };
}
