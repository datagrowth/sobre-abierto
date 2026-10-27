// Qué dejó atrás un cambio tardío en una memoria ya montada.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { obtenerPersona } from '../../../nucleo/colaboradores/personas.js';
import { leerPerfilEmpresa, perfilParaAgentes } from '../../../nucleo/empresa.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { lotesDeLicitacion } from '../lotes.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { textoParaCoherencia } from './coherenciaMemoria.js';
import { decisionesDe, type DecisionesData } from './decisiones.js';
import {
  CLAVES_HUELLA_BARATA,
  dossierDe,
  huellasActuales,
  type ClaveDossier,
  type DossierGuardado,
  type SeccionDossier,
} from './dossier.js';
import { contieneMarca, noPrometerDe } from './enfoque.js';
import { apartadosDe, filaMemoria, type FilaMemoria } from './ensamblado.js';
import { CATEGORIAS_HECHO, estrategiaDe, type HechoData } from './estrategia.js';
import { datosDeFila, fugasDeMemoria } from './fugasMemoria.js';
import { hallazgosDeCoherencia, nombresDelEquipoEn } from './hechos.js';
import { lotesMencionados } from './lotesMencionados.js';
import { decisionesDelLote } from './memoriaLote.js';

type Categoria = (typeof CATEGORIAS_HECHO)[number];

/** De qué secciones del dossier sale cada categoría de hecho. */
const FUENTES_DE_CATEGORIA: Record<Categoria, ClaveDossier[]> = Object.fromEntries(
  CATEGORIAS_HECHO.map((c) => [
    c,
    c === 'rol' ? ['equipo'] : c === 'herramienta' ? ['herramientas'] : ['pliego_tecnico', 'criterios'],
  ]),
) as Record<Categoria, ClaveDossier[]>;

// Las secciones baratas del dossier se vuelven a firmar sin leer pliegos (dossier.ts, huellasActuales) y se
// comparan con las guardadas; de ahí, los hechos de la hoja que dependen de esas secciones y los apartados que
// hay que revisar. Un falso «se mantiene» es peor que no saberlo: sin huella o con dudas, se marca. Nunca el
// precio: no está en el dossier ni la memoria puede nombrarlo.
/** Las secciones con huella distinta; una guardada sin huella (o que no está) cuenta como cambiada. */
export function seccionesCambiadas(
  guardadas: Pick<SeccionDossier, 'clave' | 'huella'>[],
  ahora: Partial<Record<ClaveDossier, string>>,
): ClaveDossier[] {
  return (Object.entries(ahora) as [ClaveDossier, string][])
    .filter(([clave, huella]) => {
      const g = guardadas.find((s) => s.clave === clave);
      return !g?.huella || g.huella !== huella;
    })
    .map(([clave]) => clave);
}

export type EntradaAfectados = {
  secciones: ClaveDossier[];
  hechos: HechoData[];
  textos: string[];
  nombresQueSalen: string[];
  herramientas: string[];
  // Por roles la memoria no nombra a nadie: el rol solo se reconoce por sus anclas.
  porRoles?: boolean;
  // Sin hechos de la hoja que dependan de ellas: identificacion, los lotes que ya no
  // van; frontera, lo que Hermes dijo no prometer y lo que ya delata otro sobre; empresa, las
  // certificaciones que el perfil ya no tiene.
  lotesQuitados?: string[];
  marcasFrontera?: string[];
  apartadosConFuga?: number[];
  empresaQuitada?: string[];
};
export type Afectados = { hechos: string[]; apartados: number[] };

