// Memoria técnica, paso 2: la estrategia que piensa Hermes antes de redactar. El código la rechaza
// con frases exactas si un título no es literal, un «se valorará» queda sin sección o las
// extensiones no caben (hasta el tercer envío); un hecho que delata un criterio automático o que
// nombra a alguien cuando el equipo va por roles, siempre. Guardada, la memoria pasa a redactarse.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { APARTADOS, GUION_CASO_A } from './fixtures/casoA.js';

const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { CARACTERES_POR_PAGINA, cuotaDeApartado, cuotaIgual, MAX_FILAS_GUIA, paginasDeGuia, reservaDeGuia } =
  await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
const {
  EstrategiaDatos,
  EstrategiaEntrada,
  estrategiaDe,
  estrategiaRecibida,
  instruccionesEstrategia,
  PayloadEstrategia,
  problemasDeEstrategia,
  recibirEstrategia,
  recursoEstrategia,
  TIPO_MEMORIA_ESTRATEGIA,
} = await import('../../src/dominios/licitaciones/oferta/estrategia.js');

before(arrancar);
after(cerrar);

// Una memoria nueva, ya con dossier y esperando la estrategia.
async function enEstrategia(): Promise<{ memoria_id: number; version: number }> {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(memoriaPorId(p.memoria).fase, 'estrategia');
  return { memoria_id: p.memoria, version: p.version };
}
const enviar = (e: unknown) =>
  recibirEstrategia(db, nucleo().db, EstrategiaEntrada.parse(e), 'oferta-licitaciones', { revisar: true });
// Dos rechazos recientes en la auditoría: el tercer envío entra con avisos.
const dosRechazos = (n: { version: number }) => {
  const ins = nucleo().db.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('oferta-licitaciones', 'licitaciones_memoria_estrategia', 'licitaciones', ?, 'error', ?)",
  );
  for (let i = 0; i < 2; i += 1) ins.run(recursoEstrategia({ id: ID, version: n.version }), new Date().toISOString());
};

test('should_reject_strategy_when_structure_title_is_not_literal', async () => {
  const n = await enEstrategia();
  const e = estrategiaCasoA(n);
  e.estructura[1]!.titulo = 'Incidencias y calidad';
  const r = enviar(e);
  assert.match(
    r.error?.message ?? '',
    /El apartado 2 de «estructura» debe llevar el título literal del guion: «Gestión de incidencias y control de calidad» \(llegó 2\. «Incidencias y calidad»\)\./,
  );
  const numerado = estrategiaCasoA(n);
  numerado.estructura[0]!.titulo = '1. Organización y metodología del servicio';
  assert.equal(enviar(numerado).error, null, 'la numeración delante no cuenta');
});

test('should_reject_strategy_when_a_se_valorara_item_is_unmapped', async () => {
  const n = await enEstrategia();
  const e = estrategiaCasoA(n);
  e.mapa = e.mapa.filter((m) => m.item !== 'Coordinación con la Asesoría Jurídica');
  e.mapa[0]!.seccion = 'Sección que no existe';
  const r = enviar(e);
  assert.match(
    r.error?.message ?? '',
    /Falta en «mapa» el «se valorará» «Coordinación con la Asesoría Jurídica» del apartado 1: di en qué sección se trata y con qué evidencia\./,
  );
  assert.match(
    r.error?.message ?? '',
    /El «mapa» lleva «Modelo organizativo propuesto» a la sección «Sección que no existe», que no está en la estructura del apartado 1\./,
  );
});

