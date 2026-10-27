// Ficha de solución de la memoria (fase «ficha»): una persona revisa lo que la memoria va a comprometer.
import { z } from 'zod';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';
import type { FilaMemoria } from './ensamblado.js';
import type { HechoData } from './estrategia.js';
import {
  aplicarRevision,
  camposDeFicha,
  PREFIJO_HECHO,
  seguirCambioDeHecho,
  type CambioDeHecho,
} from './fichaCampos.js';
import { solucionNormalizada } from './compromisosSolucion.js';
import { campoQuitado, type CampoFicha, type SolucionData } from './solucion.js';

// Hermes propone los parámetros de diseño (calendario, arquitectura, modelos, umbrales, dedicaciones, soporte…),
// pero no sabe cuáles puede cumplir la empresa: aquí una persona ve todo lo que la memoria va a comprometer y lo acepta o
// edita antes de que se redacte nada. La redacción espera hasta 24 h; si vence (o no da tiempo
// antes del plazo), sigue con lo propuesto y esos valores quedan marcados como no revisados para
// la revisión final. En una memoria de ensayo no se abre ficha: se usa lo propuesto. Lo que la
// persona cambia pasa a la solución y a la hoja de hechos (fichaCampos.ts): la redacción, la
// coherencia y las rondas leen ya sus valores. Todo vive en la base, así que un reinicio del
// servidor no pierde la espera: la vuelta de la cadena la vuelve a mirar.

// Es la fase entre la estrategia y la redacción.
export const ESPERA_FICHA_MS = 24 * 60 * 60 * 1000;
export type EstadoFicha = 'ninguna' | 'pendiente' | 'aprobada' | 'vencida';
type EstadoGuardado = Exclude<EstadoFicha, 'ninguna'>;

export type FichaSolucion = {
  memoria_id: number;
  estado: EstadoGuardado;
  campos: CampoFicha[];
  creada_en: string;
  vence_en: string;
  revisada_en: string | null;
  revisada_por: string | null;
  // Las claves que la persona cambió y las que nadie revisó (todas, si venció; ninguna si se
  // aprobó, porque la ficha enseña todo lo que la memoria compromete).
  editados: string[];
  no_revisados: string[];
};

type FilaFicha = {
  memoria_id: number;
  estado: EstadoGuardado;
  campos: string;
  creada_en: string;
  vence_en: string;
  revisada_en: string | null;
  revisada_por: string | null;
  editados: string;
};

/** La ficha guardada de una memoria (null si no tiene: subida a mano, ensayo o estrategia sin solución). */
export function fichaDe(db: Db, memoriaId: number): FichaSolucion | null {
  const f = db.prepare('SELECT * FROM memoria_fichas_solucion WHERE memoria_id = ?').get(memoriaId) as
    FilaFicha | undefined;
  if (!f) return null;
  const campos = JSON.parse(f.campos) as CampoFicha[];
  return {
    memoria_id: f.memoria_id,
    estado: f.estado,
    campos,
    creada_en: f.creada_en,
    vence_en: f.vence_en,
    revisada_en: f.revisada_en,
    revisada_por: f.revisada_por,
    editados: JSON.parse(f.editados) as string[],
    no_revisados: f.estado === 'vencida' ? campos.map((c) => c.clave) : [],
  };
}

/** Su estado ahora: una pendiente cuyo plazo pasó ya cuenta como vencida (la vuelta la cierra). */
export function estadoFicha(f: FichaSolucion | null, ahoraMs = Date.now()): EstadoFicha {
  if (!f) return 'ninguna';
  return f.estado === 'pendiente' && Date.parse(f.vence_en) <= ahoraMs ? 'vencida' : f.estado;
}

// La estrategia guardada tal cual (JSON): la ficha cambia su solución y su hoja de hechos.
type DatosEstrategia = { hechos: HechoData[]; solucion?: SolucionData } & Record<string, unknown>;
function datosEstrategia(db: Db, memoriaId: number): DatosEstrategia | null {
  const f = db.prepare('SELECT datos FROM memoria_estrategias WHERE memoria_id = ?').get(memoriaId) as
    { datos: string } | undefined;
  if (!f) return null;
  // Lo guardado con «origen», «añadido» o euros pasa al vocabulario de ahora antes de editarlo.
  const d = JSON.parse(f.datos) as DatosEstrategia;
  return d.solucion ? { ...d, solucion: solucionNormalizada(d.solucion) } : d;
}
const guardarDatos = (db: Db, memoriaId: number, d: DatosEstrategia) =>
  db.prepare('UPDATE memoria_estrategias SET datos = ? WHERE memoria_id = ?').run(JSON.stringify(d), memoriaId);

