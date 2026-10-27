// Una memoria editada a mano en Word, vuelta a apartados por los títulos del guion: con sus
// tablas como tablas, sus listas como listas y sus imágenes, en el orden del documento.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { apartadosDeTexto, localizarTitulos } = await import('../../src/dominios/licitaciones/oferta/memoriaTexto.js');
type ElementoDocx = import('../../src/nucleo/documentos/leerDocx.js').ElementoDocx;

const TITULOS = ['Organización y metodología', 'Incidencias y control', 'Mejoras vinculadas'];
const p = (
  texto: string,
  extra: { lista?: boolean; titulo?: boolean; imagenes?: string[]; numerada?: boolean; marcado?: string } = {},
): ElementoDocx => ({
  tipo: 'parrafo',
  texto,
  marcado: texto,
  lista: false,
  numerada: false,
  titulo: false,
  imagenes: [],
  ...extra,
});
const tabla = (filas: string[][]): ElementoDocx => ({ tipo: 'tabla', filas });
const LARGO =
  'La empresa registrará cada incidencia el mismo día, con su prioridad y la persona responsable de resolverla.';

test('should_find_the_section_titles_in_the_body_and_not_in_the_index', () => {
  const es = [
    p('Memoria técnica'),
    p('Índice'),
    p('1. Organización y metodología'),
    p('2. Incidencias y control'),
    p('3. Mejoras vinculadas'),
    p('1. Organización y metodología'),
    p(LARGO),
    p('2. Incidencias y control'),
    p(LARGO),
    p('3. Mejoras vinculadas'),
    p(LARGO),
  ];
  assert.deepEqual(
    localizarTitulos(es, TITULOS),
    [5, 7, 9],
    'el índice sin páginas casa igual: gana la última secuencia completa',
  );
  assert.deepEqual(localizarTitulos([p('2. Incidencias y control'), p(LARGO)], TITULOS), [null, 0, null]);
});

test('should_keep_tables_as_tables_lists_as_lists_and_images_in_document_order', () => {
  const es = [
    p('Resumen ejecutivo', { titulo: true }),
    p(LARGO),
    p('1. ORGANIZACIÓN Y METODOLOGÍA'),
    p(LARGO),
    tabla([
      ['Paso', 'Entrada', 'Salida y control'],
      ['Demandante', 'Ficha y documentos', 'PPT editable'],
      ['Compras', 'Ficha revisada', 'Borradores'],
    ]),
    p(LARGO),
    p('1.1 Equipo y roles', { titulo: true }),
    p('Paco Ejemplo, responsable del proyecto y de la relación con Astilleros Ejemplo.', { lista: true }),
    p('Elisa Ejemplo, arquitectura Azure', { lista: true }),
    p('', { imagenes: ['rId7'] }),
    p('Figura 3. Pantalla de la ficha de entrada'),
    p('2. Incidencias y control'),
    p(`${LARGO} `.repeat(40)),
  ];
  const imagenes = new Map([
    ['rId7', { ruta: 'Salidas/Licitaciones/x/memoria-v10-imagenes/imagen-1.png', ancho: 3200, alto: 2000 }],
  ]);
  const r = apartadosDeTexto(es, TITULOS, imagenes);
  const a1 = r.datos[0]!;
  assert.equal(
    a1.titulo,
    'Organización y metodología',
    'el título es el literal del guion aunque el Word lo cambie de mayúsculas',
  );
  assert.deepEqual(
    a1.bloques.map((b) => [
      b.subtitulo ?? null,
      b.parrafos.length,
      b.lista?.length ?? 0,
      b.tabla ? b.tabla.cabecera.join('|') : null,
      b.imagen?.ruta.split('/').pop() ?? null,
    ]),
    [
      [null, 1, 0, 'Paso|Entrada|Salida y control', null],
      [null, 1, 0, null, null],
      ['Equipo y roles', 0, 2, null, 'imagen-1.png'],
      [null, 1, 0, null, null],
    ],
    'el párrafo de después de la tabla y el pie de después de la imagen abren bloque: nada cambia de orden',
  );
  assert.deepEqual(a1.bloques[0]!.tabla!.filas, [
    ['Demandante', 'Ficha y documentos', 'PPT editable'],
    ['Compras', 'Ficha revisada', 'Borradores'],
  ]);
  assert.equal(a1.bloques[2]!.imagen!.pie, 'Figura 3. Pantalla de la ficha de entrada');
  assert.ok(
    r.datos[1]!.bloques[0]!.parrafos.every((x) => x.length <= 3000),
    'un párrafo de más de 3.000 caracteres se parte',
  );
  assert.equal(r.datos[2], null);
  assert.deepEqual(r.avisos, [
    'El Word tiene contenido antes del apartado 1 («Resumen ejecutivo»): está en el Word subido, pero no pasa a las versiones que monte la plataforma.',
    'No encuentro en el Word el apartado 3 («Mejoras vinculadas»): queda sin texto y se rehará si pides cambios.',
  ]);
});

