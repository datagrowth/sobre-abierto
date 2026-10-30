// Memoria presentada: la que se entregó, hecha fuera de la plataforma (PDF o Word), se sube tal
// cual con el plazo vencido, se guarda entera (repartida por apartados solo si trae los títulos
// del guion), es LA memoria de la oferta y nadie la mejora, la revisa ni la descarta.
import fs from 'node:fs';
import path from 'node:path';
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  arrancar,
  base,
  cerrar,
  conectar,
  db,
  ID,
  nucleo,
  salidas,
  sinMemorias,
  T_OFERTA,
  texto,
} from '../helpers/memoriaEntorno.js';
import { APARTADOS } from './fixtures/casoA.js';

const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');
const { memoriasDe, resumenOferta } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { actualizarMemoria } = await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { revisarIa } = await import('../../src/dominios/licitaciones/propuestas/revision.js');
const { varaDeEvaluacion } = await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');
const { faltaMemoria } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { parrafosDePdf, ofertaCerrada, subirMemoriaPresentada } =
  await import('../../src/dominios/licitaciones/oferta/memoriaPresentada.js');
const { trabajoDePresentada } = await import('../../src/dominios/licitaciones/prioridadCola.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
const { instruccionesLecciones, LeccionesEntrada, PayloadLecciones, proponerLecciones } =
  await import('../../src/dominios/licitaciones/oferta/lecciones.js');

before(arrancar);
after(cerrar);

const DIA = 24 * 60 * 60_000;
const PARRAFO =
  'La empresa presta el servicio con una consultora senior que atiende las consultas en 24 horas y revisa cada mes los indicadores con la entidad.';
type Respuesta = {
  memoria: number;
  version: number;
  borrador: number;
  ruta: string;
  reconocidos: number;
  total: number;
  paginas: number | null;
  avisos: string[];
  aprende: boolean;
  evalua: boolean;
  sustituye: number | null;
};
type FilaMem = {
  id: number;
  version: number;
  presentada: number;
  estado: string;
  guion_id: number;
  borrador_id: number;
  subida: string;
  notas_subida: string | null;
};

function plazoEn(ms: number): () => void {
  const antes = (db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(ID) as { fecha_limite: string })
    .fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(horaLocalEspana(Date.now() + ms), ID);
  return () => {
    db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(antes, ID);
  };
}

const limpiar = () => {
  sinMemorias();
  db.exec(
    'DELETE FROM evaluaciones; DELETE FROM borradores; DELETE FROM lecciones; DELETE FROM comparaciones_memoria;',
  );
};
const memoria = (id: number) => db.prepare('SELECT * FROM memorias WHERE id = ?').get(id) as FilaMem;
const estadoBorrador = (id: number) =>
  (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(id) as { estado: string }).estado;
const enDisco = (ruta: string) => path.join(salidas, ruta.replace(/^Salidas\//, ''));

async function pdf(lineas: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const pagina = doc.addPage([595, 842]);
  lineas.forEach((l, i) => pagina.drawText(l, { x: 40, y: 800 - i * 16, size: 9, font: fuente }));
  return Buffer.from(await doc.save());
}

const docxConTitulos = (titulos: string[]) =>
  generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '1 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({ numero: String(i + 1), titulo: t, bloques: [{ parrafos: [PARRAFO] }] })),
    pie: { texto: '', numeracion: true },
  });

async function subir(datos: Buffer, nombre: string, campos: Record<string, string> = {}): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  form.append('archivo', new Blob([new Uint8Array(datos)]), nombre);
  return fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/presentada`, { method: 'POST', body: form });
}

async function subirBien(datos: Buffer, nombre: string, campos: Record<string, string> = {}): Promise<Respuesta> {
  const r = await subir(datos, nombre, campos);
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()) as Respuesta;
}

// Una versión de Hermes ya montada, con sus apartados redactados y pendiente de revisar.
function versionDeHermes(version: number): { memoria: number; borrador: number } {
  const g = guionVigente(db, ID)!;
  const ts = new Date().toISOString();
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en) VALUES (?, ?, ?, 'ensamblada', ?, ?)",
      )
      .run(ID, g.id, version, ts, ts).lastInsertRowid,
  );
  APARTADOS.forEach((a, i) =>
    db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos) VALUES (?, ?, 'recibido', ?)").run(
      m,
      i + 1,
      JSON.stringify({
        titulo: a.titulo,
        bloques: [{ parrafos: ['Hermes redactó este apartado con un compromiso genérico de calidad.'] }],
        cubre: [],
        compromisos: [],
      }),
    ),
  );
  const b = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, memoria_id)
    VALUES (?, ?, 'x', 1, 'Memoria', 'plataforma', ?, 'ensamblado', ?, ?, ?)`,
      )
      .run(ID, `Salidas/Licitaciones/x/memoria-v${version}.docx`, ts, g.id, version, m).lastInsertRowid,
  );
  db.prepare('UPDATE memorias SET borrador_id = ? WHERE id = ?').run(b, m);
  return { memoria: m, borrador: b };
}

