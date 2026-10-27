// Comentarios con menciones: «@Nombre» de una persona activa la menciona (sin
// quien escribe), queda sin leer para ella hasta que la abre y le llega por email una vez, sin
// importes y solo si lo tiene activado. Un lector comenta; dar por resuelto el de otro, un editor.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comentarios-'));
process.env.PLATAFORMA_DATA_DIR = tmp;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://hermes.ejemplo.es';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearUsuario, cambiarUsuario } = await import('../../src/nucleo/usuarios.js');
const { guardarPreferencias } = await import('../../src/nucleo/avisosPersona.js');
const { usarEnvioDePrueba } = await import('../../src/nucleo/correo.js');
const { rolNecesario } = await import('../../src/nucleo/permisos.js');
const c = await import('../../src/nucleo/comentarios.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { registrarAvisosLicitaciones } = await import('../../src/dominios/licitaciones/avisos.js');
type Correo = import('../../src/nucleo/correo.js').Correo;

iniciarNucleo();
const db = nucleo().db;
after(() => {
  usarEnvioDePrueba(null);
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let enviados: Correo[] = [];
beforeEach(() => {
  enviados = [];
  usarEnvioDePrueba(async (x) => {
    enviados.push(x);
    return { data: { id: String(enviados.length) }, error: null };
  });
});

const persona = async (nombre: string, email: string, rol: 'editor' | 'lector' = 'editor') =>
  (await crearUsuario(db, { email, nombre, rol, contrasena: 'temporal-de-doce' })).data!;
const ELISA = await persona('Elisa Martín', 'elisa@example.com');
const ANA = await persona('Ana', 'ana@example.com');
const ANA_P = await persona('Ana Pérez', 'anap@example.com');
const LUIS = await persona('Luis Lector', 'luis@example.com', 'lector');

const dbL = dbLicitaciones();
const l = licitacion({
  titulo: 'Servicio de formación en IA generativa para personal técnico',
  publicada: '2026-10-01',
  limite: '2026-11-12T14:00:00',
});
guardarLicitacion(dbL, l);
registrarAvisosLicitaciones(() => ({ db: dbL, dbNucleo: db }));
const EN_REQUISITO = {
  dominio: 'licitaciones',
  recurso: l.id,
  entidad: 'requisito',
  entidad_id: '-:solvencia_tecnica',
};
const como = (u: { id: number; nombre: string }) => ({ id: u.id, nombre: u.nombre });

test('should_mention_active_people_by_name_without_accents_case_or_the_author', () => {
  // Arrange
  const equipo = [ELISA, ANA, ANA_P].map(como);

  // Act
  const a = c.mencionadas('Mira esto @elisa martin y @Ana Pérez, por favor', equipo, null);
  const b = c.mencionadas('@Ana ¿lo ves? @Elisa Martín', equipo, ELISA.id);
  const d = c.mencionadas('correo a @Anabel y elisa@example.com', equipo, null);

  // Assert
  assert.deepEqual(a.map((p) => p.id).sort(), [ELISA.id, ANA_P.id].sort(), '«@Ana Pérez» no menciona también a Ana');
  assert.deepEqual(
    b.map((p) => p.id),
    [ANA.id],
    'quien escribe no se menciona',
  );
  assert.deepEqual(d, [], 'ni «@Anabel» es Ana ni un email es una mención');
});

test('should_not_mention_from_an_email_and_look_past_a_longer_word', () => {
  // Arrange
  const luis = { id: 90, nombre: 'Luis' };
  const equipo = [luis, ...[ANA, ANA_P].map(como)];

  // Act
  const correo = c.mencionadas('mail a pepe@luis.com', equipo, null);
  const despues = c.mencionadas('@Anabel hola @Ana', equipo, null);
  const dos = c.mencionadas('@Ana mira, y otra vez @Ana', equipo, null);

  // Assert
  assert.deepEqual(correo, [], '«pepe@luis.com» no menciona a Luis');
  assert.deepEqual(
    despues.map((p) => p.id),
    [ANA.id],
    'tras «@Anabel», «@Ana» sí es Ana',
  );
  assert.deepEqual(
    dos.map((p) => p.id),
    [ANA.id],
    'dos veces la misma persona, una mención',
  );
});

test('should_save_a_comment_with_its_mentions_and_count_them_unread_until_read', () => {
  // Act
  const r = c.publicarComentario(db, como(ELISA), {
    ...EN_REQUISITO,
    texto: '@Luis Lector ¿tenemos este certificado?',
  });
  const antes = c.mencionesSinLeer(db, LUIS.id);
  const leidas = c.leerMenciones(db, LUIS.id, { comentarios: [r.data!.id] });

  // Assert
  assert.deepEqual(r.data?.menciones, [{ id: LUIS.id, nombre: 'Luis Lector' }]);
  assert.equal(r.data?.autor, 'Elisa Martín');
  assert.equal(antes.length, 1);
  assert.equal(antes[0]?.titulo, 'Formación en IA generativa para personal técnico');
  assert.equal(antes[0]?.enlace, `#/licitacion/${l.id}/requisitos`);
  assert.equal(leidas.data?.sin_leer, 0);
  assert.equal(c.comentariosDe(db, { dominio: 'licitaciones', recurso: l.id }).data?.comentarios.length, 1);
});

test('should_reject_an_empty_comment_an_unknown_place_or_tender', () => {
  assert.equal(c.publicarComentario(db, como(ELISA), { ...EN_REQUISITO, texto: '   ' }).error?.code, 'invalid_input');
  assert.equal(
    c.publicarComentario(db, como(ELISA), { ...EN_REQUISITO, entidad: 'apartado', texto: 'x' }).error?.code,
    'invalid_input',
  );
  assert.equal(
    c.publicarComentario(db, como(ELISA), { ...EN_REQUISITO, recurso: 'p-no-existe', texto: 'x' }).error?.code,
    'not_found',
  );
  assert.equal(
    c.publicarComentario(db, como(ELISA), { ...EN_REQUISITO, texto: 'x'.repeat(c.MAX_TEXTO + 1) }).error?.code,
    'invalid_input',
  );
});

test('should_let_the_author_or_an_editor_resolve_but_not_another_reader', async () => {
  // Arrange
  const otroLector = await persona('Otra Lectora', 'otra@example.com', 'lector');
  const r = c.publicarComentario(db, como(LUIS), { ...EN_REQUISITO, texto: 'Falta la ISO 27001' }).data!;

  // Act
  const ajeno = c.resolverComentario(db, r.id, { ...como(otroLector), puedeEditar: false }, { resuelto: true });
  const propio = c.resolverComentario(db, r.id, { ...como(LUIS), puedeEditar: false }, { resuelto: true });
  const editor = c.resolverComentario(db, r.id, { ...como(ELISA), puedeEditar: true }, { resuelto: false });

  // Assert
  assert.equal(ajeno.error?.code, 'sin_permiso');
  assert.deepEqual([propio.data?.resuelto, propio.data?.resuelto_por], [true, 'Luis Lector']);
  assert.equal(editor.data?.resuelto, false);
});

test('should_let_a_reader_comment_by_route', () => {
  assert.equal(rolNecesario('POST', '/api/plataforma/comentarios'), 'lector');
  assert.equal(rolNecesario('PATCH', '/api/plataforma/comentarios/3'), 'lector');
});

test('should_email_each_person_their_pending_mentions_once_without_the_comment_text', async () => {
  // Arrange: Ana no quiere emails de menciones; Elisa sí (por defecto). El precio, dicho de maneras
  // que ningún filtro taparía.
  guardarPreferencias(db, ANA.id, { menciones: false });
  c.publicarComentario(db, como(LUIS), {
    ...EN_REQUISITO,
    entidad: 'oferta',
    entidad_id: '',
    texto: '@Elisa Martín bajamos a 29 mil euros, oferta 29k, coste 1,2M o treinta mil',
  });
  c.publicarComentario(db, como(LUIS), {
    ...EN_REQUISITO,
    entidad: 'bloqueo',
    entidad_id: 'precio:-',
    texto: '@Elisa Martín y @Ana, mirad el precio',
  });

  // Act
  await c.avisarMenciones(db);
  await c.avisarMenciones(db);

  // Assert
  assert.deepEqual(
    enviados.map((x) => x.para),
    ['elisa@example.com'],
    'una vez, y a Ana no',
  );
  assert.match(enviados[0]!.asunto, /2 menciones nuevas/);
  for (const x of [enviados[0]!.texto, enviados[0]!.html])
    assert.doesNotMatch(x, /29 mil|29k|1,2M|treinta mil|bajamos|mirad el precio/);
  assert.match(enviados[0]!.texto, /Luis Lector en «Formación en IA generativa para personal técnico»/);
  assert.match(enviados[0]!.html, /#\/licitacion\/p-\d+\/revision/);
  assert.equal(c.mencionesSinLeer(db, ANA.id).length, 1, 'sin email, la mención sigue en su contador');
});

test('should_not_mention_someone_who_left', async () => {
  cambiarUsuario(db, ANA_P.id, { activo: false });
  assert.deepEqual(
    c
      .publicarComentario(db, como(ELISA), { ...EN_REQUISITO, texto: '@Ana Pérez ¿y esto?' })
      .data?.menciones.map((m) => m.id),
    [ANA.id],
    'sin Ana Pérez, «@Ana» es Ana',
  );
  cambiarUsuario(db, ANA_P.id, { activo: true });
});
