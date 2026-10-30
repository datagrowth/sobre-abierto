// Qué cambia de un guion al siguiente: volver a extraer el mismo pliego no cambia
// nada aunque cambien las páginas, los espacios o las marcas; un apartado se empareja por su
// título, un documento por su identidad y una oferta por sus lotes; al guardar un guion los
// cambios quedan en guiones.cambios y se encadenan entre versiones.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUION_CASO_A, guionCon, ID, licitacionCasoA, type Guion } from './fixtures/casoA.js';
import { GUION_CASO_B } from './fixtures/casoB.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guion-diff-'));
const agentes = path.join(tmp, '.agentes');
for (const d of [agentes, path.join(tmp, 'conocimiento'), path.join(tmp, 'salidas')])
  fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionBase, GuionEntrada, cambiosEntre, guionVigente, guionPorId, proponerGuion } =
  await import('../../src/dominios/licitaciones/oferta/guion.js');
const { estadoOferta } = await import('../../src/dominios/licitaciones/oferta/rutas.js');
const { apartadosCompatibles, componer, diferenciasGuion, seccionesAfectadas } =
  await import('../../src/dominios/licitaciones/oferta/guionDiff.js');

iniciarNucleo();
const db = dbLicitaciones();
guardarLicitacion(db, licitacionCasoA());
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const base = (g: unknown) => GuionBase.parse(g);
const casoA = (cambio: (g: Guion) => void = () => {}) => {
  const { id: _id, ...g } = guionCon(cambio);
  return base(g);
};
const casoB = (cambio: (g: typeof GUION_CASO_B) => void = () => {}) => {
  const g = structuredClone(GUION_CASO_B);
  cambio(g);
  return base(g);
};

test('should_report_no_changes_for_an_identical_reextraction_with_other_pages_and_spacing', () => {
  // Arrange: otras páginas y documento, espacios y mayúsculas, otras marcas y notas.
  const otra = casoA((g) => {
    g.memoria.pagina = 30;
    g.memoria.apartados.forEach((a) => {
      a.pagina += 1;
      a.documento = 'PCAP (versión 2).pdf';
      a.titulo = `  ${a.titulo.replace(/ /g, '  ')} `;
    });
    g.automaticos.forEach((a) => {
      a.pagina = 37;
      a.marcas = [...a.marcas, 'otra marca'];
    });
    g.archivos.forEach((a) => {
      a.pagina += 2;
      a.contenido = `${a.contenido} (parafraseado)`;
    });
    (g.archivos[0]!.documentos[0] as { notas?: string }).notas = 'Se presenta en el sobre 1.';
  });

  // Act
  const c = diferenciasGuion(casoA(), otra);

  // Assert
  assert.equal(c.vacio, true, JSON.stringify(c));
  assert.deepEqual(seccionesAfectadas(c), []);
  assert.equal(apartadosCompatibles(c), true);
});

test('should_match_sections_by_title_ignoring_accents_and_case', () => {
  const otra = casoA((g) => {
    g.memoria.apartados[0]!.titulo = 'ORGANIZACION Y METODOLOGÍA DEL SERVICIO';
  });

  const c = diferenciasGuion(casoA(), otra);

  assert.deepEqual(c.apartados, []);
  assert.equal(c.vacio, true);
});

test('should_report_a_changed_score_of_one_section', () => {
  const otra = casoA((g) => {
    g.memoria.apartados[1]!.puntos = 7.004;
    g.memoria.apartados[2]!.puntos = 6.5;
  });

  const c = diferenciasGuion(casoA(), otra);

  // 7 frente a 7,004 es la misma cifra a 2 decimales; 6 frente a 6,5, no.
  assert.deepEqual(c.apartados, [{ n: 3, titulo: 'Asesoramiento y acompañamiento', cambio: 'puntos' }]);
  assert.equal(c.vacio, false);
  assert.equal(apartadosCompatibles(c), true);
  assert.deepEqual(seccionesAfectadas(c), ['enfoque']);
});

test('should_report_an_added_lot_offer', () => {
  const antes = casoB((g) => {
    g.ofertas_economicas = g.ofertas_economicas.slice(0, 4);
    g.lotes = ['1', '2', '3', '4'];
  });

  const c = diferenciasGuion(antes, casoB());

  assert.deepEqual(c.ofertas, [{ lotes: '5', cambio: 'nuevo' }]);
  assert.equal(c.lotes, true);
  assert.deepEqual(c.automaticos, []);
  assert.deepEqual(seccionesAfectadas(c), ['precio', 'lotes']);
});

test('should_report_a_document_by_identity_not_position', () => {
  const reordenado = casoA((g) => {
    g.archivos[0]!.documentos.reverse();
  });
  const cambiado = casoA((g) => {
    g.archivos[0]!.documentos.reverse();
    g.archivos[0]!.documentos[2]!.obligatorio = true;
  });

  const igual = diferenciasGuion(casoA(), reordenado);
  const c = diferenciasGuion(casoA(), cambiado);

  assert.deepEqual(igual.documentos, []);
  assert.equal(igual.vacio, true);
  // El tercero tras invertir es el Anexo II (compromiso de UTE), que pasa a obligatorio.
  assert.deepEqual(c.documentos, [{ identidad: 'declaracion · Anexo II. Compromiso de UTE', cambio: 'cambiado' }]);
});

