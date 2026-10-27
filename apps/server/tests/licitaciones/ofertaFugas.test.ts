// Fugas entre sobres: la memoria (juicio de valor) no puede decir nada del archivo de los
// criterios automáticos ni de la oferta económica (exclusión). Dos casos de prueba: un apartado
// de Villaejemplo que repite con otras palabras la declaración de grabación de tutorías del sobre C, y el
// nivel declarado de un criterio automático («respuesta en 2 horas») es una cifra que una
// memoria correcta no puede decir. Con el caso A (p-91000710): el apartado que filtra se rechaza
// siempre, el documento ensamblado o subido lo registra como aviso y «Dar por buena» pide motivo.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  apartadoCasoA,
  decisionesCasoA,
  FICHA_CASO_A,
  GUION_CASO_A,
  ID,
  licitacionCasoA,
  type Numeros,
} from './fixtures/casoA.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-fugas-'));
const salidas = path.join(tmp, 'salidas');
const agentes = path.join(tmp, '.agentes');
for (const d of [salidas, agentes]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), 'l'.repeat(40));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { GuionBase, GuionEntrada, guionVigente, proponerGuion } =
  await import('../../src/dominios/licitaciones/oferta/guion.js');
const { marcaGenerica } = await import('../../src/dominios/licitaciones/oferta/guionRevision.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { contextoDeFugas, detectarFugas, importesSueltos } =
  await import('../../src/dominios/licitaciones/oferta/fugas.js');
const { revisarApartado } = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
const { ApartadoEntrada, recibirApartado } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { instruccionesRedaccion } = await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { ensamblarMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { fugasHeredadas } = await import('../../src/dominios/licitaciones/oferta/fugasMemoria.js');

// ── Detección (pura) ──

// Villaejemplo, lote 3 (p-91000770): el segundo guion y las decisiones del 13/10, recortados.
const SOBRE_B = 'Sobre “B” - Criterios de juicio de valor';
const SOBRE_C = 'Sobre “C” - Criterios cuantificables mediante fórmulas';
const ASISTENCIA =
  'Grabación de las tutorías por videoconferencia, disponible para el participante con su consentimiento previo';
const ALUMNAS = 'Incorporar participantes adicionales sobre el mínimo exigido en el lote 3';
const GUION_CASO_C = GuionBase.parse({
  archivos: [
    {
      nombre: 'Sobre “A” - Documentación Administrativa',
      contenido: 'DEUC y declaraciones responsables.',
      documentos: [{ tipo: 'deuc', nombre: 'DEUC', obligatorio: true, produce: 'persona' }],
    },
    {
      nombre: SOBRE_B,
      contenido: 'Propuesta académica, sin criterios automáticos.',
      documentos: [
        {
          tipo: 'memoria',
          nombre: 'Propuesta técnica de los cursos en teleformación',
          obligatorio: true,
          produce: 'hermes',
          origen: { modelo: 'ANEXO IV', documento: 'PCAP.pdf', pagina: 97 },
        },
      ],
    },
    {
      nombre: SOBRE_C,
      contenido: 'Proposición económica y criterios automáticos.',
      documentos: [
        {
          tipo: 'oferta_economica',
          nombre: 'ANEXO V.- Proposición económica y criterios evaluables mediante fórmulas',
          obligatorio: true,
          produce: 'persona',
          origen: { modelo: 'ANEXO V', documento: 'ANEXO V.docx', pagina: 99 },
        },
      ],
    },
  ],
  memoria: {
    archivo: SOBRE_B,
    titulo_documento: 'Propuesta técnica de los cursos en teleformación',
    limite_paginas: null,
    limite_detalle: 'El PCAP no fija límite.',
    apartados: [
      {
        titulo:
          'Propuesta metodológica, herramientas y recursos didácticos, así como descripción de la plataforma e-learning',
        puntos: 15,
        escala: [],
        se_valorara: [
          'El enfoque metodológico y estrategias pedagógicas propuestas, así como el sistema de tutorías y los tiempos de respuesta propuestos.',
          'Plataforma e-learning propuesta, teniendo en cuenta la integración por parte de la plataforma de herramientas de comunicación y de rastreo, así como el protocolo o canal de asistencia técnica propuesto para resolver las incidencias de acceso y uso de la plataforma.',
        ],
      },
    ],
    advertencias: [
      'Los licitadores, al describir esta propuesta académica, no podrán hacer mención a ninguno de los aspectos incluidos como valorables en los criterios automáticos.',
    ],
  },
  automaticos: [
    {
      criterio: ASISTENCIA,
      puntos: 3,
      casilla_en: 'ANEXO V, apartado 2 (indicar Sí o No; declaración responsable si se oferta)',
      archivo: SOBRE_C,
      como_se_acredita:
        'Indicar “Si o No”, sin ninguna salvedad. Si se oferta, aportar firmada la declaración responsable conforme al modelo del anexo V: consentimiento previo; uso de las grabaciones solo para el repaso individual del participante; supresión a los treinta días; sin cesión a terceros.',
      marcas: ['grabación de las tutorías', 'consentimiento previo', 'tutorías por videoconferencia'],
    },
    {
      criterio: ALUMNAS,
      puntos: 6,
      como_se_acredita: 'Por cada participante adicional al número mínimo exigido, 0,20 puntos.',
      casilla_en: 'ANEXO V, apartado 3',
      archivo: SOBRE_C,
      marcas: ['participantes adicionales'],
    },
  ],
  oferta_economica: {
    formula: 'Puntuación = X*((A-B)/(A-C))',
    presupuesto_base: 1.54,
    impuesto_aparte: 'exento',
    umbral_anormalidad: null,
    modelo: 'ANEXO V, apartado 1',
    archivo: SOBRE_C,
  },
  plazo: { fecha_limite: '2027-10-14T23:59', canal: 'PLACSP' },
  lotes: ['3'],
});
const CTX_CASO_C = contextoDeFugas({
  guion: GUION_CASO_C,
  decididos: [
    {
      criterio: ASISTENCIA,
      nos_acogemos: true,
      nota: 'Sí, se ofrece la grabación completa con consentimiento previo del participante. Anexo V lote 3, apdo. 2 + declaración a/b/c; GrabaClase',
    },
    {
      criterio: ALUMNAS,
      nos_acogemos: true,
      nota: 'Ofrece 30 participantes adicionales. Máxima opción del Anexo V, lote 3, apartado 3 (PCAP, pág. 76).',
    },
  ],
  herramientas: ['Aula Abierta', 'Looker Studio'],
  nombresPropios: ['Diputación Provincial de Villaejemplo'],
});
// Una frase sintética que repite la cláusula de la declaración con otras palabras.
const FRASE_CASO_C =
  'La coordinación consultará las grabaciones solo para el repaso de cada participante y las borrará al cabo de un mes.';

test('should_detect_the_casoC_sentence_that_echoes_the_recording_declaration', () => {
  const fugas = detectarFugas(
    `Si un participante no puede asistir, escribe al canal de soporte. ${FRASE_CASO_C} Después se cierra la incidencia.`,
    CTX_CASO_C,
  );
  assert.equal(fugas.length, 1, JSON.stringify(fugas));
  assert.deepEqual(
    [fugas[0]!.tipo, fugas[0]!.cita, fugas[0]!.criterio, fugas[0]!.archivo],
    ['eco', FRASE_CASO_C, ASISTENCIA, SOBRE_C],
  );
  assert.equal(
    fugas[0]!.marca,
    'uso de las grabaciones solo para el repaso individual del participante',
    'la cláusula de la declaración que repite',
  );
});

test('should_let_the_memoria_describe_the_support_the_rubric_asks_for_without_the_declaration', () => {
  const ninguna = (t: string) => assert.deepEqual(detectarFugas(t, CTX_CASO_C), [], t);
  ninguna(
    'El técnico de soporte solo consultará en la plataforma los datos de alta necesarios para restablecer la cuenta y nunca pedirá la contraseña.',
  );
  ninguna(
    'El canal de asistencia técnica resuelve en cuatro horas laborables las incidencias de acceso y uso de la plataforma.',
  );
  ninguna('Los datos personales de los participantes se protegen conforme al RGPD y no salen de la Unión Europea.');
  ninguna('Cada grupo tendrá 25 participantes y una tutora de referencia.');
  ninguna('Aula Abierta envía avisos y Looker Studio muestra los informes de actividad.');
  ninguna('La propuesta sigue el modelo del Anexo IV y la presenta la Diputación Provincial de Villaejemplo.');
});

test('should_detect_the_marks_tools_annexes_and_amounts_of_the_automatic_file', () => {
  const de = (t: string) => detectarFugas(t, CTX_CASO_C).map((f) => [f.tipo, f.marca]);
  assert.deepEqual(
    de('Para grabar usaremos GrabaClase con permiso del participante.'),
    [['decidido', 'GrabaClase']],
    'herramienta que solo se declara para un automático',
  );
  assert.deepEqual(
    de('Aceptaremos 30 participantes adicionales en cada edición.'),
    [['marca', 'participantes adicionales']],
    'la marca del guion, sin repetirla como cifra',
  );
  assert.deepEqual(de('Como se indica en el Anexo V, la asistencia es inmediata.'), [['documento', 'Anexo V']]);
  assert.deepEqual(de('El precio es de 1,04 € por hora y participante.'), [['importe', '1,04 €']]);
});

test('should_leave_amounts_that_do_not_talk_about_our_offer_for_a_person_to_review', () => {
  const ejemplo = 'En el ejemplo, una página de prensa a 4.000 € con un descuento del 35 % pesa 0,384.';
  assert.deepEqual(detectarFugas(ejemplo, CTX_CASO_C), [], 'el ejemplo de un método de valoración no es la oferta');
  assert.deepEqual(importesSueltos(ejemplo), ['4.000 €', 'descuento del 35 %'], 'pero se avisa');
  assert.deepEqual(
    detectarFugas('Si la baja del alumnado supera el 10 %, se activa el plan de retención.', CTX_CASO_C),
    [],
    'la baja de un participante no es la del precio',
  );
  assert.deepEqual(
    detectarFugas('Ofrecemos una baja del 15 % sobre el presupuesto de licitación.', CTX_CASO_C).map((f) => f.marca),
    ['baja del 15 %'],
  );
});

// Un criterio automático con nivel declarado (CASO_E, criterio 2.1) y la memoria en otro archivo.
const GUION_NIVEL = GuionBase.parse({
  ...GUION_CASO_A,
  automaticos: [
    {
      criterio: '2.1 Tiempo de respuesta a las consultas del alumnado en horario lectivo',
      puntos: 6,
      como_se_acredita: 'Marcando la casilla del Anexo VI.',
      casilla_en: 'Anexo VI',
      archivo: 'Archivo electrónico nº 2',
      marcas: ['respuesta garantizada'],
    },
  ],
});

test('should_detect_the_declared_level_only_when_the_sentence_talks_about_its_criterion', () => {
  assert.equal(marcaGenerica('2 horas'), true, 'como marca del guion se descartaría por genérica');
  for (const decidido of [
    { nota: 'Respuesta en 2 h o menos, con turnos y suplente' },
    { nivel: '≤ 2 horas', nota: 'Ana titular y Luis suplente.' },
  ]) {
    const ctx = contextoDeFugas({
      guion: GUION_NIVEL,
      decididos: [{ criterio: GUION_NIVEL.automaticos[0]!.criterio, nos_acogemos: true, ...decidido }],
    });
    const fugas = detectarFugas(
      'La tutora dará respuesta en 2 horas a cada consulta. La sesión de bienvenida dura 2 horas.',
      ctx,
    );
    assert.deepEqual(
      fugas.map((f) => [f.tipo, f.cita]),
      [['decidido', 'La tutora dará respuesta en 2 horas a cada consulta.']],
      JSON.stringify(decidido),
    );
  }
  const sinAcogernos = contextoDeFugas({
    guion: GUION_NIVEL,
    decididos: [{ criterio: GUION_NIVEL.automaticos[0]!.criterio, nos_acogemos: false, nota: 'Respuesta en 2 h' }],
  });
  assert.deepEqual(
    detectarFugas('La tutora dará respuesta en 2 horas a cada consulta.', sinAcogernos),
    [],
    'lo que no ofrecemos no tiene cifra que delatar',
  );
});

// CASO_B: la cifra ofertada solo está en `valor` (la web la guarda con el input automatico-valor).
const GUION_GARANTIA = GuionBase.parse({
  ...GUION_CASO_A,
  automaticos: [
    {
      criterio: 'Plazo de garantía',
      puntos: 10,
      como_se_acredita: 'Indicando los años en el Anexo III.',
      casilla_en: 'Anexo III',
      archivo: 'Archivo electrónico nº 3',
      marcas: [],
    },
  ],
});

test('should_detect_a_leak_of_the_offered_value_when_the_decision_only_has_valor', () => {
  // Arrange
  const ctx = contextoDeFugas({
    guion: GUION_GARANTIA,
    decididos: [{ criterio: 'Plazo de garantía', nos_acogemos: true, valor: 2.25, tramo: null }],
  });
  const conComa = 'Ofrecemos una garantía ampliada de 2,25 años sobre todo el servicio.';
  const conPunto = 'La garantía será de 2.25 años.';
  const otraCosa = 'El curso dura 2,25 meses en horario de mañana.';

  // Act
  const fugas = [conComa, conPunto, otraCosa].map((t) => detectarFugas(t, ctx).map((f) => [f.tipo, f.marca]));

  // Assert
  assert.deepEqual(fugas[0], [['decidido', '2,25']]);
  assert.deepEqual(fugas[1], [['decidido', '2,25']], 'el punto decimal también');
  assert.deepEqual(fugas[2], [], 'sin hablar de la garantía, la cifra no delata nada');
});

test('should_not_watch_echoes_of_the_criterion_name_nor_of_criteria_we_do_not_take', () => {
  // Con un nombre corto, describir la tutoría que pide la rúbrica ya «repetía» el criterio.
  const frase =
    'La tutora atenderá las consultas del alumnado en horario lectivo, de lunes a viernes, por el foro y la mensajería de Aula Abierta.';
  const criterio = GUION_NIVEL.automaticos[0]!.criterio;
  assert.deepEqual(
    detectarFugas(frase, contextoDeFugas({ guion: GUION_NIVEL, decididos: [{ criterio, nos_acogemos: false }] })),
    [],
  );
  assert.deepEqual(
    detectarFugas(frase, contextoDeFugas({ guion: GUION_NIVEL })),
    [],
    'el nombre del criterio no es una cláusula de la declaración',
  );
});

test('should_take_an_echo_as_a_soft_problem_and_keep_the_hard_leaks_hard', () => {
  const ctx = {
    ...CTX_CASO_C,
    apartado: { titulo: 'Propuesta metodológica', puntos: 15, se_valorara: [] },
    cuota: null,
  };
  const con = (parrafo: string) =>
    revisarApartado(
      { titulo: 'Propuesta metodológica', bloques: [{ parrafos: [parrafo] }], cubre: [], compromisos: [] },
      ctx,
    );
  const eco = con(`Si un participante no puede asistir, escribe al canal de soporte. ${FRASE_CASO_C}`);
  assert.deepEqual(eco.duros, [], 'un eco es una sospecha: tras dos rechazos entra con aviso');
  assert.match(
    eco.blandos[0] ?? '',
    /^El apartado parece repetir con otras palabras lo que se declara en criterios automáticos que van en «Sobre “C”/,
  );
  assert.equal(
    con('Para grabar usaremos GrabaClase con permiso del participante y del centro.').duros.length,
    1,
    'lo decidido sigue siendo duro',
  );
});

test('should_flag_the_years_of_a_named_team_member_when_their_experience_scores_in_another_file', () => {
  // CASO_F: el criterio A.2 puntúa la experiencia del director en el Archivo 2.
  const guion = GuionBase.parse({
    ...GUION_CASO_A,
    automaticos: [
      {
        criterio: 'A.2 Experiencia adicional del director del proyecto en auditoría de accesibilidad web',
        puntos: 10,
        como_se_acredita: 'Más de 5 años: 10 puntos. Consta en su CV.',
        casilla_en: 'Anexo VII',
        archivo: 'Archivo electrónico nº 2',
        marcas: ['experiencia adicional del director'],
      },
    ],
  });
  const ctx = contextoDeFugas({ guion, equipo: ['Olga Ejemplo Ruiz'] });
  const fugas = detectarFugas(
    'Olga Ejemplo dirigirá el proyecto: es licenciada en Diseño y acumula 12 años de experiencia en auditorías de accesibilidad de portales web.',
    ctx,
  );
  assert.deepEqual(
    fugas.map((f) => [f.tipo, f.marca]),
    [['decidido', '12 años']],
  );
  assert.deepEqual(
    detectarFugas('Olga coordinará las reuniones semanales con el cliente.', ctx),
    [],
    'sin años no delata',
  );
  assert.deepEqual(
    detectarFugas(
      'Olga acumula 12 años en auditorías.',
      contextoDeFugas({ guion: GuionBase.parse(GUION_CASO_A), equipo: ['Olga Ejemplo Ruiz'] }),
    ),
    [],
    'si no puntúa en otro archivo, se puede decir',
  );
});

// ── Recepción, ensamblado, subida y «Dar por buena» (caso A) ──

iniciarNucleo();
const db = dbLicitaciones();
const ts = new Date().toISOString();
guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ts, ts);
assert.equal(guardarPerfilEmpresa(nucleo().db, { nif: 'B12345678', nombre: 'Analítica Ejemplo SL' }).error, null);
const PERSONAS = ['Ana García Pérez', 'Luis Martín Díaz'].map(
  (nombre) => crearPersona(nucleo().db, { nombre, tipo: 'interno', rol: 'Consultora' }).data!.id,
);
await proponerFicha(db, FichaEntrada.parse(FICHA_CASO_A), 'licitaciones');
assert.equal((await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones')).error, null);
const DECISIONES = decisionesCasoA(PERSONAS);
DECISIONES.automaticos[2] = {
  criterio: 'Mejora 1: bolsa de horas adicionales',
  nos_acogemos: true,
  nota: 'Bolsa de 16 horas adicionales al año',
} as never;
assert.equal(guardarDecisiones(db, nucleo().db, ID, DECISIONES).error, null);

let server: http.Server;
let base = '';
before(() => {
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = { 'content-type': 'application/json' };
const leer = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
type FilaMemoria = {
  id: number;
  version: number;
  guion_id: number;
  estado: string;
  borrador_id: number | null;
  avisos: string;
  anulacion_fugas: string | null;
};
const memoria = (version: number) =>
  db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(ID, version) as FilaMemoria;
const numeros = (m: FilaMemoria): Numeros => ({ memoria_id: m.id, guion_id: m.guion_id, version: m.version });
// Una memoria con fases en la redacción, con los cuatro apartados por recibir.
function enRedaccion(version: number): FilaMemoria {
  const guion = (
    db.prepare('SELECT id FROM guiones WHERE licitacion_id = ? ORDER BY id DESC').get(ID) as { id: number }
  ).id;
  const id = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, ?, 'redactando', ?, 'redaccion', 0)",
      )
      .run(ID, guion, version, ts).lastInsertRowid,
  );
  for (const n of [1, 2, 3, 4])
    db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, ?, 'pendiente')").run(id, n);
  return db.prepare('SELECT * FROM memorias WHERE id = ?').get(id) as FilaMemoria;
}

// Las instrucciones de redacción que recibiría Hermes con el guion dado, sobre una versión aparte que se borra.
function instruccionesConGuion(guion: number): string {
  const m = enRedaccion(90);
  try {
    return instruccionesRedaccion(db, nucleo().db, {
      id: ID,
      memoria_id: m.id,
      guion_id: guion,
      version: m.version,
      ronda: 0,
      pedida_en: ts,
    });
  } finally {
    db.prepare('DELETE FROM memoria_apartados WHERE memoria_id = ?').run(m.id);
    db.prepare('DELETE FROM memorias WHERE id = ?').run(m.id);
  }
}
const FUGA = 'Además, la empresa reserva 16 horas adicionales al año para consultas urgentes de la entidad.';
const conFuga = (n: Numeros) => {
  const a = apartadoCasoA(1, n);
  a.bloques[1]!.parrafos.push(FUGA);
  return a;
};
const rechazoPrevio = (recurso: string) =>
  nucleo()
    .db.prepare(
      `INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en)
  VALUES ('licitaciones', 'licitaciones_memoria_apartado', 'licitaciones', ?, 'error', ?)`,
    )
    .run(recurso, new Date().toISOString());

test('should_reject_a_leaking_section_even_after_two_rejections_while_other_problems_pass_with_warnings', () => {
  const m = enRedaccion(1);
  for (let i = 0; i < 2; i += 1) rechazoPrevio(`${ID}#v${m.version}#a1`);
  const r = recibirApartado(db, ApartadoEntrada.parse(conFuga(numeros(m))), 'licitaciones', { revisar: true });
  assert.equal(r.error?.code, 'invalid_input', 'tras dos rechazos, una fuga sigue sin entrar');
  assert.match(
    r.error!.message,
    /El apartado dice lo que ofrecemos en criterios automáticos que van en «Archivo electrónico nº 2» \(causa de exclusión\): «16 horas» en «Además, la empresa reserva 16 horas adicionales al año para consultas urgentes de la entidad\.» \(bloque 2; criterio «Mejora 1: bolsa de horas adicionales»\)/,
  );
  const blando = recibirApartado(
    db,
    ApartadoEntrada.parse({ ...apartadoCasoA(1, numeros(m)), titulo: 'Organización' }),
    'licitaciones',
    { revisar: true },
  );
  assert.equal(blando.error, null, 'un problema que no es fuga entra con aviso');
  assert.match(blando.data!.avisos.join(' '), /El título debe ser el literal del guion/);
});

test('should_register_the_leaks_of_the_whole_document_as_warnings_when_assembling', async () => {
  const primera = memoria(1);
  for (const n of [2, 3, 4])
    assert.equal(
      recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(n, numeros(primera))), 'licitaciones').error,
      null,
    );
  const e1 = await ensamblarMemoria(db, primera.id);
  assert.equal(e1.error, null, e1.error?.message);
  assert.equal(memoria(1).estado, 'ensamblada');
  // La versión 2 copia los apartados sin pasar por la revisión (como «Nueva versión» con los que no rehace).
  const id = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, 2, 'redactando', ?, 'redaccion', 0)",
      )
      .run(ID, primera.guion_id, ts).lastInsertRowid,
  );
  db.prepare(
    'INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres) SELECT ?, apartado, estado, datos, caracteres FROM memoria_apartados WHERE memoria_id = ?',
  ).run(id, primera.id);
  const { id: _i, memoria_id: _m, guion_id: _g, version: _v, apartado: _a, ...datos } = conFuga(numeros(primera));
  db.prepare('UPDATE memoria_apartados SET datos = ? WHERE memoria_id = ? AND apartado = 1').run(
    JSON.stringify(datos),
    id,
  );
  const e = await ensamblarMemoria(db, id);
  assert.equal(e.error, null, e.error?.message);
  assert.match(
    e.data!.avisos[0]!,
    /^Fuga entre sobres en el apartado 1: «16 horas» es lo que ofrecemos en el criterio automático «Mejora 1: bolsa de horas adicionales», que va en «Archivo electrónico nº 2»\. Es causa de exclusión/,
  );
  assert.ok(!e.data!.avisos[0]!.includes('Además, la empresa'), 'el aviso no lleva la cita (puede nombrar a personas)');
  assert.ok(
    !JSON.parse(memoria(1).avisos).some((a: string) => a.startsWith('Fuga entre sobres')),
    'la primera no tiene fugas',
  );
});

