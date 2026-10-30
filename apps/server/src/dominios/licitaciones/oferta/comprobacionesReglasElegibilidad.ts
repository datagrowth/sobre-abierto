// Reglas de elegibilidad de las comprobaciones: cada certificación excluyente frente a las del perfil.
import type { CertificadoData } from '../../../nucleo/empresa.js';
import { eximido } from '../fichaVerificacion.js';
import { certificaciones, sinTildes, type Clave } from '../papeles.js';
import { citaLiteral } from './comprobacionesCitas.js';
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import {
  MINUTOS_POR_ACCION,
  huellaDe,
  type AccionBloqueo,
  type Bloqueo,
  type Cita,
  type Gravedad,
} from './comprobacionesTipos.js';
import type { DocumentoConClave } from './documentos.js';

// Se compara la certificación excluyente de la ficha o del guion con las certificaciones estructuradas del
// perfil, nunca con su texto libre: sin el campo, la fila sale «no comprobado» y nunca «ok».
type Exigencia = { lote: string | null; cert: Clave; cita: Cita; texto: string; documentos: string[] };
type Situacion =
  | { tipo: 'tenemos'; caduca: string | null }
  | { tipo: 'caduca'; caduca: string }
  | { tipo: 'sin_nivel' }
  | { tipo: 'falta' }
  | { tipo: 'sin_perfil' };
type Evaluada = Exigencia & { situacion: Situacion };

const RANGO_NIVEL: Record<string, number> = { basica: 1, media: 2, alta: 3 };
// «ENS MEDIA; se admite ISO 27001 o evidencias equivalentes»: la segunda es una vía para la
// primera, no otra exigencia. Pedirla aparte sería un falso «impide».
const ES_ALTERNATIVA = /alternativ|en su defecto|en caso de no disponer|se admit|equivalente|o bien/;
// La vía alternativa a un certificado que la empresa no tiene: «Anexo XIV… vía alternativa cuando no se presenta certificado ENS».
const VIA_ALTERNATIVA = /alternativ|en su defecto|en caso de no disponer/;
const ANEXO = /\banexo\s+([ivxlcdm]+|\d+)(\s+bis)?\b/i;

const enAmbito = (e: EntradasComprobaciones, lote: string | null): boolean =>
  lote === null || !e.ambito.length || e.ambito.includes(lote);
const fechaCorta = (dia: string): string => dia.split('-').reverse().join('/');
const claveDe = (x: Evaluada): string => `excluyente_vs_perfil:${x.lote ?? '-'}:${x.cert.clave}`;

function pedidasEn(texto: string): Clave[] {
  const pedidas = certificaciones(texto).filter((c) => c.clave !== 'partner-fabricante');
  return pedidas.length > 1 && ES_ALTERNATIVA.test(sinTildes(texto)) ? pedidas.slice(0, 1) : pedidas;
}

function deLaFicha(e: EntradasComprobaciones): Exigencia[] {
  const requisitos = (e.ficha?.datos.requisitos ?? []).filter(
    (r) =>
      r.tipo === 'certificacion' &&
      r.excluyente &&
      r.cumple !== 'no_aplica' &&
      !eximido(r) &&
      enAmbito(e, r.lote ?? null),
  );
  return requisitos.flatMap((r) => {
    const texto = `${r.descripcion} ${r.valor_exigido ?? ''}`.trim();
    const cita: Cita = citaLiteral(e, r) ?? {
      documento: r.documento ?? 'Ficha',
      pagina: r.pagina ?? null,
      texto: r.descripcion,
      comprobada: false,
    };
    return pedidasEn(texto).map((cert) => ({ lote: r.lote ?? null, cert, cita, texto, documentos: [] }));
  });
}

const citaDoc = (d: DocumentoConClave): Cita => ({
  documento: d.doc.origen?.documento ?? d.archivo,
  pagina: d.doc.origen?.pagina ?? null,
  texto: d.doc.nombre,
  comprobada: false,
});

