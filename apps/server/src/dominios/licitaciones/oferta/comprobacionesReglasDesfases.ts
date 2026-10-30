// Desfases de las comprobaciones: piezas ya hechas que llevan un dato que cambió después. Puro.
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { numeroDeAnexo } from './anexosModelo.js';
import { sinImportes } from './comprobacionesCoherencia.js';
import { memoriasDeTrabajo, type EntradasComprobaciones } from './comprobacionesEntradas.js';
import { MINUTOS_POR_ACCION, claveBloqueo, huellaDe, type AccionBloqueo, type Bloqueo } from './comprobacionesTipos.js';
import { cambiosEntre, enumerar, huella, SeccionesAnexo, seccionesDeAnexo } from './dependenciasAnexo.js';
import type { DocumentoConClave, FilaDocumento } from './documentos.js';

// Un anexo rellenado guarda lo que llevó (anexo_dependencias, por valores: deshacer un cambio aún no rehecho lo
// deja al día); los de antes de guardarlo los completa la vuelta de la cadena desde decisiones_historial
// (anexosAuto.ts), así que aquí no se adivina por horas: sin lo que llevó, no hay fila. La portada de la
// memoria lleva los datos de la empresa de cuando se montó. Solo mira las entradas de las comprobaciones. Sin
// importes: se dice qué cambió, nunca a cuánto.
/** Una pieza desfasada: qué es, qué cambió después y qué hacer; con lo que necesita su fila de las comprobaciones. */
export type Desfase = {
  clave: string;
  lote: string | null;
  pieza: string;
  por: string;
  accion: AccionBloqueo;
  titulo: string;
  destino: string;
  huella: string;
  minutos: number;
};

const horaCorta = (iso: string): string => horaLocalEspana(Date.parse(iso)).slice(11, 16);

function nombreAnexo(d: DocumentoConClave): string {
  const n = numeroDeAnexo(d.doc.nombre);
  const base = n ? `El Anexo ${n}` : `«${d.doc.nombre}»`;
  return d.lote ? `${base} del lote ${d.lote}` : base;
}

// Una columna ilegible es como no tenerla: sin lo que llevó no se afirma que esté viejo.
function loQueLlevo(f: FilaDocumento): SeccionesAnexo | null {
  if (!f.anexo_dependencias) return null;
  try {
    const s = SeccionesAnexo.safeParse(JSON.parse(f.anexo_dependencias));
    return s.success ? s.data : null;
  } catch {
    return null;
  }
}

const rellenado = (f: FilaDocumento | undefined): f is FilaDocumento =>
  f !== undefined && f.anexo_en !== null && !f.oculto && f.estado !== 'no_aplica';

function desfaseDeAnexo(e: EntradasComprobaciones, d: DocumentoConClave, f: FilaDocumento): Desfase | null {
  const antes = loQueLlevo(f);
  if (!antes || !e.decisiones) return null;
  const ahora = seccionesDeAnexo(d.doc.tipo, d.lote, e.decisiones.datos);
  const cambios = cambiosEntre(antes, ahora, d.lote);
  if (!cambios.length) return null;
  const por = enumerar(cambios);
  const pieza = nombreAnexo(d);
  return {
    clave: claveBloqueo('desfase', d.lote, d.clave),
    lote: d.lote,
    pieza: pieza.replace(/^El /, ''),
    por,
    accion: 'rehacer_anexo',
    titulo: `${pieza} es anterior ${`a ${por}`.replace(/^a el /, 'al ')} de las ${horaCorta(e.decisiones.actualizada_en)}: vuelve a rellenarlo`,
    destino: `documentos.${d.clave}`,
    huella: huellaDe('desfase', d.clave, f.anexo_en, huella(ahora)),
    minutos: MINUTOS_POR_ACCION.rehacer_anexo,
  };
}

function desfasesDeAnexos(e: EntradasComprobaciones): Desfase[] {
  const filas = new Map(e.documentos.filas.map((f) => [f.clave, f]));
  return e.documentos.del_guion.flatMap((d) => {
    const f = filas.get(d.clave);
    if (d.doc.tipo === 'memoria' || !rellenado(f)) return [];
    const x = desfaseDeAnexo(e, d, f);
    return x ? [x] : [];
  });
}

// La portada (y la firma) se montan con el perfil de entonces; el perfil no guarda qué campo
// cambió, así que se dice lo que la portada lleva de él. La de una presentada ya se entregó así.
// Con memoria por lote, la de cada lote (desfase:<lote>:portada).
function desfasePortada(e: EntradasComprobaciones): Desfase[] {
  const p = e.perfil;
  if (!p) return [];
  return memoriasDeTrabajo(e).flatMap(({ memoria: m, lote }) => {
    if (
      !m ||
      m.presentada ||
      m.estado !== 'ensamblada' ||
      !m.ensamblada_en ||
      Date.parse(m.ensamblada_en) >= Date.parse(p.actualizado_en)
    )
      return [];
    const arreglo = m.origen?.subida ? 'corrígela en tu Word' : 'vuelve a montarla sin IA';
    const pieza = `La portada de la v${m.version}${lote ? ` (lote ${lote})` : ''}`;
    return [
      {
        clave: claveBloqueo('desfase', lote, 'portada'),
        lote,
        pieza,
        por: 'los datos de la empresa',
        accion: 'revisar_memoria',
        titulo: `${pieza} puede llevar el domicilio, el NIF o el representante anterior (la empresa cambió a las ${horaCorta(p.actualizado_en)}): ${arreglo}`,
        destino: 'memoria',
        huella: huellaDe('desfase_portada', m.id, m.ensamblada_en, p.actualizado_en),
        minutos: 1,
      },
    ];
  });
}

/** Las piezas ya hechas que llevan un dato anterior al de ahora. */
export function desfasesDe(e: EntradasComprobaciones): Desfase[] {
  return [...desfasesDeAnexos(e), ...desfasePortada(e)];
}

const filaDe = (x: Desfase): Bloqueo => ({
  clave: x.clave,
  categoria: 'documentos',
  lote: x.lote,
  gravedad: 'riesgo',
  titulo: sinImportes(x.titulo),
  cita: null,
  actor: 'tu',
  accion: { tipo: x.accion, destino: x.destino },
  propuesta: null,
  minutos: x.minutos,
  estado: 'abierto',
  huella: x.huella,
});

export function reglasDesfases(e: EntradasComprobaciones): Bloqueo[] {
  return desfasesDe(e).map(filaDe);
}
