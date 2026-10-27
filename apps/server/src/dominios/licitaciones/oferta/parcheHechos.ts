// Parche de hechos desde las rondas de la memoria: reescribe solo los hechos que el crítico señala.
import { z } from 'zod';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { aplazamientosEn } from './aplazamientos.js';
import { MOTIVO_APLAZA } from './critica.js';
import { dossierDe } from './dossier.js';
import { filaMemoria, soloRehechos, type FilaMemoria } from './ensamblado.js';
import { estrategiaDe, type HechoData } from './estrategia.js';
import { textosDeApartados } from './evaluacionMemoria.js';
import { campoDeHecho, fichaDe, lineasRevision, seguirParcheEnFicha, type FichaSolucion } from './fichaSolucion.js';
import { detectarFugas } from './fugas.js';
import { contextoFugasDe, nombresDelEquipo } from './fugasMemoria.js';
import { guionPorId } from './guion.js';
import { nombresDelEquipoEn } from './hechos.js';

// La hoja de hechos es el contrato de la redacción y la coherencia rechaza lo que
// la contradice; cuando el crítico señalaba justo un valor de la hoja («la selección de
// servicios depende de aprobación posterior», «no se indican fechas»), la ronda no podía
// arreglarlo: dos reescrituras completas sin mover un tramo. Si un motivo cita literalmente el
// valor de un hecho y trata de él, una fase acotada reescribe solo esos hechos (respetando lo
// aprobado en la ficha de solución salvo que el motivo lo contradiga) y, si alguno cambia, se
// rehacen los apartados que lo usan; la solución y la ficha cambian con la hoja, para que la
// redacción no reciba dos valores. Cada cambio queda en los avisos de la memoria para revisarlo.

// Es la fase «hechos», entre la crítica y la reescritura.
export const TIPO_MEMORIA_HECHOS = 'licitaciones.memoria_hechos';
export const PayloadHechos = z.object({
  id: z.string().min(3),
  memoria_id: z.number().int().positive(),
  version: z.number().int().positive(),
  ronda: z.number().int().min(1),
  pedida_en: z.string().min(10),
});
export type PayloadHechosData = z.infer<typeof PayloadHechos>;

// Pocos hechos por ronda: cada uno arrastra la reescritura de los apartados que lo usan.
const MAX_HECHOS_PARCHE = 5;
// Un valor más corto («RS», «4 h») sale en citas que no hablan de él.
const MIN_VALOR = 5;

type MotivoCritica = { cita: string; motivo: string; arreglo: string };
type MotivoDeHecho = MotivoCritica & { apartado: number };
// ficha: la etiqueta del campo aprobado por una persona del que sale el valor (null si no sale de ninguno).
export type PedidoHecho = {
  clave: string;
  sobre: string;
  valor: string;
  motivos: MotivoDeHecho[];
  ficha: string | null;
};
type CambioHecho = {
  clave: string;
  sobre: string;
  antes: string;
  despues: string;
  motivo: string;
  ficha: string | null;
};
export type EstadoParche = 'pendiente' | 'recibido' | 'saltado';
export type ParcheHechos = {
  memoria_id: number;
  ronda: number;
  estado: EstadoParche;
  pedidos: PedidoHecho[];
  cambios: CambioHecho[];
  apartados: number[];
};

const comparable = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim();
const contiene = (texto: string, valor: string) => ` ${comparable(texto)} `.includes(` ${comparable(valor)} `);

// ── Puro ──

const palabrasDe = (t: string) =>
  new Set(
    comparable(t)
      .split(' ')
      .filter((w) => w.length >= 4),
  );

