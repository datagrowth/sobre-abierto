// Los fixtures del caso C para los compromisos con coste son sintéticos (memoria, pliego y
// guion inventados). Este test bloquea que se cuele un dato personal, una firma o un importe
// ofertado, y que el esperado deje de casar con la memoria o con el pliego que cita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GuionBase } from '../../src/dominios/licitaciones/oferta/guion.js';
import type { Pasaje } from '../../src/dominios/licitaciones/pasajes.js';

const DIR = path.join(import.meta.dirname, 'fixtures', 'costes');
type J = Record<string, any>;
const crudo = (n: string) => fs.readFileSync(path.join(DIR, n), 'utf8');
const leer = (n: string): J => JSON.parse(crudo(n));
const plano = (t: string) => t.replace(/\s+/g, ' ');
const ARCHIVOS = ['casoC-memoria.json', 'casoC-guion.json', 'casoC-pliego.json', 'casoC-esperado.json', 'README.md'];

// La captura en bruto vive fuera del repo; si está a mano, sus nombres reales también se buscan.
function nombresReales(): string[] {
  const candidatos = [process.env.FIXTURES_BRUTOS].filter((d): d is string => Boolean(d));
  const dir = candidatos.find((d) => fs.existsSync(path.join(d, '_comun', 'colaboradores.json')));
  if (!dir) return [];
  const items: { nombre: string }[] = JSON.parse(
    fs.readFileSync(path.join(dir, '_comun', 'colaboradores.json'), 'utf8'),
  ).items;
  return [...new Set(items.flatMap((p) => p.nombre.split(/\s+/)).filter((t) => t.length >= 4))];
}

const PATRONES: [string, RegExp][] = [
  ['correo', /[\w.+-]+@[\w-]+\.[\w.]*\w/],
  ['teléfono', /(?<![\d/-])(?:\+34\s?)?[6789](?:[ .]?\d){8}(?![\d/-])/],
  ['NIF/NIE', /\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[A-HJNP-SUVW]\d{7}[0-9A-J])\b/],
  ['CSV o URL de verificación', /Código Seguro|Url De Verificación|verifirma|https?:\/\//i],
  ['firma nominal', /\b[Ff]irmad[oa] (?:[Pp]or|electrónicamente):?\s+\p{Lu}\p{Ll}+\s+\p{Lu}/u],
  // Lo que delataba a cada persona de la plantilla aun con seudónimo (como en perfilesGenericos.test.ts).
  ['biografía', /\bCEO\b|cofundador|Co-Founder|Data Scientist/i],
];

test('should_not_contain_emails_phones_nif_or_real_names_in_costes_fixtures', () => {
  const nombres = nombresReales();
  for (const n of ARCHIVOS) {
    const texto = plano(crudo(n).replace(/\\[nrt]/g, ' '));
    for (const [que, re] of PATRONES) assert.doesNotMatch(texto, re, `${n}: ${que}`);
    for (const t of nombres)
      assert.doesNotMatch(texto, new RegExp(`(?<![\\p{L}])${t}(?![\\p{L}])`, 'u'), `${n}: nombre real`);
  }
});

test('should_have_no_offered_amount_in_the_memoria', () => {
  const m = leer('casoC-memoria.json');
  for (const a of m.apartados) assert.doesNotMatch(a.texto, /€|\beuros?\b/i, `apartado ${a.n}`);
});

test('should_have_14_expected_commitments_and_at_least_10_reviewed_exigidos', () => {
  const e = leer('casoC-esperado.json');
  assert.equal(e.compromisos.length, 14);
  assert.equal(new Set(e.compromisos.map((c: J) => c.id)).size, 14);
  assert.ok(e.exigidos_revisados.length >= 10);
  assert.ok(e.extras_tolerados.length >= 1);
  assert.match(e.revisado_por, /^Persona [A-Z]$/);
  assert.match(e.fecha, /^\d{4}-\d{2}-\d{2}$/);
});

const TIPOS = new Set([
  'material_fisico',
  'dedicacion_fija',
  'plazo_corto',
  'sesion_recurrente',
  'sesion_individual',
  'cantidad_minima',
  'frecuencia_alta',
  'grupo_extra',
  'horas_extra',
]);

test('should_give_each_expected_commitment_a_catalog_type_a_coherent_range_and_a_cheaper_wording', () => {
  const e = leer('casoC-esperado.json');
  for (const c of e.compromisos) {
    assert.ok(TIPOS.has(c.tipo), `${c.id}: tipo ${c.tipo}`);
    assert.ok(c.horas_min >= 0 && c.horas_min <= c.horas_max, `${c.id}: horas`);
    if (c.banda)
      assert.deepEqual([c.horas_min, c.horas_max], [e.bandas[c.banda].horas_min, e.bandas[c.banda].horas_max], c.id);
    if (c.euros_min !== undefined) assert.ok(c.euros_min <= c.euros_max, `${c.id}: euros`);
    assert.ok(c.barata_contiene.length > 0, `${c.id}: barata`);
  }
  const porId = new Map<string, J>(e.compromisos.map((c: J) => [c.id, c]));
  assert.deepEqual([porId.get('kits')!.euros_min, porId.get('kits')!.euros_max], [4000, 6000]);
  assert.deepEqual([porId.get('dedicacion_fija')!.horas_min, porId.get('dedicacion_fija')!.horas_max], [500, 800]);
  assert.deepEqual([porId.get('entrevistas')!.horas_min, porId.get('entrevistas')!.horas_max], [110, 200]);
});

