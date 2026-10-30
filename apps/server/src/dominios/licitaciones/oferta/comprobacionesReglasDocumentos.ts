// Reglas de documentos de las comprobaciones: datos de empresa de anexos y DEUC, obligatorios, fugas y hechos.
import { municipioDe, type PerfilEmpresaData } from '../../../nucleo/empresa.js';
import { textoComparable } from '../temas.js';
import { sinImportes } from './comprobacionesCoherencia.js';
import { memoriasEvaluadas, type EntradasComprobaciones, type MemoriaEvaluada } from './comprobacionesEntradas.js';
import { documentosDeElegibilidad, reglasElegibilidad } from './comprobacionesReglasElegibilidad.js';
import {
  MINUTOS_POR_ACCION,
  claveBloqueo,
  huellaDe,
  type AccionBloqueo,
  type Bloqueo,
  type Categoria,
  type Cita,
  type Gravedad,
} from './comprobacionesTipos.js';
import type { DocumentoConClave } from './documentos.js';
import { lotesMencionados } from './lotesMencionados.js';
import { lotesDeMemoria } from './memoriaLote.js';

// Cubren los datos de empresa que piden los anexos y el DEUC, documentos que pasan a obligatorios por lo
// decidido, obligatorios sin preparar, memoria única cuando el pliego pide una por lote, fugas sin anular y
// hechos.
type Fila = {
  clave: string;
  categoria: Categoria;
  lote: string | null;
  gravedad: Gravedad;
  titulo: string;
  cita?: Cita | null;
  actor: Bloqueo['actor'];
  accion: AccionBloqueo;
  destino: string;
  huella: string;
  minutos?: number;
};

function fila(f: Fila): Bloqueo {
  const minutos = f.actor === 'fuera' ? 0 : (f.minutos ?? MINUTOS_POR_ACCION[f.accion]);
  return {
    clave: f.clave,
    categoria: f.categoria,
    lote: f.lote,
    gravedad: f.gravedad,
    titulo: sinImportes(f.titulo),
    cita: f.cita ?? null,
    actor: f.actor,
    accion: { tipo: f.accion, destino: f.destino },
    propuesta: null,
    minutos,
    estado: 'abierto',
    huella: f.huella,
  };
}

const enAmbito = (e: EntradasComprobaciones, lote: string | null): boolean =>
  lote === null || !e.ambito.length || e.ambito.includes(lote);
// Un documento sin lote en su fila puede nombrarlo («ANEXO III LOTE 2»): si nombra solo
// lotes a los que no se va, no cuenta, igual que en el cajón Documentos (lotesDeDocumento de la web).
function lotesDelDocumento(e: EntradasComprobaciones, d: DocumentoConClave): string[] {
  if (d.lote !== null) return [d.lote];
  return lotesMencionados(
    `${d.doc.nombre}. ${d.doc.origen?.modelo ?? ''}`,
    e.lotes.lotes.map((l) => l.id),
  );
}

const delAmbito = (e: EntradasComprobaciones): DocumentoConClave[] =>
  e.documentos.del_guion.filter((d) => {
    const lotes = lotesDelDocumento(e, d);
    return !lotes.length || lotes.some((l) => enAmbito(e, l));
  });
const citaDoc = (d: DocumentoConClave): Cita => ({
  documento: d.doc.origen?.documento ?? d.archivo,
  pagina: d.doc.origen?.pagina ?? null,
  texto: d.doc.nombre,
  comprobada: false,
});

// ── Datos de empresa ──────────────────────────────────────────────────────────────

type CampoEmpresa = { campo: string; nombre: string; gravedad: Gravedad; falta: (p: PerfilEmpresaData) => boolean };

const vacio = (v: string | null | undefined): boolean => !v?.trim();
// Sin código postal ni municipio el domicilio no sirve para el DEUC ni para el lugar de la firma.
const sinDomicilio = (p: PerfilEmpresaData): boolean => !p.direccion && municipioDe(p.domicilio) === null;
const EN_DEUC = '(va en el DEUC y en los anexos)';