// Los apartados copian la hoja tal cual: la cita de un motivo lleva a menudo el valor de un hecho
// aunque el motivo hable de otra cosa de la frase («falta el orden del día» sobre una cita con la
// fecha de inicio). La cita solo cuenta si el motivo trata del hecho (nombra de qué es o sus
// anclas), señala un aplazamiento o el valor mismo aplaza; el motivo o el arreglo que nombran
// el valor cuentan siempre.
function trataDelHecho(m: MotivoCritica, h: HechoData): boolean {
  if (contiene(m.motivo, h.valor) || contiene(m.arreglo, h.valor)) return true;
  if (!contiene(m.cita, h.valor)) return false;
  const delMotivo = palabrasDe(`${m.motivo} ${m.arreglo}`);
  const anclas = palabrasDe(`${h.sobre} ${h.palabras.join(' ')} ${h.clave.replace(/_/g, ' ')}`);
  return (
    [...anclas].some((w) => delMotivo.has(w)) ||
    MOTIVO_APLAZA.test(textoComparable(m.motivo)) ||
    aplazamientosEn(h.valor).length > 0
  );
}

/**
 * Los hechos cuyo valor cita un motivo para bajar que trata de ellos, los más citados primero.
 * Los roles no: su sigla sale en casi cualquier cita.
 */
export function hechosCitados(
  hechos: HechoData[],
  apartados: { apartado: number; motivos_para_bajar: MotivoCritica[] }[],
): Omit<PedidoHecho, 'ficha'>[] {
  const pedidos = hechos
    .filter((h) => h.categoria !== 'rol' && comparable(h.valor).length >= MIN_VALOR)
    .map((h) => ({
      clave: h.clave,
      sobre: h.sobre,
      valor: h.valor,
      motivos: apartados.flatMap((x) =>
        x.motivos_para_bajar.filter((m) => trataDelHecho(m, h)).map((m) => ({ ...m, apartado: x.apartado })),
      ),
    }));
  return pedidos
    .filter((p) => p.motivos.length)
    .sort((a, b) => b.motivos.length - a.motivos.length)
    .slice(0, MAX_HECHOS_PARCHE);
}

