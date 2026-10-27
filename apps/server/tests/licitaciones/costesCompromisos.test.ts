// Compromisos con coste: el catálogo de 9 tipos, cómo se agrupan, si los exige el pliego
// y el contrato con la memoria técnica (compromisosMemoriaCoste.ts). Datos sintéticos: la memoria de
// Villaejemplo se mide aparte (costesCasoC.test.ts). Todo es puro: sin base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perfilCostesPorDefecto } from '../../src/nucleo/perfilCostes.js';
import { cifrasDeCoste } from '../../src/dominios/licitaciones/oferta/costesCatalogo.js';
import {
  compromisosConCoste,
  compromisosDetallados,
  type GuionData,
} from '../../src/dominios/licitaciones/oferta/costesCompromisos.js';
import { lineasParaCostes, textoParaCostes } from '../../src/dominios/licitaciones/oferta/costesTexto.js';
import {
  chequeosConCoste,
  type ProveedorCompromisosCoste,
} from '../../src/dominios/licitaciones/oferta/compromisosMemoriaCoste.js';
import type { Pasaje } from '../../src/dominios/licitaciones/pasajes.js';

const perfil = perfilCostesPorDefecto();

type Curso = { nombre: string; personas: number; horas?: number; semanas?: number; grupos?: number };
// Solo lo que leen los costes: alcance, lotes y los «se valorará» de la memoria.
function guion(cursos: Curso[], extra: { lotes?: string[]; se_valorara?: string[] } = {}): GuionData {
  const alcance = cursos.map((c) => ({
    nombre: c.nombre,
    personas_minimas: c.personas,
    horas: c.horas ?? 40,
    grupos: c.grupos ?? 1,
    semanas: c.semanas ?? null,
    lotes: extra.lotes,
    documento: 'PPT.pdf',
    pagina: 13,
  }));
  const memoria = { apartados: [{ titulo: 'Mejoras', puntos: 10, se_valorara: extra.se_valorara ?? [] }] };
  return { alcance, memoria, ...(extra.lotes ? { lotes: extra.lotes } : {}) } as unknown as GuionData;
}
const UN_CURSO = guion([{ nombre: 'Topografía y cartografía digital', personas: 100, semanas: 5 }]);
const pasaje = (texto: string, pagina = 3): Pasaje => ({
  ruta: 'Licitaciones/Radar/2026/sintetico/PPT.pdf',
  clase: 'ppt',
  pagina,
  texto,
});

test('should_return_empty_when_text_is_empty_or_has_no_quantities', () => {
  // Arrange
  const textos = ['', '   \n  ', 'La empresa trabaja con rigor, cercanía y compromiso con cada proyecto.'];
  // Act
  const resultados = textos.map((t) => compromisosConCoste(t, perfil, UN_CURSO, [pasaje('Objeto del contrato.')]));
  // Assert
  assert.deepEqual(resultados, [[], [], []]);
});

test('should_detect_each_catalog_type_with_one_synthetic_sentence', () => {
  // Arrange
  const frases: [string, string][] = [
    ['material_fisico', 'La empresa envía a cada alumna un kit con termómetro y guantes.'],
    ['dedicacion_fija', '| Tarea | Dedicación semanal |\n|---|---|\n| Corrección de tareas | 2 h por subgrupo |'],
    ['plazo_corto', 'La tutora corrige cada tarea en 2 días hábiles con un comentario de tres puntos.'],
    ['sesion_recurrente', 'Una consulta de mañana cada semana lectiva, de 10:00 a 10:30.'],
    ['sesion_individual', 'La coordinación invita a cada alumna apta a una entrevista individual de 30 minutos.'],
    ['cantidad_minima', 'La coordinación contactará con al menos 20 empleadores por curso.'],
    ['frecuencia_alta', 'Cada semana, la coordinación cruza las ofertas con las candidaturas de la bolsa.'],
    ['grupo_extra', 'El curso de topografía se imparte en dos grupos.'],
    ['horas_extra', 'En cada curso se imparte un taller de 10 horas lectivas adicionales.'],
  ];
  // Act
  const tipos = frases.map(([, f]) => compromisosDetallados(f, perfil, UN_CURSO).map((c) => c.tipo));
  // Assert
  assert.deepEqual(
    tipos,
    frases.map(([t]) => [t]),
  );
  const [entrevista] = compromisosDetallados(frases[4]![1], perfil, UN_CURSO);
  assert.equal(entrevista!.horas, 50, '100 alumnas × 0,75 aptas × (30 + 10) min');
  assert.match(entrevista!.barata, /a petición/i);
});

