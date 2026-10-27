// Memoria técnica, ficha de solución: tras la estrategia, una persona ve los parámetros de diseño
// que propone Hermes y los acepta o edita. La redacción no se encola sin esa aprobación; se
// encola al aprobar o, sin respuesta, a las 24 h con los valores marcados como no revisados. En
// una memoria de ensayo no se espera. La API valida la edición con un esquema estricto.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  arrancar,
  cerrar,
  conectar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  T_CURIOSO,
  T_OFERTA,
  texto,
  trabajosDe,
} from '../helpers/memoriaEntorno.js';
import { de } from '../helpers/persona.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';

const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, estrategiaDe, recibirEstrategia } =
  await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const {
  abrirFicha,
  ACOGIDOS_SE_DECLARAN,
  ESPERA_FICHA_MS,
  fichaDe,
  lineaRevision,
  NO_ACREDITADO_NO_BLOQUEA,
  reglaNoAcreditado,
} = await import('../../src/dominios/licitaciones/oferta/fichaSolucion.js');
const { instruccionesRedaccion, PayloadRedaccion, TIPO_MEMORIA_REDACCION } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');

before(arrancar);
after(cerrar);

// Una memoria con su estrategia guardada y la vuelta ya pasada: esperando en la ficha (o, de ensayo, redactando).
async function trasEstrategia(op: { ensayo?: boolean } = {}): Promise<{ memoria: number; version: number }> {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  if (op.ensayo) db.prepare('UPDATE memorias SET ensayo = 1 WHERE id = ?').run(p.memoria);
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
  await avanzarMemoria(nucleo().db, db, p.memoria);
  return { memoria: p.memoria, version: p.version };
}
const redacciones = () => trabajosDe(TIPO_MEMORIA_REDACCION);
const ruta = (version: number) => `/licitaciones/${ID}/oferta/memoria/${version}/ficha`;

test('should_not_enqueue_redaction_until_the_solution_sheet_is_approved', async () => {
  const n = await trasEstrategia();
  assert.equal(memoriaPorId(n.memoria).fase, 'ficha');
  const f = fichaDe(db, n.memoria)!;
  assert.equal(f.estado, 'pendiente');
  assert.ok(f.campos.length >= 5, `${f.campos.length} campos`);
  assert.deepEqual(
    f.campos.find((c) => c.clave === 'soporte-horario'),
    {
      clave: 'soporte-horario',
      grupo: 'Soporte',
      etiqueta: 'Horario',
      propuesto: 'L-V 9:00-17:00 (hora de Canarias)',
      valor: 'L-V 9:00-17:00 (hora de Canarias)',
      hechos: [{ clave: 'horario_atencion', valor: 'L-V 9:00-17:00 (hora de Canarias)' }],
    },
  );
  await avanzarMemoria(nucleo().db, db, n.memoria, Date.now() + ESPERA_FICHA_MS - 60_000);
  assert.equal(memoriaPorId(n.memoria).fase, 'ficha', 'a un minuto de las 24 h, sigue esperando');
  assert.deepEqual(redacciones(), [], 'sin aprobar no se encola la redacción');
});