const patch = (b: number, body: unknown) =>
  fetch(`${base}/api/licitaciones/borradores/${b}`, { method: 'PATCH', headers: json, body: JSON.stringify(body) });
type Estado = {
  memorias: {
    version: number;
    fugas: {
      hallazgos: { apartado: number; tipo: string; marca: string; cita: string; descripcion: string }[];
      anulada: { motivo: string } | null;
    };
  }[];
};
const estado = async (v: number) =>
  (await leer<Estado>(fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta`))).memorias.find(
    (m) => m.version === v,
  )!;

test('should_block_accepting_a_memoria_with_leaks_unless_a_reason_to_override_them_is_given', async () => {
  const f = (await estado(2)).fugas;
  assert.deepEqual(
    f.hallazgos.map((h) => [h.apartado, h.tipo, h.marca, h.cita]),
    [[1, 'decidido', '16 horas', FUGA]],
  );
  assert.equal(f.anulada, null);
  const b = memoria(2).borrador_id!;
  const sinMotivo = await patch(b, { decision: 'aceptar' });
  assert.equal(sinMotivo.status, 400);
  // Como «Dar por buena»: lo que queda marcado pide su motivo; las fugas, además, su propia explicación.
  const REVISADA = 'Revisada entera: la fuga se explica aparte.';
  const sinAnular = await patch(b, { decision: 'aceptar', motivo: REVISADA });
  assert.equal(sinAnular.status, 409);
  assert.match(
    (await leer<{ message: string }>(sinAnular)).message,
    /apartado 1: «Además, la empresa reserva 16 horas[^»]*» \(«16 horas» es lo que ofrecemos.*explica por qué en «anular_fugas»/,
  );
  assert.equal(
    (await patch(b, { decision: 'aceptar', motivo: REVISADA, anular_fugas: 'no' })).status,
    400,
    'un motivo de verdad',
  );
  assert.equal(
    (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(b) as { estado: string }).estado,
    'pendiente',
  );
  const motivo = 'Las 16 horas son las de la formación inicial que pide el pliego, no las de la bolsa de la mejora 1.';
  assert.equal((await patch(b, { decision: 'aceptar', motivo: REVISADA, anular_fugas: motivo })).status, 200);
  assert.equal(
    (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(b) as { estado: string }).estado,
    'aceptada',
  );
  assert.equal((await estado(2)).fugas.anulada?.motivo, motivo);
  assert.deepEqual(
    (JSON.parse(memoria(2).anulacion_fugas!) as { fugas: { marca: string }[] }).fugas.map((x) => x.marca),
    ['16 horas'],
    'queda constancia de lo anulado',
  );
  assert.equal(
    (await patch(memoria(1).borrador_id!, { decision: 'aceptar', motivo: REVISADA })).status,
    200,
    'sin fugas no hace falta anular_fugas',
  );
});

test('should_warn_about_leaks_in_a_hand_edited_word', async () => {
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const texto =
    'La empresa revisó a mano este apartado: responsables, plazos e indicadores quedan como los acordó el equipo.';
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '14 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({
      numero: String(i + 1),
      titulo: t,
      bloques: [
        { parrafos: i === 3 ? [texto, 'El detalle de cada mejora está en el Anexo VII de nuestra oferta.'] : [texto] },
      ],
    })),
    pie: { texto: '', numeracion: true },
  });
  const form = new FormData();
  form.append('archivo', new Blob([new Uint8Array(docx)]), 'memoria-editada.docx');
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/subir`, {
    method: 'POST',
    body: form,
  });
  assert.equal(r.status, 201, await r.clone().text());
  const s = await leer<{ version: number; avisos: string[] }>(r);
  assert.match(
    s.avisos.join(' '),
    /Fuga entre sobres en el apartado 4: nombra «Anexo VII», que va en «Archivo electrónico nº 2»/,
  );
  assert.deepEqual(
    (await estado(s.version)).fugas.hallazgos.map((h) => [h.apartado, h.tipo, h.cita]),
    [[4, 'documento', 'El detalle de cada mejora está en el Anexo VII de nuestra oferta.']],
  );
});

