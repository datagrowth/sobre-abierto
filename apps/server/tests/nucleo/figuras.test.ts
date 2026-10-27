// Figuras SVG de un agente: solo autocontenidas, con su texto legible para revisarlo y
// pasadas a PNG a un tamaño que cabe en la página sin deformarse.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { erroresDeSvg, fraccionDePagina, letraMinimaPt, pngRgb, svgAPng, tamanoEnPagina, textosDeSvg } =
  await import('../../src/nucleo/documentos/figuras.js');
const { inflateSync } = await import('node:zlib');

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><defs><marker id="f"><path d="M0,0 L10,5 z"/></marker></defs><rect x="10" y="10" width="300" height="100" fill="#F2F4F7"/><text x="20" y="60" font-size="16">Ficha de <tspan>entrada</tspan></text><text x="400" y="60" font-size="14">I+D &amp; datos</text><line x1="0" y1="0" x2="10" y2="10" marker-end="url(#f)"/></svg>';

test('should_accept_a_self_contained_svg_with_internal_references', () => {
  assert.deepEqual(erroresDeSvg(SVG), []);
  assert.deepEqual(erroresDeSvg(`<?xml version="1.0"?>\n${SVG}`), [], 'con declaración XML delante');
});

test('should_reject_scripts_events_external_resources_and_missing_viewbox', () => {
  const con = (extra: string) => erroresDeSvg(SVG.replace('</svg>', `${extra}</svg>`));
  assert.deepEqual(con('<script>alert(1)</script>'), ['no admite scripts']);
  assert.deepEqual(con('<rect onclick="x()" width="1" height="1"/>'), ['no admite atributos de evento (on…)']);
  assert.ok(con('<image href="https://x.es/a.png"/>').includes('no admite imágenes o recursos externos'));
  assert.ok(con('<image href="data:image/png;base64,AAAA"/>').includes('no admite imágenes incrustadas'));
  assert.deepEqual(con('<foreignObject><div/></foreignObject>'), ['no admite foreignObject']);
  assert.deepEqual(con('<rect style="fill:url(https://x.es/p)" width="1" height="1"/>'), ['no admite url() externas']);
  assert.deepEqual(erroresDeSvg(SVG.replace(' viewBox="0 0 800 400"', '')), ['necesita viewBox="0 0 ancho alto"']);
  assert.ok(erroresDeSvg('<div>hola</div>').includes('debe ser un único <svg>…</svg>'));
  assert.ok(erroresDeSvg(`<!DOCTYPE svg [<!ENTITY x "y">]>${SVG}`).length > 0);
});

test('should_read_the_visible_text_of_the_figure', () => {
  assert.deepEqual(textosDeSvg(SVG), ['Ficha de entrada', 'I+D & datos']);
});

test('should_measure_the_smallest_letter_at_its_size_on_the_page', () => {
  assert.equal(letraMinimaPt(SVG), 7.9, '14 unidades de 800 a 16 cm de ancho');
  assert.equal(letraMinimaPt(SVG.replace(/font-size="\d+"/g, '')), null);
});

test('should_render_the_figure_to_png_and_fit_it_to_the_page', () => {
  const r = svgAPng(SVG);
  assert.equal(r.error, null);
  assert.deepEqual([r.data!.ancho, r.data!.alto], [1600, 800]);
  assert.deepEqual([...r.data!.png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  assert.equal(r.data!.png[25], 2, 'RGB sin alfa: LibreOffice deja invisible en el PDF la figura con canal alfa');
  assert.equal(svgAPng(SVG.replace('</svg>', '<script/></svg>')).error?.code, 'figura_invalida');
  assert.deepEqual(tamanoEnPagina(1600, 800), { width: 600, height: 300 });
  assert.deepEqual(tamanoEnPagina(800, 1600), { width: 410, height: 820 }, 'una figura alta se encoge sin deformarse');
  assert.ok(Math.abs(fraccionDePagina(SVG) - 300 / 933) < 0.001);
});

test('should_write_an_rgb_png_without_alpha_with_the_same_pixels', () => {
  const rgba = Buffer.from([255, 0, 0, 255, 0, 128, 255, 255]);
  const png = pngRgb(rgba, 2, 1);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [2, 1, 8, 2], '2×1, 8 bits, RGB');
  const idat = png.indexOf('IDAT');
  const datos = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  assert.deepEqual([...datos], [0, 255, 0, 0, 0, 128, 255], 'fila con filtro 0 y los píxeles sin alfa');
});
