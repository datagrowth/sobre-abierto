// Memoria técnica, paso 5: el crítico ciego. Solo ve la rúbrica, el pliego y la memoria; la auditoría
// confirma que no miró nada más; sin perfil propio, la crítica queda marcada como no
// independiente. Contra el inflado: tramo de la escala, cita literal (sin ella, un tramo por
// debajo al tercer envío) y tramo máximo sin motivos para bajar.
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
  T_CRITICO,
  texto,
  trabajosDe,
  trasLaEstrategia,
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { APARTADOS, apartadoCasoA } from './fixtures/casoA.js';

const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { textoComparable } = await import('../../src/dominios/licitaciones/temas.js');
const {
  ciegaSegunAuditoria,
  cierreDeTrozo,
  CriticaEntrada,
  DEFECTOS_QUE_BAJAN,
  MOTIVO_APLAZA,
  resumenDiceMaximo,
  criticaRecibida,
  criticasDe,
  instruccionesCritica,
  PayloadCritica,
  recibirCritica,
  recursoCritica,
  LEER_HASTA_EL_CIERRE,
  RESPUESTA_PAQUETE,
  TIPO_MEMORIA_CRITICA,
  TROZO_PAQUETE,
  trozoDelPaquete,
} = await import('../../src/dominios/licitaciones/oferta/critica.js');

before(arrancar);
after(cerrar);

// Una memoria del caso A redactada entera y esperando la crítica de la ronda 0.
async function enCritica(): Promise<{ memoria_id: number; version: number }> {
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
  for (const k of [1, 2, 3, 4])
    assert.equal(
      recibirApartado(
        db,
        ApartadoEntrada.parse(apartadoCasoA(k, { memoria_id: m.id, guion_id: m.guion_id, version: m.version })),
        'oferta-licitaciones',
      ).error,
      null,
    );
  await trasLaEstrategia(p.memoria);
  assert.equal(memoriaPorId(p.memoria).fase, 'critica');
  return { memoria_id: p.memoria, version: p.version };
}

const CITA = 'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas';
// Una crítica válida: cada apartado en su segundo tramo más alto, con cita literal y un motivo para bajar.
function critica(n: { memoria_id: number }, cambios: (c: ReturnType<typeof base>) => void = () => {}) {
  const c = base(n);
  cambios(c);
  return CriticaEntrada.parse(c);
}
function base(n: { memoria_id: number }) {
  return {
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 0,
    resumen: 'Memoria correcta pero genérica: le faltan cifras propias de la entidad.',
    apartados: APARTADOS.map((a, i) => ({
      apartado: i + 1,
      tramo: a.escala.at(-2)!,
      puntos: a.escala.at(-2)!,
      cita: CITA,
      motivos_para_bajar: [
        {
          cita: 'un indicador con meta mensual que revisará con la entidad',
          motivo: 'El indicador no tiene cifra.',
          arreglo: 'Fijar la meta (p. ej. 95 % en plazo).',
        },
      ],
      falta: [] as string[],
    })),
  };
}
const enviar = (c: ReturnType<typeof critica>, agente = 'critico-licitaciones') =>
  recibirCritica(db, c, agente, { revisar: true });
const dosRechazos = (n: { memoria_id: number }) => {
  const ins = nucleo().db.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('critico-licitaciones', 'licitaciones_memoria_critica', 'licitaciones', ?, 'error', ?)",
  );
  for (let i = 0; i < 2; i += 1)
    ins.run(recursoCritica({ id: ID, memoria_id: n.memoria_id, ronda: 0 }), new Date().toISOString());
};

