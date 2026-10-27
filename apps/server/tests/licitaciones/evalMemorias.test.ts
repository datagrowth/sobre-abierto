// Memoria técnica, paso 8: el banco de pruebas de memorias. Con los juicios del caso casoG (memorias
// sintéticas; dos órdenes × dos jueces), la memoria fuerte gana a la floja; si cada orden prefiere el
// documento que va primero es sesgo de posición; los juicios se revisan por código y el script
// encola los dos órdenes con el mismo lote sin llamar a Hermes.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arrancar, cerrar, conectar, db, nucleo, T_CRITICO, texto } from '../helpers/memoriaEntorno.js';

const {
  anonimizar,
  avisosDeFiguras,
  cargarCaso,
  contradiceEsperado,
  encolarJuicios,
  guardarJuicio,
  informeDeJuicios,
  instruccionesJuicio,
  JuicioEntrada,
  juicioRecibido,
  juiciosDeLote,
  normalizarMemoria,
  PayloadJuicio,
  Rubrica,
  TIPO_EVAL_JUICIO,
  veredictoPorPares,
} = await import('../../src/dominios/licitaciones/oferta/evalMemorias.js');
const { memoriaAMarkdown } = await import('../../src/nucleo/documentos/docx.js');
const { TROZO_PAQUETE } = await import('../../src/dominios/licitaciones/oferta/critica.js');
type Memoria = import('../../src/nucleo/documentos/docx.js').Memoria;

before(arrancar);
after(cerrar);

const DIR = path.join(import.meta.dirname, 'fixtures', 'eval', 'casoG');
type JuicioFixture = {
  doc_1: string;
  doc_2: string;
  total_1: number;
  total_2: number;
  por_criterio: { preferido: string; puntos_1: number; puntos_2: number }[];
};
const JUICIOS = JSON.parse(fs.readFileSync(path.join(DIR, 'juicios.json'), 'utf8')) as JuicioFixture[];
const ID: Record<string, number> = { memoria_fuerte: 1, memoria_floja: 2 };

test('should_prefer_the_stronger_memoria_when_both_orders_agree', () => {
  const v = veredictoPorPares(
    JUICIOS.map((j) => ({ doc_1: ID[j.doc_1]!, doc_2: ID[j.doc_2]!, total_1: j.total_1, total_2: j.total_2 })),
  );
  assert.deepEqual(
    v,
    { preferido: 1, medias: { 1: 21.63, 2: 15 }, sesgo_posicion: false, juicios: 4, alerta: null },
    '21,6 frente a 15 sobre 25',
  );
  assert.equal(
    contradiceEsperado(v, { 1: 'memoria_fuerte', 2: 'memoria_floja' }, { preferido: 'memoria_fuerte' }),
    false,
  );
  assert.equal(
    contradiceEsperado(v, { 1: 'memoria_floja', 2: 'memoria_fuerte' }, { preferido: 'memoria_fuerte' }),
    true,
  );
});

test('should_report_position_bias_when_each_order_prefers_first_document', () => {
  const v = veredictoPorPares([
    { doc_1: 1, doc_2: 2, total_1: 20, total_2: 15 },
    { doc_1: 2, doc_2: 1, total_1: 21, total_2: 16 },
  ]);
  assert.deepEqual([v.preferido, v.sesgo_posicion], [null, true]);
  assert.match(v.alerta ?? '', /sesgo de posición/);
  assert.equal(
    contradiceEsperado(v, { 1: 'memoria_fuerte', 2: 'memoria_floja' }, { preferido: 'memoria_fuerte' }),
    true,
    'un empate por sesgo no pasa la puerta',
  );
});

test('should_anonymize_person_names_and_keep_roles', () => {
  const t =
    'María José Ejemplo Vega, docente principal, y Antonio Ejemplo (analista). María José revisará; Paco coordinará. NIF B00123455. Ejemplo Vega firma. La marea sube.';
  assert.equal(
    anonimizar(t, ['María José Ejemplo Vega', 'Antonio Ejemplo Moral', 'Paco Ejemplo Gómez']),
    'Persona A, docente principal, y Persona B (analista). Persona A revisará; Persona C coordinará. NIF [NIF]. Persona A firma. La marea sube.',
  );
  const memoriaFloja = fs.readFileSync(path.join(DIR, 'memoria_floja.md'), 'utf8');
  assert.ok(memoriaFloja.includes('Persona C, responsable de proyecto'), 'los roles se quedan');
  assert.doesNotMatch(memoriaFloja, /\b[A-HJ-NP-SUVW]\d{7}[0-9A-J]\b/, 'sin el NIF de la licitadora');
});