test('should_sum_rows_of_the_same_weekly_dedication_table', () => {
  // Arrange
  const md = [
    '#### Dedicación de la tutorización docente',
    '',
    '| Tarea | Dedicación semanal | Base del cálculo |',
    '|---|---|---|',
    '| Corrección y retroalimentación | 2 h 30 min por subgrupo | 12 minutos por entrega |',
    '| Dinamización del debate | 30 min por subgrupo | Lectura de aportaciones |',
    '| Seguimiento de inactividad | 30 min por subgrupo | Avisos |',
  ].join('\n');
  const g = guion([{ nombre: 'Topografía y cartografía digital', personas: 22, semanas: 4 }]);
  // Act
  const cs = compromisosDetallados(md, perfil, g);
  // Assert
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.tipo, 'dedicacion_fija');
  assert.match(cs[0]!.texto, /3,5 h por subgrupo/);
  assert.equal(cs[0]!.horas, 28, '3,5 h × 2 subgrupos de 11 × 4 semanas');
  assert.equal(cs[0]!.cita, '2 h 30 min por subgrupo');
  assert.deepEqual(
    cs[0]!.apariciones.map((a) => a.cita),
    ['2 h 30 min por subgrupo', '30 min por subgrupo'],
    'la misma cita en dos filas se sustituye una vez',
  );
  assert.match(cs[0]!.barata, /quita la tabla/);
});

test('should_collapse_duplicates_across_summary_table_and_body', () => {
  // Arrange
  const md = [
    '## 3. Mejoras',
    '',
    '| Criterio | Qué ofrecemos |',
    '|---|---|',
    '| Formación complementaria | Un taller de 10 horas por curso, con práctica final |',
    '',
    'La empresa impartirá en cada curso un taller complementario de **10 horas lectivas adicionales** del sector.',
  ].join('\n');
  // Act
  const cs = compromisosDetallados(md, perfil, UN_CURSO);
  // Assert
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.tipo, 'horas_extra');
  assert.deepEqual(
    cs[0]!.apariciones.map((a) => a.apartado),
    [3, 3],
  );
  assert.equal(cs[0]!.horas, 25, '10 h × 1 curso × (1 + 1,5 h de preparación)');
  assert.match(cs[0]!.barata, /6 h asíncronas/);
  assert.match(
    cs[0]!.instruccion,
    /^En el apartado 3, sustituye «Un taller de 10 horas por curso, con práctica final» por: 6 h asíncronas/,
  );
});

test('should_prefer_the_per_course_detection_on_a_magnitude_tie', () => {
  // Arrange: el mismo taller de 10 h, primero sin decir «por curso» y luego diciéndolo, con dos cursos.
  const dos = guion([
    { nombre: 'Topografía y cartografía digital', personas: 50, semanas: 5 },
    { nombre: 'Jardinería y arbolado', personas: 50, semanas: 5 },
  ]);
  const md = [
    '## 3. Mejoras',
    '',
    'La empresa impartirá un taller complementario de 10 horas lectivas adicionales.',
    'Además, un taller complementario de 10 horas lectivas adicionales por curso.',
  ].join('\n');
  // Act
  const cs = compromisosDetallados(md, perfil, dos).filter((c) => c.tipo === 'horas_extra');
  // Assert
  assert.equal(cs.length, 1);
  assert.match(cs[0]!.texto, /por curso/, 'la que dice «por curso» representa al grupo');
  assert.equal(cs[0]!.horas, 50, '10 h × 2 cursos × (1 + 1,5 h de preparación)');
});