test('should_serve_blind_package_without_decisions_strategy_or_team', async () => {
  const n = await enCritica();
  const c = await conectar(T_CRITICO);
  let todo = '';
  try {
    for (const parte of ['rubrica', 'pliego', 'memoria']) {
      for (let desde: number | null = 0; desde !== null;) {
        const r = JSON.parse(
          texto(
            await c.callTool({
              name: 'licitaciones_memoria_critica_paquete',
              arguments: { id: ID, memoria_id: n.memoria_id, parte, desde },
            }),
          ),
        ) as { texto: string; siguiente: number | null };
        todo += `${r.texto}\n`;
        desde = r.siguiente;
      }
    }
    const equipo = await c.callTool({
      name: 'licitaciones_dossier',
      arguments: { id: ID, memoria_id: n.memoria_id, seccion: 'equipo' },
    });
    assert.equal(equipo.isError, true, 'el perfil del crítico no lee los CV');
  } finally {
    await c.close();
  }
  assert.match(todo, /1\. Organización y metodología del servicio \(8 puntos\)\n- Modelo organizativo propuesto/);
  assert.match(todo, /Escala: 0 = No aporta contenido operativo\. \| 4 = /);
  assert.match(todo, /## Pliego técnico\n\n\[PPT p\. 1\]/);
  assert.match(todo, /## 2\. Gestión de incidencias y control de calidad\n\nProcedimiento de gestión de incidencias/);
  for (const prohibido of [
    'Ana García',
    'Luis Martín',
    'Servicio cercano',
    'Una persona de referencia',
    'horario_atencion',
    'Registro de actividades en hoja compartida',
    'Frontera',
    'Lecciones',
  ]) {
    assert.ok(!todo.includes(prohibido), `el paquete no lleva «${prohibido}»`);
  }
});

test('should_reject_tier_not_in_scale', async () => {
  const n = await enCritica();
  dosRechazos(n);
  const r = enviar(
    critica(n, (c) => {
      c.apartados[0]!.tramo = 5;
      c.apartados[0]!.puntos = 5;
    }),
  );
  assert.match(
    r.error?.message ?? '',
    /El tramo 5 no está en la escala del apartado 1 \(0, 4, 6, 8\)\./,
    'siempre, también en el tercer envío',
  );
  assert.match(
    enviar(
      critica(n, (c) => {
        c.apartados.pop();
      }),
    ).error?.message ?? '',
    /Puntúa todos los apartados: faltan 4\./,
  );
  assert.match(
    enviar(
      critica(n, (c) => {
        c.apartados[1]!.puntos = 7;
        c.apartados[1]!.tramo = 5;
      }),
    ).error?.message ?? '',
    /En el apartado 2 los puntos \(7\) pasan de su tramo \(5\)\./,
  );
});

test('should_reject_tier_without_literal_quote_and_downgrade_on_third_attempt', async () => {
  const n = await enCritica();
  const inventada = critica(n, (c) => {
    c.apartados[0]!.cita = 'La empresa garantiza una disponibilidad del 99,9 % con guardias 24 horas';
  });
  assert.match(
    enviar(inventada).error?.message ?? '',
    /La cita del apartado 1 no está tal cual en su texto: copia literal la frase que justifica el tramo \(sin evidencia, la nota no sube\)\./,
  );
  dosRechazos(n);
  const r = enviar(inventada);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.avisos, [
    'Apartado 1: sin cita literal que lo sostenga, se guarda en el tramo 4 en vez de 6.',
  ]);
  const guardada = criticasDe(db, n.memoria_id)[0]!;
  assert.deepEqual(
    [guardada.datos.apartados[0]!.tramo, guardada.datos.apartados[0]!.puntos],
    [4, 4],
    'un tramo por debajo',
  );
  assert.deepEqual([guardada.total, guardada.maximo], [4 + 5 + 5 + 2, 25]);
  const ronda = db
    .prepare(
      'SELECT tramo, puntos, motivos FROM memoria_apartado_rondas WHERE memoria_id = ? AND apartado = 1 AND ronda = 0',
    )
    .get(n.memoria_id) as { tramo: number; puntos: number; motivos: string };
  assert.deepEqual(
    [
      ronda.tramo,
      ronda.puntos,
      (JSON.parse(ronda.motivos) as { motivos_para_bajar: unknown[] }).motivos_para_bajar.length,
    ],
    [4, 4, 1],
  );
});

test('should_reject_max_tier_with_reasons_to_lower', async () => {
  const n = await enCritica();
  const r = enviar(
    critica(n, (c) => {
      c.apartados[0]!.tramo = 8;
      c.apartados[0]!.puntos = 8;
    }),
  );
  assert.match(
    r.error?.message ?? '',
    /El apartado 1 está en el tramo máximo y trae motivos para bajar o cosas que faltan: o baja de tramo o no hay nada que bajar\./,
  );
  const limpia = enviar(
    critica(n, (c) => {
      c.apartados[0]!.tramo = 8;
      c.apartados[0]!.puntos = 8;
      c.apartados[0]!.motivos_para_bajar = [];
    }),
  );
  assert.equal(limpia.error, null, limpia.error?.message);
});

test('should_mark_not_blind_when_audit_shows_forbidden_tool', async () => {
  const n = await enCritica();
  const t = trabajosDe(TIPO_MEMORIA_CRITICA)[0]!;
  assert.equal(t.clave, `memoria-${ID}-v${n.version}-critica-r0`);
  const payload = PayloadCritica.parse(JSON.parse(t.payload));
  assert.equal(payload.independiente, false, 'sin perfil del crítico');
  assert.match(
    instruccionesCritica(db, payload),
    /SOLO puedes usar licitaciones_memoria_critica_paquete y licitaciones_memoria_critica/,
  );
  assert.match(instruccionesCritica(db, payload), /Empieza|empieza en el tramo más bajo de su escala/);
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'lanzado', lanzado_en = ? WHERE id = ?").run(hace(10), t.id);
  nucleo()
    .db.prepare(
      "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('critico-licitaciones', 'licitaciones_memoria_critica_paquete', 'licitaciones', ?, 'ok', ?)",
    )
    .run(`${ID}#m${n.memoria_id}#paquete`, hace(8));
  assert.equal(
    ciegaSegunAuditoria(db, 'critico-licitaciones', ID, hace(10)),
    true,
    'el paquete no le quita la ceguera',
  );
  nucleo()
    .db.prepare(
      "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('critico-licitaciones', 'licitaciones_oferta', 'licitaciones', ?, 'ok', ?)",
    )
    .run(ID, hace(5));
  nucleo()
    .db.prepare(
      "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('critico-licitaciones', 'licitaciones_oferta', 'licitaciones', 'p-99999999', 'ok', ?)",
    )
    .run(hace(5));
  assert.equal(criticaRecibida(db, payload), false);
  const r = enviar(critica(n));
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual([r.data!.ciega, r.data!.independiente], [false, false]);
  assert.equal(criticaRecibida(db, payload), true);
  assert.equal(
    ciegaSegunAuditoria(db, 'critico-licitaciones', 'p-11111111', hace(10)),
    true,
    'lo de otra licitación no cuenta',
  );
});

test('should_mark_independent_and_blind_when_the_critic_profile_does_it', async () => {
  const antes = nucleo().config.hermesCritico;
  nucleo().config.hermesCritico = { url: 'http://hermes:8642/p/critico-licitaciones', key: 'x'.repeat(20) };
  try {
    const n = await enCritica();
    assert.equal(PayloadCritica.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_CRITICA)[0]!.payload)).independiente, true);
    const r = enviar(critica(n));
    assert.deepEqual(
      [r.data!.ciega, r.data!.independiente, r.data!.total, r.data!.maximo],
      [true, true, 6 + 5 + 5 + 2, 25],
    );
    const otra = await enCritica();
    assert.equal(
      enviar(critica(otra), 'oferta-licitaciones').data!.independiente,
      false,
      'si la envía el mismo agente que escribió la estrategia, no es independiente',
    );
  } finally {
    nucleo().config.hermesCritico = antes;
  }
});

