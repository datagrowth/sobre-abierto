// La vía alternativa de un requisito excluyente (p. ej. una declaración cuando falta un certificado):
// es una apuesta de la persona, así que pedirla exige confirmación y nunca se pide sola.
import { nucleo } from '../../../nucleo/contexto.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { fichasDe, type FichaDatosData } from '../ficha.js';
import { certificaciones } from '../papeles.js';
import type { Db } from '../store.js';
import { comprobacionesDe } from './comprobaciones.js';
import type { DocumentoConClave } from './documentos.js';
import { guardaPlazo } from './plazo.js';
import { comparable, modeloBuscado, numeroDeAnexo } from './anexosModelo.js';

type RequisitoDeFicha = FichaDatosData['requisitos'][number];
// El código del aviso que la persona confirma (409 en STATUS; la web lo reenvía con ?confirmar=1).
export const VIA_SIN_CONFIRMAR = 'via_alternativa';

// Como palabra entera: una nota que nombra el «Anexo XIV» no nombra el «Anexo X».
function nombraModelo(texto: string, modelo: string): boolean {
  const m = comparable(modelo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return m !== '' && new RegExp(`(?:^|[^a-z0-9])${m}(?:$|[^a-z0-9])`).test(comparable(texto));
}

// Lo que dice que un modelo sustituye a lo exigido, no que es el modelo con que se acredita.
const MARCA_DE_VIA =
  /\b(?:alternativ\w*|en su defecto|equivalentes?|en lugar de|si no (?:se )?(?:dispone|tiene|tenemos|cuenta))\b/;

// La frase de la nota que nombra el modelo lo marca como vía alternativa («Si no se dispone del
// certificado, presentar Anexo XIV…»): «se acredita con el Anexo III» es el anexo de siempre.
function nombraComoVia(texto: string, modelo: string): boolean {
  return texto.split(/[.;\n]\s/).some((frase) => nombraModelo(frase, modelo) && MARCA_DE_VIA.test(comparable(frase)));
}

/**
 * Qué dicen las comprobaciones de la certificación que pide el requisito: «abierta» (bloqueo sin decidir),
 * «cerrada» (la persona dijo «Vamos» o aceptó el riesgo: la vía se prepara) o «cubierta» (el perfil
 * la tiene: la vía sobra). null si no se sabe: no es una certificación, las comprobaciones no se calculan o no
 * evalúa esa exigencia (sin palabra clave que reconozca, un «partner»…); entonces decide la ficha.
 */
export type EstadoElegibilidad = 'abierta' | 'cerrada' | 'cubierta';
type EnComprobaciones = (r: RequisitoDeFicha) => EstadoElegibilidad | null;

const certDeClave = (clave: string): string | null => {
  const [regla, , ...cert] = clave.split(':');
  return regla === 'excluyente_vs_perfil' ? cert.join(':') : null;
};

export function estadoElegibilidad(db: Db, id: string, r: RequisitoDeFicha): EstadoElegibilidad | null {
  if (r.tipo !== 'certificacion') return null;
  const comprobaciones = comprobacionesDe(db, nucleo().db, id);
  if (comprobaciones.error) return null;
  const pedidas = new Set(certificaciones(`${r.descripcion} ${r.valor_exigido ?? ''}`).map((c) => c.clave));
  const deEsta = (clave: string): boolean => pedidas.has(certDeClave(clave) ?? '');
  const bloqueos = comprobaciones.data.bloqueos.filter((b) => deEsta(b.clave));
  if (bloqueos.some((b) => b.estado === 'abierto' || b.estado === 'propuesta')) return 'abierta';
  if (bloqueos.length) return 'cerrada';
  return comprobaciones.data.comprobado.some((c) => deEsta(c.clave)) ? 'cubierta' : null;
}

// cuentan: los estados de las comprobaciones en que el documento hace de vía; sin comprobaciones calculadas (o si no sabe), la
// ficha: excluyente sin cumplir (no o dudoso). El freno solo mira lo abierto; la cola salta además lo
// que el perfil ya cubre; las instrucciones del run tratan como vía también lo cerrado con «Vamos».
export function requisitoDeLaVia(
  ficha: FichaDatosData | null,
  d: DocumentoConClave,
  enComprobaciones?: EnComprobaciones,
  cuentan: readonly EstadoElegibilidad[] = ['abierta'],
): RequisitoDeFicha | null {
  if (!ficha || d.doc.tipo === 'memoria') return null;
  const modelo = modeloBuscado(d);
  const laNombra = (r: RequisitoDeFicha) =>
    r.excluyente && [r.descripcion, r.justificacion].some((t) => nombraComoVia(t, modelo));
  const cuenta = (r: RequisitoDeFicha): boolean => {
    const e = enComprobaciones?.(r) ?? null;
    return e === null ? r.cumple === 'no' || r.cumple === 'dudoso' : cuentan.includes(e);
  };
  return ficha.requisitos.find((r) => laNombra(r) && cuenta(r)) ?? null;
}

/** ¿Es el documento la vía alternativa de un requisito excluyente abierto? Lo es si una frase de la nota del requisito en la ficha nombra su modelo como alternativa y el bloqueo sigue abierto (en las comprobaciones si se pasa `enComprobaciones`; si no, o si no sabe, en la ficha). */
export function esViaAlternativa(
  ficha: FichaDatosData | null,
  d: DocumentoConClave,
  enComprobaciones?: EnComprobaciones,
): boolean {
  return requisitoDeLaVia(ficha, d, enComprobaciones) !== null;
}

export const fichaDe = (db: Db, id: string): FichaDatosData | null => fichasDe(db, id).aprobada?.datos ?? null;

// Prepararlo es una apuesta de la persona (gasta un run y no cierra el requisito): pasa solo con `confirmado`.
function frenoDeVia(db: Db, id: string, d: DocumentoConClave, confirmadoYa: boolean | undefined): Result<null> {
  const r = confirmadoYa ? null : requisitoDeLaVia(fichaDe(db, id), d, (r) => estadoElegibilidad(db, id, r));
  if (!r) return ok(null);
  const que = /\bENS\b/.test(`${r.descripcion} ${r.valor_exigido ?? ''}`)
    ? 'El ENS'
    : `El requisito «${r.descripcion.slice(0, 80)}»`;
  const n = numeroDeAnexo(modeloBuscado(d));
  return fail(
    VIA_SIN_CONFIRMAR,
    `${que} sigue abierto: preparas el ${n ? `Anexo ${n}` : `«${modeloBuscado(d)}»`} como vía alternativa. Gasta 1 run.`,
  );
}

// La vía alternativa y el plazo justo se confirman a la vez (`confirmado` deja pasar los dos): si
// llegaran por separado, confirmar el primero callaría el segundo. Lo que no da tiempo no se confirma.
export function frenosConfirmables(
  db: Db,
  id: string,
  d: DocumentoConClave,
  confirmadoYa: boolean | undefined,
): Result<null> {
  const plazo = guardaPlazo(db, id, 'anexo', { aMano: true, confirmado: confirmadoYa });
  if (plazo.error && plazo.error.code !== 'plazo_justo') return plazo;
  const via = frenoDeVia(db, id, d, confirmadoYa);
  if (!via.error) return plazo.error ? plazo : ok(null);
  return fail(VIA_SIN_CONFIRMAR, [via.error.message, plazo.error?.message].filter(Boolean).join(' '));
}