test('should_find_every_expected_fragment_literally_in_its_memoria_apartado', () => {
  const textos = new Map<number, string>(leer('casoC-memoria.json').apartados.map((a: J) => [a.n, a.texto]));
  const e = leer('casoC-esperado.json');
  const principales = [
    ...e.compromisos.map((c: J) => [c.id, c.apartado, c.fragmento_cita]),
    ...e.exigidos_revisados.map((x: J) => [x.id, x.apartado, x.fragmento_memoria]),
    ...e.extras_tolerados.map((x: J) => [x.id, x.apartado, x.fragmento_cita]),
  ] as [string, number, string][];
  for (const [id, n, f] of principales)
    assert.ok(textos.get(n)?.includes(f), `${id}: «${f}» no está en el apartado ${n}`);
  // Las otras citas son el mismo compromiso repetido, a menudo en la tabla resumen del apartado 1.
  const todo = [...textos.values()].join('\n');
  for (const c of e.compromisos)
    for (const f of c.otras_citas) assert.ok(todo.includes(f), `${c.id}: «${f}» no está en la memoria`);
});

test('should_quote_the_pliego_literally_for_every_reviewed_exigido', () => {
  const pasajes = leer('casoC-pliego.json') as unknown as Pasaje[];
  for (const x of leer('casoC-esperado.json').exigidos_revisados) {
    const cita = plano(x.pliego.cita);
    const en = pasajes.filter((p) => p.ruta.endsWith(x.pliego.documento) && plano(p.texto).includes(cita));
    assert.ok(en.length > 0, `${x.id}: la cita no está en ${x.pliego.documento}`);
  }
});

test('should_split_the_memoria_into_the_three_guion_apartados_keeping_tables_and_subtitles', () => {
  const m = leer('casoC-memoria.json');
  const g = leer('casoC-guion.json');
  assert.deepEqual(
    m.apartados.map((a: J) => a.n),
    [1, 2, 3],
  );
  m.apartados.forEach((a: J, i: number) => assert.equal(a.titulo, g.datos.memoria.apartados[i].titulo));
  assert.match(m.apartados[0].texto, /Presentación y guía de lectura/);
  assert.match(m.apartados[0].texto, /^## 1\.1 /m);
  assert.match(m.apartados[1].texto, /^## 1\.2 /);
  assert.match(m.apartados[2].texto, /^## 1\.3 /);
  assert.ok(m.apartados.every((a: J) => /^\| .* \|$/m.test(a.texto) && /^#### /m.test(a.texto)));
  assert.ok(m.apartados.every((a: J) => !/Lugar, fecha y firma del proponente/.test(a.texto)));
});

test('should_parse_the_guion_fixture_and_carry_the_lot_3_scope_from_the_ppt', () => {
  const g = leer('casoC-guion.json');
  const r = GuionBase.safeParse(g.datos);
  assert.ok(r.success, r.success ? '' : r.error.message);
  assert.equal(g.datos.oferta_economica.presupuesto_base, 18557);
  assert.deepEqual(g.datos.lotes, ['3']);
  const alcance = g.datos.alcance.map((u: J) => [u.personas_minimas, u.horas, u.grupos]);
  assert.deepEqual(alcance, [
    [40, 40, 1],
    [40, 40, 1],
    [60, 30, 1],
    [69, 50, 1],
    [120, 30, 1],
  ]);
  assert.ok(g.datos.alcance.every((u: J) => u.documento === 'PPT.pdf' && u.pagina === 13));
});

test('should_have_ppt_and_pcap_passages_with_page_and_the_lots_they_belong_to', () => {
  const pasajes = leer('casoC-pliego.json') as unknown as Pasaje[];
  for (const p of pasajes) {
    assert.deepEqual(Object.keys(p).sort(), ['clase', 'pagina', 'ruta', 'texto']);
    assert.ok(
      ['ppt', 'pcap'].includes(p.clase) && Number.isInteger(p.pagina) && p.texto.length > 100,
      p.texto.slice(0, 40),
    );
  }
  const ppt = pasajes.filter((p) => p.clase === 'ppt');
  // La prueba de «otros lotes»: el material fungible es de los lotes 1 y 2, y el pasaje lo dice.
  assert.ok(ppt.some((p) => /LOTES 1 y 2/.test(p.texto) && /material fungible/.test(p.texto)));
  assert.ok(ppt.some((p) => /LOTE 3/.test(p.texto) && /15 días naturales/.test(p.texto)));
  assert.ok(ppt.some((p) => p.pagina === 13 && /18\.557 €/.test(p.texto)));
  assert.ok(
    pasajes.some((p) => p.clase === 'pcap' && /intermediación y acuerdos con empresas del sector/.test(p.texto)),
  );
});