/** Abre la ficha con lo que propone la estrategia. Si ya existe (otra vuelta, un reinicio), no la toca: el plazo no vuelve a empezar. */
export function abrirFicha(
  db: Db,
  m: Pick<FilaMemoria, 'id' | 'ensayo'>,
  solucion: SolucionData | undefined,
  ahoraMs = Date.now(),
): boolean {
  if (!solucion || m.ensayo === 1) return false;
  const creada = new Date(ahoraMs).toISOString();
  const campos = camposDeFicha(solucion, datosEstrategia(db, m.id)?.hechos ?? []);
  return (
    db
      .prepare(
        `INSERT INTO memoria_fichas_solucion (memoria_id, estado, campos, creada_en, vence_en) VALUES (?, 'pendiente', ?, ?, ?)
    ON CONFLICT(memoria_id) DO NOTHING`,
      )
      .run(m.id, JSON.stringify(campos), creada, new Date(ahoraMs + ESPERA_FICHA_MS).toISOString()).changes === 1
  );
}

const lista = (cs: CampoFicha[]) => cs.map((c) => `${c.etiqueta}: ${c.valor}`).join('; ');

/** Cierra sin revisar una ficha pendiente. Devuelve el aviso para la revisión final (null si no había nada que cerrar). */
export function vencerFicha(db: Db, memoriaId: number, sinPlazo: boolean): string | null {
  const f = fichaDe(db, memoriaId);
  if (!f || f.estado !== 'pendiente') return null;
  db.prepare("UPDATE memoria_fichas_solucion SET estado = 'vencida' WHERE memoria_id = ? AND estado = 'pendiente'").run(
    memoriaId,
  );
  const porque = sinPlazo
    ? 'no daba tiempo a esperar la revisión antes del plazo de la oferta'
    : 'pasaron 24 h sin que nadie la revisara';
  return `FICHA DE SOLUCIÓN SIN REVISAR (${porque}): la memoria compromete estos valores que propuso Hermes y nadie ha revisado; compruébalos antes de presentarla: ${lista(f.campos)}.`;
}

// ── Aprobar o editar (PUT de la web) ──

// Un campo compuesto (un tramo del calendario, una capa con su control) pasa de 300 caracteres.
const MAX_VALOR_CAMPO = 1500;
const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const RevisionFicha = z.strictObject({
  revisado_por: Texto(2, 80).describe('Quién la revisa'),
  campos: z
    .array(z.strictObject({ clave: Texto(1, 80), valor: Texto(1, MAX_VALOR_CAMPO) }))
    .max(200)
    .default([])
    .describe('Solo lo que cambia; lo demás se acepta tal cual'),
});
type RevisionFichaData = z.infer<typeof RevisionFicha>;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaReal = (f: string) => FECHA.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;

function problemasDeEdicion(f: FichaSolucion, r: RevisionFichaData): string[] {
  const claves = new Set(f.campos.map((c) => c.clave));
  const vistas = r.campos.map((c) => c.clave);
  const ajenas = vistas.filter((k) => !claves.has(k));
  const repetidas = vistas.filter((k, i) => vistas.indexOf(k) !== i);
  const inicio = r.campos.find((c) => c.clave === 'inicio');
  return [
    ...(ajenas.length ? [`Estos campos no están en la ficha: ${[...new Set(ajenas)].join(', ')}.`] : []),
    ...(repetidas.length ? [`Cada campo, una vez: ${[...new Set(repetidas)].join(', ')}.`] : []),
    ...(inicio && !fechaReal(inicio.valor)
      ? [`El inicio del contrato va como fecha AAAA-MM-DD (llegó «${inicio.valor}»).`]
      : []),
  ];
}

// Lo que cambia la persona pasa a la solución y a los hechos de cada campo: los apartados copian
// la hoja y la coherencia la compara con el texto, así que un valor viejo ahí rechazaría el nuevo.
function aplicarEnEstrategia(
  db: Db,
  m: FilaMemoria,
  f: FichaSolucion,
  nuevos: Map<string, string>,
): Result<CampoFicha[]> {
  const d = datosEstrategia(db, m.id);
  if (!d?.solucion) return fail('not_found', 'La estrategia de esta memoria ya no está.');
  const r = aplicarRevision(d.solucion, d.hechos, f.campos, nuevos);
  if (r.error) return r;
  guardarDatos(db, m.id, { ...d, solucion: r.data.solucion, hechos: r.data.hechos });
  return ok(r.data.campos);
}