test('should_store_a_pdf_without_the_outline_titles_whole_and_marked_presentada_after_the_deadline', async () => {
  limpiar();
  const restaurar = plazoEn(-3 * DIA);
  try {
    const datos = await pdf([
      'MEMORIA TÉCNICA',
      'Índice de contenidos y anexos',
      PARRAFO,
      'Anexo I. Cronograma del servicio.',
    ]);
    const s = await subirBien(datos, 'Memoria firmada.pdf', { notas: 'La que presentamos en la sede.', lote: '2' });
    const m = memoria(s.memoria);
    assert.deepEqual(
      [m.presentada, m.estado, m.subida, m.notas_subida],
      [1, 'ensamblada', 'Memoria firmada.pdf', 'La que presentamos en la sede.'],
    );
    assert.deepEqual([s.reconocidos, s.total, s.paginas, s.sustituye], [0, APARTADOS.length, 1, null]);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM memoria_apartados WHERE memoria_id = ?').get(s.memoria) as { n: number })
        .n,
      0,
      'entera, sin repartir',
    );
    assert.match(s.avisos.join(' '), /No se encontraron los títulos de los apartados del guion: se guarda entera/);
    assert.match(s.ruta, /\/memoria-v1-presentada\/Memoria firmada\.pdf$/, 'con su nombre y su extensión');
    assert.deepEqual(fs.readFileSync(enDisco(s.ruta)), datos, 'el archivo, tal cual');
    const b = db
      .prepare('SELECT estado, origen, ruta_md, paginas, resumen FROM borradores WHERE id = ?')
      .get(s.borrador) as { estado: string; origen: string; ruta_md: string; paginas: number; resumen: string };
    assert.deepEqual(
      [b.estado, b.origen, b.paginas],
      ['aceptada', 'ensamblado', 1],
      'es lo entregado: no espera revisión',
    );
    assert.match(b.resumen, /lote 2/);
    assert.match(
      fs.readFileSync(enDisco(b.ruta_md), 'utf8'),
      /consultora senior que atiende las consultas/,
      'con su texto extraído',
    );
    assert.equal(s.evalua, true);
    assert.ok(
      nucleo().db.prepare('SELECT 1 FROM trabajos_ia WHERE clave = ?').get(`evaluacion-memoria-${ID}-v1`),
      'Hermes la evalúa',
    );
    assert.equal(s.aprende, true, 'aprende de la nota');
  } finally {
    restaurar();
  }
});

