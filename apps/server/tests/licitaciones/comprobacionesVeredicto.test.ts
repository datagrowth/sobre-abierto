// Veredicto, minutos y claves de las comprobaciones. Puro: sin base de datos ni red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claveBloqueo,
  huellaDe,
  ordenarBloqueos,
  type AccionBloqueo,
  type Actor,
  type Bloqueo,
  type Categoria,
  type EstadoBloqueo,
  type Gravedad,
} from '../../src/dominios/licitaciones/oferta/comprobacionesTipos.js';
import { minutosPersona, veredictoDe } from '../../src/dominios/licitaciones/oferta/comprobacionesVeredicto.js';

type Parcial = Partial<Omit<Bloqueo, 'accion'>> & {
  accion?: AccionBloqueo;
  actor?: Actor;
  gravedad?: Gravedad;
  estado?: EstadoBloqueo;
  categoria?: Categoria;
};

function fila(p: Parcial): Bloqueo {
  return {
    clave: p.clave ?? 'r:-',
    categoria: p.categoria ?? 'precio',
    lote: p.lote ?? null,
    gravedad: p.gravedad ?? 'impide',
    titulo: p.titulo ?? 'Fila',
    cita: null,
    actor: p.actor ?? 'tu',
    accion: { tipo: p.accion ?? 'fijar_precio' },
    propuesta: null,
    minutos: p.minutos ?? 0,
    estado: p.estado ?? 'abierto',
    huella: 'h',
  };
}

test('should_say_discarded_before_anything_else', () => {
  const v = veredictoDe({ descartada: true, motivo: 'x'.repeat(200), bloqueos: [fila({ actor: 'negocio' })] });
  assert.equal(v.tipo, 'descartada');
  assert.equal(v.texto, `Descartada: ${'x'.repeat(120)}`);
  assert.equal(veredictoDe({ retirada: true, motivo: 'Retirada', bloqueos: [] }).tipo, 'descartada');
});

test('should_be_not_presentable_when_a_business_blocker_is_open', () => {
  const bloqueos = [
    fila({ actor: 'tu' }),
    fila({ actor: 'negocio', titulo: 'ENS MEDIA', categoria: 'elegibilidad' }),
    fila({ actor: 'fuera', titulo: 'Certificado' }),
  ];
  const v = veredictoDe({ bloqueos });
  assert.equal(v.tipo, 'no_presentable');
  assert.equal(v.texto, 'No presentable: ENS MEDIA y 1 más');
  assert.equal(veredictoDe({ bloqueos: bloqueos.slice(1, 2) }).texto, 'No presentable: ENS MEDIA');
});

test('should_ask_for_your_decisions_when_only_your_rows_block', () => {
  const bloqueos = [
    fila({ clave: 'precio:2', lote: '2', titulo: 'Precio lote 2' }),
    fila({
      clave: 'domicilio',
      categoria: 'empresa',
      gravedad: 'riesgo',
      accion: 'completar_empresa',
      titulo: 'Domicilio',
    }),
  ];
  const v = veredictoDe({ bloqueos, enCurso: true });
  assert.equal(v.tipo, 'faltan_decisiones');
  assert.equal(v.texto, 'Faltan 2 decisiones tuyas');
  assert.equal(veredictoDe({ bloqueos: bloqueos.slice(0, 1) }).texto, 'Faltan 1 decisión tuya');
});

test('should_report_hermes_working_with_eta_and_accepted_risks_after', () => {
  const eta = { desde: '15:50', hasta: '16:40' };
  assert.equal(
    veredictoDe({ bloqueos: [], enCurso: true, eta }).texto,
    'Hermes trabajando (lista entre 15:50 y 16:40)',
  );
  const porHermes = fila({ actor: 'hermes', accion: 'esperar_hermes' });
  assert.equal(veredictoDe({ bloqueos: [porHermes] }).texto, 'Hermes trabajando');
  const aceptado = fila({ estado: 'riesgo_aceptado', gravedad: 'riesgo' });
  assert.deepEqual(veredictoDe({ bloqueos: [aceptado] }), {
    tipo: 'presentable_con_riesgos',
    texto: 'Presentable con 1 riesgo aceptado',
  });
});

test('should_not_count_a_vamos_row_as_open', () => {
  const bloqueos = [
    fila({ estado: 'vamos', actor: 'negocio', categoria: 'elegibilidad' }),
    fila({ estado: 'resuelto' }),
  ];
  assert.equal(veredictoDe({ bloqueos }).tipo, 'lista_para_firmar');
  assert.equal(minutosPersona(bloqueos), 0);
});

test('should_be_ready_to_sign_with_no_open_rows', () => {
  assert.deepEqual(veredictoDe({ bloqueos: [] }), { tipo: 'lista_para_firmar', texto: 'Lista para firmar' });
  const ok = fila({ gravedad: 'ok', actor: 'negocio' });
  assert.equal(veredictoDe({ bloqueos: [ok] }).tipo, 'lista_para_firmar');
});

test('should_sum_the_minutes_of_each_open_row_and_skip_outside_rows', () => {
  // Arrange: los minutos son los de cada fila (21 documentos a medio minuto; el negocio, 0).
  const bloqueos = [
    fila({ accion: 'fijar_precio', minutos: 1 }),
    fila({ accion: 'preparar_documento', minutos: 10.5 }),
    fila({ accion: 'asignar_rol', actor: 'negocio', minutos: 0 }),
    fila({ accion: 'revisar_memoria', estado: 'propuesta', minutos: 5 }),
    fila({ accion: 'subir_certificado', actor: 'fuera', minutos: 3 }),
    fila({ accion: 'aplicar_diff', estado: 'resuelto', minutos: 1 }),
  ];

  // Act
  const total = minutosPersona(bloqueos);

  // Assert
  assert.equal(total, 16.5);
  assert.equal(minutosPersona([]), 0);
});

test('should_build_stable_keys_and_short_hashes', () => {
  assert.equal(claveBloqueo('precio_pendiente', '2'), 'precio_pendiente:2');
  assert.equal(
    claveBloqueo('excluyente_vs_perfil', null, 'ENS Básica (MEDIA)'),
    'excluyente_vs_perfil:-:ens_basica_media',
  );
  assert.equal(claveBloqueo('a', '1', 'X'), claveBloqueo('a', '1', 'x'));
  const h = huellaDe('a', 1, { b: 2 });
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, huellaDe('a', 1, { b: 2 }));
  assert.notEqual(h, huellaDe('a', 2, { b: 2 }));
});

test('should_order_blockers_by_category_then_severity_then_lot', () => {
  const a = fila({ clave: 'a', categoria: 'documentos', gravedad: 'impide' });
  const b = fila({ clave: 'b', categoria: 'elegibilidad', gravedad: 'riesgo' });
  const c = fila({ clave: 'c', categoria: 'elegibilidad', gravedad: 'impide', lote: '10' });
  const d = fila({ clave: 'd', categoria: 'elegibilidad', gravedad: 'impide', lote: '2' });
  assert.deepEqual(
    ordenarBloqueos([a, b, c, d]).map((x) => x.clave),
    ['d', 'c', 'b', 'a'],
  );
});