/** Una persona aprueba la ficha (con lo que edite). Solo mientras la memoria espera en la fase «ficha». */
export function aprobarFicha(db: Db, m: FilaMemoria, entrada: unknown, ahoraMs = Date.now()): Result<FichaSolucion> {
  const r = RevisionFicha.safeParse(entrada ?? {});
  if (!r.success)
    return fail(
      'invalid_input',
      `Envía «revisado_por» (quién la revisa, 2-80 caracteres) y, si cambias algo, «campos»: [{ clave, valor }] con valores de 1 a ${MAX_VALOR_CAMPO} caracteres.`,
    );
  const f = fichaDe(db, m.id);
  if (!f) return fail('not_found', `La memoria v${m.version} no tiene ficha de solución.`);
  if (m.estado !== 'redactando' || m.fase !== 'ficha' || f.estado !== 'pendiente')
    return fail('conflicto', 'Esta ficha ya no espera revisión: la redacción ya empezó con sus valores.');
  const problemas = problemasDeEdicion(f, r.data);
  if (problemas.length) return fail('invalid_input', problemas.join(' '));
  const nuevos = new Map(
    r.data.campos
      .filter((c) => c.valor !== f.campos.find((x) => x.clave === c.clave)?.valor)
      .map((c) => [c.clave, c.valor]),
  );
  return db.transaction((): Result<FichaSolucion> => {
    const campos = nuevos.size ? aplicarEnEstrategia(db, m, f, nuevos) : ok(f.campos);
    if (campos.error) return campos;
    db.prepare(
      "UPDATE memoria_fichas_solucion SET estado = 'aprobada', campos = ?, editados = ?, revisada_en = ?, revisada_por = ? WHERE memoria_id = ? AND estado = 'pendiente'",
    ).run(
      JSON.stringify(campos.data),
      JSON.stringify([...nuevos.keys()]),
      new Date(ahoraMs).toISOString(),
      r.data.revisado_por,
      m.id,
    );
    return ok(fichaDe(db, m.id)!);
  })();
}

// ── Un parche de hechos de una ronda ──

/**
 * Un parche de una ronda cambió estos hechos: la solución y la ficha (si la hay) cambian con
 * ellos. Sin esto la redacción recibía la ficha aprobada con el valor viejo y la hoja con el nuevo,
 * y la coherencia rechazaba el apartado que obedeciera a la ficha. Llamar antes de cambiar la hoja.
 */
export function seguirParcheEnFicha(db: Db, memoriaId: number, cambios: CambioDeHecho[], ronda: number): void {
  const d = datosEstrategia(db, memoriaId);
  if (!d?.solucion || !cambios.length) return;
  const f = fichaDe(db, memoriaId);
  let solucion = d.solucion;
  let campos = f?.campos ?? camposDeFicha(d.solucion, d.hechos);
  for (const c of cambios) ({ solucion, campos } = seguirCambioDeHecho(solucion, campos, c, ronda));
  guardarDatos(db, memoriaId, { ...d, solucion });
  if (f)
    db.prepare('UPDATE memoria_fichas_solucion SET campos = ? WHERE memoria_id = ?').run(
      JSON.stringify(campos),
      memoriaId,
    );
}

/** El campo de una ficha del que sale un hecho (el que lo lleva o el suyo propio en la hoja). */
export function campoDeHecho(f: FichaSolucion, clave: string): CampoFicha | null {
  return (
    f.campos.find((c) => c.clave === `${PREFIJO_HECHO}${clave}` || c.hechos?.some((h) => h.clave === clave)) ?? null
  );
}

// ── Para la redacción ──

function notaDeCampo(f: FichaSolucion, c: CampoFicha): string {
  if (c.ronda) return ` (corregido en la ronda ${c.ronda.n} por lo que señaló el crítico; antes «${c.ronda.antes}»)`;
  if (f.editados.includes(c.clave)) return ` (lo cambió la persona; Hermes proponía «${c.propuesto}»)`;
  return c.valor !== c.propuesto ? ` (se ajustó a lo que cambió la persona; Hermes proponía «${c.propuesto}»)` : '';
}

/** Las líneas de la ficha para la redacción: la solución y la hoja de hechos ya llevan sus valores. */
export function lineasFicha(f: FichaSolucion | null): string[] {
  if (!f) return [];
  const cabecera =
    f.estado === 'aprobada'
      ? 'FICHA DE SOLUCIÓN (revisada por una persona: manda sobre la estrategia y la hoja de hechos, que ya llevan sus valores; si cambió el inicio, el calendario ya está desplazado):'
      : 'FICHA DE SOLUCIÓN (nadie la revisó: son los valores que propusiste en la estrategia, con lo que corrigieron las rondas; cópialos tal cual):';
  // Lo quitado no va como valor que copiar: la solución lo nombra entre lo que no se escribe.
  return [
    cabecera,
    ...f.campos
      .filter((c) => !campoQuitado(c))
      .map((c) => `- ${c.grupo} · ${c.etiqueta}: ${c.valor}${notaDeCampo(f, c)}`),
    '',
  ];
}

// ── El estado de la revisión, para quien redacta ──