test('should_name_dotted_section_numbers_in_the_soften_instruction', () => {
  // Arrange: como en Villaejemplo, el apartado 2 del guion se titula «1.2» en la memoria.
  const md = [
    '## 2. Seguimiento',
    '',
    '## 1.2 Seguimiento de las alumnas',
    '',
    'La empresa impartirá en cada curso un taller complementario de 10 horas lectivas adicionales.',
  ].join('\n');
  // Act
  const cs = compromisosDetallados(md, perfil, UN_CURSO);
  const lineas = lineasParaCostes(
    ['## 1.2. Otra', 'x', '## 3. Mejoras', 'y', '## 3.1 Sub', 'w', '## 12 Sin punto', 'z'].join('\n'),
  );
  // Assert
  assert.equal(cs.length, 1);
  assert.deepEqual(
    cs[0]!.apariciones.map((a) => [a.apartado, a.seccion]),
    [[2, '1.2']],
    'el apartado del guion no cambia; la memoria lo llama 1.2',
  );
  assert.match(cs[0]!.instruccion, /^En el apartado 1\.2, sustituye «/);
  assert.deepEqual(
    lineas.map((l) => [l.apartado, l.seccion]),
    [
      [null, '1.2'],
      [3, null],
      [3, '3.1'],
      [3, null],
    ],
    '«## 12 Sin punto» no abre apartado y cierra la sección',
  );
});

test('should_not_cost_on_request_services', () => {
  // Arrange
  const md = [
    'Entrevista individual de 30 minutos con cada alumna, a petición de la alumna.',
    'La alumna puede pedir una llamada de seguimiento con su tutora en cualquier momento.',
    'Revisión de CV bajo demanda, si la alumna lo solicita.',
  ].join('\n');
  // Act
  const cs = compromisosConCoste(md, perfil, UN_CURSO);
  // Assert
  assert.deepEqual(cs, []);
});

const ENTREVISTA = 'La coordinación hace una entrevista individual de 30 minutos con cada alumna.';

test('should_mark_exigido_when_pliego_fixes_same_or_higher_magnitude', () => {
  // Arrange
  const pliegos = [
    [pasaje('La adjudicataria realizará una entrevista individual de 30 minutos con cada alumna.')],
    [pasaje('La adjudicataria realizará una entrevista individual de 45 minutos con cada alumna.', 6)],
  ];
  // Act
  const cs = pliegos.map((p) => compromisosDetallados(ENTREVISTA, perfil, UN_CURSO, p)[0]!);
  // Assert
  assert.deepEqual(
    cs.map((c) => c.clase),
    ['exigido', 'exigido'],
  );
  assert.deepEqual(
    cs.map((c) => c.criterio),
    [null, null],
  );
  assert.match(cs[1]!.pliego!.cita, /45 minutos/);
  assert.deepEqual([cs[1]!.pliego!.documento, cs[1]!.pliego!.pagina], ['PPT', 6]);
  assert.match(cs[1]!.supuesto, /El pliego pide 45 min/);
});

test('should_mark_anadido_with_delta_when_memoria_exceeds_pliego', () => {
  // Arrange
  const p = [pasaje('La adjudicataria realizará una entrevista individual de 15 minutos con cada alumna.')];
  const g = guion([{ nombre: 'Topografía y cartografía digital', personas: 100 }], {
    se_valorara: ['Las acciones de orientación individual y entrevista con cada alumna'],
  });
  // Act
  const [c] = compromisosDetallados(ENTREVISTA, perfil, g, p);
  // Assert
  assert.equal(c!.clase, 'anadido');
  assert.match(c!.supuesto, /El pliego pide 15 min; la memoria, 30 min/);
  assert.equal(c!.criterio, 'Las acciones de orientación individual y entrevista con cada alumna');
  assert.match(c!.pliego!.cita, /15 minutos/);
});