test('should_reject_strategy_when_target_lengths_exceed_page_limit', async () => {
  const n = await enEstrategia();
  const largo = estrategiaCasoA(n);
  largo.estructura = largo.estructura.map((x, i) => ({
    ...x,
    caracteres_objetivo: cuotaDeApartado(25, APARTADOS[i]!.puntos, 25, paginasDeGuia(GUION_CASO_A.memoria))!.caracteres,
  }));
  const r = enviar(largo).error?.message ?? '';
  assert.match(
    r,
    /^Las extensiones suman 67\.500 caracteres y en 25 páginas caben unos 58\.800 \(sin portada, índice ni tabla guía\): recórtalas\./,
    'cada una cabe en su cuota, pero no todas juntas',
  );
  const corto = estrategiaCasoA(n);
  corto.estructura[0]!.caracteres_objetivo = 5_000;
  assert.match(
    enviar(corto).error?.message ?? '',
    /La extensión objetivo del apartado 1 \(5\.000\) debe ir de 15\.100 a 21\.600 caracteres\./,
  );
});

test('should_always_reject_fact_that_leaks_automatic_criterion', async () => {
  const n = await enEstrategia();
  const e = estrategiaCasoA(n);
  e.hechos.push({
    clave: 'bolsa',
    categoria: 'cifra',
    sobre: 'mejoras',
    valor: 'Bolsa de horas de 20 horas al año',
    palabras: ['bolsa'],
  });
  const mensaje =
    /El hecho «bolsa» delata «bolsa de horas» \(«Mejora 1: bolsa de horas adicionales», que va en «Archivo electrónico nº 2»\): un hecho se copia en todos los apartados; quítalo\./;
  assert.match(enviar(e).error?.message ?? '', mensaje);
  dosRechazos(n);
  assert.match(enviar(e).error?.message ?? '', mensaje, 'también en el tercer envío');
  const blando = estrategiaCasoA(n);
  blando.estructura[1]!.titulo = 'Incidencias y calidad';
  const r = enviar(blando);
  assert.equal(r.error, null, 'lo blando, al tercer envío, entra como aviso');
  assert.match(r.data!.avisos.join(' '), /título literal del guion/);
});

test('should_reject_named_roles_when_team_must_be_anonymous', async () => {
  const n = await enEstrategia();
  const e = estrategiaCasoA(n);
  e.hechos[2] = {
    clave: 'responsable',
    categoria: 'rol',
    sobre: 'responsable del servicio',
    valor: 'Ana García Pérez, responsable del servicio',
    palabras: ['responsable'],
  };
  const fila = db.prepare('SELECT secciones FROM memoria_dossiers WHERE memoria_id = ?').get(n.memoria_id) as {
    secciones: string;
  };
  db.prepare('UPDATE memoria_dossiers SET secciones = ? WHERE memoria_id = ?').run(
    JSON.stringify({ ...JSON.parse(fila.secciones), equipo_por_roles: true }),
    n.memoria_id,
  );
  dosRechazos(n);
  assert.match(
    enviar(e).error?.message ?? '',
    /El hecho «responsable» nombra a una persona del equipo y el pliego pide el equipo por roles, sin nombres: escribe solo el rol\./,
  );
  db.prepare('UPDATE memoria_dossiers SET secciones = ? WHERE memoria_id = ?').run(fila.secciones, n.memoria_id);
  assert.equal(enviar(e).error, null, 'sin la regla de roles, el nombre va como en la memoria');
});

test('should_warn_about_tools_that_are_not_in_the_decisions', async () => {
  const n = await enEstrategia();
  const e = estrategiaCasoA(n);
  e.hechos.push({
    clave: 'crm',
    categoria: 'herramienta',
    sobre: 'seguimiento',
    valor: 'Salesforce',
    palabras: ['Salesforce'],
  });
  const r = enviar(e);
  assert.equal(r.error, null);
  assert.deepEqual(r.data!.avisos, [
    'La herramienta «Salesforce» (hecho «crm») no está en las decisiones de la oferta.',
  ]);
});

