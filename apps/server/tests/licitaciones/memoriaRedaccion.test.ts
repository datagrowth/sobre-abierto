// Memoria técnica, paso 3: la memoria entera en un run. Un único trabajo para todos los apartados
// pendientes, con la estrategia entera en línea y el índice del dossier; cada apartado se envía
// al terminarlo; un reintento pide solo lo que falta; los rechazos cuentan por ronda; con el
// último apartado la memoria pasa a la crítica y no se ensambla.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrancar,
  cerrar,
  conectar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  T_OFERTA,
  texto,
  trabajosDe,
  trasLaEstrategia,
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { apartadoCasoA } from './fixtures/casoA.js';

const { ApartadoEntrada, marcarApartadosFallidos, pedirMemoria, recibirApartado, recursoApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { instruccionesRedaccion, PayloadRedaccion, redaccionHecha, TIPO_MEMORIA_REDACCION, textoDeApartado } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { ApartadoDatos } = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');

before(arrancar);
after(cerrar);

type Numeros = { memoria_id: number; guion_id: number; version: number };

// Una memoria con dossier y estrategia, ya en la redacción y con su trabajo encolado.
async function enRedaccion(): Promise<Numeros> {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(
    recibirEstrategia(
      db,
      nucleo().db,
      EstrategiaEntrada.parse(estrategiaCasoA({ memoria_id: p.memoria, version: p.version })),
      'oferta-licitaciones',
    ).error,
    null,
  );
  await trasLaEstrategia(p.memoria);
  const m = memoriaPorId(p.memoria);
  assert.equal(m.fase, 'redaccion');
  return { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
}
const enviar = (n: number, numeros: Numeros) =>
  recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(n, numeros)), 'oferta-licitaciones', { revisar: true });