test('should_enqueue_redaction_when_a_person_approves_the_sheet_with_edits', async () => {
  const n = await trasEstrategia();
  const r = await api(
    ruta(n.version),
    { campos: [{ clave: 'soporte-horario', valor: 'L-V 8:00-15:00 (hora de Canarias)' }] },
    'PUT',
    de('Elisa'),
  );
  assert.equal(r.status, 200, await r.clone().text());
  const f = (await r.json()) as {
    estado: string;
    revisada_por: string;
    revisada_en: string;
    editados: string[];
    no_revisados: string[];
  };
  assert.deepEqual(
    [f.estado, f.revisada_por, f.editados, f.no_revisados],
    ['aprobada', 'Elisa', ['soporte-horario'], []],
  );
  assert.ok(Date.now() - Date.parse(f.revisada_en) < 60_000, 'guarda cuándo');
  const m = memoriaPorId(n.memoria);
  assert.equal(m.fase, 'redaccion');
  assert.equal(redacciones().length, 1, 'al aprobar se encola la redacción, sin esperar a la vuelta');
  assert.equal(
    estrategiaDe(db, n.memoria)!.datos.hechos.find((h) => h.clave === 'horario_atencion')!.valor,
    'L-V 8:00-15:00 (hora de Canarias)',
    'la hoja de hechos copia lo que cambió la persona',
  );
  const inst = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(redacciones()[0]!.payload)));
  assert.match(inst, /FICHA DE SOLUCIÓN \(revisada por una persona: manda sobre la estrategia y la hoja de hechos/);
  assert.match(
    inst,
    /- Soporte · Horario: L-V 8:00-15:00 \(hora de Canarias\) \(lo cambió la persona; Hermes proponía «L-V 9:00-17:00 \(hora de Canarias\)»\)/,
  );
  assert.equal((await api(ruta(n.version), { revisado_por: 'Elisa' }, 'PUT')).status, 409, 'aprobada, ya no se cambia');
});

test('should_enqueue_redaction_after_24_hours_marking_values_as_unreviewed', async () => {
  const n = await trasEstrategia();
  await avanzarMemoria(nucleo().db, db, n.memoria, Date.now() + ESPERA_FICHA_MS + 60_000);
  const m = memoriaPorId(n.memoria);
  assert.equal(m.fase, 'redaccion');
  assert.equal(redacciones().length, 1, 'vencida, se redacta con lo propuesto');
  const f = fichaDe(db, n.memoria)!;
  assert.equal(f.estado, 'vencida');
  assert.deepEqual(
    f.no_revisados,
    f.campos.map((c) => c.clave),
    'todos sin revisar',
  );
  const avisos = JSON.parse(filaMemoria(db, n.memoria)!.avisos) as string[];
  assert.ok(
    avisos.some(
      (a) =>
        a.startsWith(
          'FICHA DE SOLUCIÓN SIN REVISAR (pasaron 24 h sin que nadie la revisara): la memoria compromete estos valores que propuso Hermes',
        ) && a.includes('Horario: L-V 9:00-17:00 (hora de Canarias)'),
    ),
    avisos.join('\n'),
  );
});

test('should_not_wait_for_the_sheet_in_an_ensayo', async () => {
  const n = await trasEstrategia({ ensayo: true });
  assert.equal(memoriaPorId(n.memoria).fase, 'redaccion', 'de ensayo, sigue con lo propuesto');
  assert.equal(fichaDe(db, n.memoria), null, 'no se abre ficha');
  assert.equal(redacciones().length, 1);
});

test('should_keep_the_24_hours_when_the_monitor_restarts', async () => {
  const n = await trasEstrategia();
  const antes = fichaDe(db, n.memoria)!;
  const m = filaMemoria(db, n.memoria)!;
  assert.equal(
    abrirFicha(db, m, estrategiaDe(db, n.memoria)!.datos.solucion, Date.now() + 3_600_000),
    false,
    'ya estaba abierta',
  );
  assert.equal(fichaDe(db, n.memoria)!.vence_en, antes.vence_en, 'el plazo no vuelve a empezar');
});

