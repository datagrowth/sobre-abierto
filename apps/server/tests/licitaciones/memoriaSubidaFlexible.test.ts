// «Subir versión editada» con una memoria hecha fuera: un Word sin los títulos del guion (o con
// solo algunos) o un PDF ya no se rechaza. Se guarda entera, marcada sin repartir y con su aviso
// (o repartida a medias), se da por buena, se evalúa y enseña lecciones; «Pedir cambios» no.
import fs from 'node:fs';
import path from 'node:path';
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { api, arrancar, base, cerrar, db, ID, nucleo, salidas, sinMemorias } from '../helpers/memoriaEntorno.js';
import { APARTADOS } from './fixtures/casoA.js';

const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');
const { memoriasDe } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { revisarIa } = await import('../../src/dominios/licitaciones/propuestas/revision.js');
const { evaluarMemoria } = await import('../../src/dominios/licitaciones/oferta/reevaluar.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { sincronizarDocumentos } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { instruccionesLecciones, PayloadLecciones, TIPO_LECCIONES } =
  await import('../../src/dominios/licitaciones/oferta/lecciones.js');
const { AVISO_SIN_REPARTIR } = await import('../../src/dominios/licitaciones/oferta/subidaFlexible.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { EvaluacionEntrada, guardarEvaluacion, instruccionesEvaluacion } =
  await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
const { estadoImpacto } = await import('../../src/dominios/licitaciones/oferta/impacto.js');

before(arrancar);
after(cerrar);

const DIA = 24 * 60 * 60_000;
const PARRAFO =
  'La empresa presta el servicio con una consultora senior que atiende las consultas en 24 horas y revisa cada mes los indicadores con la entidad.';
const TITULOS = APARTADOS.map((a) => a.titulo);
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
  sin_repartir?: boolean;
};

const limpiar = () => {
  sinMemorias();
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores; DELETE FROM lecciones; DELETE FROM oferta_documentos;');
};
const enDisco = (ruta: string) => path.join(salidas, ruta.replace(/^Salidas\//, ''));
const filaMemoria = (id: number) =>
  db.prepare('SELECT sin_repartir, estado, subida FROM memorias WHERE id = ?').get(id) as {
    sin_repartir: number;
    estado: string;
    subida: string;
  };
const apartados = (id: number) =>
  db.prepare('SELECT estado FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado').all(id) as {
    estado: string;
  }[];
const borrador = (id: number) =>
  db.prepare('SELECT estado, ruta, ruta_pdf, ruta_md, ruta_json FROM borradores WHERE id = ?').get(id) as {
    estado: string;
    ruta: string;
    ruta_pdf: string | null;
    ruta_md: string;
    ruta_json: string;
  };

// Abierto: así un 409 al pedir cambios es por la versión, no por el plazo.
db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(horaLocalEspana(Date.now() + 30 * DIA), ID);

const docx = (titulos: string[], parrafos = [PARRAFO]) =>
  generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '1 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({ numero: String(i + 1), titulo: t, bloques: [{ parrafos }] })),
    pie: { texto: '', numeracion: true },
  });
const docxAjeno = () => docx(['Relación de documentos aportados', 'Anexo I. Cronograma del servicio']);

async function pdf(paginas: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  for (const lineas of paginas) {
    const p = doc.addPage([595, 842]);
    lineas.forEach((l, i) => p.drawText(l, { x: 40, y: 800 - i * 16, size: 9, font: fuente }));
  }
  return Buffer.from(await doc.save());
}

async function subir(datos: Buffer, nombre: string, campos: Record<string, string> = {}): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  form.append('archivo', new Blob([new Uint8Array(datos)]), nombre);
  return fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/subir`, { method: 'POST', body: form });
}

async function subirBien(datos: Buffer, nombre: string, campos: Record<string, string> = {}): Promise<Respuesta> {
  const r = await subir(datos, nombre, campos);
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()) as Respuesta;
}

// Una versión de Hermes ya montada, con sus apartados redactados.
function versionDeHermes(version: number): number {
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
  return m;
}

test('should_store_a_word_without_the_outline_titles_whole_with_the_warning_and_the_mark', async () => {
  limpiar();
  const s = await subirBien(await docxAjeno(), 'memoria hecha en local.docx');
  assert.deepEqual([s.sin_repartir, s.reconocidos, s.total, s.version], [true, 0, TITULOS.length, 1]);
  assert.ok(s.avisos.includes(AVISO_SIN_REPARTIR), s.avisos.join(' | '));
  assert.doesNotMatch(s.avisos.join(' '), /No encuentro en el Word los títulos/);
  const m = filaMemoria(s.memoria);
  assert.deepEqual([m.sin_repartir, m.estado, m.subida], [1, 'ensamblada', 'memoria hecha en local.docx']);
  assert.equal(apartados(s.memoria).length, 0, 'entera, sin apartados');
  const b = borrador(s.borrador);
  assert.equal(b.estado, 'pendiente', 'se revisa como cualquier versión');
  assert.match(b.ruta, /\/memoria-v1\.docx$/);
  assert.match(
    fs.readFileSync(enDisco(b.ruta_md), 'utf8'),
    /guardada entera[\s\S]*consultora senior que atiende las consultas/,
  );
  assert.ok(
    (JSON.parse(fs.readFileSync(enDisco(b.ruta_json), 'utf8')) as { parrafos: string[] }).parrafos.includes(PARRAFO),
    'sus párrafos, para las lecciones',
  );
  const e = memoriasDe(db, ID)[0]!;
  assert.deepEqual([e.sin_repartir, e.avisos.includes(AVISO_SIN_REPARTIR)], [true, true]);
});

test('should_split_a_word_with_some_outline_titles_partially_and_keep_the_rest_without_section', async () => {
  limpiar();
  const s = await subirBien(await docx(TITULOS.slice(0, 2)), 'memoria-parcial.docx');
  assert.deepEqual([Boolean(s.sin_repartir), s.reconocidos], [false, 2]);
  assert.deepEqual(
    apartados(s.memoria).map((a) => a.estado),
    ['recibido', 'recibido', ...TITULOS.slice(2).map(() => 'fallido')],
  );
  assert.equal(filaMemoria(s.memoria).sin_repartir, 0);
  const md = fs.readFileSync(enDisco(borrador(s.borrador).ruta_md), 'utf8');
  assert.match(md, /## Sin apartado[\s\S]*SIIE/, 'lo de antes del primer título, en su bloque');
});

test('should_keep_todays_full_split_for_a_word_with_all_the_outline_titles', async () => {
  limpiar();
  const s = await subirBien(await docx(TITULOS), 'memoria-completa.docx');
  assert.deepEqual([Boolean(s.sin_repartir), s.reconocidos, s.total], [false, TITULOS.length, TITULOS.length]);
  assert.ok(apartados(s.memoria).every((a) => a.estado === 'recibido'));
  assert.ok(!s.avisos.includes(AVISO_SIN_REPARTIR));
});

test('should_accept_a_pdf_whole_with_its_pages_or_split_by_the_titles_it_has', async () => {
  limpiar();
  const entera = await subirBien(
    await pdf([['MEMORIA TÉCNICA', PARRAFO], ['Anexo I. Cronograma del servicio.']]),
    'memoria firmada.pdf',
  );
  assert.deepEqual([entera.sin_repartir, entera.paginas], [true, 2]);
  const b = borrador(entera.borrador);
  assert.match(b.ruta, /\/memoria-v1\.pdf$/, 'con su extensión');
  assert.equal(b.ruta_pdf, null, 'el original ya es el PDF');
  assert.match(fs.readFileSync(enDisco(b.ruta_md), 'utf8'), /\[pág\. 1\][\s\S]*consultora senior[\s\S]*\[pág\. 2\]/);
  const repartida = await subirBien(
    await pdf([[`1. ${TITULOS[0]}`, PARRAFO, `2. ${TITULOS[1]}`, PARRAFO]]),
    'memoria con titulos.pdf',
  );
  assert.deepEqual([Boolean(repartida.sin_repartir), repartida.reconocidos], [false, 2]);
  const falso = await subir(Buffer.from('no soy un pdf'), 'memoria.pdf');
  assert.equal(falso.status, 400);
  assert.match(((await falso.json()) as { message: string }).message, /no es un PDF válido/);
});

test('should_return_409_when_asking_for_changes_on_a_whole_version', async () => {
  limpiar();
  const s = await subirBien(await docxAjeno(), 'entera.docx');
  const r = await api(`/licitaciones/${ID}/oferta/memoria/${s.version}/mejorar`, {
    indicaciones: 'Quita los condicionales de todos los apartados.',
  });
  assert.equal(r.status, 409);
  assert.match(
    ((await r.json()) as { message: string }).message,
    /se subió a mano: Hermes no la rehace\. Corrígela en tu documento o pide una memoria nueva/,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n,
    1,
    'no se crea otra versión',
  );
});

test('should_accept_evaluate_and_put_a_whole_version_in_the_checklist', async () => {
  limpiar();
  const s = await subirBien(await pdf([[PARRAFO]]), 'entera.pdf');
  assert.ok(
    nucleo().db.prepare('SELECT 1 FROM trabajos_ia WHERE clave = ?').get(`evaluacion-memoria-${ID}-v${s.version}`),
    'Hermes la evalúa sobre el texto entero',
  );
  assert.equal(
    evaluarMemoria(nucleo().db, db, raicesActuales(), { id: ID, version: s.version }).error,
    null,
    'y se puede volver a evaluar',
  );
  const r = revisarIa(db, 'borradores', s.borrador, { decision: 'aceptar' });
  assert.deepEqual([r.error, borrador(s.borrador).estado], [null, 'aceptada']);
  sincronizarDocumentos(db, ID, guionVigente(db, ID)!);
  const doc = db
    .prepare("SELECT ruta FROM oferta_documentos WHERE licitacion_id = ? AND ruta LIKE '%memoria-v%'")
    .get(ID) as { ruta: string } | undefined;
  assert.equal(doc?.ruta, s.ruta, 'la checklist lleva el PDF subido');
  const otra = await subirBien(await docxAjeno(), 'otra.docx');
  assert.equal(revisarIa(db, 'borradores', otra.borrador, { decision: 'descartar' }).error, null, 'y se descarta');
});

test('should_learn_comparing_the_whole_text_with_the_last_hermes_version', async () => {
  limpiar();
  versionDeHermes(1);
  const s = await subirBien(await docxAjeno(), 'entera.docx', {
    notas: 'Rehecha en local con los anexos del cliente.',
  });
  assert.equal(s.aprende, true);
  const t = nucleo().db.prepare('SELECT payload FROM trabajos_ia WHERE tipo = ?').get(TIPO_LECCIONES) as {
    payload: string;
  };
  const inst = instruccionesLecciones(db, PayloadLecciones.parse(JSON.parse(t.payload)));
  assert.match(inst, /CAMBIOS EN EL TEXTO ENTERO \(v1 de Hermes → v2/);
  assert.match(inst, /– Hermes redactó este apartado/);
  assert.ok(inst.includes(`+ ${PARRAFO}`), inst);
});

// Una evaluación con la vara del guion (el primer tramo con puntos de cada apartado) y estos genéricos.
function evaluacion(documento: string, genericos: string[]) {
  const criterios = APARTADOS.map((a, i) => ({
    criterio: a.titulo,
    peso: a.puntos,
    tipo: 'juicio_valor',
    apartado: i + 1,
    tramo: a.escala[1]!,
    puntuacion: a.escala[1]!,
    justificacion: 'Concreto en lo operativo, sin indicadores con meta.',
    referencia: 'pág. 1',
  }));
  return EvaluacionEntrada.parse({
    id: ID,
    documento,
    resumen: 'Memoria hecha fuera: concreta en lo operativo, floja en indicadores.',
    puntuacion_total: criterios.reduce((s, c) => s + c.puntuacion, 0),
    puntuacion_maxima: APARTADOS.reduce((s, a) => s + a.puntos, 0),
    criterios,
    eliminar: [],
    modificar: [],
    reforzar: [],
    comparables: [],
    riesgos: [],
    genericos: genericos.map((texto) => ({ referencia: 'pág. 1', texto, por_que: 'No dice con qué medida.' })),
  });
}

test('should_register_the_self_evaluation_of_a_whole_version_with_literal_generics', async () => {
  limpiar();
  const s = await subirBien(await docxAjeno(), 'entera.docx');
  const inst = instruccionesEvaluacion(ID, s.ruta, db);
  assert.match(
    inst,
    /subida a mano entera: no trae los títulos de los apartados del guion y no se reescribe por apartados/,
  );
  assert.doesNotMatch(inst, /tu evaluación decide qué apartados se reescriben/);
  assert.match(inst, /con referencia \(la página y la sección del documento/);
  const r = guardarEvaluacion(db, raicesActuales(), evaluacion(s.ruta, [PARRAFO]), 'licitaciones');
  assert.equal(r.error, null, r.error?.message);
  const inventado = guardarEvaluacion(
    db,
    raicesActuales(),
    evaluacion(s.ruta, ['Este párrafo no está en ningún sitio del documento subido.']),
    'licitaciones',
  );
  assert.match(inventado.error?.message ?? '', /no están tal cual en la memoria v1/, 'lo que no está sigue sin entrar');
});

test('should_accept_generics_from_the_without_section_block_of_a_partial_split', async () => {
  limpiar();
  const fuera = 'Relación de documentos que se aportan con esta memoria técnica del servicio.';
  const dentro = 'La consultora atiende las consultas en 24 horas.';
  const s = await subirBien(
    await pdf([[fuera, `1. ${TITULOS[0]}`, dentro, `2. ${TITULOS[1]}`, dentro]]),
    'parcial.pdf',
  );
  assert.deepEqual([Boolean(s.sin_repartir), s.reconocidos], [false, 2]);
  const r = guardarEvaluacion(db, raicesActuales(), evaluacion(s.ruta, [fuera, dentro]), 'licitaciones');
  assert.equal(r.error, null, r.error?.message);
});

const FUGA_ENTERA = 'El detalle de cada mejora está en el Anexo VII de nuestra oferta.';

test('should_ask_for_a_reason_to_accept_a_whole_version_with_leaks_and_keep_what_was_overridden', async () => {
  limpiar();
  const s = await subirBien(await docx(['Relación de documentos aportados'], [PARRAFO, FUGA_ENTERA]), 'con fuga.docx');
  assert.ok(s.sin_repartir);
  assert.match(s.avisos.join(' '), /Fuga entre sobres en el texto: nombra «Anexo VII»/);
  const e = memoriasDe(db, ID)[0]!;
  assert.deepEqual(
    e.fugas.hallazgos.map((h) => [h.apartado, h.tipo, h.marca, h.cita]),
    [[0, 'documento', 'Anexo VII', FUGA_ENTERA]],
  );
  const sinMotivo = revisarIa(db, 'borradores', s.borrador, { decision: 'aceptar' });
  assert.equal(sinMotivo.error?.code, 'conflicto');
  assert.match(sinMotivo.error!.message, /texto: «El detalle de cada mejora está en el Anexo VII/);
  const motivo = 'El Anexo VII es el del pliego técnico, no el modelo de la oferta.';
  assert.equal(revisarIa(db, 'borradores', s.borrador, { decision: 'aceptar', anular_fugas: motivo }).error, null);
  const a = JSON.parse(
    (db.prepare('SELECT anulacion_fugas FROM memorias WHERE id = ?').get(s.memoria) as { anulacion_fugas: string })
      .anulacion_fugas,
  ) as { motivo: string; fugas: { marca: string }[] };
  assert.deepEqual([a.motivo, a.fugas.map((f) => f.marca)], [motivo, ['Anexo VII']], 'el paquete la da por anulada');
});

test('should_learn_only_from_the_note_when_a_whole_version_has_no_text', async () => {
  limpiar();
  versionDeHermes(1);
  assert.equal(
    (await subirBien(await pdf([[]]), 'escaneada.pdf')).aprende,
    false,
    'sin texto ni nota no hay de qué aprender',
  );
  const s = await subirBien(await pdf([[]]), 'escaneada.pdf', {
    notas: 'La rehicimos en local con los anexos del cliente.',
  });
  assert.equal(s.aprende, true);
  const t = nucleo()
    .db.prepare('SELECT payload FROM trabajos_ia WHERE tipo = ? ORDER BY id DESC')
    .get(TIPO_LECCIONES) as { payload: string };
  const inst = instruccionesLecciones(db, PayloadLecciones.parse(JSON.parse(t.payload)));
  assert.doesNotMatch(inst, /– Hermes redactó/, 'nada sale como quitado');
  assert.doesNotMatch(inst, /CAMBIOS EN EL TEXTO ENTERO/);
});

test('should_compare_a_whole_pdf_by_content_despite_line_breaks_and_repeated_headers', async () => {
  limpiar();
  versionDeHermes(1);
  const cabecera = 'Analítica Ejemplo - Memoria técnica del servicio';
  const nuevo = 'La consultora atiende las consultas en 24 horas.';
  const s = await subirBien(
    await pdf([
      [cabecera, 'Hermes redactó este apartado con un', 'compromiso genérico de calidad.'],
      [cabecera, nuevo],
    ]),
    'entera.pdf',
  );
  assert.equal(s.aprende, true);
  const t = nucleo().db.prepare('SELECT payload FROM trabajos_ia WHERE tipo = ?').get(TIPO_LECCIONES) as {
    payload: string;
  };
  const inst = instruccionesLecciones(db, PayloadLecciones.parse(JSON.parse(t.payload)));
  assert.doesNotMatch(
    inst,
    /– Hermes redactó/,
    'el párrafo de Hermes sigue, aunque el PDF lo corte y le pegue la cabecera',
  );
  assert.doesNotMatch(inst, /\+ [^\n]*Hermes redactó/, 'ni vuelve como añadido');
  assert.match(inst, /\+ [^\n]*La consultora atiende las consultas en 24 horas\./);
});

test('should_return_409_when_updating_the_affected_sections_of_a_whole_version', async () => {
  limpiar();
  const s = await subirBien(await docxAjeno(), 'entera.docx');
  const previa = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/${s.version}/afectados`);
  assert.equal(previa.status, 409);
  assert.match(((await previa.json()) as { message: string }).message, /se subió a mano: Hermes no la rehace/);
  const r = await api(`/licitaciones/${ID}/oferta/memoria/${s.version}/actualizar-afectados`, {
    cambio: { lotes: ['1'] },
  });
  assert.equal(r.status, 409);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n,
    1,
    'no se crea otra versión',
  );
});

test('should_put_a_whole_version_in_the_impact_as_one_piece_with_all_its_text', async () => {
  limpiar();
  const s = await subirBien(await docxAjeno(), 'entera.docx');
  const e = estadoImpacto(db, nucleo().db, ID);
  assert.equal(e.error, null, e.error?.message);
  assert.deepEqual(
    e.data!.apartados.map((a) => [a.memoria_version, a.n, a.entera]),
    [[s.version, 0, true]],
  );
  assert.match(e.data!.apartados[0]!.texto ?? '', /consultora senior que atiende las consultas/);
});
