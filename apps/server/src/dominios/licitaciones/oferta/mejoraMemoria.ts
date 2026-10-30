// Lo que recibe el redactor por cada apartado de una versión que se pide para MEJORAR la memoria.
import type { Db } from '../store.js';
import { evaluacionDeMemoria, type Evaluacion, type EvaluacionDatosData } from '../propuestas/evaluacion.js';
import { apartadosDe, type FilaMemoria } from './ensamblado.js';
import { esDelApartado, localizarCitas, textosDeApartados, tramoMaximo } from './evaluacionMemoria.js';
import { datosDeFila } from './fugasMemoria.js';
import type { GuionBaseData } from './guion.js';
import { puntosTexto } from './guionRevision.js';
import { textoDeBloque, type ApartadoDatosData } from './memoriaRevision.js';

// Se pide con «Nueva versión» de una persona o una ronda que pide Hermes (actualizarMemoria.ts), frente a un
// cambio tardío, que conserva el texto y cambia solo lo que depende del cambio (redaccion.ts). Aquí el apartado
// se reescribe para su tramo máximo con lo que dijo la evaluación de la base (justificación, tramo, sugerencias
// y párrafos genéricos). Las indicaciones de la persona van primero y mandan; el motivo de Hermes va al final,
// como contexto.
type ApartadoGuion = NonNullable<GuionBaseData['memoria']>['apartados'][number];
type Sugerencia = EvaluacionDatosData['modificar'][number];
type Bloque = ApartadoDatosData['bloques'][number];

function cabecera(version: number, ev: Evaluacion, a: ApartadoGuion, n: number): string[] {
  const c = ev.datos.criterios.find((x) => x.apartado === n);
  const descripcion = (puntos: number) => a.escala.find((t) => Math.abs(t.puntos - puntos) < 0.01)?.descripcion;
  const conDescripcion = (puntos: number) =>
    `${puntosTexto(puntos)} puntos${descripcion(puntos) ? `: «${descripcion(puntos)}»` : ''}`;
  const obtenido = c ? (c.tramo ?? c.puntuacion) : null;
  const donde =
    obtenido === null
      ? 'la evaluación propia no lo puntuó'
      : `la evaluación propia lo deja en el tramo de ${conDescripcion(obtenido)}`;
  return [
    `MEJORA DE LA VERSIÓN ${version}: este apartado ya se redactó y ${donde}. Reescríbelo para el tramo máximo (${conDescripcion(tramoMaximo(a))}): conserva lo que la mesa valoraría y corrige esto.`,
    ...(c ? [`- Justificación de la evaluación: «${c.justificacion}»`] : []),
  ];
}

function sugerencias(ev: Evaluacion, a: ApartadoGuion, n: number, textos: string[]): string[] {
  const de = (nombre: string, xs: Sugerencia[]) =>
    xs.filter((s) => esDelApartado(s.referencia, n, a.titulo)).map((s) => `- ${nombre}: ${s.que} (${s.referencia})`);
  const genericos = ev.datos.genericos ?? [];
  const donde = localizarCitas(
    textos,
    genericos.map((g) => g.texto),
  );
  // Un genérico se localiza por su texto; si no aparece, por la referencia que dio la evaluación.
  const aqui = genericos.filter(
    (g, i) => donde[i] === n || (donde[i] === null && esDelApartado(g.referencia, n, a.titulo)),
  );
  return [
    ...de('Modificar', ev.datos.modificar),
    ...de('Reforzar', ev.datos.reforzar),
    ...de('Eliminar', ev.datos.eliminar),
    ...(aqui.length
      ? [
          '- Párrafos genéricos que la mesa no puntuaría (reescríbelos con quién, cuándo y con qué medida, o quítalos):',
          ...aqui.map((g) => `  · «${g.texto}» — ${g.por_que}`),
        ]
      : []),
  ];
}

// La figura va entera para poder conservarla o retocarla sin dibujarla de cero; tablas e imágenes
// (de una versión editada a mano, p. ej.) tal cual, para conservarlas.
function bloqueAnterior(b: Bloque, i: number): string {
  const figura = b.figura ? `\nSVG de la figura (reutilízalo si sigue valiendo):\n${b.figura.svg}` : '';
  const tabla = b.tabla ? `\nTABLA (consérvala o mejórala en «tabla» del bloque):\n${JSON.stringify(b.tabla)}` : '';
  const im = b.imagen;
  const imagen = im
    ? `\nIMAGEN de la versión editada a mano: para conservarla, pon en el bloque que toque "imagen": ${JSON.stringify({ ruta: im.ruta, ancho: im.ancho, alto: im.alto, ...(im.pie ? { pie: im.pie } : {}) })}`
    : '';
  return `[Bloque ${i + 1}]\n${textoDeBloque(b)}${figura}${tabla}${imagen}`;
}

function textoAnterior(db: Db, base: FilaMemoria, n: number): string[] {
  const d = datosDeFila(apartadosDe(db, base.id).find((f) => f.apartado === n));
  if (!d) return [`TEXTO ANTERIOR: la v${base.version} no llegó a redactar este apartado; redáctalo entero.`];
  return [
    `TEXTO ANTERIOR DEL APARTADO (v${base.version}; reescríbelo entero, no lo reenvíes tal cual):`,
    ...d.bloques.map(bloqueAnterior),
  ];
}

const lineasPersona = (indicaciones: string | null | undefined): string[] =>
  indicaciones
    ? [
        'INDICACIONES DE QUIEN LLEVA LA OFERTA (mandan sobre la evaluación; aplica las que toquen a este apartado):',
        indicaciones,
        '',
      ]
    : [];

const lineasAgente = (motivo: string | null | undefined): string[] =>
  motivo
    ? ['', `HERMES PIDIÓ ESTA RONDA PORQUE: ${motivo} (es contexto: no manda sobre la evaluación ni añade compromisos)`]
    : [];

/**
 * Lo que añade la tarea de redacción a un apartado de una versión de mejora en su ronda 0: las
 * indicaciones de la persona, la evaluación de la base de ese apartado con la consigna de mejorarlo,
 * el motivo de Hermes y el texto anterior. Vacío si la memoria no es de mejora o no tiene base.
 */
export function lineasMejora(db: Db, m: FilaMemoria, n: number, a: ApartadoGuion): string[] {
  if (!m.mejora || m.version_base === null || m.ronda !== 0) return [];
  const base = db
    .prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?')
    .get(m.licitacion_id, m.version_base) as FilaMemoria | undefined;
  if (!base) return [];
  const ev = evaluacionDeMemoria(db, m.licitacion_id, base.version);
  const evaluacion = ev
    ? [...cabecera(base.version, ev, a, n), ...sugerencias(ev, a, n, textosDeApartados(db, base.id))]
    : [
        `NUEVA VERSIÓN DE LA ${base.version}: reescribe este apartado para el tramo máximo (${puntosTexto(tramoMaximo(a))} puntos)${m.indicaciones ? ' siguiendo las indicaciones de arriba' : ''}.`,
      ];
  return [
    ...lineasPersona(m.indicaciones),
    ...evaluacion,
    ...lineasAgente(m.motivo_agente),
    '',
    ...textoAnterior(db, base, n),
  ];
}