test('should_reject_a_put_with_invalid_fields_with_400', async () => {
  const n = await trasEstrategia();
  const casos: [string, unknown, RegExp][] = [
    // Sin «quién» ya no hay 400: el servidor firma siempre con la persona de la sesión.
    ['campo extra', { revisado_por: 'Elisa', aprobar: true }, /«revisado_por»/],
    ['valor vacío', { revisado_por: 'Elisa', campos: [{ clave: 'soporte-horario', valor: '' }] }, /«campos»/],
    [
      'clave ajena',
      { revisado_por: 'Elisa', campos: [{ clave: 'region', valor: 'UE' }] },
      /Estos campos no están en la ficha: region\./,
    ],
    [
      'repetida',
      {
        revisado_por: 'Elisa',
        campos: [
          { clave: 'inicio', valor: '2027-01-11' },
          { clave: 'inicio', valor: '2027-01-12' },
        ],
      },
      /Cada campo, una vez: inicio\./,
    ],
    [
      'inicio que no es fecha',
      { revisado_por: 'Elisa', campos: [{ clave: 'inicio', valor: 'en enero' }] },
      /El inicio del contrato va como fecha AAAA-MM-DD \(llegó «en enero»\)\./,
    ],
  ];
  for (const [caso, cuerpo, mensaje] of casos) {
    const r = await api(ruta(n.version), cuerpo, 'PUT');
    assert.equal(r.status, 400, caso);
    assert.match(((await r.json()) as { message: string }).message, mensaje, caso);
  }
  assert.equal(memoriaPorId(n.memoria).fase, 'ficha', 'nada de eso la aprueba');
  assert.equal(
    (await api(`/licitaciones/${ID}/oferta/memoria/abc/ficha`, { revisado_por: 'Elisa' }, 'PUT')).status,
    400,
  );
  assert.equal((await api(ruta(n.version + 50), undefined, 'GET')).status, 404);
  const g = await api(ruta(n.version), undefined, 'GET');
  assert.equal(g.status, 200);
  assert.equal(((await g.json()) as { estado: string }).estado, 'pendiente');
});

test('should_tell_agents_the_sheet_is_pending_review', async () => {
  await trasEstrategia();
  const c = await conectar(T_OFERTA);
  try {
    const r = await c.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } });
    const progreso = (
      JSON.parse(texto(r)) as {
        memoria: {
          progreso: {
            fase: string;
            situacion: string;
            ficha: { estado: string; campos: { clave: string; hechos?: unknown }[] };
          };
        };
      }
    ).memoria.progreso;
    assert.equal(progreso.fase, 'ficha');
    assert.ok(
      progreso.ficha.campos.some((c) => c.hechos !== undefined),
      'el agente de la oferta ve los hechos de cada campo',
    );
    assert.match(
      progreso.situacion,
      /^ficha de solución pendiente de revisión: una persona acepta o edita los valores en la web/,
    );
    assert.equal(progreso.ficha.estado, 'pendiente');
  } finally {
    await c.close();
  }
});

test('should_hide_the_fact_sheet_in_the_solution_sheet_from_agents_without_people_permission', async () => {
  await trasEstrategia();
  const c = await conectar(T_CURIOSO);
  try {
    const r = await c.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } });
    const campos = (
      JSON.parse(texto(r)) as { memoria: { progreso: { ficha: { campos: { clave: string; hechos?: unknown }[] } } } }
    ).memoria.progreso.ficha.campos;
    assert.ok(
      campos.length > 0 && campos.every((x) => x.hechos === undefined),
      'la hoja de hechos puede nombrar al equipo',
    );
  } finally {
    await c.close();
  }
});