// Sin perfil propio, el crítico es el mismo agente que redactó: lo que hizo su run de redacción,
// aún vivo cuando se lanza la crítica, no es suyo. Su ventana empieza al leer el paquete.
async function criticaLanzadaSinPerfil() {
  const n = await enCritica();
  const t = trabajosDe(TIPO_MEMORIA_CRITICA)[0]!;
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'lanzado', lanzado_en = ? WHERE id = ?").run(hace(10), t.id);
  const auditar = (herramienta: string, recurso: string, min: number) =>
    nucleo()
      .db.prepare(
        "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('critico-licitaciones', ?, 'licitaciones', ?, 'ok', ?)",
      )
      .run(herramienta, recurso, hace(min));
  return {
    n,
    hace,
    paquete: (min: number) => auditar('licitaciones_memoria_critica_paquete', `${ID}#m${n.memoria_id}#paquete`, min),
    prohibida: (min: number) => auditar('licitaciones_oferta', ID, min),
  };
}

test('should_not_count_forbidden_call_made_before_reading_the_package_when_critic_has_no_profile', async () => {
  const { n, paquete, prohibida } = await criticaLanzadaSinPerfil();
  prohibida(8);
  paquete(5);
  const r = enviar(critica(n));
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    [r.data!.independiente, r.data!.ciega],
    [false, true],
    'lo consultado por el run de la redacción antes del paquete no es del crítico',
  );
});

