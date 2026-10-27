import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leerFoco,
  leerRuta,
  rutaA,
  rutaComprobaciones,
  rutaComprobacionesEn,
  rutaFicha,
  personaDeRuta,
  rutaDesconocida,
} from './rutas.js';

test('should_read_section_view_and_id_from_the_address', () => {
  assert.deepEqual(leerRuta('#/mercado/competidores/B12345678'), {
    seccion: 'mercado',
    vista: 'competidores',
    id: 'B12345678',
  });
  assert.deepEqual(leerRuta('#/licitacion/p-20571214'), { seccion: 'licitacion', vista: null, id: 'p-20571214' });
  assert.deepEqual(leerRuta('#/ajustes/empresa'), { seccion: 'ajustes', vista: 'empresa', id: null });
  assert.deepEqual(
    leerRuta(''),
    { seccion: 'pipeline', vista: null, id: null },
    'el Pipeline es la pantalla principal',
  );
  assert.deepEqual(leerRuta('#/inventada/x'), { seccion: 'pipeline', vista: null, id: null });
  assert.deepEqual(
    leerRuta('#/hoy'),
    { seccion: 'pipeline', vista: null, id: null },
    'la antigua «Hoy» abre el Pipeline',
  );
  assert.deepEqual(
    leerRuta('#/live'),
    { seccion: 'actividad', vista: null, id: null },
    'las direcciones antiguas siguen valiendo',
  );
});

test('should_send_each_old_licitaciones_address_to_its_new_place', () => {
  assert.deepEqual(
    leerRuta('#/licitaciones'),
    { seccion: 'pipeline', vista: null, id: null },
    'la lista lleva al Pipeline',
  );
  assert.deepEqual(leerRuta('#/licitaciones/oportunidades'), { seccion: 'pipeline', vista: null, id: null });
  assert.deepEqual(leerRuta('#/licitaciones/oportunidades/p-20571214'), {
    seccion: 'licitacion',
    vista: null,
    id: 'p-20571214',
  });
  assert.deepEqual(leerRuta('#/licitaciones/presentadas/p-1'), {
    seccion: 'pipeline',
    vista: 'presentadas',
    id: 'p-1',
  });
  assert.equal(leerRuta('#/licitaciones/ofertas').vista, 'presentadas');
  assert.deepEqual(leerRuta('#/licitaciones/competidores/B1'), { seccion: 'mercado', vista: 'competidores', id: 'B1' });
  assert.deepEqual(leerRuta('#/licitaciones/organismos'), { seccion: 'mercado', vista: 'organismos', id: null });
  assert.equal(leerRuta('#/licitaciones/barreras').vista, 'que-nos-falta');
  assert.equal(leerRuta('#/licitaciones/que-nos-falta').seccion, 'mercado');
  assert.deepEqual(leerRuta('#/licitaciones/ajustes/filtros'), { seccion: 'ajustes', vista: 'fuentes', id: 'filtros' });
});

test('should_round_trip_ids_with_slashes_and_accents', () => {
  const r = { seccion: 'biblioteca', vista: 'notas', id: 'Licitaciones/Presentadas/Formación estadística.md' };
  assert.equal(rutaA(r), '#/biblioteca/notas/Licitaciones%2FPresentadas%2FFormaci%C3%B3n%20estad%C3%ADstica.md');
  assert.deepEqual(leerRuta(rutaA(r)), r);
  assert.equal(rutaA({ seccion: 'pipeline' }), '#/pipeline');
  assert.equal(leerRuta('#/mercado/ofertas').vista, 'ofertas', 'los alias de Licitaciones no tocan otras secciones');
});

test('should_flag_unknown_section_route', () => {
  assert.equal(rutaDesconocida('#/inventada/x'), true);
  assert.equal(rutaDesconocida(''), false);
  assert.equal(rutaDesconocida('#/'), false);
  assert.equal(rutaDesconocida('#/live'), false);
  assert.equal(rutaDesconocida('#/licitaciones/oportunidades'), false, 'las de antes llevan a su sitio');
  assert.equal(rutaDesconocida('#/licitacion/p-1'), false);
});

test('should_read_comprobaciones_focus_from_hash_with_bloqueo', () => {
  const ruta = leerRuta('#/licitaciones/oportunidades/p-91000770/comprobaciones#bloqueo=x');

  const foco = leerFoco(ruta.id);

  assert.equal(ruta.seccion, 'licitacion');
  assert.deepEqual(foco, { id: 'p-91000770', seccion: 'comprobaciones', bloqueo: 'x', testid: null });
  assert.deepEqual(
    leerFoco(leerRuta('#/licitacion/p-91000770/comprobaciones#bloqueo=x').id),
    foco,
    'la dirección nueva, igual',
  );
  assert.deepEqual(leerFoco('p-123/comprobaciones#bloqueo=precio_pendiente:3:-'), {
    id: 'p-123',
    seccion: 'comprobaciones',
    bloqueo: 'precio_pendiente:3:-',
    testid: null,
  });
});

