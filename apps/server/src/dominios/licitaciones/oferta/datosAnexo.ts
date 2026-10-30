// Datos que un anexo pide y el pliego no fija: subcontratación de servidores, orden de lotes e impuesto.
import { leerPlan } from './anexoPlan.js';
import type { DecisionesData } from './decisiones.js';
import type { FilaDocumento } from './documentos.js';
import type { GuionBaseData } from './guion.js';
import { ofertasEconomicas } from './guionLotes.js';

// Los decide una persona (decisiones.datos_anexo); aquí solo se detecta cuáles pide esta oferta, con la frase
// que lo pide. Detección por regex: puede pedir de más, y por eso las comprobaciones lo dejan en riesgo hasta
// cinco días antes y la persona puede descartarlo con motivo.
export const DATOS_ANEXO = ['subcontratacion_servidores', 'orden_lotes', 'impuesto'] as const;
export type DatoAnexo = (typeof DATOS_ANEXO)[number];

/** Un texto donde buscar: un modelo (o un párrafo suyo) o una pieza del guion, con dónde está. */
export type TextoModelo = { clave: string; texto: string; documento?: string; pagina?: number | null };
type CitaDato = { documento: string; pagina: number | null; texto: string };
export type DatoPedido = { dato: DatoAnexo; cita: CitaDato };

const PATRONES: readonly [Exclude<DatoAnexo, 'impuesto'>, RegExp][] = [
  ['subcontratacion_servidores', /subcontrat\w+[^.]{0,80}servidor/i],
  ['orden_lotes', /orden de preferencia[^.]{0,40}lotes/i],
];
const EXENCION = /exent/i;
const MAX_CITA = 300;

// La frase donde está la coincidencia: del punto (o salto) anterior al siguiente, recortada.
function fraseDe(texto: string, desde: number): string {
  const inicio = Math.max(texto.lastIndexOf('.', desde), texto.lastIndexOf('\n', desde)) + 1;
  const finPunto = texto.indexOf('.', desde);
  const frase = texto
    .slice(inicio, finPunto === -1 ? texto.length : finPunto + 1)
    .replace(/\s+/g, ' ')
    .trim();
  return frase.length > MAX_CITA ? `${frase.slice(0, MAX_CITA - 1)}…` : frase;
}

const citaDe = (t: TextoModelo, desde: number): CitaDato => ({
  documento: t.documento ?? t.clave,
  pagina: t.pagina ?? null,
  texto: fraseDe(t.texto, desde),
});

/** Lo que dice el guion de cada documento (nombre, notas, modelo) y de cada oferta económica. */
function textosDelGuion(g: GuionBaseData): TextoModelo[] {
  const documentos = g.archivos.flatMap((a) =>
    a.documentos.map((d) => ({
      clave: 'guion',
      texto: [d.nombre, d.origen?.modelo, d.notas].filter(Boolean).join('. '),
      documento: d.origen?.documento ?? d.nombre,
      pagina: d.origen?.pagina ?? null,
    })),
  );
  const ofertas = ofertasEconomicas(g).map((o) => ({
    clave: 'guion',
    texto: [o.modelo, o.formula].filter(Boolean).join('. '),
    documento: o.documento ?? o.archivo,
    pagina: o.pagina ?? null,
  }));
  return [...documentos, ...ofertas];
}

/** El texto de los modelos ya rellenados: cada párrafo o campo que su plan tocó (anexoPlan.ts). */
export function textosDeDocumentos(
  filas: readonly Pick<FilaDocumento, 'clave' | 'nombre' | 'sustituciones'>[],
): TextoModelo[] {
  return filas.flatMap((f) => {
    const plan = leerPlan(f.sustituciones);
    if (!plan) return [];
    const textos =
      plan.formato === 'docx' ? plan.items.map((x) => x.original) : plan.campos.map((c) => `${c.nombre}: ${c.dato}`);
    return textos.map((texto) => ({ clave: f.clave, texto, documento: f.nombre, pagina: null }));
  });
}

function primeraCita(textos: readonly TextoModelo[], re: RegExp): CitaDato | null {
  for (const t of textos) {
    const m = re.exec(t.texto);
    if (m) return citaDe(t, m.index);
  }
  return null;
}

// Solo se pide el impuesto con algo que lo ponga en duda: una frase que habla de exención, un
// guion que no dice qué impuesto va aparte o el IGIC (p. ej. una formación que puede estar exenta o
// con tipo reducido). Con IVA aparte y sin exención el 21 % no se pregunta: a
// pocos días del plazo frenaría el veredicto y la regeneración del paquete por nada.
function citaImpuesto(g: GuionBaseData, textos: readonly TextoModelo[]): CitaDato | null {
  const ofertas = ofertasEconomicas(g).filter((o) => o.impuesto_aparte !== 'exento');
  if (!ofertas.length) return null;
  const exencion = primeraCita(textos, EXENCION);
  if (exencion) return exencion;
  const conImpuesto = ofertas.find((o) => o.impuesto_aparte !== 'IVA');
  if (!conImpuesto) return null;
  const texto = conImpuesto.impuesto_aparte
    ? `${conImpuesto.impuesto_aparte} aparte`
    : 'El guion no dice qué impuesto va aparte';
  return {
    documento: conImpuesto.documento ?? conImpuesto.archivo,
    pagina: conImpuesto.pagina ?? null,
    texto: `${conImpuesto.modelo ?? 'Oferta económica'}: ${texto}`,
  };
}

/** Los datos de anexo que pide esta oferta, uno por dato, con la primera frase que lo pide. */
export function datosQuePide(g: GuionBaseData, textosModelos: readonly TextoModelo[]): DatoPedido[] {
  const textos = [...textosModelos, ...textosDelGuion(g)];
  const pedidos: DatoPedido[] = PATRONES.flatMap(([dato, re]) => {
    const cita = primeraCita(textos, re);
    return cita ? [{ dato, cita }] : [];
  });
  const impuesto = citaImpuesto(g, textos);
  return impuesto ? [...pedidos, { dato: 'impuesto', cita: impuesto }] : pedidos;
}

type ConDatosAnexo = Pick<DecisionesData, 'datos_anexo'> & Partial<Pick<DecisionesData, 'lotes'>>;

/**
 * El orden de preferencia guardado, si sigue valiendo: con los lotes decididos, tiene que traer
 * exactamente esos (si no, quitar un lote dejaría su nombre en el anexo).
 */
export function ordenVigente(d: ConDatosAnexo | null | undefined): string[] | null {
  const orden = d?.datos_anexo?.orden_lotes;
  if (!orden?.length) return null;
  const lotes = d?.lotes ?? [];
  if (!lotes.length) return orden;
  const mismos = orden.length === lotes.length && lotes.every((l) => orden.includes(l));
  return mismos ? orden : null;
}

/** Si ese dato ya está decidido (null o sin decisiones = sin decidir; un orden de lotes que ya no son los decididos, también). */
export function datoDecidido(d: ConDatosAnexo | null | undefined, dato: DatoAnexo): boolean {
  if (dato === 'orden_lotes') return ordenVigente(d) !== null;
  const v = d?.datos_anexo?.[dato];
  return v !== null && v !== undefined;
}