test('should_mark_not_blind_when_forbidden_call_comes_after_reading_the_package', async () => {
  const { n, paquete, prohibida } = await criticaLanzadaSinPerfil();
  paquete(8);
  prohibida(5);
  const r = enviar(critica(n));
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    [r.data!.independiente, r.data!.ciega],
    [false, false],
    'después de leer el paquete, mirar el expediente le quita la ceguera',
  );
});

test('should_count_forbidden_call_since_the_launch_when_the_critic_never_read_the_package', async () => {
  const { n, prohibida } = await criticaLanzadaSinPerfil();
  prohibida(5);
  const r = enviar(critica(n));
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    [r.data!.independiente, r.data!.ciega],
    [false, false],
    'sin paquete leído, la ventana empieza al lanzarse',
  );
});

test('should_ignore_forbidden_call_made_before_the_critique_was_launched', async () => {
  const { n, hace, prohibida } = await criticaLanzadaSinPerfil();
  prohibida(30);
  nucleo()
    .db.prepare(
      "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('critico-licitaciones', 'licitaciones_memoria_critica_paquete', 'licitaciones', ?, 'ok', ?)",
    )
    .run(`${ID}#m${n.memoria_id}#paquete`, hace(9));
  const r = enviar(critica(n));
  assert.deepEqual([r.data!.independiente, r.data!.ciega], [false, true], 'lo anterior al lanzamiento nunca cuenta');
});

// ── Crítico sin huecos ──

test('should_reject_tier_below_max_without_reasons_even_on_third_attempt', async () => {
  const n = await enCritica();
  dosRechazos(n);
  const r = enviar(
    critica(n, (c) => {
      c.apartados[3]!.motivos_para_bajar = [];
    }),
  );
  assert.match(
    r.error?.message ?? '',
    /El apartado 4 está por debajo del tramo máximo \(2 de 4\) y no trae ningún motivo para bajar/,
  );
  const conFalta = enviar(
    critica(n, (c) => {
      c.apartados[3]!.motivos_para_bajar = [];
      c.apartados[3]!.falta = ['Plan de formación'];
    }),
  );
  assert.match(
    conFalta.error?.message ?? '',
    /El apartado 4 está por debajo del tramo máximo/,
    'lo que falta no basta: el reescritor necesita un motivo con su arreglo',
  );
});

test('should_reject_summary_that_says_max_when_some_tier_is_not', async () => {
  const n = await enCritica();
  const r = enviar(
    critica(n, (c) => {
      c.resumen = 'Memoria sólida: alcanza la puntuación máxima en organización y calidad.';
    }),
  );
  assert.match(
    r.error?.message ?? '',
    /El resumen habla de «máximo» y los apartados 1, 2, 3, 4 están por debajo del tramo máximo/,
  );
  assert.equal(
    resumenDiceMaximo('Ningún apartado llega al máximo: faltan cifras propias.'),
    false,
    'negado no lo afirma',
  );
  assert.equal(resumenDiceMaximo('Queda lejos del máximo.'), false);
  assert.equal(resumenDiceMaximo('Nota máxima en el apartado 1.'), true);
});

