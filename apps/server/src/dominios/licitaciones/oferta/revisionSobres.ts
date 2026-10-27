// La Revisión por sobre y documento: lo que comprueban las comprobaciones, colocado donde se lee antes de firmar.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { comprobacionesDe } from './comprobaciones.js';
import { nombreArchivo } from './comprobacionesReglasDocumentos.js';
import { claveBloqueo, type Bloqueo, type Comprobaciones } from './comprobacionesTipos.js';
import { criticasDe, criticaVigente } from './critica.js';
import { documentosDe, type DocumentoOferta, type EstadoDocumento } from './documentos.js';
import { tramoMaximo } from './evaluacionMemoria.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { claveCriterio } from './guionLotes.js';
import { aplicacionesDe } from './leccionesAplicadas.js';
import { memoriasDe, type EstadoMemoria } from './memoria.js';
import { REGLA_TRIBUNAL } from './comprobacionesReglasTribunal.js';
import { notaTribunal, textoNota, UMBRAL_TRIBUNAL } from './tribunal.js';

// Cada fila de las comprobaciones va a su documento (el precio, a la oferta económica de su lote; lo de la
// memoria, a la memoria; un criterio, al archivo donde va; la empresa, al DEUC) o a su sobre, y lo que no es de
// ninguno, arriba. Se añaden las páginas frente al límite, que no haya datos de otros sobres, el anonimato, la
// nota del crítico ciego por apartado y las firmas de cada sobre, y en cada memoria las lecciones que se le
// aplicaron. El veredicto y «se puede registrar» son los de las comprobaciones: lo añadido solo avisa.
type EstadoComprobacion = 'correcto' | 'riesgo' | 'impide' | 'pendiente';
// bloqueo: la fila de las comprobaciones donde está la acción («Suavizar», «Pedir cambios»…); destino: otra pieza (el kit de firma).
type AccionRevision = { texto: string; bloqueo: string | null; destino: string | null };
type ComprobacionRevision = {
  clave: string;
  estado: EstadoComprobacion;
  titulo: string;
  detalle: string | null;
  accion: AccionRevision | null;
  aceptado: boolean;
};
// lecciones: en una memoria, las del libro que se pasaron a su redacción, con los apartados y si el crítico las ve cumplidas.
type LeccionAplicadaRevision = { id: number; texto: string; apartados: number[]; cumplida: boolean | null };
type DocumentoRevision = Pick<DocumentoOferta, 'clave' | 'nombre' | 'tipo' | 'lote' | 'ruta'> & {
  estado: EstadoDocumento;
  comprobaciones: ComprobacionRevision[];
  lecciones?: LeccionAplicadaRevision[];
};
type SobreRevision = {
  archivo: string;
  documentos: DocumentoRevision[];
  comprobaciones: ComprobacionRevision[];
};
export type RevisionSobres = {
  veredicto: Comprobaciones['veredicto'];
  cuentas: Record<EstadoComprobacion, number>;
  puede_registrar: boolean;
  calculada_en: string;
  generales: ComprobacionRevision[];
  sobres: SobreRevision[];
};

const ESTADO: Record<Bloqueo['gravedad'], EstadoComprobacion> = {
  impide: 'impide',
  riesgo: 'riesgo',
  no_comprobado: 'pendiente',
  ok: 'correcto',
};
const ACEPTADO = new Set(['riesgo_aceptado', 'vamos']);

// El verbo de la acción, como el botón de las comprobaciones; la acción se hace en su fila.
const VERBO: Partial<Record<Bloqueo['accion']['tipo'], string>> = {
  suavizar: 'Suavizar',
  revisar_memoria: 'Pedir cambios',
  fijar_precio: 'Fijar el precio',
  preparar_documento: 'Prepararlo',
  completar_empresa: 'Completarlo',
  campo: 'Completarlo',
  asignar_rol: 'Asignar a alguien',
  desmarcar_criterio: 'Revisar el criterio',
  subir_certificado: 'Subir el certificado',
  aplicar_diff: 'Revisarlo',
  rehacer_anexo: 'Rehacerlo',
};

function deBloqueo(b: Bloqueo): ComprobacionRevision {
  const cita = b.cita ? `${b.cita.documento}${b.cita.pagina ? `, pág. ${b.cita.pagina}` : ''}` : null;
  return {
    clave: b.clave,
    estado: ESTADO[b.gravedad],
    titulo: b.titulo,
    detalle: cita,
    aceptado: ACEPTADO.has(b.estado),
    accion:
      b.actor === 'fuera' ? null : { texto: VERBO[b.accion.tipo] ?? 'Ver la fila', bloqueo: b.clave, destino: null },
  };
}