test('should_split_a_docx_with_the_outline_titles_by_section', async () => {
  limpiar();
  const titulos = APARTADOS.map((a) => a.titulo);
  const s = await subirBien(await docxConTitulos(titulos.slice(0, 2)), 'memoria-presentada.docx');
  assert.deepEqual([s.reconocidos, s.total], [2, titulos.length]);
  const filas = db
    .prepare('SELECT apartado, estado, agente FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(s.memoria) as { apartado: number; estado: string; agente: string }[];
  assert.deepEqual(
    filas.map((f) => f.estado),
    ['recibido', 'recibido', ...titulos.slice(2).map(() => 'fallido')],
  );
  assert.match(s.avisos.join(' '), /Repartida por los apartados del guion: 2 de \d+ reconocidos/);
  assert.equal(memoriasDe(db, ID)[0]!.presentada, true);
});

test('should_split_pdf_lines_into_paragraphs_and_keep_the_outline_titles_alone', () => {
  const p = parrafosDePdf(
    [
      '1. Organización y metodología del servicio\nLa consultora atiende las consultas\nen 24 horas.\n\nOtra línea suelta',
    ],
    ['Organización y metodología del servicio'],
  );
  assert.deepEqual(
    p.map((x) => x.texto),
    [
      '1. Organización y metodología del servicio',
      'La consultora atiende las consultas en 24 horas.',
      'Otra línea suelta',
    ],
  );
});

test('should_return_400_when_the_extension_or_the_signature_is_not_allowed', async () => {
  limpiar();
  const txt = await subir(Buffer.from('hola'), 'memoria.txt');
  assert.deepEqual(
    [txt.status, ((await txt.json()) as { message: string }).message],
    [400, 'Formato no admitido: sube un archivo .pdf o .docx.'],
  );
  const falso = await subir(Buffer.from('no soy un pdf'), 'memoria.pdf');
  assert.equal(falso.status, 400);
  assert.match(((await falso.json()) as { message: string }).message, /no es un PDF válido/);
  const lote = await subir(await pdf([PARRAFO]), 'memoria.pdf', { lote: 'x'.repeat(81) });
  assert.equal(lote.status, 400);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n, 0, 'no se guarda nada');
});

test('should_not_update_accept_or_discard_the_presentada', async () => {
  limpiar();
  const s = await subirBien(await docxConTitulos(APARTADOS.map((a) => a.titulo)), 'presentada.docx');
  // Con el plazo abierto (presentada antes de tiempo): lo que la frena es que es lo entregado.
  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id: ID,
    version: s.version,
    indicaciones: 'Quita los condicionales de todos los apartados.',
    confirmado: true,
  });
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /es la presentada: lo entregado no cambia/);
  for (const decision of ['aceptar', 'descartar'] as const) {
    const x = revisarIa(db, 'borradores', s.borrador, { decision });
    assert.equal(x.error?.code, 'conflicto', decision);
  }
  assert.equal(estadoBorrador(s.borrador), 'aceptada', 'sigue siendo la de la oferta');
});

test('should_prefer_the_presentada_for_lessons_evaluation_and_the_offer_summary', async () => {
  limpiar();
  const hermes = versionDeHermes(1);
  const s = await subirBien(await docxConTitulos(APARTADOS.map((a) => a.titulo)), 'presentada.docx');
  assert.equal(estadoBorrador(hermes.borrador), 'descartada', 'la versión de trabajo deja de ser la de la oferta');
  assert.equal(s.aprende, true, 'aprende de lo presentado frente a la versión de Hermes');
  const t = nucleo()
    .db.prepare('SELECT payload FROM trabajos_ia WHERE clave = ?')
    .get(`lecciones-${ID}-v${s.version}`) as { payload: string };
  assert.deepEqual([JSON.parse(t.payload).memoria_id, JSON.parse(t.payload).base_id], [s.memoria, hermes.memoria]);
  assert.equal(
    varaDeEvaluacion(db, ID, s.ruta)?.memoria?.version,
    s.version,
    'su evaluación es la de la memoria presentada',
  );
  assert.equal(resumenOferta(db, ID).memoria?.version, s.version);
  // Una versión posterior (p. ej. de ensayo) no le quita el sitio.
  versionDeHermes(s.version + 1);
  db.prepare('UPDATE memorias SET ensayo = 1 WHERE version = ?').run(s.version + 1);
  assert.equal(resumenOferta(db, ID).memoria?.version, s.version);
  const c = await conectar(T_OFERTA);
  try {
    const o = JSON.parse(texto(await c.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } }))) as {
      memoria: { version: number; presentada: boolean };
    };
    assert.deepEqual(
      [o.memoria.version, o.memoria.presentada],
      [s.version, true],
      'licitaciones_oferta la marca presentada',
    );
  } finally {
    await c.close();
  }
});