/** Los apartados que usan alguno de esos hechos: los que la estrategia dice y los que llevan su valor. */
export function apartadosQueUsan(
  pedidos: Pick<PedidoHecho, 'clave' | 'valor'>[],
  hechos: HechoData[],
  textos: string[],
): number[] {
  const out = new Set<number>();
  for (const p of pedidos) {
    for (const n of hechos.find((h) => h.clave === p.clave)?.apartados ?? []) out.add(n);
    textos.forEach((t, i) => {
      if (contiene(t, p.valor)) out.add(i + 1);
    });
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * El campo de la ficha aprobada del que sale un hecho (null si la ficha no está aprobada o no es
 * de ninguno). Va por el hecho atado a cada campo al abrir la ficha: comparando textos, los
 * campos compuestos («servicio · tier · región») no casaban con el hecho escrito de otra forma.
 * Una ficha de antes, sin hechos atados, se compara por texto.
 */
export function campoDeFicha(f: FichaSolucion | null, h: Pick<HechoData, 'clave' | 'valor'>): string | null {
  if (f?.estado !== 'aprobada') return null;
  const atado = campoDeHecho(f, h.clave);
  const v = comparable(h.valor);
  const c =
    atado ??
    (f.campos.some((x) => x.hechos)
      ? null
      : f.campos.find((x) => {
          const w = comparable(x.valor);
          return w.length >= 3 && (v.includes(w) || w.includes(v));
        }));
  return c ? `${c.etiqueta}: ${c.valor}` : null;
}

// ── Base ──

type FilaParche = {
  memoria_id: number;
  ronda: number;
  estado: EstadoParche;
  pedidos: string;
  cambios: string;
  apartados: string;
};

/** El parche de hechos de una ronda (null si esa ronda no lo pidió). */
export function parcheDe(db: Db, memoriaId: number, ronda: number): ParcheHechos | null {
  const f = db
    .prepare('SELECT * FROM memoria_parches_hechos WHERE memoria_id = ? AND ronda = ?')
    .get(memoriaId, ronda) as FilaParche | undefined;
  return f
    ? {
        memoria_id: f.memoria_id,
        ronda: f.ronda,
        estado: f.estado,
        pedidos: JSON.parse(f.pedidos) as PedidoHecho[],
        cambios: JSON.parse(f.cambios) as CambioHecho[],
        apartados: JSON.parse(f.apartados) as number[],
      }
    : null;
}

/** Los parches de una memoria, por ronda. */
export function parchesDe(db: Db, memoriaId: number): ParcheHechos[] {
  const rondas = db
    .prepare('SELECT ronda FROM memoria_parches_hechos WHERE memoria_id = ? ORDER BY ronda')
    .all(memoriaId) as { ronda: number }[];
  return rondas.map((r) => parcheDe(db, memoriaId, r.ronda)!);
}

export type ParchePlaneado = { pedidos: PedidoHecho[]; apartados: number[] };

/** Qué hechos parchear tras la crítica de esta ronda y qué apartados los usan (null si ningún motivo cita un hecho). */
export function planearParche(
  db: Db,
  m: FilaMemoria,
  apartados: { apartado: number; motivos_para_bajar: MotivoCritica[] }[],
): ParchePlaneado | null {
  const hechos = estrategiaDe(db, m.id)?.datos.hechos ?? [];
  const citados = hechosCitados(hechos, apartados);
  if (!citados.length) return null;
  const ficha = fichaDe(db, m.id);
  const pedidos = citados.map((p) => ({ ...p, ficha: campoDeFicha(ficha, p) }));
  return { pedidos, apartados: apartadosQueUsan(pedidos, hechos, textosDeApartados(db, m.id)) };
}

/** Abre el parche de la ronda `ronda` (la que se va a reescribir). */
export function abrirParche(db: Db, memoriaId: number, ronda: number, p: ParchePlaneado): void {
  db.prepare(
    `INSERT INTO memoria_parches_hechos (memoria_id, ronda, estado, pedidos, apartados, creado_en) VALUES (?, ?, 'pendiente', ?, ?, ?)
    ON CONFLICT(memoria_id, ronda) DO NOTHING`,
  ).run(memoriaId, ronda, JSON.stringify(p.pedidos), JSON.stringify(p.apartados), new Date().toISOString());
}

/** Sin tiempo o sin respuesta: la ronda sigue con la hoja de hechos como estaba. */
export function saltarParche(db: Db, memoriaId: number, ronda: number): void {
  db.prepare(
    "UPDATE memoria_parches_hechos SET estado = 'saltado' WHERE memoria_id = ? AND ronda = ? AND estado = 'pendiente'",
  ).run(memoriaId, ronda);
}

// ── Recepción ──

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
export const HechosEntrada = z.strictObject({
  id: Texto(3, 40).describe('Id de la licitación'),
  memoria_id: z.number().int().positive().describe('Los números que te dio la tarea'),
  ronda: z.number().int().min(1),
  hechos: z
    .array(
      z.strictObject({
        clave: Texto(2, 60).describe('La clave del hecho que pide la tarea'),
        valor: Texto(1, 300).describe('El valor nuevo (o el mismo, si no hay que cambiarlo)'),
        motivo: Texto(5, 500).describe('Por qué cambia (o por qué se mantiene), en una frase'),
      }),
    )
    .min(1)
    .max(MAX_HECHOS_PARCHE),
});
export type HechosEntradaData = z.infer<typeof HechosEntrada>;
export const recursoHechos = (a: { id: string; memoria_id: number; ronda: number }) =>
  `${a.id}#m${a.memoria_id}#hechos#r${a.ronda}`;

function destinoDelParche(db: Db, e: HechosEntradaData): Result<{ m: FilaMemoria; parche: ParcheHechos }> {
  const m = filaMemoria(db, e.memoria_id);
  if (!m || m.licitacion_id !== e.id)
    return fail('not_found', `No hay ninguna memoria con id ${e.memoria_id} en la licitación «${e.id}».`);
  const parche = parcheDe(db, m.id, e.ronda);
  if (m.estado !== 'redactando' || m.fase !== 'hechos' || m.ronda !== e.ronda || parche?.estado !== 'pendiente')
    return fail('invalid_input', `Esa memoria no espera hechos de la ronda ${e.ronda}.`);
  return ok({ m, parche });
}

function problemasDeCobertura(e: HechosEntradaData, p: ParcheHechos): string[] {
  const pedidas = p.pedidos.map((x) => x.clave);
  const vistas = e.hechos.map((h) => h.clave);
  const ajenas = vistas.filter((k) => !pedidas.includes(k));
  const faltan = pedidas.filter((k) => !vistas.includes(k));
  const repetidas = [...new Set(vistas.filter((k, i) => vistas.indexOf(k) !== i))];
  return [
    ...(ajenas.length ? [`Solo se corrigen los hechos que pide la tarea; estos no: ${ajenas.join(', ')}.`] : []),
    ...(faltan.length
      ? [`Falta la respuesta de: ${faltan.join(', ')} (si no cambia, envía su valor de ahora y por qué se mantiene).`]
      : []),
    ...(repetidas.length ? [`Cada hecho, una vez: ${repetidas.join(', ')}.`] : []),
  ];
}

type Revision = { duros: string[]; blandos: string[] };

// Lo mismo que se exige a la hoja de hechos de la estrategia: ni fugas ni nombres con el equipo
// por roles (siempre), y sin aplazar el valor (hasta el tercer envío).
function revisarHechos(db: Db, m: FilaMemoria, e: HechosEntradaData, p: ParcheHechos): Revision {
  const guion = guionPorId(db, m.guion_id);
  const fugas = guion ? contextoFugasDe(db, guion) : null;
  const porRoles = dossierDe(db, m.id)?.equipo_por_roles ?? false;
  const equipo = porRoles ? nombresDelEquipo(db, m.licitacion_id) : [];
  const duros = [
    ...problemasDeCobertura(e, p),
    ...e.hechos.flatMap((h) => {
      const sobre = p.pedidos.find((x) => x.clave === h.clave)?.sobre ?? '';
      return [
        ...(fugas
          ? detectarFugas(`${sobre}: ${h.valor}.`, fugas).map(
              (f) =>
                `El valor de «${h.clave}» delata «${f.marca}» («${f.criterio}», que va en «${f.archivo}»): quítalo.`,
            )
          : []),
        ...nombresDelEquipoEn(h.valor, equipo).map(
          () =>
            `El valor de «${h.clave}» nombra a una persona del equipo y el pliego pide el equipo por roles: escribe solo el rol.`,
        ),
      ];
    }),
  ];
  const blandos = e.hechos.flatMap((h) =>
    aplazamientosEn(h.valor).map(
      (f) =>
        `El valor de «${h.clave}» aplaza en vez de fijar («${f}»): da el valor concreto que propondría el mejor competidor.`,
    ),
  );
  return { duros, blandos };
}

function cambiosDe(e: HechosEntradaData, p: ParcheHechos): CambioHecho[] {
  return e.hechos.flatMap((h) => {
    const pedido = p.pedidos.find((x) => x.clave === h.clave)!;
    return comparable(h.valor) === comparable(pedido.valor)
      ? []
      : [
          {
            clave: h.clave,
            sobre: pedido.sobre,
            antes: pedido.valor,
            despues: h.valor,
            motivo: h.motivo,
            ficha: pedido.ficha,
          },
        ];
  });
}

/** El aviso para la revisión final: un hecho cambiado en una ronda no lo ha visto nadie. */
function avisoDeCambio(c: CambioHecho, ronda: number): string {
  return `HECHO CAMBIADO EN LA RONDA ${ronda} (revísalo antes de presentar): «${c.sobre}» pasa de «${c.antes}» a «${c.despues}». Motivo: ${c.motivo}${c.ficha ? ` Cambia un valor aprobado en la ficha de solución («${c.ficha}»).` : ''}`;
}

// Solo los apartados que usan un hecho que de verdad cambió se reescriben por el parche (los que
// pidió la ronda ya están pendientes): antes se marcaban todos al planearlo, también los que
// estaban en el máximo, aunque el run de hechos mantuviera el valor. En una memoria que sale de otra,
// solo los rehechos por el cambio: los copiados se quedan como en la base (el aviso del hecho cambiado lo deja a la vista).
function rehacerLosQueUsan(db: Db, m: FilaMemoria, cambios: CambioHecho[], hechos: HechoData[]): number[] {
  const limite = soloRehechos(m);
  const apartados = apartadosQueUsan(
    cambios.map((c) => ({ clave: c.clave, valor: c.antes })),
    hechos,
    textosDeApartados(db, m.id),
  ).filter((n) => limite === null || limite.includes(n));
  const pendiente = db.prepare(
    "UPDATE memoria_apartados SET estado = 'pendiente', ronda = ?, rechazos = 0, error = NULL, avisos = '[]', trabajo_id = NULL WHERE memoria_id = ? AND apartado = ? AND estado <> 'pendiente'",
  );
  for (const n of apartados) pendiente.run(m.ronda, m.id, n);
  return apartados;
}

function guardarParche(db: Db, m: FilaMemoria, cambios: CambioHecho[], agente: string): void {
  db.transaction(() => {
    seguirParcheEnFicha(db, m.id, cambios, m.ronda);
    const f = db.prepare('SELECT datos FROM memoria_estrategias WHERE memoria_id = ?').get(m.id) as
      { datos: string } | undefined;
    const datos = f ? (JSON.parse(f.datos) as { hechos: HechoData[] }) : null;
    const apartados = datos && cambios.length ? rehacerLosQueUsan(db, m, cambios, datos.hechos) : [];
    if (datos && cambios.length) {
      datos.hechos = datos.hechos.map((h) => ({
        ...h,
        valor: cambios.find((c) => c.clave === h.clave)?.despues ?? h.valor,
      }));
      db.prepare('UPDATE memoria_estrategias SET datos = ? WHERE memoria_id = ?').run(JSON.stringify(datos), m.id);
    }
    db.prepare(
      "UPDATE memoria_parches_hechos SET estado = 'recibido', cambios = ?, apartados = ?, agente = ?, recibido_en = ? WHERE memoria_id = ? AND ronda = ? AND estado = 'pendiente'",
    ).run(JSON.stringify(cambios), JSON.stringify(apartados), agente, new Date().toISOString(), m.id, m.ronda);
    const actuales = JSON.parse(filaMemoria(db, m.id)?.avisos ?? '[]') as string[];
    db.prepare('UPDATE memorias SET avisos = ? WHERE id = ?').run(
      JSON.stringify([...new Set([...actuales, ...cambios.map((c) => avisoDeCambio(c, m.ronda))])]),
      m.id,
    );
  })();
}

export type HechosRecibidos = {
  memoria: number;
  ronda: number;
  cambiados: string[];
  mantenidos: string[];
  avisos: string[];
};

/**
 * Revisa y guarda los hechos corregidos de una ronda. Con `revisar` (la tool), un valor que
 * aplaza se rechaza hasta el tercer envío; una fuga, un nombre con el equipo por roles o un
 * hecho que no se pidió, siempre. Lo cambiado pasa a la hoja de hechos y a los avisos.
 */
export function recibirHechos(
  db: Db,
  e: HechosEntradaData,
  agente: string,
  op: { revisar?: boolean; hoy?: Date } = {},
): Result<HechosRecibidos> {
  const d = destinoDelParche(db, e);
  if (d.error) return d;
  const r = revisarHechos(db, d.data.m, e, d.data.parche);
  const exigir = op.revisar === true && exigirRevision(db, 'licitaciones_memoria_hechos', recursoHechos(e), op.hoy);
  if (r.duros.length || (exigir && r.blandos.length))
    return fail('invalid_input', `${[...r.duros, ...r.blandos].join(' ')} Corrige y vuelve a enviar todos los hechos.`);
  const cambios = cambiosDe(e, d.data.parche);
  guardarParche(db, d.data.m, cambios, agente);
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: e.id,
    datos: { accion: 'hechos', version: d.data.m.version, ronda: e.ronda, memoria: e.memoria_id },
  });
  const cambiados = cambios.map((c) => c.clave);
  return ok({
    memoria: e.memoria_id,
    ronda: e.ronda,
    cambiados,
    mantenidos: e.hechos.map((h) => h.clave).filter((k) => !cambiados.includes(k)),
    avisos: exigir ? [] : r.blandos,
  });
}