// ── Dónde va cada fila ──

type Contexto = { guion: GuionGuardado; documentos: DocumentoOferta[] };
type Sitio = { documento: string | null; archivo: string | null };
const GENERAL: Sitio = { documento: null, archivo: null };

const DE_LA_MEMORIA = new Set(['compromiso_caro', 'compromisos_caros', 'desfase', 'fuga', 'hecho', 'anonimato']);
const MEDIOS = /adscripcion|medios personales|equipo/;

function documentoDeTipo(c: Contexto, tipo: string, lote: string | null): Sitio {
  const delTipo = c.documentos.filter((d) => d.tipo === tipo);
  const d = delTipo.find((x) => lote === null || x.lote === lote || x.lote === null) ?? delTipo[0];
  return d ? { documento: d.clave, archivo: d.archivo } : GENERAL;
}

// La fila de un criterio lleva en su clave el criterio normalizado (comprobacionesReglasDecisiones.ts).
function archivoDelCriterio(c: Contexto, b: Bloqueo): Sitio {
  const a = c.guion.datos.automaticos.find(
    (x) => claveBloqueo('nos_acogemos', b.lote, claveCriterio(x.criterio)) === b.clave,
  );
  const archivo = a
    ? c.documentos.find((d) => textoComparable(d.archivo) === textoComparable(a.archivo))?.archivo
    : undefined;
  return archivo ? { documento: null, archivo } : GENERAL;
}

function archivoSinPreparar(c: Contexto, b: Bloqueo): Sitio {
  const archivo = [...new Set(c.documentos.map((d) => d.archivo))].find(
    (a) => claveBloqueo('documentos_sin_preparar', b.lote, nombreArchivo(a)) === b.clave,
  );
  return archivo ? { documento: null, archivo } : GENERAL;
}

function documentoDeDestino(c: Contexto, destino: string | undefined): Sitio {
  const clave = destino?.startsWith('documentos.') ? destino.slice('documentos.'.length) : null;
  const d = clave ? c.documentos.find((x) => x.clave === clave) : undefined;
  return d ? { documento: d.clave, archivo: d.archivo } : GENERAL;
}

function documentoDeMedios(c: Contexto): Sitio {
  const d = c.documentos.find((x) => MEDIOS.test(textoComparable(x.nombre)));
  return d ? { documento: d.clave, archivo: d.archivo } : GENERAL;
}

function sitioDe(c: Contexto, b: Bloqueo): Sitio {
  const [regla] = b.clave.split(':');
  if (regla === 'precio' || regla === 'dato_anexo')
    return documentoDeTipo(c, 'oferta_economica', regla === 'precio' ? b.lote : null);
  if (regla === 'nos_acogemos') return archivoDelCriterio(c, b);
  if (regla === 'documentos_sin_preparar') return archivoSinPreparar(c, b);
  if (regla === 'obligatorio_condicionado') return documentoDeDestino(c, b.accion.destino);
  if (regla?.startsWith('memoria') || DE_LA_MEMORIA.has(regla ?? '')) return documentoDeTipo(c, 'memoria', b.lote);
  if (b.categoria === 'empresa') return documentoDeTipo(c, 'deuc', null);
  if (regla === 'medios') return documentoDeMedios(c);
  return GENERAL;
}

// ── Lo que añade la Revisión ──

const correcto = (clave: string, titulo: string, detalle: string | null = null): ComprobacionRevision => ({
  clave,
  estado: 'correcto',
  titulo,
  detalle,
  accion: null,
  aceptado: false,
});

function paginas(m: EstadoMemoria): ComprobacionRevision[] {
  const n = m.paginas ?? m.paginas_estimadas;
  if (n === null || m.limite_paginas === null) return [];
  const titulo = `${n} de ${m.limite_paginas} páginas${m.paginas === null ? ' (estimadas)' : ''}`;
  return n <= m.limite_paginas
    ? [correcto(`paginas:${m.id}`, titulo)]
    : // Riesgo y no «impide»: lo que impide registrar lo dicen las comprobaciones, que aún no miran las páginas.
      [
        {
          clave: `paginas:${m.id}`,
          estado: 'riesgo',
          titulo: `${titulo}: pasa del límite del pliego`,
          detalle: null,
          accion: { texto: 'Pedir cambios', bloqueo: null, destino: 'memoria' },
          aceptado: false,
        },
      ];
}