const payload = () => PayloadRedaccion.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!.payload));
const apartados = (memoria: number) =>
  db
    .prepare('SELECT apartado, estado, trabajo_id, error FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(memoria) as { apartado: number; estado: string; trabajo_id: number | null; error: string | null }[];

test('should_enqueue_single_job_for_all_pending_apartados', async () => {
  const n = await enRedaccion();
  const trabajos = trabajosDe(TIPO_MEMORIA_REDACCION);
  assert.deepEqual(
    trabajos.map((t) => t.clave),
    [`memoria-${ID}-v${n.version}-r0`],
  );
  assert.deepEqual(
    apartados(n.memoria_id).map((a) => a.trabajo_id),
    Array(4).fill(trabajos[0]!.id),
    'todos los apartados con el mismo trabajo',
  );
  assert.deepEqual(payload(), { id: ID, ...n, ronda: 0, pedida_en: memoriaPorId(n.memoria_id).pedida_en });
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(trabajosDe(TIPO_MEMORIA_REDACCION).length, 1, 'no lo pide dos veces');
  assert.equal(redaccionHecha(db, payload()), false);
});

test('should_include_full_strategy_inline_and_dossier_index', async () => {
  const n = await enRedaccion();
  const inst = instruccionesRedaccion(db, nucleo().db, payload());
  assert.match(
    inst,
    /^Tarea de la plataforma de Analítica Ejemplo: redacta la memoria técnica entera \(versión \d+, 4 apartados\) de la oferta a la licitación p-91000710/,
  );
  assert.match(inst, /TE TOCA REDACTAR los apartados 1, 2, 3, 4\./);
  assert.match(
    inst,
    /=== Apartado 1 ===\nAPARTADO: «Organización y metodología del servicio» \(8 puntos de 25 de la memoria\)\. Extensión objetivo: 16.900-18.800 caracteres/,
  );
  assert.match(
    inst,
    /\| horario_atencion \| horario \| atención de consultas \| L-V 9:00-17:00 \(hora de Canarias\) \|/,
    'la hoja de hechos entera, en línea',
  );
  assert.match(inst, /### 4\. Mejoras vinculadas al objeto del contrato \(≈ \d+\.\d00 caracteres\)/);
  assert.match(
    inst,
    new RegExp(
      `EL DOSSIER \\(léelo con licitaciones_dossier, id=${ID}, memoria_id=${n.memoria_id}\\): identificacion \\(\\d+ caracteres\\), pliego_tecnico \\(\\d+ caracteres\\)`,
    ),
  );
  assert.match(inst, /lee enteras «pliego_tecnico», «criterios», «frontera» y «equipo»/);
  assert.match(inst, /Ana García Pérez — Responsable del servicio \(50 %\)/, 'el equipo con su CV');
  assert.match(inst, /Frontera con los otros sobres: estas materias se valoran en «Archivo electrónico nº 2»/);
  assert.match(inst, /Voz afirmativa, en presente o futuro de compromiso/);
  assert.match(
    inst,
    new RegExp(
      `6\\. En cuanto termines un apartado, envíalo con licitaciones_memoria_apartado \\(id=${ID}, memoria_id=${n.memoria_id}, guion_id=${n.guion_id}, version=${n.version}, apartado=N\\)`,
    ),
  );
  assert.match(inst, /cada envío es la señal de que sigues trabajando/);
});

test('should_ask_only_for_missing_apartados_when_job_is_retried', async () => {
  const n = await enRedaccion();
  for (const k of [1, 2]) assert.equal(enviar(k, n).error, null);
  const inst = instruccionesRedaccion(db, nucleo().db, payload());
  assert.match(inst, /YA ESTÁN RECIBIDOS los apartados 1, 2: no los reenvíes\./);
  assert.match(
    inst,
    /--- Apartado 1 \(recibido\) ---\n1\. Organización y metodología del servicio\nModelo organizativo propuesto/,
  );
  assert.match(inst, /TE TOCA REDACTAR los apartados 3, 4; empieza por el 3\./);
  assert.ok(inst.includes('=== Apartado 3 ===') && inst.includes('=== Apartado 4 ==='));
  assert.ok(
    !inst.includes('=== Apartado 1 ===') && !inst.includes('=== Apartado 2 ==='),
    'no pide reenviar lo recibido',
  );
  assert.match(inst, /apartado a apartado en orden \(3, 4\)/);
});

test('should_not_count_previous_round_rejections', async () => {
  const n = await enRedaccion();
  const corto = apartadoCasoA(1, n);
  corto.bloques = corto.bloques.map((b) => ({ ...b, lista: b.lista.slice(0, 1) }));
  const rechazos = (recurso: string) => {
    const ins = nucleo().db.prepare(
      "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('oferta-licitaciones', 'licitaciones_memoria_apartado', 'licitaciones', ?, 'error', ?)",
    );
    for (let i = 0; i < 2; i += 1) ins.run(recurso, new Date().toISOString());
  };
  rechazos(recursoApartado({ id: ID, version: n.version, apartado: 1 }));
  db.prepare('UPDATE memorias SET ronda = 1 WHERE id = ?').run(n.memoria_id);
  assert.equal(recursoApartado({ id: ID, version: n.version, apartado: 1 }, 1), `${ID}#v${n.version}#a1#r1`);
  const r = recibirApartado(db, ApartadoEntrada.parse(corto), 'oferta-licitaciones', { revisar: true });
  assert.match(r.error?.message ?? '', /se queda corto/, 'los dos rechazos de la ronda 0 no cuentan en la 1');
  rechazos(recursoApartado({ id: ID, version: n.version, apartado: 1 }, 1));
  const tercero = recibirApartado(db, ApartadoEntrada.parse(corto), 'oferta-licitaciones', { revisar: true });
  assert.equal(tercero.error, null, 'dos rechazos de esta ronda: entra con avisos');
  assert.match(tercero.data!.avisos.join(' '), /se queda corto/);
});

test('should_move_to_critica_when_last_apartado_arrives', async () => {
  const n = await enRedaccion();
  for (const k of [1, 2, 3, 4]) {
    const r = enviar(k, n);
    assert.equal(r.error, null, r.error?.message);
  }
  assert.equal(redaccionHecha(db, payload()), true);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.estado], ['critica', 'redactando'], 'pasa a la crítica sin ensamblarse');
});