test('should_mark_sections_incompatible_when_one_is_added', () => {
  const otra = casoA((g) => {
    g.memoria.apartados.unshift({
      ...structuredClone(g.memoria.apartados[0]!),
      titulo: 'Conocimiento del sector público',
    });
  });

  const c = diferenciasGuion(casoA(), otra);

  // Añadir uno delante no mueve los demás.
  assert.deepEqual(c.apartados, [{ n: 1, titulo: 'Conocimiento del sector público', cambio: 'nuevo' }]);
  assert.equal(apartadosCompatibles(c), false);
});

test('should_compose_changes_across_three_versions', () => {
  // Arrange: v1 → v2 cambia los puntos del apartado 1 y añade un criterio; v2 → v3 quita ese
  // criterio, mueve el último apartado al principio y quita la memoria del límite.
  const v1 = casoA();
  const v2 = casoA((g) => {
    g.memoria.apartados[0]!.puntos = 9;
    g.automaticos.push({ ...structuredClone(g.automaticos[0]!), criterio: 'Mejora 4: informes mensuales' });
  });
  const v3 = casoA((g) => {
    g.memoria.apartados[0]!.puntos = 9;
    g.memoria.apartados.unshift(g.memoria.apartados.pop()!);
    g.memoria.limite_paginas = 30;
  });

  // Act
  const c = componer([diferenciasGuion(v1, v2), diferenciasGuion(v2, v3)]);

  // Assert: el criterio añadido y quitado no cuenta; lo demás, sí.
  assert.deepEqual(c.automaticos, []);
  // Los mismos cambios que comparar v1 con v3 directamente (n es la posición en la versión en que se vio).
  const pares = (x: typeof c) => x.apartados.map((a) => `${a.titulo}: ${a.cambio}`).sort();
  assert.deepEqual(pares(c), pares(diferenciasGuion(v1, v3)));
  assert.equal(c.apartados.find((a) => a.titulo === 'Organización y metodología del servicio')?.cambio, 'puntos');
  assert.equal(c.memoria.limite, true);
  assert.equal(apartadosCompatibles(c), false);
  assert.equal(componer([]).vacio, true);
});

test('should_store_the_changes_when_saving_a_new_guion', async () => {
  // Arrange
  const primero = await proponerGuion(
    db,
    GuionEntrada.parse({ id: ID, ...structuredClone(GUION_CASO_A) }),
    'licitaciones',
  );
  assert.equal(primero.error, null);

  // Act: la oferta económica cambia de fórmula.
  const segundo = await proponerGuion(
    db,
    GuionEntrada.parse(
      guionCon((g) => {
        g.oferta_economica.formula = 'P = 35 × (oferta más baja / oferta a valorar)';
      }),
    ),
    'licitaciones',
  );

  // Assert
  assert.equal(segundo.error, null);
  const g = guionVigente(db, ID)!;
  assert.deepEqual(g.cambios?.ofertas, [{ lotes: '', cambio: 'cambiado' }]);
  assert.equal(g.cambios?.vacio, false);
  assert.deepEqual(seccionesAfectadas(g.cambios!), ['precio']);
  assert.deepEqual(cambiosEntre(db, primero.data!.guion, segundo.data!.guion), componer([g.cambios!]));
  const evento = db
    .prepare("SELECT datos FROM eventos WHERE tipo = 'licitacion.guion' ORDER BY id DESC LIMIT 1")
    .get() as { datos: string };
  assert.equal(JSON.parse(evento.datos).cambios_vacio, false);
});

test('should_send_the_guion_changes_to_the_web_in_the_offer_state', () => {
  // Arrange: el guion vigente es el v2 del test anterior (cambió la fórmula del precio).

  // Act
  const r = estadoOferta(ID);

  // Assert: la web ya no dice «No se sabe qué cambió».
  assert.equal(r.error, null);
  assert.equal(r.data!.guion!.version > 1, true);
  assert.deepEqual(r.data!.guion!.cambios, guionVigente(db, ID)!.cambios);
  assert.deepEqual(r.data!.guion!.cambios?.ofertas, [{ lotes: '', cambio: 'cambiado' }]);
});

test('should_treat_unknown_changes_as_everything_changed', async () => {
  // Arrange: tres versiones; la del medio sin cambios guardados (de antes de la columna).
  const v1 = guionVigente(db, ID)!;
  const v2 = (await proponerGuion(db, GuionEntrada.parse({ id: ID, ...structuredClone(GUION_CASO_A) }), 'licitaciones'))
    .data!;
  const v3 = (await proponerGuion(db, GuionEntrada.parse({ id: ID, ...structuredClone(GUION_CASO_A) }), 'licitaciones'))
    .data!;
  db.prepare('UPDATE guiones SET cambios = NULL WHERE id = ?').run(v2.guion);
  db.prepare("UPDATE guiones SET cambios = '{roto' WHERE id = ?").run(v1.id);

  // Act + Assert
  assert.equal(guionPorId(db, v2.guion)!.cambios, null);
  assert.equal(guionPorId(db, v1.id)!.cambios, null);
  assert.equal(cambiosEntre(db, v1.id, v3.guion), null);
  assert.equal(cambiosEntre(db, v3.guion, v1.id), null);
  assert.equal(cambiosEntre(db, v1.id, 999_999), null);
  assert.equal(cambiosEntre(db, v2.guion, v3.guion)?.vacio, true);
});