function fugasYAnonimato(m: EstadoMemoria): ComprobacionRevision[] {
  if (m.estado !== 'ensamblada') return [];
  return [
    ...(m.fugas.hallazgos.length ? [] : [correcto(`sin_fugas:${m.id}`, 'Sin datos de otros sobres')]),
    ...(m.anonimato?.exige && m.anonimato.personas === 0
      ? [correcto(`anonimato:${m.id}`, 'Equipo sin nombres, como pide el pliego')]
      : []),
  ];
}

// La nota que le daría la mesa según el crítico ciego, con su margen (tribunal.ts), y los apartados
// por debajo del 70 % de sus puntos. Si las comprobaciones ya traen la fila del tribunal de esta memoria, la
// nota va en esa fila (con su acción) y aquí no se repite.
function notaDelCritico(db: Db, g: GuionGuardado, m: EstadoMemoria, enComprobaciones: boolean): ComprobacionRevision[] {
  const c = criticasDe(db, m.id).at(-1);
  if (!c || !c.maximo) return [];
  const nota = notaTribunal(c, g.datos.memoria);
  const anterior = criticaVigente(db, m.id, c)
    ? ''
    : ' a un texto anterior (algún apartado cambió después): pide otra crítica';
  const total: ComprobacionRevision = {
    clave: `critica:${m.id}`,
    estado: c.total >= UMBRAL_TRIBUNAL * c.maximo && !anterior ? 'correcto' : 'riesgo',
    titulo: `El crítico ciego le da ${nota ? textoNota(nota) : `${c.total} de ${c.maximo}`}${anterior}`,
    detalle: c.datos.resumen.length > 240 ? `${c.datos.resumen.slice(0, 239)}…` : c.datos.resumen,
    accion: null,
    aceptado: false,
  };
  const flojos = c.datos.apartados.flatMap((a): ComprobacionRevision[] => {
    const ap = g.datos.memoria?.apartados[a.apartado - 1];
    const max = ap ? tramoMaximo(ap) : 0;
    if (!ap || !max || a.puntos >= UMBRAL_TRIBUNAL * max) return [];
    const arreglo = a.motivos_para_bajar[0]?.arreglo ?? a.falta[0] ?? null;
    return [
      {
        clave: `critica:${m.id}:${a.apartado}`,
        estado: 'riesgo',
        titulo: `${ap.titulo}: ${a.puntos} de ${max} según el crítico`,
        detalle: arreglo,
        accion: { texto: 'Pedir cambios', bloqueo: null, destino: 'memoria' },
        aceptado: false,
      },
    ];
  });
  return [...(enComprobaciones ? [] : [total]), ...flojos];
}

// La memoria de cada documento de memoria: la de su lote, o la común; nunca la de ensayo.
function memoriaDelDocumento(memorias: EstadoMemoria[], d: DocumentoOferta): EstadoMemoria | null {
  return (
    memorias.find((m) => !m.ensayo && (m.lote ?? null) === d.lote) ??
    memorias.find((m) => !m.ensayo && m.lote === null) ??
    null
  );
}

function deLaMemoria(
  db: Db,
  g: GuionGuardado,
  memorias: EstadoMemoria[],
  d: DocumentoOferta,
  comprobaciones: Comprobaciones,
): ComprobacionRevision[] {
  const m = d.tipo === 'memoria' ? memoriaDelDocumento(memorias, d) : null;
  const enComprobaciones = comprobaciones.bloqueos.some(
    (b) => b.clave === claveBloqueo(REGLA_TRIBUNAL, m?.lote ?? null),
  );
  return m ? [...paginas(m), ...fugasYAnonimato(m), ...notaDelCritico(db, g, m, enComprobaciones)] : [];
}

// Una por lección: cumplida si el crítico la ve en todos sus apartados, no si falla en alguno, null sin comprobar.
function leccionesDeLaMemoria(db: Db, memorias: EstadoMemoria[], d: DocumentoOferta): LeccionAplicadaRevision[] {
  const m = d.tipo === 'memoria' ? memoriaDelDocumento(memorias, d) : null;
  const porLeccion = new Map<number, LeccionAplicadaRevision>();
  for (const a of m ? aplicacionesDe(db, m.id) : []) {
    const l = porLeccion.get(a.leccion_id) ?? { id: a.leccion_id, texto: a.texto, apartados: [], cumplida: true };
    l.apartados.push(a.apartado);
    l.cumplida =
      a.cumplida === false || l.cumplida === false ? false : a.cumplida === null || l.cumplida === null ? null : true;
    porLeccion.set(a.leccion_id, l);
  }
  return [...porLeccion.values()];
}