test('should_tell_hermes_what_we_offered_and_that_a_leak_is_never_accepted', () => {
  const inst = instruccionesConGuion(memoria(1).guion_id);
  assert.match(
    inst,
    /Tampoco «Anexo VII», «16 horas»: es lo que ofrecemos en ellos o el modelo donde se marca\. Ni cuentes con otras palabras lo que se declara en ellos\./,
  );
  assert.match(
    inst,
    /Una fuga al archivo de los criterios automáticos o de la oferta económica, o un nombre del equipo cuando va por roles, se rechaza siempre\./,
  );
});

test('should_ask_for_roles_without_years_when_the_team_experience_scores_in_another_file', async () => {
  const g = await proponerGuion(
    db,
    GuionEntrada.parse({
      id: ID,
      ...GUION_CASO_A,
      automaticos: [
        ...GUION_CASO_A.automaticos,
        {
          ...GUION_CASO_A.automaticos[0]!,
          criterio: 'Experiencia adicional de la responsable del servicio',
          marcas: ['experiencia adicional'],
        },
      ],
    }),
    'licitaciones',
  );
  const inst = instruccionesConGuion(g.data!.guion);
  assert.match(
    inst,
    /- Equipo \(redacta por roles, sin nombres, años de experiencia, titulaciones ni certificaciones: se valoran en «Experiencia adicional de la responsable del servicio», que va en «Archivo electrónico nº 2»\): Responsable del servicio/,
  );
  assert.doesNotMatch(inst, /Ana García Pérez/);
});