test('should_warn_about_an_empty_section', () => {
  const r = apartadosDeTexto(
    [p('1. Organización y metodología'), p('2. Incidencias y control'), p(LARGO)],
    TITULOS.slice(0, 2),
  );
  assert.equal(r.datos[0], null);
  assert.match(r.avisos[0]!, /El apartado 1 \(«Organización y metodología»\) está vacío en el Word\./);
});

// Si el cierre pasara al último apartado, la versión siguiente lo llevaría dos veces.
test('should_leave_the_place_date_and_signature_closing_out_of_the_last_section', () => {
  const es = [
    p('1. Organización y metodología'),
    p(LARGO),
    p('2. Incidencias y control'),
    p(LARGO),
    p('3. Mejoras vinculadas'),
    p(LARGO),
    p('En Santa Cruz de Tenerife, a 15 de octubre de 2026.'),
    p('Fdo.: Paco Ejemplo Gómez'),
    p('Administrador solidario de Analítica Ejemplo SL'),
  ];
  const r = apartadosDeTexto(es, TITULOS);
  assert.deepEqual(
    r.datos[2]?.bloques.map((b) => [b.parrafos, b.lista ?? []]),
    [[[LARGO], []]],
    'el último apartado acaba donde empieza el cierre',
  );
  assert.deepEqual(r.avisos, [
    'El cierre «En Santa Cruz de Tenerife, a 15 de octubre de 2026.» y lo que le sigue no pasan a las versiones que monte la plataforma: ella pone el lugar, la fecha y la firma si el pliego los pide.',
  ]);
  const enBlanco = apartadosDeTexto(
    [...es.slice(0, 6), p('En ____________________, a 14 de octubre de 2026.'), p('Fdo.: ____________________')],
    TITULOS,
  );
  assert.deepEqual(enBlanco.datos[2]?.bloques[0]?.parrafos, [LARGO], 'también con el lugar en blanco');
  const enUnParrafo = apartadosDeTexto(
    [
      ...es.slice(0, 5),
      p('En Madrid, a 3 de marzo de 2026, la empresa entregó el primer informe con todos los indicadores acordados.'),
    ],
    TITULOS,
  );
  assert.equal(
    enUnParrafo.datos[2]?.bloques[0]?.parrafos.length,
    1,
    'una frase del texto que empieza igual no es el cierre',
  );
  assert.deepEqual(enUnParrafo.avisos, []);
});

test('should_bring_a_numbered_list_and_bold_text_back_into_the_section', () => {
  const es = [
    p('1. Organización y metodología'),
    p(LARGO, { marcado: LARGO.replace('el mismo día', '**el mismo día**') }),
    p('Arranque y acta de inicio', { lista: true, numerada: true }),
    p('Primer informe mensual', { lista: true, numerada: true }),
    p('2. Incidencias y control'),
    p(LARGO),
  ];
  const a1 = apartadosDeTexto(es, TITULOS).datos[0]!;
  assert.deepEqual(
    a1.bloques.map((b) => [b.parrafos, b.lista ?? null, b.lista_numerada ?? null]),
    [
      [
        [LARGO.replace('el mismo día', '**el mismo día**')],
        null,
        ['Arranque y acta de inicio', 'Primer informe mensual'],
      ],
    ],
  );
});