test('should_build_comprobaciones_route_with_encoded_clave_and_read_it_back', () => {
  const clave = 'medios_sin_persona:2:topografia_y_jardineria/a#b';

  const ruta = rutaComprobaciones('p-123', clave);

  assert.equal(rutaComprobaciones('p-123'), '#/licitacion/p-123/comprobaciones');
  assert.equal(rutaFicha('p-123'), '#/licitacion/p-123');
  assert.equal(rutaFicha('p-123', 'expediente'), '#/licitacion/p-123/expediente');
  assert.ok(ruta.startsWith('#/licitacion/p-123/comprobaciones#bloqueo=medios_sin_persona%3A2%3A'));
  assert.deepEqual(leerFoco(leerRuta(ruta).id), {
    id: 'p-123',
    seccion: 'comprobaciones',
    bloqueo: clave,
    testid: null,
  });
});

test('should_keep_reading_old_preparacion_links_as_a_section', () => {
  assert.deepEqual(leerFoco(leerRuta('#/licitaciones/oportunidades/p-123/preparacion').id), {
    id: 'p-123',
    seccion: 'preparacion',
    bloqueo: null,
    testid: null,
  });
  assert.deepEqual(leerFoco('p-123'), { id: 'p-123', seccion: null, bloqueo: null, testid: null });
  assert.deepEqual(leerFoco(null), { id: null, seccion: null, bloqueo: null, testid: null });
  assert.deepEqual(leerFoco('p-123/comprobaciones#otra=1'), {
    id: 'p-123',
    seccion: 'comprobaciones',
    bloqueo: null,
    testid: null,
  });
});

test('should_build_a_comprobaciones_route_that_focuses_the_package_footer', () => {
  // Act
  const ruta = rutaComprobacionesEn('p-123', 'registrar-paquete');

  // Assert
  assert.equal(ruta, '#/licitacion/p-123/comprobaciones#testid=registrar-paquete');
  assert.deepEqual(leerFoco(leerRuta(ruta).id), {
    id: 'p-123',
    seccion: 'comprobaciones',
    bloqueo: null,
    testid: 'registrar-paquete',
  });
});

test('should_parse_person_route_with_subject_anchor', () => {
  assert.deepEqual(leerRuta('#/equipo/1001#campo=topografía'), {
    seccion: 'equipo',
    vista: 'personas',
    id: '1001',
    campo: 'topografía',
  });
  assert.deepEqual(
    leerRuta('#/equipo/7#campo=limpieza%2Fmantenimiento%20t%C3%A9cnico').campo,
    'limpieza/mantenimiento técnico',
  );
  assert.deepEqual(
    leerRuta('#/colaboradores/12'),
    { seccion: 'equipo', vista: 'personas', id: '12' },
    'sin ancla no lleva campo',
  );
  assert.deepEqual(leerRuta('#/equipo/pendientes/5'), { seccion: 'equipo', vista: 'pendientes', id: '5' });
  assert.deepEqual(leerRuta('#/equipo'), { seccion: 'equipo', vista: null, id: null });
});

test('should_build_person_route_with_subject', () => {
  const ruta = rutaA({ seccion: 'equipo', vista: 'personas', id: 12, campo: 'topografía y jardinería' });

  assert.equal(ruta, '#/equipo/personas/12#campo=topograf%C3%ADa%20y%20jardiner%C3%ADa');
  assert.deepEqual(leerRuta(ruta), {
    seccion: 'equipo',
    vista: 'personas',
    id: '12',
    campo: 'topografía y jardinería',
  });
  assert.equal(rutaA({ seccion: 'equipo', vista: 'personas', id: 12 }), '#/equipo/personas/12');
});

test('should_open_the_person_of_the_team_matrix_link', () => {
  assert.equal(personaDeRuta(leerRuta('#/equipo/12#campo=topografía')), 12);
});

test('should_open_no_person_from_other_routes_or_a_malformed_id', () => {
  assert.equal(personaDeRuta(leerRuta('#/equipo/personas')), null);
  assert.equal(personaDeRuta({ seccion: 'equipo', vista: 'personas', id: '12a' }), null);
  assert.equal(personaDeRuta({ seccion: 'licitaciones', vista: 'oportunidades', id: '12' }), null);
  assert.equal(personaDeRuta(null), null);
});

test('should_read_old_cabina_links_as_comprobaciones', () => {
  const foco = leerFoco(leerRuta('#/licitaciones/oportunidades/p-91000770/cabina#bloqueo=x').id);

  assert.deepEqual(foco, { id: 'p-91000770', seccion: 'comprobaciones', bloqueo: 'x', testid: null });
  assert.deepEqual(leerFoco('p-123/cabina#testid=registrar-paquete'), {
    id: 'p-123',
    seccion: 'comprobaciones',
    bloqueo: null,
    testid: 'registrar-paquete',
  });
});