/** «hecho» del trabajo: el parche de esa ronda ya no está pendiente (o la memoria ya no lo espera). */
export function hechosRecibidos(db: Db, p: PayloadHechosData): boolean {
  const m = filaMemoria(db, p.memoria_id);
  if (!m || m.estado !== 'redactando' || m.fase !== 'hechos' || m.ronda !== p.ronda) return true;
  return parcheDe(db, m.id, p.ronda)?.estado !== 'pendiente';
}

// ── Instrucciones ──

function lineasPedido(p: PedidoHecho): string[] {
  return [
    `- «${p.clave}» (${p.sobre}): hoy «${p.valor}».`,
    ...p.motivos.map(
      (m) => `  · Apartado ${m.apartado}, sobre «${m.cita}»: ${m.motivo} Arreglo que propone: ${m.arreglo}`,
    ),
    ...(p.ficha
      ? [
          `  · Este valor lo APROBÓ UNA PERSONA en la ficha de solución («${p.ficha}»): mantenlo salvo que el motivo lo contradiga; si lo cambias, di en «motivo» qué del motivo lo contradice.`,
        ]
      : []),
  ];
}

/** Instrucciones del run que corrige los hechos citados por el crítico. */
export function instruccionesHechos(db: Db, p: PayloadHechosData): string {
  const cabecera = `Tarea de la plataforma de ${nombreEmpresa(db)}: corrige la hoja de hechos de la memoria técnica (versión ${p.version}, ronda ${p.ronda}) de la licitación ${p.id} antes de reescribir los apartados. Sigue la skill «licitaciones» (sección «Corregir hechos en una ronda»).`;
  const parche = parcheDe(db, p.memoria_id, p.ronda);
  if (!parche || parche.estado !== 'pendiente')
    return [cabecera, '', 'Este parche ya no está pendiente: no hagas nada y termina.'].join('\n');
  const m = filaMemoria(db, p.memoria_id);
  return [
    cabecera,
    '',
    ...lineasRevision(fichaDe(db, p.memoria_id), m?.ensayo === 1),
    'El crítico ciego bajó la nota citando estos valores de la hoja de hechos. La hoja es el contrato de la redacción: mientras no cambie, los apartados no pueden arreglarlo.',
    ...parche.pedidos.flatMap(lineasPedido),
    '',
    'CÓMO CORREGIR:',
    '1. Solo estos hechos: el resto de la hoja no se toca. Lee la estrategia y el dossier (licitaciones_oferta, licitaciones_dossier) si necesitas contexto.',
    '2. Por cada uno, el valor que fijaría el mejor competidor: concreto (cifra, fecha, servicio, región, horario), sin aplazarlo («a acordar», «pendiente de», «T0») y escrito como hecho, sin «el órgano lo ratifica»: la ratificación es solo para lo que el pliego reserva al órgano. Ni importes, ni criterios automáticos de otro archivo, ni nombres si el equipo va por roles.',
    '3. Si el motivo no va contra el valor sino contra cómo lo cuenta el texto, mantenlo (envía el mismo valor y por qué se mantiene): los apartados se reescriben igual.',
    `4. Envía licitaciones_memoria_hechos con id=${p.id}, memoria_id=${p.memoria_id}, ronda=${p.ronda} y «hechos»: uno por cada clave de arriba con «valor» y «motivo». Si responde con un error, corrige exactamente lo que dice y reenvía todos.`,
    'No hagas nada más: no reescribas apartados (vienen después) y no respondas en ningún canal. Cada cambio queda marcado para que una persona lo revise.',
  ].join('\n');
}