test('should_treat_minimal_concretion_of_unquantified_obligation_as_exigido', () => {
  // Arrange
  const p = [
    pasaje(
      'La tutorización docente comprende la resolución de dudas de las alumnas en las tutorías que se establezcan.',
    ),
  ];
  // Act
  const minima = compromisosDetallados(
    'Una tutoría en directo de 1 hora cada semana lectiva.',
    perfil,
    UN_CURSO,
    p,
  )[0]!;
  const mayor = compromisosDetallados(
    'Una tutoría en directo de 2 horas cada semana lectiva.',
    perfil,
    UN_CURSO,
    p,
  )[0]!;
  // Assert
  assert.equal(minima.clase, 'exigido');
  assert.match(minima.supuesto, /se concreta en lo mínimo \(1 sesión semanal de 1 h\)/);
  assert.equal(mayor.clase, 'anadido');
  assert.match(mayor.supuesto, /lo mínimo es 1 sesión semanal de 1 h\); la memoria, 2 h por semana/);
  assert.match(mayor.pliego!.cita, /tutorías que se establezcan/);
});

test('should_ignore_pliego_passages_of_other_lots', () => {
  // Arrange
  const md = 'La empresa envía a cada alumna un kit de material con termómetro y guantes.';
  const p = [
    pasaje('4.A) Medios para los LOTES 1 y 2. La adjudicataria enviará a cada alumna un kit de material con guantes.'),
  ];
  const lote3 = guion([{ nombre: 'Topografía y cartografía digital', personas: 100 }], { lotes: ['3'] });
  const sinLotes = guion([{ nombre: 'Topografía y cartografía digital', personas: 100 }]);
  // Act
  const [delLote3] = compromisosDetallados(md, perfil, lote3, p);
  const [sinFiltro] = compromisosDetallados(md, perfil, sinLotes, p);
  // Assert
  assert.equal(delLote3!.clase, 'anadido');
  assert.equal(delLote3!.pliego, null);
  assert.equal(sinFiltro!.clase, 'exigido');
});

test('should_say_sin_cotejar_when_no_pliego', () => {
  // Arrange
  const md = 'Guardia de entregas el domingo, de 19:00 a 21:00, para las incidencias que impiden entregar.';
  // Act
  const sinPliego = compromisosDetallados(md, perfil, UN_CURSO);
  const vacio = compromisosDetallados(md, perfil, UN_CURSO, []);
  // Assert
  for (const [c] of [sinPliego, vacio]) {
    assert.equal(c!.clase, 'anadido');
    assert.match(c!.supuesto, /Sin cotejar con el pliego/);
    assert.equal(c!.horas, 10, '2 h × 5 semanas de aula');
  }
});

test('should_parse_2h30min_ge20_dos_grupos_and_thousands', () => {
  // Arrange
  const textos = [
    '2 h 30 min por subgrupo',
    '≥ 20 empleadores',
    'al menos veinte empleadores',
    'en dos grupos',
    '1.000 alumnas',
    'media hora',
  ];
  // Act
  const cifras = textos.map((t) => cifrasDeCoste(t)[0]);
  // Assert
  assert.deepEqual(cifras, [
    { valor: 2.5, unidad: 'h', minimo: false },
    { valor: 20, unidad: 'empleador', minimo: true },
    { valor: 20, unidad: 'empleador', minimo: true },
    { valor: 2, unidad: 'grupo', minimo: false },
    { valor: 1000, unidad: 'alumna', minimo: false },
    { valor: 0.5, unidad: 'h', minimo: false },
  ]);
});