test('should_reject_judgment_whose_totals_do_not_add_up', () => {
  const caso = cargarCaso(db, 'casoG', DIR).data!;
  assert.deepEqual(Object.keys(caso.documentos).sort(), ['memoria_floja', 'memoria_fuerte']);
  assert.equal(cargarCaso(db, 'casoG', DIR).data!.caso, caso.caso, 'idempotente por clave');
  const memoriaFuerte = fs.readFileSync(path.join(DIR, 'memoria_fuerte.md'), 'utf8');
  const cita = memoriaFuerte
    .split('\n')
    .find((l) => l.startsWith('La unidad de trabajo de CAUCE'))!
    .slice(0, 120);
  const rubrica = Rubrica.parse(JSON.parse(fs.readFileSync(path.join(DIR, 'rubrica.json'), 'utf8')));
  const juicio = (cambios: Partial<Record<string, unknown>> = {}) =>
    JuicioEntrada.parse({
      caso: 'casoG',
      lote: 'prueba',
      doc_1: caso.documentos['memoria_fuerte'],
      doc_2: caso.documentos['memoria_floja'],
      por_criterio: rubrica.criterios.map((c) => ({
        criterio: c.titulo,
        preferido: '1',
        margen: 2,
        puntos_1: c.puntos,
        puntos_2: c.puntos / 2,
        razon: 'El documento 1 concreta el alcance para el Ayuntamiento de Villaejemplo.',
        cita,
      })),
      total_1: 25,
      total_2: 12.5,
      maximo: 25,
      preferido_global: '1',
      que_marca_la_diferencia: ['Especificidad para el cliente.'],
      ...cambios,
    });
  assert.match(
    guardarJuicio(db, juicio({ total_1: 24 }), 'critico-licitaciones').error?.message ?? '',
    /total_1 \(24\) debe ser la suma de puntos_1 \(25\)\./,
  );
  assert.match(
    guardarJuicio(db, juicio({ maximo: 30 }), 'critico-licitaciones').error?.message ?? '',
    /maximo debe ser 25/,
  );
  const sinCita = juicio();
  sinCita.por_criterio[1]!.cita = 'Una frase que no aparece en el documento uno de ninguna manera.';
  assert.match(
    guardarJuicio(db, sinCita, 'critico-licitaciones', { revisar: true }).error?.message ?? '',
    /La cita del criterio 2 no está tal cual en el documento 1\./,
  );
  const r = guardarJuicio(db, juicio(), 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.preferido, caso.documentos['memoria_fuerte']);
  assert.equal(
    juicioRecibido(db, {
      caso: 'casoG',
      doc_1: caso.documentos['memoria_fuerte']!,
      doc_2: caso.documentos['memoria_floja']!,
      lote: 'prueba',
    }),
    true,
  );
});

