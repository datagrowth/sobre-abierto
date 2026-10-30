import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparRequisitos, normaNuevaCreacion, requisitosDeFicha } from './licitacionesFormato.js';

const req = (clase, extra = {}) => ({
  origen: 'ficha',
  clase,
  etiqueta: clase,
  descripcion: clase,
  resultado: 'cumple',
  excluyente: false,
  ...extra,
});

test('should_split_requirements_into_the_five_areas_in_plan_order_with_the_rest_in_otros_requisitos', () => {
  // Arrange
  const requisitos = [
    req('solvencia_tecnica'),
    req('experiencia'),
    req('clasificacion'),
    req('financiera'),
    req('seguro'),
    req('certificacion', { resultado: 'no_cumple', excluyente: true }),
    req('habilitacion'),
    req('medios_personales'),
    req('idioma'),
    req('declaracion'),
    req('tecnica'),
  ];

  // Act
  const g = agruparRequisitos(requisitos);

  // Assert
  assert.deepEqual(
    g.map((a) => a.titulo),
    ['Solvencia económica', 'Solvencia técnica', 'Certificaciones', 'Perfiles', 'Otros requisitos'],
  );
  assert.deepEqual(
    g.map((a) => a.requisitos.map((r) => r.clase)),
    [
      ['financiera', 'seguro'],
      ['solvencia_tecnica', 'experiencia', 'clasificacion', 'tecnica'],
      ['certificacion', 'habilitacion'],
      ['medios_personales'],
      ['idioma', 'declaracion'],
    ],
  );
  assert.equal(
    g.reduce((n, a) => n + a.requisitos.length, 0),
    requisitos.length,
    'ninguno se pierde ni se repite',
  );
});

test('should_say_why_a_section_is_empty_from_the_coverage', () => {
  // Arrange
  const cobertura = [
    { tema: 'certificaciones', estado: 'no_lo_pide' },
    { tema: 'medios_personales', estado: 'no_encontrado' },
  ];

  // Act
  const g = agruparRequisitos([req('solvencia_economica')], cobertura);

  // Assert
  assert.equal(g[0].vacio, null);
  assert.equal(g[2].vacio, 'El pliego no lo pide.');
  assert.equal(g[3].vacio, 'No se encontró en los pliegos.');
  assert.equal(g[1].vacio, 'Sin requisitos todavía.');
  assert.equal(g[4].vacio, 'Nada más.');
  assert.equal(agruparRequisitos([], undefined).length, 5, 'sin cobertura, los cinco igual');
});

test('should_show_the_new_company_rule_while_the_company_is_new', () => {
  // Arrange
  const ficha = {
    datos: {
      requisitos: [
        {
          tipo: 'solvencia_tecnica',
          descripcion: 'Relación de servicios similares',
          valor_exigido: '≥ 70.000 €',
          excluyente: true,
          cumple: 'si',
          justificacion: 'Somos de nueva creación.',
          nueva_creacion: {
            valor_exigido: 'Declaración de medios técnicos y personal',
            documento: 'Anexo I.pdf',
            pagina: 5,
          },
        },
      ],
    },
  };
  const [r] = requisitosDeFicha(ficha);

  // Act
  const nueva = normaNuevaCreacion(r, true);

  // Assert
  assert.deepEqual(nueva, {
    exigido: 'Declaración de medios técnicos y personal',
    general: 'Relación de servicios similares: ≥ 70.000 €',
    documento: 'Anexo I.pdf',
    pagina: 5,
  });
  assert.deepEqual(
    normaNuevaCreacion(r, null)?.exigido,
    'Declaración de medios técnicos y personal',
    'sin fecha de constitución, también',
  );
  assert.equal(normaNuevaCreacion(r, false), null, 'con cinco años o más, la regla general');
  assert.equal(normaNuevaCreacion({ ...r, nueva_creacion: null }, true), null);
});