test('should_tell_hermes_which_automatic_criteria_we_take_when_they_go_in_the_memoria_file', async () => {
  const g = await proponerGuion(
    db,
    GuionEntrada.parse({
      id: ID,
      ...GUION_CASO_A,
      automaticos: GUION_CASO_A.automaticos.map((a) => ({ ...a, archivo: 'Archivo electrónico nº 1' })),
    }),
    'licitaciones',
  );
  const inst = instruccionesConGuion(g.data!.guion);
  assert.match(
    inst,
    /- Criterios automáticos que van en el mismo archivo que la memoria \(se marcan en su modelo\): describe lo ofertado de forma coherente con el modelo, sin superarlo; lo no ofertado no se describe\./,
  );
  assert.match(
    inst,
    /· Nos acogemos: «Mejora 1: bolsa de horas adicionales» \(Bolsa de 16 horas adicionales al año\)\./,
  );
  assert.match(inst, /· No nos acogemos: «Certificado ISO 14001»/);
});

// Herencia de la anulación: una versión nueva no vuelve a pedir el motivo de una fuga
// que ya se anuló si la frase es la misma; si la frase cambió, se revisa otra vez.
const fugaEn = (cita: string, apartado = 1) => ({
  tipo: 'decidido' as const,
  marca: '16 horas',
  cita,
  criterio: 'Mejora 1: bolsa de horas adicionales',
  archivo: 'Archivo electrónico nº 2',
  apartado,
  titulo: 'Organización',
  descripcion: '«16 horas» es lo que ofrecemos',
});
const ANULACION_V1 = {
  motivo: 'Es el horario de atención del pliego, no la bolsa ofertada.',
  en: '2026-10-14T10:00:00.000Z',
  fugas: [
    {
      apartado: 1,
      tipo: 'decidido' as const,
      marca: '16 horas',
      criterio: 'Mejora 1: bolsa de horas adicionales',
      cita: FUGA,
    },
  ],
};

test('should_inherit_an_annulment_when_the_sentence_did_not_change', () => {
  const nuevas = [fugaEn(`  ${FUGA.toUpperCase()} `, 2), fugaEn('Otra frase con 16 horas de soporte.')];

  const h = fugasHeredadas(ANULACION_V1, nuevas, 1);

  assert.deepEqual(
    h?.fugas.map((f) => f.apartado),
    [2],
    'misma frase aunque cambie de apartado, mayúsculas o espacios',
  );
  assert.equal(h?.heredada_de, 1);
  assert.equal(h?.motivo, ANULACION_V1.motivo);
});

test('should_not_inherit_when_the_sentence_changed', () => {
  const nuevas = [
    fugaEn('Además, la empresa reserva 20 horas adicionales al año para consultas urgentes de la entidad.'),
  ];

  assert.equal(fugasHeredadas(ANULACION_V1, nuevas, 1), null);
  assert.equal(fugasHeredadas(null, [fugaEn(FUGA)], 1), null, 'sin anulación previa no hay nada que heredar');
  assert.equal(fugasHeredadas(ANULACION_V1, [], 1), null, 'sin fugas nuevas tampoco');
});
