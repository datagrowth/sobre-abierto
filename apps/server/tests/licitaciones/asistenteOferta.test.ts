// Asistente de la oferta: sobre las 5 ofertas sintéticas de las comprobaciones hace exactamente
// las preguntas de sus decisiones pendientes; una respuesta rápida se guarda por código sin ningún
// trabajo de IA; un texto libre va a Hermes y solo se guarda tras confirmarlo; contratar repregunta
// el plazo para acreditar al perfil a incorporar; el hilo no enseña importes a los agentes y no se
// generan los documentos mientras quede algo por decidir.
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asistente-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { decisionesDe } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { preguntasDeOferta } = await import('../../src/dominios/licitaciones/oferta/asistentePreguntas.js');
const { responder } = await import('../../src/dominios/licitaciones/oferta/asistenteRespuestas.js');
const { importeDeTexto } = await import('../../src/dominios/licitaciones/oferta/asistentePrecio.js');
const { plazoAcreditacion } = await import('../../src/dominios/licitaciones/oferta/asistenteEquipo.js');
const { cerrarLecturasFallidas, instruccionesInterpretar, interpretarRespuesta, TIPO_INTERPRETAR } =
  await import('../../src/dominios/licitaciones/oferta/asistenteInterpretar.js');
const { hiloDe } = await import('../../src/dominios/licitaciones/oferta/asistenteHilo.js');
const { hiloParaAgente } = await import('../../src/dominios/licitaciones/oferta/asistenteTools.js');
const { generarDocumentos } = await import('../../src/dominios/licitaciones/oferta/asistenteGenerar.js');
const { listarPerfilesAIncorporar } = await import('../../src/nucleo/colaboradores/aIncorporar.js');
const { ofertaSigue } = await import('../../src/dominios/licitaciones/oferta/aIncorporarOferta.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { OFERTAS_COMPROBACIONES, leerFixtureComprobaciones, sembrarFixture } =
  await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
const ID: Record<string, string> = {};
const AHORA: Record<string, number> = {};
for (const o of OFERTAS_COMPROBACIONES) {
  const f = leerFixtureComprobaciones(o);
  sembrarFixture(db, nucleo().db, f);
  ID[o] = f.id;
  AHORA[o] = Date.parse(f.ahora);
}
after(() => {
  mock.timers.reset();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function enHora<T>(oferta: string, fn: () => Promise<T> | T): Promise<T> {
  mock.timers.enable({ apis: ['Date'], now: AHORA[oferta]! });
  try {
    return await fn();
  } finally {
    mock.timers.reset();
  }
}

const preguntas = (oferta: string) =>
  enHora(oferta, async () => {
    const r = await preguntasDeOferta(db, nucleo().db, ID[oferta]!, AHORA[oferta]);
    assert.ok(r.data, r.error?.message);
    return r.data;
  });
const pendientes = async (oferta: string) =>
  (await preguntas(oferta)).preguntas.filter((p) => p.estado === 'pendiente').map((p) => p.clave);
const trabajos = () => (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n;
const version = (oferta: string) => decisionesDe(db, ID[oferta]!)?.version ?? null;

// Las filas de las comprobaciones que son decisiones de la persona: precio, datos del anexo, acogerse a un criterio y roles sin nadie.
function decisionesDeLaComprobaciones(oferta: string): string[] {
  const c = comprobacionesDe(db, nucleo().db, ID[oferta]!, AHORA[oferta]);
  return (c.data?.bloqueos ?? [])
    .filter((b) => b.actor === 'tu' && b.estado === 'abierto')
    .filter(
      (b) =>
        ['fijar_precio', 'campo', 'desmarcar_criterio'].includes(b.accion.tipo) ||
        (b.accion.tipo === 'aplicar_diff' && b.clave === 'decisiones_falta:-'),
    )
    .map((b) => b.clave);
}

test('should_ask_exactly_the_pending_decisions_of_each_real_offer', async () => {
  // Arrange
  const esperado: Record<string, number> = { casoE: 9, casoB: 1, casoF: 8, casoD: 2, casoC: 1 };

  for (const o of OFERTAS_COMPROBACIONES) {
    // Act
    const claves = await pendientes(o);
    const comprobaciones = decisionesDeLaComprobaciones(o);

    // Assert
    assert.equal(claves.length, esperado[o], `${o}: ${claves.join(' | ')}`);
    const precios = comprobaciones.filter((k) => k.startsWith('precio:')).map((k) => `precio:${k.split(':')[1]}`);
    assert.deepEqual(
      claves.filter((k) => k.startsWith('precio:')).sort(),
      precios.sort(),
      `${o}: una pregunta por precio sin decidir`,
    );
    assert.deepEqual(
      claves.filter((k) => k.startsWith('dato_anexo:')).sort(),
      comprobaciones
        .filter((k) => k.startsWith('dato_anexo:'))
        .map((k) => `dato_anexo:${k.split(':')[2]}`)
        .sort(),
      o,
    );
    if (!comprobaciones.includes('decisiones_falta:-')) {
      assert.equal(
        claves.filter((k) => k.startsWith('automatico:')).length,
        comprobaciones.filter((k) => k.startsWith('nos_acogemos:')).length,
        `${o}: los criterios contradictorios se vuelven a preguntar`,
      );
    }
  }
});

test('should_save_a_quick_answer_by_code_without_any_ai_job', async () => {
  // Arrange
  const antes = trabajos();

  // Act
  const r = await enHora('casoE', () =>
    responder(db, nucleo().db, ID.casoE!, {
      pregunta: 'dato_anexo:impuesto',
      version: version('casoE'),
      opcion: 'igic',
    }),
  );

  // Assert
  assert.equal(r.data?.estado, 'guardada', r.error?.message);
  assert.deepEqual(decisionesDe(db, ID.casoE!)?.datos.datos_anexo?.impuesto, { tipo: 'IGIC', porcentaje: 7 });
  assert.equal(trabajos(), antes, 'una respuesta rápida no lanza ningún trabajo de IA');
  assert.ok(!(await pendientes('casoE')).includes('dato_anexo:impuesto'));
  assert.deepEqual(
    hiloDe(db, ID.casoE!)
      .slice(-2)
      .map((m) => m.tipo),
    ['respuesta', 'guardado'],
  );
});

test('should_read_a_written_price_by_code_and_keep_it_from_agents', async () => {
  // Arrange
  const antes = trabajos();

  // Act
  const r = await enHora('casoC', () =>
    responder(db, nucleo().db, ID.casoC!, { pregunta: 'precio:3', version: version('casoC'), texto: '1,25 € la hora' }),
  );

  // Assert
  assert.equal(r.data?.estado, 'guardada', r.error?.message);
  const oferta = decisionesDe(db, ID.casoC!)?.datos.ofertas.find((o) => o.lote === '3');
  assert.equal(oferta?.pendiente, false);
  assert.deepEqual(
    [oferta?.importe, oferta?.unitarios.map((u) => u.precio)],
    [null, [1.25]],
    'Villaejemplo se oferta por hora: va al precio unitario',
  );
  assert.equal(trabajos(), antes, 'el precio nunca va a Hermes');
  const paraAgente = JSON.stringify(hiloParaAgente(hiloDe(db, ID.casoC!), null));
  assert.ok(!paraAgente.includes('1,25'), paraAgente);
});

test('should_read_a_discount_on_the_lot_budget_when_there_are_no_comparables', async () => {
  // Arrange: CASO_D no tiene adjudicaciones comparables (sin precio sugerido)
  const pregunta = (await preguntas('casoD')).preguntas.find((p) => p.clave === 'precio:2')!;
  assert.deepEqual(
    pregunta.opciones.map((o) => o.clave),
    ['otro'],
  );

  // Act
  const r = await enHora('casoD', () =>
    responder(db, nucleo().db, ID.casoD!, {
      pregunta: 'precio:2',
      version: version('casoD'),
      texto: 'un 10 % de baja',
    }),
  );

  // Assert: 10 % sobre el presupuesto del lote, no 10 €
  assert.equal(r.data?.estado, 'guardada', r.error?.message);
  const importe = decisionesDe(db, ID.casoD!)?.datos.ofertas.find((o) => o.lote === '2')?.importe ?? 0;
  assert.ok(importe > 1000, `importe ${importe}`);
});

test('should_ask_again_when_a_price_falls_below_the_abnormal_threshold', async () => {
  // Arrange: el pliego de CASO_D fija el umbral de anormalidad en un 20 % de baja
  const guion = db
    .prepare('SELECT id, datos FROM guiones WHERE licitacion_id = ? ORDER BY id DESC LIMIT 1')
    .get(ID.casoD!) as { id: number; datos: string };
  const { oferta_economica: oe, ...resto } = JSON.parse(guion.datos) as { oferta_economica: Record<string, unknown> };
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(
    JSON.stringify({ ...resto, ofertas_economicas: [{ ...oe, lotes: [], precios_unitarios: [], umbral_baja: 0.2 }] }),
    guion.id,
  );

  // Act: una baja del 60 %
  const r = await enHora('casoD', () =>
    responder(db, nucleo().db, ID.casoD!, { pregunta: 'precio:2', version: version('casoD'), texto: '60 % de baja' }),
  );

  // Assert: se guarda, el aviso vuelve y se repregunta en el hilo
  assert.equal(r.data?.estado, 'guardada', r.error?.message);
  assert.ok(
    r.data?.avisos.some((a) => /anormalidad/.test(a)),
    JSON.stringify(r.data?.avisos),
  );
  const aviso = hiloDe(db, ID.casoD!).at(-1);
  assert.deepEqual([aviso?.tipo, aviso?.pregunta, aviso?.autor], ['aviso', 'precio:2', 'hermes']);
  // Y no se repite al responder otra pregunta
  await enHora('casoD', () =>
    responder(db, nucleo().db, ID.casoD!, {
      pregunta: 'dato_anexo:impuesto',
      version: version('casoD'),
      opcion: 'igic',
    }),
  );
  const avisos = hiloDe(db, ID.casoD!).filter((m) => m.tipo === 'aviso');
  assert.deepEqual(
    avisos.map((m) => m.pregunta),
    ['precio:2'],
    'el aviso del precio no cuelga del impuesto',
  );
  assert.match(aviso?.texto ?? '', /anormalidad.*¿Lo mantienes o lo cambias\?/s);
});

test('should_read_prices_amounts_and_discounts', () => {
  assert.equal(importeDeTexto('29.280', null), 29280);
  assert.equal(importeDeTexto('Ponle 29.280,50 euros', null), 29280.5);
  assert.equal(importeDeTexto('un 8,5 % de baja', 32000), 29280);
  assert.equal(importeDeTexto('lo que veas', 32000), null);
  assert.equal(importeDeTexto('8,5 % de baja', null), null, 'sin base, una baja no son 8,50 €');
  assert.equal(importeDeTexto('una baja del 12%', null), null);
  assert.equal(importeDeTexto('0', null), null);
});

test('should_send_free_text_to_hermes_and_save_only_after_confirming', async () => {
  // Arrange
  const pregunta = (await preguntas('casoF')).preguntas.find((p) => p.clave === 'equipo:director:-');
  const persona = pregunta?.opciones.find((o) => o.accion?.tipo === 'persona');
  assert.ok(pregunta && persona);

  // Act: texto libre → trabajo de cola, nada guardado
  const r = await enHora('casoF', () =>
    responder(db, nucleo().db, ID.casoF!, {
      pregunta: pregunta.clave,
      version: null,
      texto: `Que lo haga ${persona.texto}`,
    }),
  );
  const libre = hiloDe(db, ID.casoF!).at(-1)!;
  const trabajo = nucleo().db.prepare('SELECT tipo, payload FROM trabajos_ia ORDER BY id DESC LIMIT 1').get() as {
    tipo: string;
    payload: string;
  };

  // Assert
  assert.equal(r.data?.estado, 'interpretando', r.error?.message);
  assert.equal(trabajo.tipo, TIPO_INTERPRETAR);
  assert.equal(JSON.parse(trabajo.payload).mensaje, libre.id);
  assert.equal(decisionesDe(db, ID.casoF!), null, 'nada se guarda antes de confirmar');

  // Act: Hermes interpreta → por confirmar; la persona confirma → guardado
  const i = await interpretarRespuesta(
    db,
    nucleo().db,
    { id: ID.casoF!, mensaje: libre.id, entendido: true, opcion: persona.clave, explicacion: 'Nombra a esa persona' },
    'oferta-licitaciones',
  );
  assert.equal(i.data?.estado, 'por_confirmar', i.error?.message);
  assert.equal(decisionesDe(db, ID.casoF!), null);
  const c = await enHora('casoF', () =>
    responder(db, nucleo().db, ID.casoF!, { pregunta: pregunta.clave, version: null, interpretacion: i.data!.mensaje }),
  );

  // Assert
  assert.equal(c.data?.estado, 'guardada', c.error?.message);
  assert.deepEqual(
    decisionesDe(db, ID.casoF!)?.datos.equipo.map((m) => m.rol_en_la_oferta),
    ['Director/a'],
  );
  assert.ok(!(await pendientes('casoF')).includes('equipo:director:-'));
});

test('should_not_send_cv_data_to_hermes_when_interpreting_a_team_answer', async () => {
  // Arrange: las opciones de equipo llevan nombre, rol y lo que le falta a cada candidato (de su CV)
  const pregunta = (await preguntas('casoB')).preguntas.find((p) => p.clave === 'equipo:coordinador:-')!;
  const personas = pregunta.opciones.filter((o) => o.accion?.tipo === 'persona');
  assert.ok(personas.length && personas.every((o) => o.detalle), 'hay candidatos con detalle');
  await enHora('casoB', () =>
    responder(db, nucleo().db, ID.casoB!, {
      pregunta: pregunta.clave,
      version: version('casoB'),
      texto: 'el de siempre',
    }),
  );
  const libre = hiloDe(db, ID.casoB!).at(-1)!;

  // Act
  const tarea = await instruccionesInterpretar(db, nucleo().db, {
    id: ID.casoB!,
    mensaje: libre.id,
    pregunta: pregunta.clave,
  });

  // Assert: cada persona solo por su id
  for (const o of personas) {
    assert.ok(!tarea.includes(o.texto.split(' · ')[0]!), `nombre de ${o.clave} en la tarea`);
    assert.ok(!tarea.includes(o.detalle!), `detalle de ${o.clave} en la tarea`);
    if (o.accion?.tipo === 'persona')
      assert.ok(tarea.includes(`«${o.clave}»: la persona ${o.accion.persona_id} de Colaboradores`));
  }
  assert.ok(!/no consta|cumple lo que se puede comprobar|docencia:|titulación:/.test(tarea), tarea);
});

test('should_close_a_reading_whose_job_failed', async () => {
  // Arrange: un texto libre cuyo trabajo de cola acabó fallido
  await enHora('casoE', () =>
    responder(db, nucleo().db, ID.casoE!, {
      pregunta: 'automatico:formatos de descarga de los registros de actividad:-',
      version: version('casoE'),
      texto: 'pues depende',
    }),
  );
  const libre = hiloDe(db, ID.casoE!).at(-1)!;
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'fallido' WHERE tipo = ? AND json_extract(payload, '$.mensaje') = ?")
    .run(TIPO_INTERPRETAR, libre.id);

  // Act
  cerrarLecturasFallidas(db, nucleo().db, ID.casoE!);

  // Assert
  const hilo = hiloDe(db, ID.casoE!);
  assert.equal(hilo.find((m) => m.id === libre.id)?.estado, 'fallida');
  assert.match(hilo.at(-1)?.texto ?? '', /Hermes no pudo leerlo/);
});

test('should_reject_an_interpretation_that_does_not_fit_the_question', async () => {
  const pregunta = (await preguntas('casoF')).preguntas.find((p) => p.clave === 'equipo:analist:-')!;
  await enHora('casoF', () =>
    responder(db, nucleo().db, ID.casoF!, {
      pregunta: pregunta.clave,
      version: version('casoF'),
      texto: 'el de siempre',
    }),
  );
  const libre = hiloDe(db, ID.casoF!).at(-1)!;
  const opcionAjena = await interpretarRespuesta(
    db,
    nucleo().db,
    { id: ID.casoF!, mensaje: libre.id, entendido: true, opcion: 'igic' },
    'h',
  );
  const precio = await interpretarRespuesta(
    db,
    nucleo().db,
    { id: ID.casoF!, mensaje: libre.id, entendido: true, accion: { tipo: 'precio', lote: null, importe: 1000 } },
    'h',
  );
  const repregunta = await interpretarRespuesta(
    db,
    nucleo().db,
    { id: ID.casoF!, mensaje: libre.id, entendido: false, repregunta: '¿Quién es «el de siempre»?' },
    'h',
  );
  assert.equal(opcionAjena.error?.code, 'invalid_input');
  assert.equal(precio.error?.code, 'invalid_input', 'el precio no se contesta en una pregunta de equipo');
  assert.equal(repregunta.data?.estado, 'repregunta');
  assert.equal(hiloDe(db, ID.casoF!).at(-1)?.texto, '¿Quién es «el de siempre»?');
});

test('should_ask_when_to_accredit_someone_to_be_hired_and_track_it_in_equipo', async () => {
  // Act: «Hay que contratarlo» no guarda nada y repregunta
  const r = await enHora('casoF', () =>
    responder(db, nucleo().db, ID.casoF!, {
      pregunta: 'equipo:analist:-',
      version: version('casoF'),
      opcion: 'contratar',
    }),
  );
  const repregunta = (await preguntas('casoF')).preguntas.find((p) => p.clave === 'incorporar:analist:-');

  // Assert
  assert.equal(r.data?.estado, 'repregunta', r.error?.message);
  assert.ok(repregunta, 'sale la pregunta del perfil a incorporar');
  assert.match(repregunta.texto, /hacia el 2027-/);
  assert.deepEqual(
    repregunta.citas.map((c) => c.documento),
    ['LCSP'],
    'sin cláusula en el guion, el art. 150.2 LCSP',
  );

  // Act: «Sí, como perfil a incorporar»
  const s = await enHora('casoF', () =>
    responder(db, nucleo().db, ID.casoF!, {
      pregunta: repregunta.clave,
      version: version('casoF'),
      opcion: 'incorporar',
    }),
  );

  // Assert
  assert.equal(s.data?.estado, 'guardada', s.error?.message);
  assert.deepEqual(
    decisionesDe(db, ID.casoF!)?.datos.a_incorporar?.map((p) => p.rol_en_la_oferta),
    ['Analista'],
  );
  const enEquipo = listarPerfilesAIncorporar(nucleo().db, { dominio: 'licitaciones', recurso: ID.casoF! });
  assert.deepEqual(
    enEquipo.map((p) => [p.perfil, p.acreditar_antes !== null]),
    [['Analista', true]],
  );
  const q = (await preguntas('casoF')).preguntas.find((p) => p.clave === 'equipo:analist:-');
  assert.equal(q?.estado, 'hecha');
  assert.match(q?.respuesta ?? '', /^A incorporar/);
});

test('should_take_the_accreditation_deadline_from_the_guion_when_it_has_it', () => {
  const guion = {
    datos: {
      documentos_adjudicacion: [
        {
          nombre: 'Documentación acreditativa de los medios',
          modelo: null,
          documento: 'PCAP',
          pagina: 19,
          cuando: 'En 10 días hábiles desde el requerimiento',
        },
      ],
    },
  };
  const p = plazoAcreditacion({ guion, licitacion: { fecha_limite: '2026-11-10T14:00:00' } } as unknown as Parameters<
    typeof plazoAcreditacion
  >[0]);
  assert.deepEqual(p.cita, {
    documento: 'PCAP',
    pagina: 19,
    texto: 'Documentación acreditativa de los medios: En 10 días hábiles desde el requerimiento',
  });
  assert.equal(p.acreditar_antes, '2026-12-24', '30 días tras el cierre y 10 hábiles, sin fines de semana ni festivos');
});

test('should_not_generate_documents_while_something_is_undecided', async () => {
  const r = await enHora('casoF', () => generarDocumentos(db, nucleo().db, raicesActuales(), ID.casoF!));
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error?.message ?? '', /Faltan \d+ decisi/);
});

test('should_refuse_an_answer_saved_over_another_version', async () => {
  const r = await enHora('casoD', () =>
    responder(db, nucleo().db, ID.casoD!, { pregunta: 'dato_anexo:impuesto', version: 999, opcion: 'iva' }),
  );
  assert.equal(r.error?.code, 'conflicto');
});

test('should_say_which_offers_still_go_on_for_their_profiles_to_incorporate', () => {
  assert.equal(ofertaSigue(db, ID.casoE!), true, 'en preparación');
  assert.equal(ofertaSigue(db, ID.casoF!), false, 'descartada: sus perfiles se retiran de Equipo');
  db.prepare("UPDATE licitaciones SET borrada_en = '2026-10-20T10:00:00Z' WHERE id = ?").run(ID.casoB!);
  assert.equal(ofertaSigue(db, ID.casoB!), false, 'retirada de la PLACSP');
  assert.equal(ofertaSigue(db, 'p-no-existe'), false);
});