function delGuion(e: EntradasComprobaciones): Exigencia[] {
  const docs = e.documentos.del_guion.filter(
    (d) => d.doc.tipo === 'acreditacion' && d.doc.obligatorio && enAmbito(e, d.lote),
  );
  return docs.flatMap((d) =>
    pedidasEn(d.doc.nombre).map((cert) => ({
      lote: d.lote,
      cert,
      cita: citaDoc(d),
      texto: d.doc.nombre,
      documentos: [d.clave],
    })),
  );
}

const rango = (nivel: string | null | undefined): number => (nivel ? (RANGO_NIVEL[sinTildes(nivel)] ?? 0) : 0);

// Una exigencia por lote y certificación: manda el nivel más alto que se pide, y se recuerdan
// todos los documentos del guion que la piden.
function agrupadas(e: EntradasComprobaciones): Exigencia[] {
  const porClave = new Map<string, Exigencia>();
  for (const x of [...deLaFicha(e), ...delGuion(e)]) {
    const k = `${x.lote ?? '-'}:${x.cert.clave}`;
    const previa = porClave.get(k);
    if (!previa) {
      porClave.set(k, x);
      continue;
    }
    const masAlta = rango(x.cert.nivel) > rango(previa.cert.nivel) ? x : previa;
    porClave.set(k, { ...masAlta, documentos: [...new Set([...previa.documentos, ...x.documentos])] });
  }
  return [...porClave.values()];
}

function situacion(x: Exigencia, certificados: CertificadoData[] | null, plazoDia: string): Situacion {
  if (certificados === null) return { tipo: 'sin_perfil' };
  const mismos = certificados.filter((c) => certificaciones(c.nombre).some((k) => k.clave === x.cert.clave));
  const nivelOk = (c: CertificadoData): boolean => !x.cert.nivel || rango(c.nivel) >= rango(x.cert.nivel);
  const vigente = mismos.find((c) => nivelOk(c) && (c.caduca === null || c.caduca >= plazoDia));
  if (vigente) return { tipo: 'tenemos', caduca: vigente.caduca };
  const caducado = mismos.find((c) => nivelOk(c) && c.caduca !== null);
  if (caducado?.caduca) return { tipo: 'caduca', caduca: caducado.caduca };
  if (x.cert.nivel && mismos.some((c) => c.nivel === null)) return { tipo: 'sin_nivel' };
  return { tipo: 'falta' };
}

function evaluar(e: EntradasComprobaciones): Evaluada[] {
  const certificados = e.perfil?.perfil.certificados ?? null;
  const plazoDia = (e.licitacion.fecha_limite ?? new Date(e.ahoraMs).toISOString()).slice(0, 10);
  return agrupadas(e).map((x) => ({ ...x, situacion: situacion(x, certificados, plazoDia) }));
}

const etiqueta = (c: Clave): string =>
  c.clave === 'ens' ? `ENS${c.nivel ? ` ${c.nivel.toUpperCase()}` : ''}` : c.nombre;
const noLaTenemos = (x: Evaluada): boolean => x.situacion.tipo === 'falta' || x.situacion.tipo === 'caduca';

type Forma = { gravedad: Gravedad; actor: Bloqueo['actor']; accion: AccionBloqueo; titulo: string };

function formaDe(x: Evaluada): Forma | null {
  const etq = etiqueta(x.cert);
  const s = x.situacion;
  if (s.tipo === 'tenemos') return null;
  if (s.tipo === 'sin_perfil')
    return {
      gravedad: 'no_comprobado',
      actor: 'tu',
      accion: 'completar_empresa',
      titulo: `No se puede comprobar «${etq}»: el perfil de empresa no tiene sus certificaciones`,
    };
  if (s.tipo === 'sin_nivel')
    return {
      gravedad: 'no_comprobado',
      actor: 'tu',
      accion: 'completar_empresa',
      titulo: `No se puede comprobar «${etq}»: el perfil no dice la categoría de su ENS`,
    };
  if (s.tipo === 'caduca')
    return {
      gravedad: 'impide',
      actor: 'negocio',
      accion: 'subir_certificado',
      titulo: `El certificado ${etq} caduca el ${fechaCorta(s.caduca)} antes del plazo`,
    };
  return {
    gravedad: 'impide',
    actor: 'negocio',
    accion: 'subir_certificado',
    titulo: `Exigen ${etq} y el perfil no lo tiene`,
  };
}