test('should_advance_to_the_solution_sheet_when_strategy_is_saved', async () => {
  const n = await enEstrategia();
  const trabajos = trabajosDe(TIPO_MEMORIA_ESTRATEGIA);
  assert.deepEqual(
    trabajos.map((t) => t.clave),
    [`memoria-${ID}-v${n.version}-estrategia`],
    'la máquina de estados pide la estrategia',
  );
  const payload = PayloadEstrategia.parse(JSON.parse(trabajos[0]!.payload));
  const inst = instruccionesEstrategia(db, payload);
  assert.match(
    inst,
    /^Tarea de la plataforma de Analítica Ejemplo: piensa la estrategia de la memoria técnica \(versión \d+\) de la oferta a la licitación p-91000710/,
  );
  assert.match(inst, new RegExp(`licitaciones_dossier \\(id=${ID}, memoria_id=${n.memoria_id}\\)`));
  assert.match(
    inst,
    /- Apartado 1 «Organización y metodología del servicio»: entre 15\.100 y 21\.600 caracteres \(por sus 8 puntos de 25\)\./,
  );
  assert.match(inst, /La suma no puede pasar de 58\.800 caracteres/);
  assert.match(
    inst,
    /\n3a\. DECISIONES DE DISEÑO\. Somos el implantador y decidimos\./,
    'entre la rúbrica y la extensión',
  );
  assert.match(inst, /\n6c\. Catálogo normativo \(«catalogo_normativo» de la solución\)/);
  assert.match(
    inst,
    /\n6d\. Medición: cada umbral e indicador dice en qué entorno \(desarrollo, preproducción o producción\) y con qué datos/,
    'E7: dónde y con qué datos se mide cada KPI',
  );
  assert.match(inst, /\n6e\. Compromisos \(«compromisos» de la solución\)/, 'lo que la memoria promete y cuesta');
  assert.match(
    inst,
    /por defecto, la formulación más barata que puntúe \(a petición en vez de fija, mensual en vez de semanal, asíncrono en vez de presencial, materiales digitales o del propio alumnado en vez de kits/,
  );
  assert.match(
    inst,
    /Lo decidido se escribe como hecho, en presente o futuro de compromiso: «La solución usa X en la región Y»/,
  );
  assert.doesNotMatch(
    inst,
    /Escríbelo así: «proponemos X; el órgano lo ratifica/,
    'la fórmula de ratificación ya no se pide',
  );
  assert.ok(
    inst.indexOf('3a. DECISIONES') > inst.indexOf('\n3. ') && inst.indexOf('3a. DECISIONES') < inst.indexOf('\n4. '),
  );
  assert.match(
    inst,
    /\n6a\. Una persona puede revisar la solución en la ficha antes de redactar; si no lo hace a tiempo, se redacta con lo propuesto y queda marcado\. No escribas en las reglas, la frontera ni los pendientes que la redacción queda bloqueada o espera una revisión humana\./,
  );
  assert.match(
    inst,
    /Lo que el dossier no acredita \(experiencia, certificaciones\) va a la frontera como «no afirmar», con «sin acreditar» en el motivo \(la plataforma se lo avisa a la persona\), y no entra en la hoja de hechos; nunca como bloqueo de la redacción\. Un criterio al que nos acogemos y que se acredita EN ESTA MEMORIA no va a la frontera: se declara\./,
  );
  assert.ok(!inst.includes('Una persona la revisa antes de redactar'), 'la redacción lo leía como un bloqueo');
  assert.equal(estrategiaRecibida(db, payload), false);
  const c = await conectar(T_OFERTA);
  try {
    const r = await c.callTool({ name: 'licitaciones_memoria_estrategia', arguments: estrategiaCasoA(n) });
    assert.equal(r.isError, undefined, texto(r));
    assert.deepEqual(JSON.parse(texto(r)), {
      memoria: n.memoria_id,
      version: n.version,
      hechos: 4,
      avisos: [],
      ruta_md: `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v${n.version}-estrategia.md`,
    });
  } finally {
    await c.close();
  }
  assert.equal(estrategiaRecibida(db, payload), true);
  assert.equal(estrategiaDe(db, n.memoria_id)?.agente, 'oferta-licitaciones');
  const md = fs.readFileSync(
    path.join(salidas, 'Licitaciones', `EXP-2026-0412 (${ID})`, `memoria-v${n.version}-estrategia.md`),
    'utf8',
  );
  assert.match(
    md,
    /## Hoja de hechos\n\| Clave \| Categoría \| Sobre \| Valor \|\n\| --- \| --- \| --- \| --- \|\n\| horario_atencion \| horario \| atención de consultas \| L-V 9:00-17:00 \(hora de Canarias\) \|/,
  );
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(memoriaPorId(n.memoria_id).fase, 'ficha', 'antes de redactar, una persona revisa la ficha de solución');
  assert.match(enviar(estrategiaCasoA(n)).error?.message ?? '', /no espera estrategia/, 'pasada la fase, no se cambia');
});

const conValorara = (n: number) => ({
  apartados: [{ se_valorara: Array.from({ length: n }, (_, i) => `punto ${i}`) }],
});

test('should_reserve_guide_pages_by_se_valorara_count_up_to_the_row_cap', () => {
  assert.deepEqual(
    [0, 1, 8, 9, 16, 17].map((n) => paginasDeGuia(conValorara(n))),
    [0, 1, 1, 2, 2, 3],
    'una página por cada 8 filas (con la columna de evidencia), redondeando hacia arriba',
  );
  assert.equal(paginasDeGuia({ apartados: [] }), 0);
  assert.equal(
    paginasDeGuia({ apartados: [{ se_valorara: ['a', 'b'] }, { se_valorara: ['c'] }] }),
    1,
    'cuentan los de todos los apartados',
  );
  const tope = Math.ceil(MAX_FILAS_GUIA / 8);
  assert.deepEqual(
    [
      paginasDeGuia(conValorara(MAX_FILAS_GUIA)),
      paginasDeGuia(conValorara(MAX_FILAS_GUIA + 1)),
      paginasDeGuia(conValorara(5_000)),
    ],
    [tope, tope, tope],
    'la tabla se corta en MAX_FILAS_GUIA filas',
  );
});

test('should_reserve_guide_pages_for_the_guide_table', () => {
  const mem = conValorara(13);
  assert.equal(reservaDeGuia(mem), 2);
  assert.equal(reservaDeGuia(null), 0, 'sin memoria en el guion no hay nada que reservar');
  const sin = cuotaDeApartado(25, 8, 25)!;
  const con = cuotaDeApartado(25, 8, 25, 2)!;
  assert.equal(sin.caracteres, 23_700, 'sin reserva, como antes');
  assert.equal(con.caracteres, 21_600, '(25 - 2 de portada e índice - 2 de guía) páginas por su parte y la holgura');
  assert.deepEqual(cuotaDeApartado(25, 8, 25, 0), sin, 'reservar 0 no cambia nada');
  assert.equal(
    cuotaIgual(25, 4, 2)!.caracteres < cuotaIgual(25, 4)!.caracteres,
    true,
    'el reparto a partes iguales también las descuenta',
  );
  assert.equal(
    cuotaDeApartado(3, 8, 25, 10)!.caracteres > 0,
    true,
    'con más reserva que páginas, queda al menos una página de reparto',
  );
});

test('should_fit_strategy_extensions_plus_guide_pages_in_the_page_limit', async () => {
  const n = await enEstrategia();
  const e = estrategiaCasoA(n);
  const guia = paginasDeGuia(GUION_CASO_A.memoria);
  const suma = e.estructura.reduce((s, x) => s + x.caracteres_objetivo, 0);
  assert.equal(guia, 2, '14 «se valorará» a 8 por página');
  assert.equal(
    2 + guia + suma / CARACTERES_POR_PAGINA <= 25,
    true,
    `portada e índice (2) + guía (${guia}) + ${suma} caracteres caben en 25 páginas`,
  );
  assert.equal(enviar(e).error, null, 'y la plataforma lo acepta');
  const con = (extensiones: number[]) => {
    const x = estrategiaCasoA(n);
    extensiones.forEach((c, k) => {
      x.estructura[k]!.caracteres_objetivo = c;
    });
    return x;
  };
  assert.equal(
    enviar(con([19_600, 17_000, 14_500, 7_700])).error,
    null,
    'justo en 58.800 caracteres, lo que queda tras portada, índice y guía, cabe',
  );
  assert.match(
    enviar(con([20_000, 17_000, 14_500, 7_700])).error?.message ?? '',
    /Las extensiones suman 59\.200 caracteres y en 25 páginas caben unos 58\.800 \(sin portada, índice ni tabla guía\)/,
    'pasarse de lo que queda tras la guía se rechaza',
  );
});

test('should_flag_numbered_section_titles_as_soft_problem', async () => {
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  const e = EstrategiaDatos.parse(datos);
  e.estructura[1]!.secciones[0]!.titulo = `2.1 ${e.estructura[1]!.secciones[0]!.titulo}`;
  e.mapa = e.mapa.map((m) =>
    m.apartado === 2 && m.seccion === datos.estructura[1]!.secciones[0]!.titulo
      ? { ...m, seccion: e.estructura[1]!.secciones[0]!.titulo }
      : m,
  );
  const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
  const ctx = {
    mem: GuionBase.parse(GUION_CASO_A).memoria!,
    fugas: { automaticos: [] },
    porRoles: false,
    equipo: [],
    herramientas: [],
  };
  const p = problemasDeEstrategia(e, ctx);
  assert.deepEqual(
    p.blandos.filter((b) => /lleva numeración/.test(b)),
    [
      `La sección «${e.estructura[1]!.secciones[0]!.titulo}» del apartado 2 lleva numeración: escribe solo el título; el número lo pone el documento.`,
    ],
  );
  e.estructura[1]!.secciones[0]!.titulo = '2026 en cifras';
  assert.equal(
    problemasDeEstrategia(e, ctx).blandos.some((b) => /lleva numeración/.test(b)),
    false,
    'un año no es numeración',
  );
  e.estructura[1]!.secciones[0]!.titulo = '1.500 usuarios formados en el primer año';
  assert.equal(
    problemasDeEstrategia(e, ctx).blandos.some((b) => /lleva numeración/.test(b)),
    false,
    'una cifra con separador de miles no es numeración',
  );
  for (const titulo of ['1. Diagnóstico', 'II.1 Metodología']) {
    e.estructura[1]!.secciones[0]!.titulo = titulo;
    assert.equal(
      problemasDeEstrategia(e, ctx).blandos.some((b) => b.includes(`«${titulo}»`) && /lleva numeración/.test(b)),
      true,
      titulo,
    );
  }
});

// Sin límite de páginas (A4): la estrategia tiene un techo por «se valorará» y la redacción, la
// extensión objetivo de la estrategia más un 15 %.
const sinLimite = async () => {
  const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
  const g = GuionBase.parse(GUION_CASO_A);
  return { ...g, memoria: { ...g.memoria!, limite_paginas: null } };
};

test('should_reject_strategy_over_ceiling_when_pliego_has_no_page_limit', async () => {
  const datos = await sinLimite();
  const { id: _id, memoria_id: _m, version: _v, ...e0 } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  const e = EstrategiaDatos.parse(e0);
  const ctx = { mem: datos.memoria, fugas: { automaticos: [] }, porRoles: false, equipo: [], herramientas: [] };
  const techo1 = 3_300 * datos.memoria.apartados[0]!.se_valorara.length;
  e.estructura = e.estructura.map((x) => ({
    ...x,
    caracteres_objetivo: 3_000 * datos.memoria.apartados[x.apartado - 1]!.se_valorara.length,
  }));
  assert.deepEqual(
    problemasDeEstrategia(e, ctx).blandos.filter((b) => /techo/.test(b)),
    [],
    'por debajo del techo, nada',
  );
  e.estructura[0]!.caracteres_objetivo = techo1 + 1_000;
  const techo = problemasDeEstrategia(e, ctx).blandos.filter((b) => /techo/.test(b));
  assert.equal(techo.length, 1, techo.join('\n'));
  assert.match(
    techo[0]!,
    /^La extensión objetivo del apartado 1 \([\d.]+\) pasa del techo de [\d.]+ caracteres \(3\.300 por cada «se valorará»/,
  );
  e.estructura = e.estructura.map((x) => ({
    ...x,
    caracteres_objetivo: 3_300 * datos.memoria.apartados[x.apartado - 1]!.se_valorara.length + 500,
  }));
  assert.ok(
    problemasDeEstrategia(e, ctx).blandos.some((b) =>
      /^Las extensiones suman [\d.]+ caracteres y el techo de la memoria es/.test(b),
    ),
    'la suma por encima del techo también',
  );
});

test('should_reject_section_over_strategy_target_when_pliego_has_no_page_limit', async () => {
  const datos = await sinLimite();
  const { contextoDeApartado } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
  const { revisarApartado } = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
  const { apartadoCasoA } = await import('./fixtures/casoA.js');
  const guion = { id: 1, licitacion_id: ID, version: 1, datos } as unknown as Parameters<typeof contextoDeApartado>[0];
  assert.equal(contextoDeApartado(guion, 1)!.cuota, null, 'sin estrategia, sin cuota');
  const c = contextoDeApartado(guion, 1, {}, null, 0, 2_000)!;
  assert.deepEqual(
    [c.cuota!.caracteres, c.cuota!.minimo, c.cuota!.sinLimite],
    [2_300, null, true],
    'objetivo × 1,15, sin suelo',
  );
  const a = apartadoCasoA(1, { memoria_id: 1, guion_id: 1, version: 1 });
  const r = revisarApartado(a, c, true);
  assert.ok(
    [...r.duros, ...r.blandos].some((p) =>
      /^El apartado tiene [\d.]+ caracteres y le corresponden unos 2\.300 \(la extensión objetivo de la estrategia más un 15 %; el pliego no limita las páginas\): recorta/.test(
        p,
      ),
    ),
    [...r.duros, ...r.blandos].join('\n'),
  );
  const holgado = contextoDeApartado(guion, 1, {}, null, 0, 100_000)!;
  assert.ok(
    ![...revisarApartado(a, holgado, true).blandos].some((p) => /le corresponden/.test(p)),
    'por debajo del objetivo no se pide alargar: es un techo',
  );
});

test('should_keep_guide_rows_short_enough_for_the_reserved_pages', async () => {
  const { evidenciaDeGuia } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
  const larga =
    'Procedimiento con responsable, calendario semanal, indicador con meta mensual y acta de seguimiento firmada por las dos partes. '.repeat(
      3,
    );
  const celda = evidenciaDeGuia([larga, larga]);
  assert.ok(celda.length <= 160, `${celda.length} caracteres`);
  assert.ok(celda.endsWith('…') && celda.startsWith('Procedimiento con responsable'));
  assert.equal(
    evidenciaDeGuia(['Acta firmada.', 'Plan semanal.']),
    'Acta firmada; Plan semanal.',
    'lo corto, entero, una pista tras otra',
  );
  assert.equal(paginasDeGuia(conValorara(20)), 3, '20 filas con su evidencia no caben en 2 páginas');
});

// C-1: el bloque «solucion» decide los parámetros de diseño; solo queda abierto lo que el pliego
// reserva al órgano, con su cita y la propuesta de la empresa por defecto.
async function solucionPura() {
  const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  const ctx = {
    mem: GuionBase.parse(GUION_CASO_A).memoria!,
    fugas: { automaticos: [] },
    porRoles: false,
    equipo: [],
    herramientas: [],
  };
  return { e: EstrategiaDatos.parse(datos), ctx };
}

test('should_reject_legitimate_pending_without_citation', async () => {
  const { e, ctx } = await solucionPura();
  e.solucion.pendientes_legitimos = [
    { parametro: 'Tamaño de la muestra de aceptación', cita: '', por_defecto: '100 expedientes' },
  ];
  assert.ok(
    problemasDeEstrategia(e, ctx).blandos.includes(
      'El pendiente «Tamaño de la muestra de aceptación» no trae la cita del pliego que lo reserva al órgano: cítala literal o fija tú el valor (100 expedientes).',
    ),
  );
  e.solucion.pendientes_legitimos[0]!.cita = 'La muestra de aceptación la fijará el órgano de contratación';
  const fuentes = 'Cláusula 9. La muestra de aceptación la fijará el órgano de contratación al inicio.';
  assert.deepEqual(
    problemasDeEstrategia(e, { ...ctx, fuentes }).blandos.filter((b) => /pendiente/.test(b)),
    [],
    'con la cita literal del dossier, se admite',
  );
  assert.match(
    problemasDeEstrategia(e, { ...ctx, fuentes: 'Otro pliego sin esa frase.' }).blandos.join(' '),
    /La cita del pendiente «Tamaño de la muestra de aceptación» \(«La muestra de aceptación la fijará el órgano de contratación»\) no está en el dossier/,
  );
});

test('should_flag_repeated_cases_and_impossible_calendar_dates', async () => {
  const { e, ctx } = await solucionPura();
  e.solucion.casos[1]!.caso = e.solucion.casos[0]!.caso;
  e.solucion.calendario.semanas[0]!.hasta = '2026-02-30';
  const blandos = problemasDeEstrategia(e, ctx).blandos;
  assert.ok(
    blandos.some((b) => b.startsWith('Cada apartado lleva su propio caso en «casos»')),
    blandos.join('\n'),
  );
  assert.ok(blandos.includes('Estas fechas del calendario no existen: 2026-02-30.'), blandos.join('\n'));
});

test('should_always_reject_solution_that_leaks_automatic_criterion', async () => {
  const n = await enEstrategia();
  const e = estrategiaCasoA(n);
  e.solucion.formacion!.plan = 'Bolsa de horas de 20 horas al año para formación a demanda.';
  dosRechazos(n);
  assert.match(
    enviar(e).error?.message ?? '',
    /La solución delata «bolsa de horas» \(«Mejora 1: bolsa de horas adicionales», que va en «Archivo electrónico nº 2»\)/,
  );
});

test('should_write_the_solution_in_the_strategy_markdown', async () => {
  const n = await enEstrategia();
  const r = enviar(estrategiaCasoA(n));
  assert.equal(r.error, null, r.error?.message);
  const md = fs.readFileSync(path.join(salidas, r.data!.ruta_md!.replace(/^Salidas\//, '')), 'utf8');
  assert.match(
    md,
    /## Solución \(decidida: la memoria la compromete\)\n### Calendario \(inicio \d{4}-\d{2}-\d{2}: Fecha límite \+ 5 semanas/,
  );
  assert.match(md, /\| Responsable del servicio \| RS \| 50 % \|/);
  assert.match(md, /- Ninguno: todo lo demás está decidido\./);
});

test('should_tell_strategy_an_ensayo_has_no_review_and_nothing_blocks_redaction', async () => {
  const n = await enEstrategia();
  db.prepare('UPDATE memorias SET ensayo = 1 WHERE id = ?').run(n.memoria_id);
  const inst = instruccionesEstrategia(
    db,
    PayloadEstrategia.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_ESTRATEGIA)[0]!.payload)),
  );
  assert.match(
    inst,
    /\n6a\. Es una memoria de ENSAYO: nadie revisa la solución; se redacta con lo que propongas\. No escribas en las reglas/,
  );
});