test('should_carry_edits_of_composite_fields_and_the_start_to_the_solution_and_fact_sheet', async () => {
  const n = await trasEstrategia();
  const antes = estrategiaDe(db, n.memoria)!.datos;
  const inicio = new Date(Date.parse(`${antes.solucion!.calendario.inicio}T00:00:00Z`) + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const r = await api(
    ruta(n.version),
    {
      revisado_por: 'Elisa',
      campos: [
        { clave: 'soporte-respuesta', valor: 'Respuesta a consultas en 72 horas' },
        { clave: 'inicio', valor: inicio },
      ],
    },
    'PUT',
  );
  assert.equal(r.status, 200, await r.clone().text());
  const e = estrategiaDe(db, n.memoria)!.datos;
  assert.equal(
    e.hechos.find((h) => h.clave === 'respuesta_consultas')!.valor,
    '72 horas',
    'la hoja: la coherencia ya no devuelve el texto a 48 horas',
  );
  assert.equal(
    e.hechos.find((h) => h.clave === 'responsable')!.valor,
    'Responsable del servicio (50 %)',
    'lo demás no se toca',
  );
  assert.equal(e.solucion!.soporte!.respuesta, 'Respuesta a consultas en 72 horas', 'la solución que lee la redacción');
  assert.equal(e.solucion!.calendario.inicio, inicio);
  assert.deepEqual(
    e.solucion!.calendario.semanas.map((x) => x.desde),
    antes.solucion!.calendario.semanas.map((x) =>
      new Date(Date.parse(`${x.desde}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10),
    ),
    'el calendario se desplaza con el inicio',
  );
  const inst = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(redacciones()[0]!.payload)));
  assert.match(inst, /Soporte: L-V 9:00-17:00 \(hora de Canarias\); Respuesta a consultas en 72 horas;/);
  assert.match(
    inst,
    /- Calendario · Tramo 1 \(desde · hasta · trabajo · rol · entregable · puerta\): [^\n]*\(se ajustó a lo que cambió la persona; Hermes proponía/,
  );
});

test('should_reject_an_edit_that_leaves_a_reversed_calendar_stretch', async () => {
  const n = await trasEstrategia();
  const r = await api(
    ruta(n.version),
    {
      revisado_por: 'Elisa',
      campos: [{ clave: 'semana-1', valor: '2030-01-10 · 2030-01-01 · Arranque · RS · Acta · Acta firmada' }],
    },
    'PUT',
  );
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { message: string }).message, /acaban antes de empezar: 2030-01-10–2030-01-01/);
  assert.equal(fichaDe(db, n.memoria)!.estado, 'pendiente', 'nada se aplica');
});

// ── El estado de la revisión, dicho a la redacción (sin él, la redacción leía «una persona revisa
// los parámetros antes de redactar» como un bloqueo y no redactó nada) ──

const instruccionesDeRedaccion = () =>
  instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(redacciones().at(-1)!.payload)));

test('should_tell_redaction_who_approved_the_sheet_and_when', async () => {
  const n = await trasEstrategia();
  assert.equal((await api(ruta(n.version), {}, 'PUT', de('Elisa'))).status, 200);
  // La fecha que guardó la plataforma, no la del reloj del test: a medianoche (Madrid) diferirían.
  const revisada = fichaDe(db, n.memoria)!.revisada_en!;
  assert.ok(Date.now() - Date.parse(revisada) < 60_000, `aprobada ahora, no ${revisada}`);
  const hoy = new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(new Date(revisada));
  const inst = instruccionesDeRedaccion();
  assert.ok(
    inst.includes(
      `\nREVISIÓN HUMANA: ficha de solución aprobada por Elisa el ${hoy}: redacta con estos valores. Ninguna revisión humana bloquea esta tarea`,
    ),
    inst.slice(0, 1500),
  );
  assert.ok(
    inst.indexOf('REVISIÓN HUMANA') < inst.indexOf('TE TOCA REDACTAR'),
    'antes que nada de lo que hay que redactar',
  );
});

test('should_tell_redaction_the_expired_sheet_goes_with_the_proposed_values', async () => {
  await trasEstrategia().then((n) => avanzarMemoria(nucleo().db, db, n.memoria, Date.now() + ESPERA_FICHA_MS + 60_000));
  assert.match(
    instruccionesDeRedaccion(),
    /\nREVISIÓN HUMANA: ficha de solución vencida sin revisar: redacta con lo propuesto; esos valores quedan marcados para la revisión final\. Ninguna revisión humana bloquea/,
  );
});

test('should_tell_redaction_an_ensayo_has_no_human_review', async () => {
  await trasEstrategia({ ensayo: true });
  const inst = instruccionesDeRedaccion();
  assert.match(
    inst,
    /\nREVISIÓN HUMANA: memoria de ENSAYO: no hay revisión humana; redacta con lo propuesto\. Ninguna revisión humana bloquea esta tarea: si la estrategia o la hoja de hechos dicen que algo espera una revisión o queda bloqueado, no te detiene\./,
  );
  assert.ok(!inst.includes('FICHA DE SOLUCIÓN ('), 'sin ficha que copiar');
});

test('should_treat_unaccredited_team_experience_as_a_warning_not_a_block', async () => {
  await trasEstrategia({ ensayo: true });
  const inst = instruccionesDeRedaccion();
  assert.ok(inst.includes(NO_ACREDITADO_NO_BLOQUEA));
  assert.match(NO_ACREDITADO_NO_BLOQUEA, /experiencia de la empresa o del equipo, certificaciones/);
  assert.match(NO_ACREDITADO_NO_BLOQUEA, /NO BLOQUEA: redacta igual sin afirmarlo ni inventar acreditaciones/);
  assert.match(
    NO_ACREDITADO_NO_BLOQUEA,
    /la plataforma se lo avisa a la persona/,
    'el aviso lo pone la plataforma (acreditaciones.ts), no el redactor',
  );
});

// Sin revisión, la hoja de hechos es lo que propuso el propio modelo: no puede imponer una
// experiencia que el dossier contradice (5 años en un sitio, 12 en otro).
test('should_not_let_an_unreviewed_fact_sheet_impose_an_unaccredited_merit', async () => {
  await trasEstrategia({ ensayo: true });
  const inst = instruccionesDeRedaccion();
  assert.match(
    inst,
    /Nadie ha revisado la hoja de hechos ni la ficha: una experiencia, unos años, una certificación o un proyecto que el dossier no respalda o en el que se contradice NO se afirma aunque lo traigan la hoja o la ficha \(gana a «cópialos tal cual»/,
  );
  assert.ok(!inst.includes('manda la hoja de hechos'), 'en un ensayo la hoja no manda sobre el dossier');
  const vencida = { estado: 'vencida' } as Parameters<typeof reglaNoAcreditado>[0];
  assert.match(
    reglaNoAcreditado(vencida, false),
    /Nadie ha revisado la hoja de hechos/,
    'vencida, igual que el ensayo',
  );
  assert.match(reglaNoAcreditado(null, false), /Nadie ha revisado la hoja de hechos/);
  const aprobada = { estado: 'aprobada' } as Parameters<typeof reglaNoAcreditado>[0];
  assert.match(
    reglaNoAcreditado(aprobada, false),
    /Si el dossier se contradice, manda la hoja de hechos: la revisó una persona\.$/,
  );
  assert.match(reglaNoAcreditado(aprobada, true), /Nadie ha revisado/, 'el ensayo manda sobre una ficha aprobada');
});

// Con el hallazgo «compromiso» (coherenciaMemoria.ts), «no lo afirmes» y «declara su valor» eran dos
// órdenes opuestas: el criterio al que se acoge la empresa en esta memoria se declara, y lo dice primero.
test('should_tell_redaction_a_criterion_we_claim_in_this_memoria_is_declared_even_without_evidence', async () => {
  await trasEstrategia({ ensayo: true });
  const inst = instruccionesDeRedaccion();
  assert.ok(inst.includes(ACOGIDOS_SE_DECLARAN));
  assert.match(
    ACOGIDOS_SE_DECLARAN,
    /^EXCEPCIÓN, Y MANDA SOBRE LO ANTERIOR: un criterio al que nos acogemos y que se acredita EN ESTA MEMORIA .* decláralo con su valor .* sin inventar CV, proyectos, títulos ni fechas/,
  );
  assert.ok(
    inst.indexOf(NO_ACREDITADO_NO_BLOQUEA) < inst.indexOf(ACOGIDOS_SE_DECLARAN),
    'la excepción va detrás de la regla',
  );
  assert.match(inst, /solo la excepción de los criterios a los que nos acogemos la gana a ella/);
});

test('should_name_the_review_state_without_a_sheet_outside_an_ensayo', () => {
  assert.match(
    lineaRevision(null, false),
    /^REVISIÓN HUMANA: no hay ficha de solución que revisar: redacta con lo propuesto\./,
  );
  assert.match(lineaRevision(null, true), /memoria de ENSAYO/, 'el ensayo manda aunque no haya ficha');
});