function filaExigencia(x: Evaluada, certificados: CertificadoData[] | null): Bloqueo | null {
  const f = formaDe(x);
  if (!f) return null;
  return {
    clave: claveDe(x),
    categoria: 'elegibilidad',
    lote: x.lote,
    gravedad: f.gravedad,
    titulo: f.titulo,
    cita: x.cita,
    actor: f.actor,
    accion: { tipo: f.accion, destino: 'empresa.certificados' },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION[f.accion],
    estado: 'abierto',
    huella: huellaDe(x.texto, certificados),
  };
}

function nombreDoc(d: DocumentoConClave): string {
  const m = ANEXO.exec(d.doc.origen?.modelo ?? '') ?? ANEXO.exec(d.doc.nombre);
  return m ? `El Anexo ${m[1]!.toUpperCase()}${m[2] ? ' Bis' : ''}` : `«${d.doc.nombre}»`;
}

function esViaAlternativa(d: DocumentoConClave, x: Evaluada): boolean {
  const texto = `${d.doc.nombre} ${d.doc.notas ?? ''}`;
  const mismoLote = d.lote === null || x.lote === null || d.lote === x.lote;
  return (
    !d.doc.obligatorio &&
    mismoLote &&
    VIA_ALTERNATIVA.test(sinTildes(texto)) &&
    certificaciones(texto).some((c) => c.clave === x.cert.clave)
  );
}

function filaAlternativa(d: DocumentoConClave, x: Evaluada): Bloqueo {
  return {
    clave: `excluyente_alternativa:${d.lote ?? '-'}:${d.clave}`,
    categoria: 'documentos',
    lote: d.lote,
    gravedad: 'impide',
    titulo: `${nombreDoc(d)} pasa a obligatorio: no tenemos ${etiqueta(x.cert)}`,
    cita: { ...citaDoc(d), texto: d.doc.notas ?? d.doc.nombre },
    actor: 'tu',
    accion: { tipo: 'preparar_documento', destino: `documentos.${d.clave}` },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION.preparar_documento,
    estado: 'abierto',
    huella: huellaDe(d.doc.nombre, d.doc.notas ?? null, x.texto),
  };
}

function alternativas(e: EntradasComprobaciones, faltan: readonly Evaluada[]): Bloqueo[] {
  const porClave = new Map<string, Bloqueo>();
  const docs = e.documentos.del_guion.filter((d) => enAmbito(e, d.lote));
  for (const x of faltan) {
    for (const d of docs)
      if (esViaAlternativa(d, x) && !porClave.has(d.clave)) porClave.set(d.clave, filaAlternativa(d, x));
  }
  return [...porClave.values()];
}

export function reglasElegibilidad(e: EntradasComprobaciones): Bloqueo[] {
  const certificados = e.perfil?.perfil.certificados ?? null;
  const evaluadas = evaluar(e);
  const filas = evaluadas.map((x) => filaExigencia(x, certificados)).filter((b): b is Bloqueo => b !== null);
  return [...filas, ...alternativas(e, evaluadas.filter(noLaTenemos))];
}

/** Claves de documento del guion que piden un certificado que la empresa no tiene: ya salen aquí, la regla de documentos no los cuenta otra vez. */
export function documentosDeElegibilidad(e: EntradasComprobaciones): Set<string> {
  return new Set(
    evaluar(e)
      .filter(noLaTenemos)
      .flatMap((x) => x.documentos),
  );
}

/** Las certificaciones exigidas que el perfil cubre y siguen vigentes en el plazo, para «Comprobado». */
export function comprobadoElegibilidad(e: EntradasComprobaciones): { clave: string; texto: string }[] {
  return evaluar(e).flatMap((x) => {
    if (x.situacion.tipo !== 'tenemos') return [];
    const hasta = x.situacion.caduca ? `, vigente hasta ${fechaCorta(x.situacion.caduca)}` : '';
    return [{ clave: claveDe(x), texto: `${etiqueta(x.cert)}: la tenemos${hasta}` }];
  });
}