test('should_enqueue_both_orders_with_same_batch', async () => {
  const caso = cargarCaso(db, 'casoG', DIR).data!;
  const [a, b] = [caso.documentos['memoria_fuerte']!, caso.documentos['memoria_floja']!];
  const ids = encolarJuicios(nucleo().db, 'casoG', a, b, 'lote-1');
  const trabajos = nucleo()
    .db.prepare(`SELECT payload FROM trabajos_ia WHERE tipo = ? AND id IN (${ids.join(', ')}) ORDER BY id`)
    .all(TIPO_EVAL_JUICIO) as { payload: string }[];
  const payloads = trabajos.map((t) => PayloadJuicio.parse(JSON.parse(t.payload)));
  assert.deepEqual(
    payloads.map((p) => [p.doc_1, p.doc_2, p.lote]),
    [
      [a, b, 'lote-1'],
      [b, a, 'lote-1'],
    ],
  );
  assert.deepEqual(encolarJuicios(nucleo().db, 'casoG', a, b, 'lote-1'), ids, 'no duplica');
  const inst = instruccionesJuicio(payloads[0]!, 'Analítica Ejemplo');
  assert.doesNotMatch(
    inst,
    /memoria_fuerte|memoria_floja\b|Hermes|local/,
    'el juez no sabe de quién es cada documento',
  );
  const c = await conectar(T_CRITICO);
  try {
    const leer = async (parte: string) =>
      JSON.parse(
        texto(await c.callTool({ name: 'licitaciones_eval_paquete', arguments: { ...payloads[0], parte } })),
      ) as { texto: string; total: number };
    assert.match((await leer('documento_1')).texto, /^# Memoria técnica\n/, 'sin la versión: no delata cuál es');
    assert.match((await leer('pliego')).texto, /## 5\. Prototipo de las pantallas \(5 puntos\)/);
  } finally {
    await c.close();
  }
  const juicios = [
    [a, b, 23, 15.5],
    [b, a, 17, 24],
  ].map(([d1, d2, t1, t2]) => ({
    doc_1: d1!,
    doc_2: d2!,
    total_1: t1!,
    total_2: t2!,
    datos: { por_criterio: [] } as never,
  }));
  assert.match(
    informeDeJuicios(
      juicios,
      { [a]: 'memoria_fuerte', [b]: 'memoria_floja' },
      Rubrica.parse(JSON.parse(fs.readFileSync(path.join(DIR, 'rubrica.json'), 'utf8'))),
    ),
    /Veredicto: memoria_fuerte \(medias: memoria_floja 16,25, memoria_fuerte 23,5\)\./,
  );
  assert.deepEqual(juiciosDeLote(db, 'casoG', 'lote-1'), []);
});

// Como el paquete del crítico: con trozos de 40.000 el juez podía puntuar el principio de cada parte.
test('should_serve_a_full_chunk_judgment_part_whole_and_tell_the_judge_to_read_to_the_end', async () => {
  const caso = cargarCaso(db, 'casoG-largo', DIR).data!;
  const largo = 'Cláusula "7.2"\n«plazo»\t'.repeat(5_000).slice(0, TROZO_PAQUETE);
  db.prepare('UPDATE eval_casos SET pliego = ? WHERE clave = ?').run(largo, 'casoG-largo');
  const p = {
    caso: 'casoG-largo',
    doc_1: caso.documentos['memoria_fuerte']!,
    doc_2: caso.documentos['memoria_floja']!,
    lote: 'largo',
  };
  assert.match(
    instruccionesJuicio(p, 'Analítica Ejemplo'),
    /si la respuesta trae «siguiente» ≠ null, sigue leyendo con «desde» = «siguiente»; no envíes el juicio sin haber llegado a «siguiente» = null en las cuatro partes/,
  );
  assert.match(instruccionesJuicio(p, 'Analítica Ejemplo'), /si no lo ves al final, la respuesta te llegó recortada/);
  const c = await conectar(T_CRITICO);
  try {
    const crudo = texto(await c.callTool({ name: 'licitaciones_eval_paquete', arguments: { ...p, parte: 'pliego' } }));
    assert.ok(!crudo.includes('respuesta recortada'), `recortada a ${crudo.length} caracteres`);
    const r = JSON.parse(crudo) as { texto: string; siguiente: number | null };
    assert.deepEqual([r.texto === largo, r.siguiente], [true, null]);
    assert.ok(crudo.endsWith(`"cierre":"fin del trozo 0-${largo.length}"}`), crudo.slice(-80));
  } finally {
    await c.close();
  }
});

// Medición simétrica (A5), con memorias sintéticas: todas pasan por la misma normalización, sin la
// línea de la licitadora, y la del ensamblado se lee con el contenido de sus figuras.
const PANTALLA =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><text x="10" y="30" font-size="16">Bandeja</text><text x="10" y="60" font-size="16">Filtros</text></svg>';
const MEMORIA_SINTETICA: Memoria = {
  portada: {
    titulo: 'Memoria técnica',
    expediente: 'EXP-1',
    organo: 'Organismo de prueba',
    licitadora: { nombre: 'Empresa Licitadora, S.L.', nif: 'B12345678' },
    fecha: '1 de octubre de 2026',
  },
  apartados: [
    {
      numero: '1',
      titulo: 'Solución',
      bloques: [
        { parrafos: ['Lucía Gómez Ruiz dirige el proyecto.'], figura: { titulo: 'Bandeja de trabajo', svg: PANTALLA } },
      ],
    },
  ],
  pie: { texto: '', numeracion: true },
};

test('should_normalize_every_memoria_the_same_way_without_the_bidder_line', () => {
  const md = memoriaAMarkdown(MEMORIA_SINTETICA);
  assert.match(md, /\*\*Licitadora:\*\* Empresa Licitadora, S\.L\. \(NIF B12345678\)/);
  const n = normalizarMemoria(md, ['Lucía Gómez Ruiz']);
  assert.match(
    n,
    /^\*\*Expediente:\*\* EXP-1 · \*\*Órgano:\*\* Organismo de prueba · \*\*Fecha:\*\* 1 de octubre de 2026$/m,
    'la portada sin licitadora',
  );
  assert.doesNotMatch(n, /Empresa Licitadora|B12345678|Lucía/);
  assert.match(n, /Persona A dirige el proyecto\./);
  assert.equal(
    normalizarMemoria('# Memoria\nPresentada por Otra Empresa, S.A. (NIF A87654321)\nTexto.', []),
    '# Memoria\nTexto.',
    'la portada de un Word, igual',
  );
  const word =
    'Expediente EXP-1\nOrganismo de prueba\n\nPresentada por Otra Empresa, S.A. (NIF A87654321)\nCalle Mayor 1, 28001 Madrid\nLote 1\n\n1 de octubre de 2026\nTexto.';
  assert.equal(
    normalizarMemoria(word, []),
    'Expediente EXP-1\nOrganismo de prueba\n\nLote 1\n\n1 de octubre de 2026\nTexto.',
    'el domicilio del Word se va con la licitadora, como en el .md',
  );
  const conDomicilio = memoriaAMarkdown({
    ...MEMORIA_SINTETICA,
    portada: {
      ...MEMORIA_SINTETICA.portada,
      licitadora: { ...MEMORIA_SINTETICA.portada.licitadora, domicilio: 'Calle Mayor 1, 28001 Madrid' },
    },
  });
  assert.doesNotMatch(normalizarMemoria(conDomicilio, []), /Calle Mayor/);
});

test('should_load_assembled_memorias_with_figure_contents_and_warn_on_asymmetric_figures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-sintetico-'));
  try {
    const rubrica = { titulo: 'Caso sintético', criterios: [{ titulo: '1. Solución', puntos: 5, escala: [] }] };
    fs.writeFileSync(path.join(dir, 'rubrica.json'), JSON.stringify(rubrica));
    fs.writeFileSync(path.join(dir, 'pliego.md'), '# Pliego\nSe valorará la solución.');
    fs.writeFileSync(path.join(dir, 'nombres.json'), JSON.stringify(['Lucía Gómez Ruiz']));
    // El .md viejo traía el marcador; con su .json al lado se rehace con los rótulos.
    fs.writeFileSync(
      path.join(dir, 'a.md'),
      memoriaAMarkdown(MEMORIA_SINTETICA).replace(
        /\*Figura 1\. Bandeja de trabajo\*[\s\S]*?Contenido: [^\n]*/,
        '*Figura 1. Bandeja de trabajo* (dibujo en el .docx)',
      ),
    );
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ memoria: MEMORIA_SINTETICA }));
    fs.writeFileSync(path.join(dir, 'b.md'), '# Memoria técnica\n\n## 1. Solución\n\nUna solución sin figuras.\n');
    const caso = cargarCaso(db, 'sintetico-figuras', dir);
    assert.equal(caso.error, null, caso.error?.message);
    const a = (
      db.prepare('SELECT texto FROM eval_documentos WHERE id = ?').get(caso.data!.documentos['a']) as { texto: string }
    ).texto;
    assert.match(a, /\*Figura 1\. Bandeja de trabajo\*\n\nContenido: Bandeja · Filtros/);
    assert.doesNotMatch(a, /Licitadora|B12345678|Lucía/);
    assert.deepEqual(caso.data!.avisos, [
      'a trae figuras y b no: el juicio compara también eso; comprueba que no falten al pasarlas a .md.',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(
    avisosDeFiguras({ x: '*Figura 1. Flujo* (dibujo en el .docx)', y: 'Figura 1. Flujo\nContenido: Alta' }),
    [
      'x tiene 1 figuras sin su contenido («dibujo en el .docx»): pon junto a su .md el .json del ensamblado para leerlas.',
    ],
  );
});
