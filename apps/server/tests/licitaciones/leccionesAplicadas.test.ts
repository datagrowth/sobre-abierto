// Aplicar y medir las lecciones sobre el caso A: cuáles se pasan al redactar por tema, alcance
// y órgano; dónde quedan apuntadas; qué dice el crítico; y la regla «lección no aplicada».
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, cerrar, db, ID, sinMemorias } from '../helpers/memoriaEntorno.js';
import { APARTADOS } from './fixtures/casoA.js';

const { aplicacionesDe, apuntarAplicadas, leccionesNoAplicadas, leccionesParaRedactar, marcarCumplidas } =
  await import('../../src/dominios/licitaciones/oferta/leccionesAplicadas.js');
const { insertarLecciones } = await import('../../src/dominios/licitaciones/oferta/libroLecciones.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { instruccionesCritica } = await import('../../src/dominios/licitaciones/oferta/critica.js');
const { reglaLeccionesNoAplicadas } =
  await import('../../src/dominios/licitaciones/oferta/comprobacionesReglasLecciones.js');

before(arrancar);
after(cerrar);

const ORGANO_A = 'Sociedad Insular de Inclusión de Ejemplo, S.L. (SIIE)';
const OTRA = 'p-otra-oferta';
const evidencia = (licitacion_id: string) => ({
  licitacion_id,
  memoria_id: null,
  documento: 'x.docx',
  ubicacion: null,
  texto: '',
});

function leccion(
  texto: string,
  x: Partial<{
    alcance: 'general' | 'organo' | 'cpv';
    alcance_valor: string;
    tema: 'metodologia' | 'planificacion' | null;
    origen: 'edicion' | 'mesa' | 'precio';
    evidencias: string[];
  }> = {},
): number {
  insertarLecciones(db, [
    {
      licitacion_id: OTRA,
      origen: x.origen ?? 'edicion',
      alcance: x.alcance ?? 'general',
      alcance_valor: x.alcance_valor ?? null,
      tema: x.tema === undefined ? 'metodologia' : x.tema,
      texto,
      evidencias: (x.evidencias ?? [OTRA]).map(evidencia),
      agente: 'licitaciones',
    },
  ]);
  const id = (db.prepare('SELECT MAX(id) AS id FROM lecciones').get() as { id: number }).id;
  db.prepare("UPDATE lecciones SET estado = 'aceptada' WHERE id = ?").run(id);
  return id;
}

function memoria(): { id: number; version: number } {
  const g = guionVigente(db, ID)!;
  const id = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, 1, 'redactando', 'x', 'critica', 0)",
      )
      .run(ID, g.id).lastInsertRowid,
  );
  return { id, version: 1 };
}

const limpiar = () => {
  sinMemorias();
  db.exec('DELETE FROM lecciones; DELETE FROM lecciones_aplicaciones;');
};
const q = { licitacion_id: ID, apartado: 1, titulo: APARTADOS[0]!.titulo, se_valorara: APARTADOS[0]!.se_valorara };

test('should_pick_lessons_by_theme_scope_and_body_and_leave_out_price_ones', () => {
  // Arrange
  limpiar();
  const delTema = leccion('Describe el ciclo de cada consulta con sus pasos y su responsable.');
  const delOrgano = leccion('Cita la normativa interna del cliente en cada procedimiento.', {
    alcance: 'organo',
    alcance_valor: ORGANO_A,
    tema: null,
  });
  leccion('Cita la normativa del cabildo.', {
    alcance: 'organo',
    alcance_valor: 'Cabildo de Isla Ejemplo',
    tema: null,
  });
  leccion('Pon el cronograma en semanas con hitos.', { tema: 'planificacion' });
  leccion('Baja un 8 % en este CPV.', { origen: 'precio', tema: null });
  const fuerte = leccion('Pon un indicador con meta por cada compromiso del servicio.', {
    evidencias: [OTRA, 'p-tercera'],
  });

  // Act
  const elegidas = leccionesParaRedactar(db, q).map((l) => l.id);

  // Assert
  assert.deepEqual(
    elegidas,
    [fuerte, delTema, delOrgano],
    'del tema primero (la de dos ofertas antes), luego la del mismo órgano; ni otro órgano, ni otro tema, ni precio',
  );
});

