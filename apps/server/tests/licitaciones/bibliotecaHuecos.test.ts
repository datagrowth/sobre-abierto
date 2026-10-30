// Biblioteca en la web sobre el caso A: los huecos (lo que piden los pliegos y la Biblioteca
// no respalda), «Pedir nota» a Hermes y en cuántas ofertas se ha usado cada nota.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, cerrar, db, ID, nucleo } from '../helpers/memoriaEntorno.js';

const { huecosBiblioteca, temasPedidos } = await import('../../src/dominios/licitaciones/huecosBiblioteca.js');
const { instruccionesNota, notaRecibida, pedirNotas, TIPO_NOTA, usosDeNotas } =
  await import('../../src/nucleo/bibliotecaGestion.js');

before(arrancar);
after(cerrar);

type Hit = Awaited<
  ReturnType<(typeof import('../../src/biblioteca/motor/documentos/busquedaHibrida.js'))['buscarEnBiblioteca']>
>[number];
const hit = (x: Partial<Hit>): Hit => ({
  path: 'x.md',
  title: 'x',
  score: 1,
  snippet: '',
  matched_in: ['semantic'],
  kind: 'document',
  passages: [],
  ...x,
});

test('should_take_the_themes_from_the_approved_fichas_of_the_last_six_months', () => {
  const temas = temasPedidos(db);
  assert.ok(temas.length > 0, 'la ficha del caso A pide cosas');
  assert.ok(temas.every((t) => t.licitaciones.has(ID)));
  assert.deepEqual(temasPedidos(db, Date.now() + 365 * 86_400_000), [], 'una ficha de hace más de 6 meses no cuenta');
});

test('should_report_as_gaps_what_the_library_does_not_back_up', async () => {
  // Arrange: el primer tema lo respalda un documento sin nota; el resto, nada.
  const [primero] = temasPedidos(db);
  const buscar = async (q: string) =>
    q === primero!.tema ? [hit({ kind: 'document', path: 'Casos/informe.pdf' })] : [];

  // Act
  const h = await huecosBiblioteca(db, { buscar, listo: () => true });
  const sinModelo = await huecosBiblioteca(db, { buscar, listo: () => false });

  // Assert
  assert.equal(h.estado, 'ok');
  assert.equal(h.huecos.find((x) => x.tema === primero!.tema)?.tenemos, 'solo_documentos');
  assert.ok(h.huecos.filter((x) => x.tema !== primero!.tema).every((x) => x.tenemos === 'nada' && x.pliegos === 1));
  assert.deepEqual(
    [sinModelo.estado, sinModelo.huecos],
    ['sin_busqueda', []],
    'sin búsqueda por significado no se inventan huecos',
  );
});

test('should_count_in_how_many_offers_a_note_was_read', () => {
  // Arrange: el agente de la oferta lee la nota mientras trabaja en dos licitaciones distintas.
  const n = nucleo().db;
  n.exec('DELETE FROM auditoria_agentes');
  const ins = n.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('oferta-licitaciones', ?, 'x', ?, 'ok', ?)",
  );
  ins.run('licitaciones_memoria_apartado', `${ID}#m3`, '2026-10-20T10:00:00.000Z');
  ins.run('biblioteca_leer', 'Metodologías/Formación.md', '2026-10-20T10:20:00.000Z');
  ins.run('licitaciones_memoria_apartado', 'p-otra#m4', '2026-10-21T09:00:00.000Z');
  ins.run('biblioteca_leer', 'Metodologías/Formación.md', '2026-10-21T09:05:00.000Z');
  ins.run('biblioteca_leer', 'Metodologías/Formación.md', '2026-10-21T09:06:00.000Z');
  ins.run('biblioteca_leer', 'Casos/sin oferta.md', '2026-10-25T09:06:00.000Z');

  // Act + Assert
  assert.deepEqual(
    usosDeNotas(n),
    { 'Metodologías/Formación.md': 2 },
    'ofertas distintas; una lectura lejos de cualquier oferta no cuenta',
  );
});

test('should_ask_hermes_for_a_draft_of_a_gap_and_know_when_it_arrived', async () => {
  const n = nucleo().db;
  const r = await pedirNotas(n, { tema: 'Casos de IA en el sector salud' });
  assert.deepEqual(r.data, { pedidas: 1, no_se_pueden_leer: [] });
  const t = n.prepare('SELECT payload FROM trabajos_ia WHERE tipo = ? ORDER BY id DESC').get(TIPO_NOTA) as {
    payload: string;
  };
  const p = JSON.parse(t.payload);
  assert.match(instruccionesNota(p, 'Analítica Ejemplo'), /carpeta «Borradores»[\s\S]*«tipo» \(uno de: caso_exito/);
  assert.equal(notaRecibida(n, p), false);
  n.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('licitaciones', 'biblioteca_proponer', 'biblioteca', 'Borradores', 'ok', ?)",
  ).run(new Date(Date.now() + 1000).toISOString());
  assert.equal(notaRecibida(n, p), true);
  assert.match(
    instruccionesNota({ ruta: 'Casos/informe.pdf', tema: null, pedida_en: 'x' }, 'Analítica Ejemplo'),
    /fuente «Casos\/informe\.pdf»/,
  );
});