const CAMPOS_EMPRESA: readonly CampoEmpresa[] = [
  {
    campo: 'nombre',
    nombre: `Falta el nombre de la empresa ${EN_DEUC}`,
    gravedad: 'impide',
    falta: (p) => vacio(p.nombre),
  },
  { campo: 'nif', nombre: `Falta el NIF de la empresa ${EN_DEUC}`, gravedad: 'impide', falta: (p) => vacio(p.nif) },
  {
    campo: 'domicilio',
    nombre: `Falta el domicilio de la empresa ${EN_DEUC}`,
    gravedad: 'impide',
    falta: sinDomicilio,
  },
  {
    campo: 'representante',
    nombre: `Falta el representante que firma ${EN_DEUC}`,
    gravedad: 'impide',
    falta: (p) => vacio(p.representante?.nombre),
  },
  {
    campo: 'representante.nif',
    nombre: `Falta el NIF del representante ${EN_DEUC}`,
    gravedad: 'impide',
    falta: (p) => vacio(p.representante?.nif),
  },
  {
    campo: 'representante.cargo',
    nombre: 'Falta el cargo del representante (va en la firma de los anexos)',
    gravedad: 'riesgo',
    falta: (p) => vacio(p.representante?.cargo),
  },
  {
    campo: 'contacto.email',
    nombre: 'Falta el correo de contacto de la empresa (lo piden el DEUC y los anexos)',
    gravedad: 'riesgo',
    falta: (p) => vacio(p.contacto?.email),
  },
  {
    campo: 'contacto.telefono',
    nombre: 'Falta el teléfono de contacto de la empresa (lo piden el DEUC y los anexos)',
    gravedad: 'riesgo',
    falta: (p) => vacio(p.contacto?.telefono),
  },
];

const filaEmpresa = (campo: string, titulo: string, gravedad: Gravedad): Bloqueo =>
  fila({
    clave: claveBloqueo('empresa', null, campo),
    categoria: 'empresa',
    lote: null,
    gravedad,
    titulo,
    actor: 'tu',
    accion: 'completar_empresa',
    destino: campo === 'perfil' ? 'empresa' : `empresa.${campo}`,
    huella: huellaDe('empresa', campo),
  });

function datosDeEmpresa(e: EntradasComprobaciones): Bloqueo[] {
  if (!delAmbito(e).some((d) => d.doc.produce === 'persona')) return [];
  const p = e.perfil?.perfil;
  if (!p)
    return [
      filaEmpresa('perfil', 'Falta el perfil de la empresa (sus datos van en el DEUC y en los anexos)', 'impide'),
    ];
  return CAMPOS_EMPRESA.filter((c) => c.falta(p)).map((c) => filaEmpresa(c.campo, c.nombre, c.gravedad));
}

// ── Obligatoriedad condicionada ───────────────────────────────────────────────────

// Palabras que salen en cualquier modelo o criterio: no dicen de qué trata el documento.
const VACIAS = new Set(
  (
    'para como sobre entre desde hasta cada este esta estos estas otro otra sus una unos unas pliego modelo anexo ' +
    'declaracion responsable relativa relativo documento documentacion presentar presente caso dicho dicha mediante debe deben ' +
    'numero total minimo exigido prescripciones tecnicas tecnico lote lotes contrato oferta empresa licitador'
  ).split(' '),
);

function significativas(t: string): Set<string> {
  const palabras = textoComparable(t)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 3 && !/\d/.test(p) && !VACIAS.has(p));
  return new Set(palabras.map((p) => p.replace(/(?<=[^aeiou])es$|s$/, '')));
}

const compartidas = (a: Set<string>, b: Set<string>): number => [...a].filter((p) => b.has(p)).length;

type Acogido = { criterio: string; lote: string | null; palabras: Set<string> };

function acogidos(e: EntradasComprobaciones): Acogido[] {
  const delGuion = e.guion?.datos.automaticos ?? [];
  return (e.decisiones?.datos.automaticos ?? [])
    .filter((a) => a.nos_acogemos && enAmbito(e, a.lote ?? null))
    .map((a) => {
      const g = delGuion.find((x) => textoComparable(x.criterio) === textoComparable(a.criterio));
      return {
        criterio: a.criterio,
        lote: a.lote ?? null,
        palabras: significativas(`${a.criterio} ${g?.exige_documento ?? ''}`),
      };
    });
}