test('should_record_where_each_lesson_was_passed_once_and_what_the_critic_said', () => {
  limpiar();
  const l = leccion('Describe el ciclo de cada consulta con sus pasos y su responsable.');
  const m = memoria();
  apuntarAplicadas(db, m, 1, [l]);
  apuntarAplicadas(db, m, 1, [l]);
  assert.deepEqual(
    aplicacionesDe(db, m.id).map((a) => [a.leccion_id, a.apartado, a.cumplida]),
    [[l, 1, null]],
    'repetir el run no duplica',
  );
  const inst = instruccionesCritica(db, {
    id: ID,
    memoria_id: m.id,
    version: 1,
    ronda: 0,
    pedida_en: 'x',
    independiente: true,
  });
  assert.ok(
    inst.includes(`Después de puntuar, y sin cambiar ningún tramo`) &&
      inst.includes(`- L${l} (apartado 1): Describe el ciclo`),
    'el crítico comprueba la lección después de puntuar',
  );
  assert.equal(
    marcarCumplidas(db, m.id, [
      { leccion: l, apartado: 1, cumple: true, nota: 'Lo describe en una tabla.' },
      { leccion: l, apartado: 3, cumple: false, nota: 'No se pasó aquí.' },
    ]),
    1,
  );
  assert.deepEqual(
    aplicacionesDe(db, m.id).map((a) => [a.cumplida, a.nota]),
    [[true, 'Lo describe en una tabla.']],
  );
});

test('should_flag_a_strong_lesson_not_passed_or_not_fulfilled_as_a_risk_in_the_review', () => {
  // Arrange
  limpiar();
  const m = memoria();
  const fuerte = leccion('Pon un indicador con meta por cada compromiso del servicio.', {
    evidencias: [OTRA, 'p-tercera'],
  });
  leccion('Una lección de una sola oferta.');
  leccion('Pon el cronograma en semanas con hitos.', { tema: 'planificacion', evidencias: [OTRA, 'p-tercera'] });

  // Act + Assert
  assert.deepEqual(
    leccionesNoAplicadas(db, m.id).map((x) => [x.leccion_id, x.motivo]),
    [[fuerte, 'no_pasada']],
    'solo la de fuerza alta y de un tema que la memoria tiene',
  );
  apuntarAplicadas(db, m, 1, [fuerte]);
  assert.deepEqual(leccionesNoAplicadas(db, m.id), []);
  marcarCumplidas(db, m.id, [{ leccion: fuerte, apartado: 1, cumple: false, nota: 'No hay metas.' }]);
  const [x] = leccionesNoAplicadas(db, m.id);
  assert.deepEqual([x!.motivo, x!.apartados], ['no_cumplida', [1]]);
  const [fila] = reglaLeccionesNoAplicadas({
    lecciones_no_aplicadas: [{ lote: null, version: 1, lecciones: [x!] }],
  } as never);
  assert.deepEqual(
    [fila!.clave, fila!.gravedad, fila!.accion.tipo, fila!.categoria],
    [`memoria_leccion:-:${fuerte}`, 'riesgo', 'aceptar_riesgo', 'coherencia'],
  );
  assert.match(fila!.titulo, /^El crítico no ve cumplida en el apartado 1 de la v1 la lección «Pon un indicador/);
});

// Una lección queda aplicada cuando llega la redacción, no al montar el dossier.
test('should_record_an_applied_lesson_when_the_section_arrives_not_when_the_dossier_is_built', async () => {
  // Arrange
  limpiar();
  const { nucleo } = await import('../helpers/memoriaEntorno.js');
  const { apartadoCasoA } = await import('./fixtures/casoA.js');
  const { recibirApartado, ApartadoEntrada } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
  const { componerDossier } = await import('../../src/dominios/licitaciones/oferta/dossier.js');
  const l = leccion('Describe el ciclo de cada consulta con sus pasos y su responsable.');
  const g = guionVigente(db, ID)!;
  const memoria = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, 1, 'redactando', 'x', 'redaccion', 0)",
      )
      .run(ID, g.id).lastInsertRowid,
  );
  db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, 1, 'pendiente')").run(memoria);

  // Act
  const dossier = await componerDossier(db, nucleo().db, memoria);
  const antes = aplicacionesDe(db, memoria).length;
  const r = recibirApartado(
    db,
    ApartadoEntrada.parse(apartadoCasoA(1, { memoria_id: memoria, guion_id: g.id, version: 1 })),
    'oferta-licitaciones',
  );

  // Assert
  assert.equal(dossier.error, null, dossier.error?.message);
  assert.match(
    dossier.data!.secciones.find((x) => x.clave === 'lecciones')!.texto,
    /Describe el ciclo de cada consulta/,
    'la lección va al dossier',
  );
  assert.equal(antes, 0, 'montar el dossier no la apunta');
  assert.equal(r.error, null);
  assert.deepEqual(
    aplicacionesDe(db, memoria).map((a) => [a.leccion_id, a.apartado]),
    [[l, 1]],
    'con el apartado recibido, sí',
  );
});