test('should_return_exact_contract_shape_from_compromisosConCoste', () => {
  // Arrange
  const md = [
    '## 2. Metodología',
    '',
    'La empresa envía a cada alumna el material necesario:',
    '',
    '- **Topografía:** cinta métrica y guantes de jardinería.',
    '- **Limpieza:** bayetas de microfibra y guantes de nitrilo.',
    '',
    '## 3. Transferencia al puesto',
    '',
    'La coordinación invita a cada alumna apta a una entrevista individual de orientación de 30 minutos.',
  ].join('\n');
  const g = guion([
    { nombre: 'Comunicación institucional y redes sociales', personas: 40 },
    { nombre: 'Topografía y cartografía digital', personas: 69 },
    { nombre: 'Jardinería y arbolado urbano, mantenimiento de zonas verdes', personas: 120 },
  ]);
  const proveedor: ProveedorCompromisosCoste = (t) => compromisosConCoste(t, perfil, g);
  // Act
  const cs = proveedor(md);
  const chequeos = chequeosConCoste(md, proveedor).filter((c) => c.tipo === 'coste');
  // Assert
  for (const c of cs)
    assert.deepEqual(Object.keys(c).sort(), ['cita', 'clase', 'criterio', 'euros', 'horas', 'supuesto', 'texto']);
  const kits = cs.find((c) => /material/i.test(c.texto))!;
  assert.equal(kits.euros, 4730);
  assert.equal(kits.horas, null);
  assert.match(kits.supuesto, /^189 alumnas \(PPT pág\. 13: topografia 69 \+ jardineria 120\) × \(18 \+ 7\)/);
  assert.equal(kits.cita, 'La empresa envía a cada alumna el material necesario:');
  assert.equal(chequeos.length, 1, 'solo la entrevista pasa de 40 h; los kits no cuestan horas');
  assert.equal(chequeos[0]!.apartado, 3);
  assert.doesNotMatch(chequeos[0]!.texto, /€|euros/);
});

test('should_render_saved_apartado_tables_and_subtitles_for_costs', () => {
  // Arrange
  const apartado = {
    titulo: 'Plan de atención',
    bloques: [
      {
        subtitulo: 'Dedicación semanal',
        parrafos: ['La coordinación fija la dedicación de cada aula antes de abrirla, a partir de los subgrupos.'],
        tabla: { cabecera: ['Tarea', 'Dedicación'], filas: [['Corrección', '2 h por subgrupo']] },
      },
    ],
  };
  // Act
  const md = textoParaCostes(apartado, 1);
  const filas = lineasParaCostes(md).filter((l) => l.celdas);
  // Assert
  assert.match(md, /^## 1\. Plan de atención\n/);
  assert.deepEqual(
    filas.map((l) => [l.apartado, l.titulo, l.cabecera, l.celdas]),
    [[1, 'Dedicación semanal', ['Tarea', 'Dedicación'], ['Corrección', '2 h por subgrupo']]],
  );
});

test('should_not_import_io_modules_from_costes_core', () => {
  // Arrange
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/dominios/licitaciones/oferta');
  const archivos = ['costesCompromisos.ts', 'costesCatalogo.ts', 'costesDimensiones.ts', 'costesTexto.ts'];
  // Act
  const valores = archivos.flatMap((a) =>
    [...fs.readFileSync(path.join(dir, a), 'utf8').matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)].map(
      (m) => m[1]!,
    ),
  );
  // Assert
  assert.deepEqual(
    valores.filter((v) => /nucleo|vault|store|db|pasajes|node:/.test(v)),
    [],
  );
});

test('should_say_pliego_does_not_ask_when_cotejable_without_obligation_passages', () => {
  // Arrange: pliego legible e indexado, pero ningún trozo con obligaciones.
  const md =
    '## 2. Orientación\n\nLa coordinación invita a cada alumna apta a una entrevista individual de 30 minutos.';
  // Act
  const [legible] = compromisosDetallados(md, perfil, UN_CURSO, { pasajes: [], cotejable: true });
  const [ilegible] = compromisosDetallados(md, perfil, UN_CURSO, { pasajes: [], cotejable: false });
  // Assert
  assert.match(legible!.supuesto, /El pliego no lo pide\.$/);
  assert.match(ilegible!.supuesto, /Sin cotejar con el pliego\.$/);
});

test('should_take_people_from_the_memoria_when_there_is_no_scope_nor_pliego', () => {
  // Arrange: lo que tiene el crítico, solo el texto (la cifra mayor es el total; la del subgrupo, menor).
  const md =
    '## 1. Metodología\n\nEl curso atiende a 150 alumnas en subgrupos de 12 alumnas.\n\n## 2. Orientación\n\nLa coordinación hace una entrevista individual de 30 minutos con cada alumna.';
  // Act
  const [entrevista] = compromisosDetallados(md, perfil);
  // Assert
  assert.equal(entrevista!.horas, 100, '150 alumnas × (30 + 10) min');
  assert.match(entrevista!.supuesto, /^150 alumnas \(memoria\)/);
});