test('should_mark_all_pending_failed_when_single_job_fails', async () => {
  const n = await enRedaccion();
  assert.equal(enviar(1, n).error, null);
  const t = trabajosDe(TIPO_MEMORIA_REDACCION)[0]!;
  nucleo()
    .db.prepare(
      "UPDATE trabajos_ia SET estado = 'fallido', error = 'El run superó el tiempo máximo.', actualizado_en = ? WHERE id = ?",
    )
    .run(new Date().toISOString(), t.id);
  assert.equal(marcarApartadosFallidos(db), 3);
  assert.deepEqual(
    apartados(n.memoria_id).map((a) => a.estado),
    ['recibido', 'fallido', 'fallido', 'fallido'],
  );
  assert.match(
    apartados(n.memoria_id)[1]!.error ?? '',
    /El trabajo de IA no dejó el apartado: El run superó el tiempo máximo\./,
  );
  assert.equal(
    (await avanzarMemoria(nucleo().db, db, n.memoria_id)).tipo,
    'esperar',
    'falló hace nada: espera a la ronda de reintento',
  );
  nucleo()
    .db.prepare('UPDATE trabajos_ia SET actualizado_en = ? WHERE id = ?')
    .run(new Date(Date.now() - 40 * 60_000).toISOString(), t.id);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const otra = trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!;
  assert.equal(otra.clave, `memoria-${ID}-v${n.version}-r0-r1`);
  assert.deepEqual(
    apartados(n.memoria_id).map((a) => [a.estado, a.trabajo_id]),
    [
      ['recibido', t.id],
      ['pendiente', otra.id],
      ['pendiente', otra.id],
      ['pendiente', otra.id],
    ],
  );
  assert.match(
    instruccionesRedaccion(db, nucleo().db, payload()),
    /TE TOCA REDACTAR los apartados 2, 3, 4; empieza por el 2\./,
  );
});

test('should_reach_critica_end_to_end_through_mcp_with_a_single_writing_job', async () => {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  const n = { memoria_id: p.memoria, guion_id: memoriaPorId(p.memoria).guion_id, version: p.version };
  const c = await conectar(T_OFERTA);
  try {
    const e = await c.callTool({
      name: 'licitaciones_memoria_estrategia',
      arguments: estrategiaCasoA({ memoria_id: n.memoria_id, version: n.version }),
    });
    assert.equal(e.isError, undefined, texto(e));
    await trasLaEstrategia(p.memoria);
    for (const k of [1, 2, 3, 4]) {
      const r = await c.callTool({ name: 'licitaciones_memoria_apartado', arguments: apartadoCasoA(k, n) });
      assert.equal(r.isError, undefined, texto(r));
    }
  } finally {
    await c.close();
  }
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(memoriaPorId(p.memoria).fase, 'critica');
  assert.equal(trabajosDe(TIPO_MEMORIA_REDACCION).length, 1, 'un único trabajo de redacción');
});

test('should_number_the_items_of_numbered_lists_in_the_text_of_an_apartado', () => {
  const d = ApartadoDatos.parse({
    titulo: '2. Gestión de incidencias y control de calidad',
    bloques: [
      {
        subtitulo: 'Procedimiento',
        parrafos: ['Cada incidencia sigue los mismos pasos desde que se recibe hasta que se cierra.'],
        lista: ['Una viñeta de apoyo'],
        lista_numerada: ['Se registra la incidencia', 'Se asigna a una persona', 'Se cierra con la entidad'],
      },
      {
        parrafos: ['Un segundo bloque con su propia lista que vuelve a empezar en uno.'],
        lista_numerada: ['Primer paso del segundo bloque'],
      },
    ],
    cubre: [],
    compromisos: [],
  });
  assert.equal(
    textoDeApartado(d),
    [
      '2. Gestión de incidencias y control de calidad',
      'Procedimiento',
      'Cada incidencia sigue los mismos pasos desde que se recibe hasta que se cierra.',
      '- Una viñeta de apoyo',
      '1. Se registra la incidencia',
      '2. Se asigna a una persona',
      '3. Se cierra con la entidad',
      'Un segundo bloque con su propia lista que vuelve a empezar en uno.',
      '1. Primer paso del segundo bloque',
    ].join('\n'),
  );
  assert.equal(
    textoDeApartado({
      ...d,
      bloques: [{ parrafos: ['Solo un párrafo sin ninguna lista dentro del bloque.'] }],
    }).includes('1. '),
    false,
    'sin lista numerada no se numera nada',
  );
});
