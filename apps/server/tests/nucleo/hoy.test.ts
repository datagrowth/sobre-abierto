// «Hoy» reúne lo de cada dominio, cuenta lo pendiente por sección y no se cae si uno falla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarHoy, resumenHoy, type HoyDominio } from '../../src/nucleo/hoy.js';

const item = (titulo: string) => ({
  tipo: 'ficha',
  titulo,
  detalle: null,
  fecha: null,
  importe: null,
  enlace: { seccion: 'licitaciones' },
});
const vacio = (seccion: string): HoyDominio => ({
  seccion,
  vence: [],
  por_aprobar: [],
  novedades: [],
  novedades_total: 0,
});

test('should_gather_every_domain_and_count_pending_approvals_by_section', async () => {
  let recibido = '';
  registrarHoy('prueba-lic', (desde) => {
    recibido = desde;
    return { ...vacio('licitaciones'), por_aprobar: [item('A'), item('B')] };
  });
  registrarHoy('prueba-cae', () => {
    throw new Error('base cerrada');
  });
  registrarHoy('prueba-asincrona', async () => ({ ...vacio('biblioteca'), por_aprobar: [item('Nota')] }));
  const h = await resumenHoy(undefined, Date.parse('2026-10-04T12:00:00Z'));
  assert.equal(h.desde, '2026-10-03T12:00:00.000Z', 'sin «desde», las últimas 24 horas');
  assert.equal(recibido, h.desde);
  assert.equal(h.cuentas['licitaciones'], 2);
  assert.equal(h.cuentas['biblioteca'], 1);
  assert.ok(!h.secciones.some((s) => s.seccion === 'cae'), 'el dominio que falla se omite');
});