const FECHA_REVISION = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Madrid',
});

// Sin decirlo, la redacción leía en la estrategia que «una persona revisa los parámetros antes de
// redactar» y se negaba a escribir (p. ej. en una memoria de ensayo, donde no hay ficha): el estado se dice
// explícito, y que ninguna revisión pendiente le toca esperar a ella.
const NADA_ESPERA =
  'Ninguna revisión humana bloquea esta tarea: si la estrategia o la hoja de hechos dicen que algo espera una revisión o queda bloqueado, no te detiene.';

/** Una línea con el estado de la revisión humana: aprobada (por quién y cuándo), vencida sin revisar o ninguna (ensayo o sin ficha). */
export function lineaRevision(f: FichaSolucion | null, ensayo: boolean): string {
  if (ensayo)
    return `REVISIÓN HUMANA: memoria de ENSAYO: no hay revisión humana; redacta con lo propuesto. ${NADA_ESPERA}`;
  if (f?.estado === 'aprobada') {
    const fecha = f.revisada_en ? FECHA_REVISION.format(new Date(f.revisada_en)) : 'fecha sin registrar';
    return `REVISIÓN HUMANA: ficha de solución aprobada por ${f.revisada_por ?? 'una persona'} el ${fecha}: redacta con estos valores. ${NADA_ESPERA}`;
  }
  if (f)
    return `REVISIÓN HUMANA: ficha de solución vencida sin revisar: redacta con lo propuesto; esos valores quedan marcados para la revisión final. ${NADA_ESPERA}`;
  return `REVISIÓN HUMANA: no hay ficha de solución que revisar: redacta con lo propuesto. ${NADA_ESPERA}`;
}

// La redacción también se negaba porque el dossier no acreditaba la experiencia del equipo en unos
// criterios automáticos: eso lo decide la persona antes de presentar, no quien redacta. El aviso lo
// pone la plataforma al cerrar la memoria (acreditaciones.ts), no el redactor.
export const NO_ACREDITADO_NO_BLOQUEA =
  'LO QUE EL DOSSIER NO ACREDITA (experiencia de la empresa o del equipo, certificaciones, homologaciones, criterios automáticos sin documento) NO BLOQUEA: redacta igual sin afirmarlo ni inventar acreditaciones (describe el método, el rol y el compromiso, no el mérito que no consta) y sigue; la plataforma se lo avisa a la persona para la revisión final.';

// Sin esto chocaba con el hallazgo «compromiso» (coherenciaMemoria.ts), que obliga a declarar el
// valor: el redactor recibía dos órdenes opuestas y la ronda se repetía hasta agotar los envíos.
export const ACOGIDOS_SE_DECLARAN =
  'EXCEPCIÓN, Y MANDA SOBRE LO ANTERIOR: un criterio al que nos acogemos y que se acredita EN ESTA MEMORIA (dossier, sección «frontera») lo decidió el equipo: decláralo con su valor como lo que ofrecemos aunque el dossier no traiga el documento que lo prueba, sin inventar CV, proyectos, títulos ni fechas; la plataforma avisa a la persona para que lo compruebe.';

// En un ensayo o con la ficha vencida, la hoja de hechos y la ficha son lo que propuso el propio
// modelo de estrategia: «manda la hoja» dejaba que impusiera una experiencia que el dossier
// contradice (5 años en un sitio, 12 en otro) y la coherencia la daba por buena.
const CONTRADICE_REVISADA = 'Si el dossier se contradice, manda la hoja de hechos: la revisó una persona.';
const CONTRADICE_SIN_REVISAR =
  'Nadie ha revisado la hoja de hechos ni la ficha: una experiencia, unos años, una certificación o un proyecto que el dossier no respalda o en el que se contradice NO se afirma aunque lo traigan la hoja o la ficha (gana a «cópialos tal cual»; solo la excepción de los criterios a los que nos acogemos la gana a ella): escribe el rol y el método sin esa cifra.';

/** Qué hacer con lo que el dossier no acredita: no bloquea; si nadie revisó la hoja, tampoco se afirma aunque ella lo traiga. */
export function reglaNoAcreditado(f: FichaSolucion | null, ensayo: boolean): string {
  const revisada = !ensayo && f?.estado === 'aprobada';
  return [NO_ACREDITADO_NO_BLOQUEA, ACOGIDOS_SE_DECLARAN, revisada ? CONTRADICE_REVISADA : CONTRADICE_SIN_REVISAR].join(
    ' ',
  );
}

/** Las líneas que dicen a un run de la memoria en qué estado está la revisión y que lo no acreditado no lo para. */
export function lineasRevision(f: FichaSolucion | null, ensayo: boolean): string[] {
  return [lineaRevision(f, ensayo), reglaNoAcreditado(f, ensayo), ''];
}