test('should_accept_a_summary_that_names_exactly_which_apartados_reach_the_maximum', async () => {
  assert.equal(
    resumenDiceMaximo('El apartado 1 alcanza el máximo; el 3 queda en Bueno por falta de fechas.', [3]),
    false,
    'nombra bien el que está en el máximo',
  );
  assert.equal(
    resumenDiceMaximo('Respeta el límite máximo de 25 páginas.', [2]),
    false,
    'el límite de páginas no es una nota',
  );
  assert.equal(resumenDiceMaximo('Los apartados 1 y 3 alcanzan el máximo.', [3]), true, 'el 3 no lo alcanza');
  assert.equal(resumenDiceMaximo('Memoria de nota máxima.', [3]), true, 'de toda la memoria');
  const n = await enCritica();
  const r = enviar(
    critica(n, (c) => {
      c.apartados[0]!.tramo = APARTADOS[0]!.escala.at(-1)!;
      c.apartados[0]!.puntos = c.apartados[0]!.tramo;
      c.apartados[0]!.motivos_para_bajar = [];
      c.resumen =
        'El apartado 1 alcanza el máximo; el resto queda en Bueno por falta de cifras y respeta el límite máximo de páginas.';
    }),
  );
  assert.equal(r.error, null, r.error?.message);
});

test('should_not_take_validation_or_approval_in_a_technical_reason_as_a_postponement', async () => {
  assert.equal(
    MOTIVO_APLAZA.test(textoComparable('No describe el proceso de validación de las respuestas del modelo.')),
    false,
  );
  assert.equal(
    MOTIVO_APLAZA.test(textoComparable('Falta el circuito de aprobación de los cambios en producción.')),
    false,
  );
  assert.equal(MOTIVO_APLAZA.test(textoComparable('Deja la meta pendiente de aprobación posterior.')), true);
  assert.equal(MOTIVO_APLAZA.test(textoComparable('Calendario relativo, sin fechas.')), true);
  const n = await enCritica();
  const r = enviar(
    critica(n, (c) => {
      c.apartados[1]!.motivos_para_bajar = [
        {
          cita: 'un indicador con meta mensual que revisará con la entidad',
          motivo: 'No describe el proceso de validación de las respuestas.',
          arreglo: 'Añadir revisión por pares y muestreo aleatorio de salidas.',
        },
      ];
    }),
  );
  assert.equal(r.error, null, r.error?.message);
});

test('should_ask_postponement_reason_to_bring_the_value_a_top_competitor_would_propose', async () => {
  const n = await enCritica();
  const aplazado = (arreglo: string) =>
    critica(n, (c) => {
      c.apartados[1]!.motivos_para_bajar = [
        {
          cita: 'un indicador con meta mensual que revisará con la entidad',
          motivo: 'Deja la meta pendiente de aprobación posterior.',
          arreglo,
        },
      ];
    });
  assert.match(
    enviar(aplazado('Concretar la meta con la entidad.')).error?.message ?? '',
    /El motivo 1 del apartado 2 señala un valor aplazado: su arreglo da el valor concreto que propondría el mejor competidor/,
  );
  const r = enviar(
    aplazado('La empresa propone un 95 % de consultas en plazo; la entidad lo ratifica en el acta del primer mes.'),
  );
  assert.equal(r.error, null, r.error?.message);
  assert.ok(
    DEFECTOS_QUE_BAJAN.some((d) => /calendario relativo/.test(d)) &&
      DEFECTOS_QUE_BAJAN.some((d) => /figuras sin contenido legible/.test(d)),
  );
});

// ── El crítico ve el documento ensamblado ──