// Fuente «edición»: la final de Hermes frente a la presentada, con los cambios que etiqueta
// Hermes y el porqué de los 3 más grandes que no se explican solos.
test('should_compare_hermes_final_version_with_the_presentada_and_ask_why_for_the_three_biggest_changes', async () => {
  // Arrange
  limpiar();
  versionDeHermes(1);
  const s = await subirBien(await docxConTitulos(APARTADOS.map((a) => a.titulo)), 'presentada.docx');
  const leer = async () =>
    (await (await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/comparaciones`)).json()) as {
      items: {
        id: number;
        version_hermes: number;
        por_apartado: boolean;
        resumen: { total: number };
        cambios: { n: number; tipo: string | null; tamano: number }[];
        preguntas: { n: number; respuesta: string | null }[];
      }[];
    };
  const c = (await leer()).items[0]!;
  assert.deepEqual(
    [c.version_hermes, c.por_apartado, c.resumen.total],
    [1, true, 2 * APARTADOS.length],
    'cada apartado: lo de Hermes quitado y lo presentado añadido',
  );
  const t = nucleo()
    .db.prepare('SELECT payload FROM trabajos_ia WHERE clave = ?')
    .get(`lecciones-${ID}-v${s.version}`) as { payload: string };
  const inst = instruccionesLecciones(db, PayloadLecciones.parse(JSON.parse(t.payload)));
  assert.match(inst, /que se presentó \(«presentada\.docx»\)[\s\S]*CAMBIOS ENTRE TU v1 Y LA PRESENTADA v/);
  assert.match(inst, /4\. cambios: por cada cambio de la lista sin tipo/);
  const porque = {
    pregunta: '¿Por qué se cambió este párrafo?',
    opciones: ['Lo pidió el cliente', 'Faltaba una cifra', 'Por extensión'] as [string, string, string],
  };
  const grandes = c.cambios
    .filter((k) => k.n <= 4)
    .sort((a, b) => b.tamano - a.tamano)
    .slice(0, 3)
    .map((k) => k.n);

  // Act
  const entrada = LeccionesEntrada.parse({
    id: ID,
    memoria_id: s.memoria,
    lecciones: [
      {
        texto: 'Pon el plazo de respuesta en horas y la revisión mensual con la entidad.',
        alcance: 'general',
        apartado: 1,
        evidencia: '+ atiende las consultas en 24 horas',
        cambio: grandes[0],
      },
    ],
    cambios: c.cambios.map((k) => ({ n: k.n, tipo: 'especificidad', porque: k.n <= 4 ? porque : null })),
  });
  const r = proponerLecciones(db, entrada, 'licitaciones');
  const malo = proponerLecciones(
    db,
    { ...entrada, cambios: [{ n: 999, tipo: 'estilo', porque: null }] },
    'licitaciones',
  );
  const despues = (await leer()).items[0]!;
  const respuesta = await fetch(
    `${base}/api/licitaciones/licitaciones/${ID}/oferta/comparaciones/${despues.id}/porque`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: despues.preguntas[0]!.n, respuesta: 'Faltaba una cifra' }),
    },
  );

  // Assert
  assert.deepEqual(r.data, { guardadas: 1 });
  assert.match(malo.error?.message ?? '', /999 no existe/);
  assert.ok(despues.cambios.every((k) => k.tipo === 'especificidad'));
  assert.deepEqual(
    despues.preguntas.map((p) => p.n),
    grandes,
    'solo los 3 más grandes de los que no se explican solos',
  );
  assert.deepEqual([respuesta.status, await respuesta.json()], [200, { pendientes: 2 }]);
  const l = db.prepare('SELECT evidencias FROM lecciones WHERE memoria_id = ?').get(s.memoria) as {
    evidencias: string;
  };
  const e = JSON.parse(l.evidencias)[0];
  assert.deepEqual(
    [e.ubicacion.startsWith(`cambio ${grandes[0]} · apartado 1 · `), e.porque],
    [true, 'Faltaba una cifra'],
    'la respuesta va a la evidencia de su lección (I3)',
  );
});

test('should_not_flag_the_memoria_as_outdated_once_presented', async () => {
  limpiar();
  versionDeHermes(1);
  const g = guionVigente(db, ID)!;
  db.prepare('UPDATE memorias SET guion_id = ? WHERE licitacion_id = ?').run(g.id - 1, ID);
  assert.equal(memoriasDe(db, ID)[0]!.guion_cambiado, true, 'en preparación sí se avisa');
  assert.equal(ofertaCerrada(db, ID), false);
  const decididas = (
    db.prepare('SELECT guion_id FROM decisiones_oferta WHERE licitacion_id = ?').get(ID) as { guion_id: number }
  ).guion_id;
  db.prepare('UPDATE decisiones_oferta SET guion_id = ? WHERE licitacion_id = ?').run(g.id - 1, ID);
  assert.equal(resumenOferta(db, ID).guion_cambiado, true, 'las decisiones, también desfasadas en preparación');
  db.prepare("UPDATE oportunidades SET estado = 'presentada' WHERE licitacion_id = ?").run(ID);
  try {
    assert.equal(memoriasDe(db, ID)[0]!.guion_cambiado, false, 'presentada, ya no pide cambios');
    assert.deepEqual(faltaMemoria(db, ID, g), []);
    assert.equal(resumenOferta(db, ID).guion_cambiado, false, 'ni manda a revisar las decisiones');
  } finally {
    db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = ?").run(ID);
    db.prepare('UPDATE decisiones_oferta SET guion_id = ? WHERE licitacion_id = ?').run(decididas, ID);
  }
});

test('should_replace_the_previous_presentada_when_another_is_uploaded', async () => {
  limpiar();
  const primera = await subirBien(await pdf([PARRAFO]), 'equivocada.pdf');
  const segunda = await subirBien(await pdf([PARRAFO, PARRAFO]), 'buena.pdf');
  assert.equal(segunda.sustituye, primera.memoria);
  assert.deepEqual(
    [memoria(primera.memoria).presentada, memoria(segunda.memoria).presentada],
    [2, 1],
    'la anterior queda en el historial',
  );
  assert.deepEqual([estadoBorrador(primera.borrador), estadoBorrador(segunda.borrador)], ['descartada', 'aceptada']);
  assert.ok(fs.existsSync(enDisco(primera.ruta)), 'sin borrar su archivo');
  const [nueva, vieja] = memoriasDe(db, ID);
  assert.deepEqual([nueva!.presentada, vieja!.presentada, vieja!.presentada_sustituida], [true, false, true]);
  assert.equal(
    revisarIa(db, 'borradores', primera.borrador, { decision: 'aceptar' }).error?.code,
    'conflicto',
    'la sustituida tampoco se da por buena',
  );
});

test('should_put_the_autoevaluation_of_the_presentada_behind_the_live_offers', async () => {
  limpiar();
  const restaurar = plazoEn(-3 * DIA);
  try {
    const hermes = versionDeHermes(1);
    const s = await subirBien(await pdf([PARRAFO]), 'Memoria presentada.pdf');
    const t = nucleo()
      .db.prepare('SELECT payload FROM trabajos_ia WHERE clave = ?')
      .get(`evaluacion-memoria-${ID}-v${s.version}`) as { payload: string };
    assert.equal(trabajoDePresentada(db, JSON.parse(t.payload)), true, 'con el plazo vencido no pasa por delante');
    const rutaHermes = (db.prepare('SELECT ruta FROM borradores WHERE id = ?').get(hermes.borrador) as { ruta: string })
      .ruta;
    assert.equal(trabajoDePresentada(db, { id: ID, documento: rutaHermes }), false);
    assert.equal(trabajoDePresentada(db, { id: ID }), false);
    assert.equal(trabajoDePresentada(db, null), false);
  } finally {
    restaurar();
  }
});

test('should_not_announce_an_evaluation_when_the_pliego_does_not_score_the_memoria', async () => {
  limpiar();
  const g = guionVigente(db, ID)!;
  const antes = (db.prepare('SELECT datos FROM guiones WHERE id = ?').get(g.id) as { datos: string }).datos;
  db.prepare("UPDATE guiones SET datos = json_set(datos, '$.memoria.valorable', json('false')) WHERE id = ?").run(g.id);
  try {
    const s = await subirBien(await pdf([PARRAFO]), 'memoria.pdf');
    assert.equal(s.evalua, false, 'autoevaluar no la encolaría');
    assert.equal(
      nucleo().db.prepare('SELECT 1 FROM trabajos_ia WHERE clave = ?').get(`evaluacion-memoria-${ID}-v${s.version}`),
      undefined,
    );
  } finally {
    db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(antes, g.id);
  }
});

test('should_take_the_version_after_the_slow_reading_so_a_memoria_created_meanwhile_leaves_no_orphan', async () => {
  limpiar();
  const datos = await pdf([PARRAFO]);
  const enCurso = subirMemoriaPresentada(db, ID, { nombre: 'Memoria presentada.pdf', datos, campos: {} });
  // Mientras se lee el PDF, otra persona pide una versión de la memoria.
  versionDeHermes(1);
  const r = await enCurso;
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.version, 2);
  assert.match(r.data!.ruta, /\/memoria-v2-presentada\//);
  assert.equal(
    fs.existsSync(path.join(path.dirname(path.dirname(enDisco(r.data!.ruta))), 'memoria-v1-presentada')),
    false,
    'sin carpeta huérfana',
  );
});

test('should_reject_uploading_again_the_file_that_already_is_the_presentada', async () => {
  limpiar();
  const datos = await pdf([PARRAFO]);
  const s = await subirBien(datos, 'Memoria presentada.pdf');
  const otra = await subir(datos, 'Memoria presentada.pdf');
  assert.equal(otra.status, 409);
  assert.equal(
    ((await otra.json()) as { message: string }).message,
    `Ese archivo ya es la memoria presentada (v${s.version}): no hace falta subirlo otra vez.`,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n,
    1,
    'no se crea otra ni se repite la evaluación',
  );
  assert.equal(memoria(s.memoria).presentada, 1);
});

// ── Por lote: CASO_E (lotes 2 y 4) pide «una Memoria Técnica específica para cada lote» ──

const { sembrarFixture, leerFixtureComprobaciones } = await import('../helpers/comprobacionesFixtures.js');
const { cierreDe } = await import('../../src/dominios/licitaciones/oferta/memoriaPresentada.js');
const { faltaDePreparacion } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { ofertaParaAgente } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { reglasDeMemoria } = await import('../../src/dominios/licitaciones/oferta/reglasMemoria.js');
const { leerEntradasComprobaciones } = await import('../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');

const CASO_E = leerFixtureComprobaciones('casoE');
const AHORA_CASO_E = Date.parse(CASO_E.ahora);
let casoESembrada = false;

// Se siembra al llegar aquí: el perfil y las personas de CASO_E sustituirían los del caso A en las pruebas de antes.
function conCasoE(): void {
  limpiar();
  if (!casoESembrada) {
    sembrarFixture(db, nucleo().db, CASO_E);
    casoESembrada = true;
  }
}

// Una versión de Hermes de un lote, ensamblada y sin revisar.
function versionDeLote(lote: string | null): { memoria: number; borrador: number; version: number } {
  const g = guionVigente(db, CASO_E.id)!;
  const ts = new Date().toISOString();
  const version =
    ((
      db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(CASO_E.id) as {
        v: number | null;
      }
    ).v ?? 0) + 1;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, lote) VALUES (?, ?, ?, 'ensamblada', ?, ?, ?)",
      )
      .run(CASO_E.id, g.id, version, ts, ts, lote).lastInsertRowid,
  );
  const b = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, memoria_id)
    VALUES (?, ?, 'x', 1, 'Memoria', 'plataforma', ?, 'ensamblado', ?, ?, ?)`,
      )
      .run(CASO_E.id, `Salidas/Licitaciones/casoE/memoria-v${version}.docx`, ts, g.id, version, m).lastInsertRowid,
  );
  db.prepare('UPDATE memorias SET borrador_id = ? WHERE id = ?').run(b, m);
  return { memoria: m, borrador: b, version };
}

async function presentarLote(lote: string | null, lineas: string[] = [PARRAFO]): Promise<Respuesta> {
  const r = await subirMemoriaPresentada(db, CASO_E.id, {
    nombre: `Memoria lote ${lote ?? 'comun'}.pdf`,
    datos: await pdf(lineas),
    campos: lote ? { lote } : {},
  });
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
}

const loteDe = (id: number) =>
  (db.prepare('SELECT lote FROM memorias WHERE id = ?').get(id) as { lote: string | null }).lote;

test('should_not_touch_the_presentada_of_lote_2_when_uploading_the_one_of_lote_4', async () => {
  // Arrange
  conCasoE();
  const hermes2 = versionDeLote('2');
  const hermes4 = versionDeLote('4');
  const lote2 = await presentarLote('2');

  // Act
  const lote4 = await presentarLote('4', [PARRAFO, 'Lote 4: direccion de obra.']);

  // Assert
  assert.deepEqual([loteDe(lote2.memoria), loteDe(lote4.memoria)], ['2', '4'], 'memorias.lote, no solo el .md');
  assert.deepEqual([memoria(lote2.memoria).presentada, memoria(lote4.memoria).presentada], [1, 1]);
  assert.equal(lote4.sustituye, null, 'la del lote 2 no es la anterior del lote 4');
  assert.deepEqual([estadoBorrador(lote2.borrador), estadoBorrador(lote4.borrador)], ['aceptada', 'aceptada']);
  assert.deepEqual(
    [estadoBorrador(hermes2.borrador), estadoBorrador(hermes4.borrador)],
    ['descartada', 'descartada'],
    'cada subida descarta solo las de su lote',
  );
});

test('should_discard_only_the_working_versions_of_its_lote', async () => {
  // Arrange
  conCasoE();
  const hermes4 = versionDeLote('4');
  const comun = versionDeLote(null);

  // Act
  await presentarLote('2');

  // Assert
  assert.deepEqual([estadoBorrador(hermes4.borrador), estadoBorrador(comun.borrador)], ['pendiente', 'pendiente']);
});

test('should_replace_only_the_presentada_of_the_same_lote', async () => {
  // Arrange
  conCasoE();
  const lote4 = await presentarLote('4');
  const equivocada = await presentarLote('2');

  // Act
  const buena = await presentarLote('2', [PARRAFO, 'La buena del lote 2.']);

  // Assert
  assert.equal(buena.sustituye, equivocada.memoria);
  assert.deepEqual(
    [memoria(equivocada.memoria).presentada, memoria(buena.memoria).presentada, memoria(lote4.memoria).presentada],
    [2, 1, 1],
  );
  assert.equal(estadoBorrador(lote4.borrador), 'aceptada');
});

test('should_keep_asking_for_the_memoria_of_lote_4_when_only_lote_2_is_presented', async () => {
  // Arrange
  conCasoE();
  const hermes4 = versionDeLote('4');
  const lote2 = await presentarLote('2');

  // Act
  const falta = faltaMemoria(db, CASO_E.id, guionVigente(db, CASO_E.id)!);
  const hoy = faltaDePreparacion(db, CASO_E.id, AHORA_CASO_E);
  const resumen = resumenOferta(db, CASO_E.id);
  const mcp = ofertaParaAgente(db, nucleo().db, { id: CASO_E.id, secciones: ['memoria'] }, false, AHORA_CASO_E);

  // Assert
  assert.deepEqual(falta, [`Memoria técnica del lote 4: revisa la v${hermes4.version} y dala por buena`]);
  assert.ok(hoy.includes(falta[0]!), JSON.stringify(hoy));
  assert.ok(!hoy.some((x) => x.startsWith('Memoria técnica del lote 2')), 'el lote 2 ya está entregado');
  const cierre = cierreDe(db, CASO_E.id);
  assert.deepEqual([ofertaCerrada(db, CASO_E.id), cierre('2'), cierre('4')], [false, true, false]);
  const esperado = [
    { lote: '2', version: lote2.version, estado: 'ensamblada', por_revisar: false, presentada: true },
    { lote: '4', version: hermes4.version, estado: 'ensamblada', por_revisar: true, presentada: false },
  ];
  assert.deepEqual(resumen.memorias_por_lote, esperado);
  assert.equal(mcp.error, null, mcp.error?.message);
  assert.deepEqual(mcp.data!['memorias_por_lote'], esperado, 'el MCP dice lo mismo que el resumen');
});

test('should_prefer_the_presentada_of_each_lote_in_the_comprobaciones_even_with_a_newer_version', async () => {
  // Arrange
  conCasoE();
  const lote2 = await presentarLote('2');
  versionDeLote('2');

  // Act
  const e = leerEntradasComprobaciones(db, nucleo().db, CASO_E.id, AHORA_CASO_E);

  // Assert
  assert.equal(e.error, null);
  assert.deepEqual(
    e.data!.memoria_lotes!.por_lote.map((x) => [x.lote, x.memoria?.version ?? null]),
    [
      ['2', lote2.version],
      ['4', null],
    ],
  );
  assert.equal(resumenOferta(db, CASO_E.id).memorias_por_lote![0]!.version, lote2.version, 'el resumen elige la misma');
});

test('should_review_the_working_memoria_of_lote_4_not_the_presentada_of_lote_2', async () => {
  // Arrange
  conCasoE();
  const lote2 = await presentarLote('2');
  const hermes4 = versionDeLote('4');

  // Act
  const e = leerEntradasComprobaciones(db, nucleo().db, CASO_E.id, AHORA_CASO_E);
  const comprobaciones = comprobacionesDe(db, nucleo().db, CASO_E.id, AHORA_CASO_E);

  // Assert
  assert.equal(e.error, null);
  assert.equal(
    e.data!.memoria?.version,
    hermes4.version,
    'las reglas de la memoria de la oferta miran la del lote abierto',
  );
  assert.equal(comprobaciones.error, null);
  const sobreLaPresentada = comprobaciones.data!.bloqueos.filter(
    (b) => b.titulo.includes(`v${lote2.version} `) || b.cita?.documento === `Memoria v${lote2.version}`,
  );
  assert.deepEqual(sobreLaPresentada, [], 'ninguna fila pide arreglar lo ya entregado');
});

test('should_close_the_offer_when_every_lote_has_its_presentada_or_there_is_a_common_one', async () => {
  // Arrange
  conCasoE();
  await presentarLote('2');
  await presentarLote('4');

  // Act
  const porLotes = ofertaCerrada(db, CASO_E.id);
  limpiar();
  versionDeLote('4');
  const presentadaComun = await presentarLote(null);
  const comun = cierreDe(db, CASO_E.id);
  const porLote = resumenOferta(db, CASO_E.id).memorias_por_lote!;
  const comprobaciones = leerEntradasComprobaciones(db, nucleo().db, CASO_E.id, AHORA_CASO_E).data!.memoria_lotes!
    .por_lote;

  // Assert
  assert.equal(porLotes, true);
  assert.deepEqual([comun(null), comun('2'), comun('4')], [true, true, true], 'la común vale para todos los lotes');
  assert.deepEqual(faltaMemoria(db, CASO_E.id, guionVigente(db, CASO_E.id)!), []);
  assert.deepEqual(
    porLote.map((x) => [x.lote, x.version, x.presentada]),
    [
      ['2', presentadaComun.version, true],
      ['4', presentadaComun.version, true],
    ],
  );
  assert.deepEqual(
    comprobaciones.map((x) => x.memoria?.version ?? null),
    [presentadaComun.version, presentadaComun.version],
    'las comprobaciones eligen la misma',
  );
});

test('should_reject_a_lote_that_is_not_of_the_offer', async () => {
  // Arrange
  conCasoE();

  // Act
  const r = await subirMemoriaPresentada(db, CASO_E.id, {
    nombre: 'Memoria.pdf',
    datos: await pdf([PARRAFO]),
    campos: { lote: '7' },
  });

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(r.error?.message, 'El lote «7» no es de esta oferta: las memorias son de los lotes 2, 4.');
});

test('should_not_block_the_comprobaciones_with_page_or_anonymity_rules_on_the_presentada', () => {
  // Arrange
  const larga = {
    version: 3,
    estado: 'ensamblada' as const,
    paginas: 40,
    paginas_estimadas: null,
    limite_paginas: 30,
    anonimato: null,
    lote: '2',
  };

  // Act
  const trabajo = reglasDeMemoria(larga);
  const presentada = reglasDeMemoria({ ...larga, presentada: true });

  // Assert
  assert.equal(trabajo.length, 1);
  assert.deepEqual(presentada, []);
});