const normal = (t: string) =>
  ` ${textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
// Por la palabra entera o su plural, como las anclas de la coherencia (hechos.ts).
function nombraAncla(texto: string, palabras: string[]): boolean {
  const n = normal(texto);
  const tokens = new Set(n.trim().split(' '));
  return palabras
    .map((p) => normal(p).trim())
    .filter(Boolean)
    .some((a) => (a.includes(' ') ? n.includes(` ${a} `) : [a, `${a}s`, `${a}es`].some((f) => tokens.has(f))));
}

const conHerramienta = (herramientas: string[], valor: string) =>
  herramientas.some((h) => textoComparable(h).trim() === textoComparable(valor).trim());

// Un hecho afectado marca los apartados donde sale. El rol, si sale alguien con nombre, lo marca
// su nombre (las anclas «docente» están en apartados que siguen valiendo); una herramienta, solo
// si ya no está en las decisiones.
function apartadosDelHecho(h: HechoData, e: EntradaAfectados): number[] {
  if (h.categoria === 'rol' && e.nombresQueSalen.length && !e.porRoles) return [];
  if (h.categoria === 'herramienta' && conHerramienta(e.herramientas, h.valor)) return [];
  const dondeSale = (t: string) =>
    h.categoria === 'herramienta'
      ? normal(t).includes(normal(h.valor))
      : nombraAncla(t, h.palabras) || normal(t).includes(normal(h.valor));
  return e.textos.flatMap((t, i) => (t && dondeSale(t) ? [i + 1] : []));
}

// Lo que cambió en las secciones sin hechos de la hoja, por regla: el texto que nombra lo que ya no está.
function apartadosSinHechos(e: EntradaAfectados): number[] {
  const marcan = (seccion: ClaveDossier, nombra: (t: string) => boolean): number[] =>
    e.secciones.includes(seccion) ? e.textos.flatMap((t, i) => (t && nombra(t) ? [i + 1] : [])) : [];
  return [
    ...marcan('identificacion', (t) => lotesMencionados(t, e.lotesQuitados ?? []).length > 0),
    ...marcan('frontera', (t) => (e.marcasFrontera ?? []).some((m) => contieneMarca(t, m))),
    ...(e.secciones.includes('frontera') ? (e.apartadosConFuga ?? []) : []),
    ...marcan('empresa', (t) => (e.empresaQuitada ?? []).some((x) => normal(t).includes(normal(x)))),
  ];
}

/** Los hechos que dependen de las secciones cambiadas y los apartados que hay que revisar (puro). */
export function afectadosDeHuellas(e: EntradaAfectados): Afectados {
  const hechos = e.hechos.filter((h) => FUENTES_DE_CATEGORIA[h.categoria].some((s) => e.secciones.includes(s)));
  const porNombre = e.textos.flatMap((t, i) => (nombresDelEquipoEn(t, e.nombresQueSalen).length ? [i + 1] : []));
  const porHerramienta = e.secciones.includes('herramientas')
    ? hallazgosDeCoherencia(e.textos, [], { herramientas: e.herramientas })
        .filter((x) => x.tipo === 'herramienta')
        .map((x) => x.apartado)
    : [];
  const apartados = [
    ...porNombre,
    ...porHerramienta,
    ...apartadosSinHechos(e),
    ...hechos.flatMap((h) => apartadosDelHecho(h, e)),
  ];
  return { hechos: hechos.map((h) => h.clave), apartados: [...new Set(apartados)].sort((a, b) => a - b) };
}

export type DesfaseMemoria = { secciones: ClaveDossier[] } & Afectados;

// textos[i] es el apartado i+1 (vacío si no llegó).
function textosDe(dbLic: Db, memoriaId: number): string[] {
  const filas = apartadosDe(dbLic, memoriaId);
  const total = Math.max(0, ...filas.map((f) => f.apartado));
  return Array.from({ length: total }, (_, i) => {
    const d = datosDeFila(filas.find((f) => f.apartado === i + 1));
    return d ? textoParaCoherencia(d) : '';
  });
}

function nombresQueSalen(dbNucleo: DbNucleo, antes: number[], ahora: number[]): string[] {
  return antes
    .filter((id) => !ahora.includes(id))
    .flatMap((id) => {
      const p = obtenerPersona(dbNucleo, id);
      return p.error ? [] : [p.data.nombre];
    });
}

// Los lotes que salieron: los de la portada de la base («- Lotes a los que vamos: …») que ya no se deciden.
const LINEA_LOTES = /^- (?:Lotes a los que vamos|Lote): (.*)$/m;
function lotesQuitados(
  dbLic: Db,
  m: FilaMemoria,
  d: DossierGuardado | null,
  todas: DecisionesData | undefined,
): string[] {
  const ahora = m.lote ? [m.lote] : (todas?.lotes ?? []);
  if (!ahora.length) return [];
  const existentes = lotesDeLicitacion(dbLic, m.licitacion_id)?.lotes.map((l) => l.id) ?? [];
  const linea = LINEA_LOTES.exec(d?.secciones.find((s) => s.clave === 'identificacion')?.texto ?? '')?.[1];
  return (linea !== undefined ? lotesMencionados(linea, existentes) : existentes).filter((l) => !ahora.includes(l));
}

// Las certificaciones que decía el dossier de la base y el perfil de ahora ya no trae.
const LINEA_CERTIFICACIONES = /^- Certificaciones: (.*)\.$/m;
function empresaQuitada(dbNucleo: DbNucleo, d: DossierGuardado | null): string[] {
  const linea = LINEA_CERTIFICACIONES.exec(d?.secciones.find((s) => s.clave === 'empresa')?.texto ?? '')?.[1];
  if (!linea || linea === 'ninguna registrada') return [];
  const guardado = leerPerfilEmpresa(dbNucleo);
  const ahora = guardado ? perfilParaAgentes(guardado.perfil).certificaciones.map(textoComparable) : [];
  return linea.split(', ').filter((c) => !ahora.includes(textoComparable(c)));
}

// Un dossier de antes de las huellas no dice qué cambió: ante la duda se marca, pero
// solo en la memoria vigente de la oferta (la última de su lote), no en cada versión antigua.
function sinHuellasYAntigua(dbLic: Db, m: FilaMemoria, d: DossierGuardado | null): boolean {
  if (d && d.secciones.some((s) => s.huella)) return false;
  if (m.ensayo) return true;
  const ultima = (
    dbLic
      .prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ? AND ensayo = 0 AND lote IS ?')
      .get(m.licitacion_id, m.lote ?? null) as { v: number }
  ).v;
  return ultima !== m.version;
}

function entradaDe(
  dbLic: Db,
  dbNucleo: DbNucleo,
  m: FilaMemoria,
  x: { secciones: ClaveDossier[]; dossier: DossierGuardado | null },
): EntradaAfectados {
  const todas = decisionesDe(dbLic, m.licitacion_id)?.datos;
  const decisiones = todas ? decisionesDelLote(todas, m.lote ?? null) : null;
  return {
    secciones: x.secciones,
    hechos: estrategiaDe(dbLic, m.id)?.datos.hechos ?? [],
    textos: textosDe(dbLic, m.id),
    nombresQueSalen: nombresQueSalen(
      dbNucleo,
      x.dossier?.equipo_ids ?? [],
      decisiones?.equipo.map((p) => p.persona_id) ?? [],
    ),
    herramientas: decisiones?.herramientas ?? [],
    porRoles: x.dossier?.equipo_por_roles ?? false,
    lotesQuitados: lotesQuitados(dbLic, m, x.dossier, todas),
    marcasFrontera: noPrometerDe(dbLic, m.licitacion_id).flatMap((n) => n.marcas),
    apartadosConFuga: [...new Set(fugasDeMemoria(dbLic, m.id).map((f) => f.apartado))],
    empresaQuitada: empresaQuitada(dbNucleo, x.dossier),
  };
}

/** Lo que un cambio dejó atrás en una memoria montada (null si no está ensamblada o se subió a mano). No lee pliegos. */
export function desfaseMemoria(dbLic: Db, dbNucleo: DbNucleo, memoriaId: number): Result<DesfaseMemoria | null> {
  const m = filaMemoria(dbLic, memoriaId);
  if (!m) return fail('not_found', `No hay ninguna memoria con id ${memoriaId}.`);
  if (m.fase === null || m.estado !== 'ensamblada') return ok(null);
  const dossier = dossierDe(dbLic, m.id);
  if (sinHuellasYAntigua(dbLic, m, dossier)) return ok(null);
  const ahora = huellasActuales(dbLic, dbNucleo, m.id, [...CLAVES_HUELLA_BARATA]);
  if (ahora.error) return ahora;
  const secciones = seccionesCambiadas(dossier?.secciones ?? [], ahora.data);
  return ok({ secciones, ...afectadosDeHuellas(entradaDe(dbLic, dbNucleo, m, { secciones, dossier })) });
}

/**
 * Vuelve a firmar las secciones baratas del dossier guardado con las huellas de ahora: lo que
 * cambió no afecta a ningún apartado y la memoria sigue valiendo, así que deja de salir desfasada.
 */
export function refirmarDossier(dbLic: Db, dbNucleo: DbNucleo, memoriaId: number): Result<null> {
  const f = dbLic.prepare('SELECT secciones FROM memoria_dossiers WHERE memoria_id = ?').get(memoriaId) as
    { secciones: string } | undefined;
  if (!f) return ok(null);
  const ahora = huellasActuales(dbLic, dbNucleo, memoriaId, [...CLAVES_HUELLA_BARATA]);
  if (ahora.error) return ahora;
  const guardado = JSON.parse(f.secciones) as { secciones: { clave: ClaveDossier; huella?: string }[] } & Record<
    string,
    unknown
  >;
  const secciones = guardado.secciones.map((x) => ({ ...x, huella: ahora.data[x.clave] ?? x.huella ?? '' }));
  dbLic
    .prepare('UPDATE memoria_dossiers SET secciones = ? WHERE memoria_id = ?')
    .run(JSON.stringify({ ...guardado, secciones }), memoriaId);
  return ok(null);
}