test('should_serve_assembled_document_with_deterministic_checks_first', async () => {
  const n = await enCritica();
  const c = await conectar(T_CRITICO);
  let todo = '';
  try {
    for (let desde: number | null = 0; desde !== null;) {
      const r = JSON.parse(
        texto(
          await c.callTool({
            name: 'licitaciones_memoria_critica_paquete',
            arguments: { id: ID, memoria_id: n.memoria_id, parte: 'documento', desde },
          }),
        ),
      ) as { texto: string; siguiente: number | null };
      todo += r.texto;
      desde = r.siguiente;
    }
  } finally {
    await c.close();
  }
  assert.match(todo, /^COMPROBACIONES AUTOMÁTICAS DEL DOCUMENTO/, 'los chequeos, delante');
  assert.match(todo, /\*\*Expediente:\*\*/, 'con portada');
  assert.match(todo, /## Índice/);
  assert.match(todo, /## 2\. Gestión de incidencias y control de calidad/);
  for (const prohibido of ['horario_atencion', 'Frontera', 'Lecciones'])
    assert.ok(!todo.includes(prohibido), `el documento no lleva «${prohibido}»`);
  const t = trabajosDe(TIPO_MEMORIA_CRITICA)[0]!;
  assert.match(
    instruccionesCritica(db, PayloadCritica.parse(JSON.parse(t.payload))),
    /parte «documento» \(la memoria como la verá la mesa/,
  );
});

// ── Tras la medición: con trozos de 40.000 el crítico puntuó el principio de cada parte ──

// Un texto de `n` caracteres con un salto de línea y unas comillas cada pocos: lo que más crece al escaparlo.
const textoQueEscapa = (n: number) => 'Cláusula "7.2"\n«plazo»\t'.repeat(Math.ceil(n / 22)).slice(0, n);

test('should_serve_a_full_chunk_part_whole_in_one_read_without_truncation', async () => {
  const n = await enCritica();
  const f = db.prepare('SELECT secciones FROM memoria_dossiers WHERE memoria_id = ?').get(n.memoria_id) as {
    secciones: string;
  };
  const s = JSON.parse(f.secciones) as { secciones: { critico?: boolean; titulo: string; texto: string }[] };
  const cabecera = '## Pliego técnico\n\n';
  const largo = textoQueEscapa(TROZO_PAQUETE - cabecera.length);
  s.secciones = s.secciones
    .map((x) => ({ ...x, critico: x.titulo === 'Pliego técnico' }))
    .map((x) => (x.critico ? { ...x, texto: largo } : x));
  db.prepare('UPDATE memoria_dossiers SET secciones = ? WHERE memoria_id = ?').run(JSON.stringify(s), n.memoria_id);
  const c = await conectar(T_CRITICO);
  try {
    const crudo = texto(
      await c.callTool({
        name: 'licitaciones_memoria_critica_paquete',
        arguments: { id: ID, memoria_id: n.memoria_id, parte: 'pliego' },
      }),
    );
    assert.ok(!crudo.includes('respuesta recortada'), `recortada a ${crudo.length} caracteres`);
    assert.ok(
      crudo.length <= RESPUESTA_PAQUETE,
      `${crudo.length} caracteres: más que el tope que llega entero a Hermes`,
    );
    const r = JSON.parse(crudo) as { texto: string; total: number; siguiente: number | null };
    assert.ok(
      crudo.endsWith(`"cierre":"${cierreDeTrozo(0, TROZO_PAQUETE)}"}`),
      'el cierre va detrás del texto: si Hermes recorta, falta',
    );
    assert.equal(r.total, TROZO_PAQUETE);
    assert.equal(r.siguiente, null, 'entera en una lectura');
    assert.equal(r.texto, `${cabecera}${largo}`);
  } finally {
    await c.close();
  }
});

test('should_shorten_a_chunk_whose_json_escapes_would_not_fit_and_keep_reading_from_siguiente', () => {
  const controles = String.fromCharCode(1).repeat(TROZO_PAQUETE * 2);
  let leido = '';
  for (let desde: number | null = 0; desde !== null;) {
    const t = trozoDelPaquete(controles, desde);
    assert.ok(JSON.stringify(t).length <= RESPUESTA_PAQUETE, `${JSON.stringify(t).length} caracteres`);
    assert.ok(t.hasta > t.desde, 'siempre avanza');
    leido += t.texto;
    desde = t.siguiente;
  }
  assert.equal(leido, controles, 'nada se pierde entre trozos');
  assert.deepEqual(trozoDelPaquete('abc', 10), {
    total: 3,
    desde: 3,
    hasta: 3,
    siguiente: null,
    texto: '',
    cierre: 'fin del trozo 3-3',
  });
});

test('should_tell_the_critic_to_keep_reading_until_siguiente_is_null', async () => {
  await enCritica();
  const inst = instruccionesCritica(db, PayloadCritica.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_CRITICA)[0]!.payload)));
  assert.match(
    inst,
    /si la respuesta trae «siguiente» ≠ null, sigue leyendo; no envíes la crítica sin haber llegado a «siguiente» = null en rubrica, pliego y documento/,
  );
  assert.ok(inst.includes(LEER_HASTA_EL_CIERRE), 'si no ve el cierre, la respuesta llegó recortada');
  assert.match(LEER_HASTA_EL_CIERRE, /no envíes nada y termina diciendo «paquete recortado/);
});