// El criterio que más palabras comparte con el documento, si comparte al menos dos.
function criterioDe(d: DocumentoConClave, criterios: readonly Acogido[]): Acogido | null {
  const propias = significativas(d.doc.nombre);
  const candidatos = criterios
    .filter((c) => c.lote === null || d.lote === null || c.lote === d.lote)
    .map((c) => ({ c, n: compartidas(propias, c.palabras) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n);
  return candidatos[0]?.c ?? null;
}

// Los nombres literales vienen a menudo en mayúsculas: en un título se leen mejor en minúscula.
function nombreLegible(nombre: string): string {
  const n = nombre.trim();
  return n === n.toUpperCase() ? n.charAt(0) + n.slice(1).toLowerCase() : n;
}
const corto = (t: string, max = 90): string => (t.length > max ? `${t.slice(0, max - 1).trim()}…` : t);

const preparado = (e: EntradasComprobaciones, clave: string): boolean => {
  const f = e.documentos.filas.find((x) => x.clave === clave);
  return f?.estado === 'preparado' || f?.estado === 'no_aplica';
};

// Los que la regla de elegibilidad ya hace obligatorios (vía alternativa a un certificado): no salen dos veces.
const deElegibilidad = (e: EntradasComprobaciones): Set<string> =>
  new Set(
    reglasElegibilidad(e)
      .filter((b) => b.clave.startsWith('excluyente_alternativa:'))
      .map((b) => b.clave.split(':')[2]!),
  );

function condicionados(e: EntradasComprobaciones): Bloqueo[] {
  const criterios = acogidos(e);
  const ya = deElegibilidad(e);
  return delAmbito(e)
    .filter((d) => !d.doc.obligatorio && !ya.has(d.clave) && !preparado(e, d.clave))
    .flatMap((d) => {
      const c = criterioDe(d, criterios);
      if (!c) return [];
      const genero = d.doc.tipo === 'declaracion' ? 'obligatoria' : 'obligatorio';
      return [
        fila({
          clave: claveBloqueo('obligatorio_condicionado', d.lote, d.clave),
          categoria: 'documentos',
          lote: d.lote,
          gravedad: 'impide',
          titulo: `«${corto(nombreLegible(d.doc.nombre))}» pasa a ${genero}: te acoges a «${corto(c.criterio)}»`,
          cita: citaDoc(d),
          actor: 'tu',
          accion: 'preparar_documento',
          destino: `documentos.${d.clave}`,
          huella: huellaDe(d.doc.nombre, c.criterio),
        }),
      ];
    });
}

// ── Obligatorios sin preparar ───────────────────────────────────────────────────────────────

export const nombreArchivo = (a: string): string => corto(a.replace(/[“”"«»]/g, '').trim(), 60);

function sinPreparar(e: EntradasComprobaciones): Map<string, DocumentoConClave[]> {
  const fuera = documentosDeElegibilidad(e);
  const ocultos = new Set(e.documentos.filas.filter((f) => f.oculto).map((f) => f.clave));
  const unico = e.ambito.length === 1 ? e.ambito[0]! : null;
  const grupos = new Map<string, DocumentoConClave[]>();
  for (const d of delAmbito(e)) {
    if (
      !d.doc.obligatorio ||
      d.doc.tipo === 'memoria' ||
      fuera.has(d.clave) ||
      ocultos.has(d.clave) ||
      preparado(e, d.clave)
    )
      continue;
    const lote = d.lote ?? unico;
    const k = JSON.stringify([d.archivo, lote]);
    grupos.set(k, [...(grupos.get(k) ?? []), { ...d, lote }]);
  }
  return grupos;
}

function obligatoriosSinPreparar(e: EntradasComprobaciones): Bloqueo[] {
  return [...sinPreparar(e).values()].map((docs) => {
    const { archivo, lote } = docs[0]!;
    const n = docs.length;
    const donde = `${nombreArchivo(archivo)}${lote ? ` · lote ${lote}` : ''}`;
    return fila({
      clave: claveBloqueo('documentos_sin_preparar', lote, nombreArchivo(archivo)),
      categoria: 'documentos',
      lote,
      gravedad: 'riesgo',
      titulo: `${donde}: ${n} ${n === 1 ? 'documento' : 'documentos'} sin preparar`,
      actor: 'tu',
      accion: 'preparar_documento',
      destino: 'documentos',
      huella: huellaDe(docs.map((d) => d.clave)),
      minutos: MINUTOS_POR_ACCION.preparar_documento * n,
    });
  });
}

// ── Memoria única por lote ──────────────────────────────────────────────────────────────────

// Los mismos lotes que el pedido de la memoria (lotesDecididos): los de las decisiones o, sin ellos, los de interés.
const lotesDecididosDe = (e: EntradasComprobaciones): string[] =>
  e.decisiones?.datos.lotes.length ? [...new Set(e.decisiones.datos.lotes)] : e.ambito;

// El mismo criterio que la memoria por lote (memoriaLote.ts): si los dos discreparan, las comprobaciones
// pediría una memoria por lote que no se puede pedir ni subir. comprobaciones.ts la quita cuando cada lote tiene la suya.
function memoriaUnica(e: EntradasComprobaciones): Bloqueo[] {
  const lotes = e.guion ? lotesDeMemoria(e.guion.datos, lotesDecididosDe(e)) : null;
  if (!lotes) return [];
  return [
    fila({
      clave: claveBloqueo('memoria_por_lote', null),
      categoria: 'documentos',
      lote: null,
      gravedad: 'impide',
      titulo:
        'El pliego pide una memoria por lote: redáctalas en Memoria («Redactar las memorias, una por lote») o sube la de cada lote',
      actor: 'tu',
      accion: 'preparar_documento',
      destino: 'memoria',
      huella: huellaDe('memoria_por_lote', [...lotes].sort()),
    }),
  ];
}

// ── Fugas y hechos de la memoria de la oferta ────────────────────────────────────────────

type FugaVista = NonNullable<EntradasComprobaciones['fugas']>['hallazgos'][number];
const claveFuga = (f: Pick<FugaVista, 'tipo' | 'marca' | 'criterio'>): string =>
  `${f.tipo}|${textoComparable(f.marca)}|${textoComparable(f.criterio)}`;

// La presentada ya no se corrige: sus fugas y hechos no son filas (ni en la web, ni en el MCP, ni en Hoy).
function fugasSinAnular(m: MemoriaEvaluada): FugaVista[] {
  if (!m.memoria || !m.fugas || m.memoria.presentada) return [];
  const anuladas = new Set((m.fugas.anulada?.fugas ?? []).map(claveFuga));
  const vistas = new Set<string>();
  return m.fugas.hallazgos.filter((f) => {
    const k = `${f.apartado}|${claveFuga(f)}`;
    if (anuladas.has(claveFuga(f)) || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

const documentoDe = (lote: string | null): string => (lote ? `Memoria del lote ${lote}` : 'Memoria');

// El eco (una frase que se parece a un criterio) es una sospecha, no una fuga dura.
// Con memoria por lote, las de la memoria de cada lote, cada una con su lote en la clave. En una
// versión subida entera (subidaFlexible.ts) la fuga va en el apartado 0: está en el texto, sin apartado.
function fugas(e: EntradasComprobaciones): Bloqueo[] {
  return memoriasEvaluadas(e).flatMap((m) =>
    fugasSinAnular(m).map((f) =>
      fila({
        clave: claveBloqueo('fuga', m.lote, `${f.apartado}-${huellaDe(claveFuga(f)).slice(0, 8)}`),
        categoria: 'fugas',
        lote: m.lote,
        gravedad: f.tipo === 'eco' ? 'riesgo' : 'impide',
        titulo: `Fuga entre sobres ${f.apartado > 0 ? `en el apartado ${f.apartado}` : 'en el texto de la memoria'}: «${f.marca}»`,
        cita: { documento: documentoDe(m.lote), pagina: null, texto: f.cita, comprobada: false },
        actor: 'tu',
        accion: 'revisar_memoria',
        destino: f.apartado > 0 ? `memoria.apartado.${f.apartado}` : 'memoria',
        huella: huellaDe(m.memoria?.id ?? null, f.tipo, f.marca, f.criterio, f.cita),
      }),
    ),
  );
}

type HallazgoVista = EntradasComprobaciones['hallazgos'][number];
const tituloHallazgo = (h: HallazgoVista): string =>
  h.tipo === 'nombre'
    ? `La memoria nombra a «${h.encontrado}» y el pliego pide el equipo por roles, sin nombres`
    : `La memoria dice «${h.encontrado}» y las decisiones «${h.esperado}»`;

function hechosDe(m: MemoriaEvaluada): Bloqueo[] {
  if (m.memoria?.presentada) return [];
  const vistas = new Set<string>();
  return m.hallazgos
    .filter((h) => h.tipo === 'contradiccion' || h.tipo === 'nombre')
    .flatMap((h) => {
      const clave = claveBloqueo(
        'hecho',
        m.lote,
        `${h.apartado}-${huellaDe(h.tipo, h.hecho, h.encontrado).slice(0, 8)}`,
      );
      if (vistas.has(clave)) return [];
      vistas.add(clave);
      return [
        fila({
          clave,
          categoria: 'coherencia',
          lote: m.lote,
          gravedad: 'riesgo',
          titulo: tituloHallazgo(h),
          cita: { documento: documentoDe(m.lote), pagina: null, texto: h.cita, comprobada: false },
          actor: 'tu',
          accion: 'revisar_memoria',
          destino: `memoria.apartado.${h.apartado}`,
          huella: huellaDe(m.memoria?.id ?? null, h),
        }),
      ];
    });
}

const hechosDeMemoria = (e: EntradasComprobaciones): Bloqueo[] => memoriasEvaluadas(e).flatMap(hechosDe);

export function reglasDocumentos(e: EntradasComprobaciones): Bloqueo[] {
  return [
    ...datosDeEmpresa(e),
    ...condicionados(e),
    ...obligatoriosSinPreparar(e),
    ...memoriaUnica(e),
    ...fugas(e),
    ...hechosDeMemoria(e),
  ];
}