function firmaDe(g: GuionGuardado, archivo: string): ComprobacionRevision[] {
  const a = g.datos.archivos.find((x) => x.nombre === archivo);
  if (!a?.firma) return [];
  return [
    {
      clave: `firma:${nombreArchivo(archivo)}`,
      estado: 'pendiente',
      titulo: `Hay que firmarlo: ${a.firma.length > 160 ? `${a.firma.slice(0, 159).trimEnd()}…` : a.firma}`,
      detalle: 'Se firma con el kit de firma de la carpeta de la licitación',
      accion: { texto: 'Kit de firma', bloqueo: null, destino: 'kit_firma' },
      aceptado: false,
    },
  ];
}

// ── Todo junto ──

function contar(todas: ComprobacionRevision[]): Record<EstadoComprobacion, number> {
  const cuentas: Record<EstadoComprobacion, number> = { correcto: 0, riesgo: 0, impide: 0, pendiente: 0 };
  for (const c of todas) cuentas[c.aceptado ? 'correcto' : c.estado] += 1;
  return cuentas;
}

function sobresDe(
  db: Db,
  g: GuionGuardado,
  documentos: DocumentoOferta[],
  comprobaciones: Comprobaciones,
): { sobres: SobreRevision[]; generales: ComprobacionRevision[] } {
  const c = { guion: g, documentos };
  const memorias = memoriasDe(db, g.licitacion_id);
  const porDocumento = new Map<string, ComprobacionRevision[]>();
  const porArchivo = new Map<string, ComprobacionRevision[]>();
  const generales: ComprobacionRevision[] = [];
  for (const b of comprobaciones.bloqueos) {
    const s = sitioDe(c, b);
    const destino = s.documento ? porDocumento : s.archivo ? porArchivo : null;
    if (destino)
      destino.set(s.documento ?? s.archivo!, [...(destino.get(s.documento ?? s.archivo!) ?? []), deBloqueo(b)]);
    else generales.push(deBloqueo(b));
  }
  generales.push(
    ...comprobaciones.comprobado
      .filter((x) => x.clave !== 'fugas')
      .map((x) => correcto(`comprobado:${x.clave}`, x.texto)),
  );
  const archivos = [...new Set(documentos.map((d) => d.archivo))];
  const sobres = archivos.map((archivo): SobreRevision => ({
    archivo,
    documentos: documentos
      .filter((d) => d.archivo === archivo && d.estado !== 'no_aplica')
      .map((d) => ({
        clave: d.clave,
        nombre: d.nombre,
        tipo: d.tipo,
        lote: d.lote,
        ruta: d.ruta,
        estado: d.estado,
        comprobaciones: [...(porDocumento.get(d.clave) ?? []), ...deLaMemoria(db, g, memorias, d, comprobaciones)],
        ...(d.tipo === 'memoria' ? { lecciones: leccionesDeLaMemoria(db, memorias, d) } : {}),
      })),
    comprobaciones: [...(porArchivo.get(archivo) ?? []), ...firmaDe(g, archivo)],
  }));
  return { sobres, generales };
}

/** La Revisión de una licitación con guion: el veredicto de las comprobaciones de la oferta y las de cada sobre y documento. */
export function revisionPorSobres(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  ahoraMs = Date.now(),
): Result<RevisionSobres> {
  const comprobaciones = comprobacionesDe(db, dbNucleo, id, ahoraMs);
  if (comprobaciones.error) return comprobaciones;
  const g = guionVigente(db, id);
  if (!g)
    return fail('conflicto', 'Esta licitación aún no tiene guion de la oferta: la Revisión sale de sus documentos.');
  const { sobres, generales } = sobresDe(db, g, documentosDe(db, id).documentos, comprobaciones.data);
  const todas = [
    ...generales,
    ...sobres.flatMap((s) => [...s.comprobaciones, ...s.documentos.flatMap((d) => d.comprobaciones)]),
  ];
  return ok({
    veredicto: comprobaciones.data.veredicto,
    cuentas: contar(todas),
    calculada_en: new Date(ahoraMs).toISOString(),
    // El mismo criterio que el registro del pie de las comprobaciones: ningún «impide» abierto de las comprobaciones.
    puede_registrar: !comprobaciones.data.bloqueos.some((b) => b.gravedad === 'impide' && b.estado === 'abierto'),
    generales,
    sobres,
  });
}
