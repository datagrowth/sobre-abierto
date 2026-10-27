// Lo no acreditado ya no para la redacción: la plataforma lo deja como aviso
// para la persona. Méritos a los que se acoge la empresa y que se declaran en la memoria (hay que poder
// probarlos) y lo que la estrategia dejó sin afirmar en la frontera por no estar acreditado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUION_CASO_A } from './fixtures/casoA.js';

process.env.NODE_ENV = 'test';

const { avisosDeAcreditacion } = await import('../../src/dominios/licitaciones/oferta/acreditaciones.js');
const { compromisosDeLaMemoria } = await import('../../src/dominios/licitaciones/oferta/compromisosMemoria.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');

const EXPERIENCIA = 'Experiencia adicional del jefe de proyecto';
const FORMACION = 'Horas adicionales de formación al personal';

function guion() {
  const base = {
    como_se_acredita: 'Se identifican en la propuesta técnica.',
    casilla_en: 'Propuesta técnica',
    archivo: GUION_CASO_A.memoria.archivo,
    documento: 'PCAP.pdf',
    pagina: 36,
  };
  return GuionBase.parse({
    ...GUION_CASO_A,
    automaticos: [
      {
        ...base,
        criterio: EXPERIENCIA,
        puntos: 2,
        marcas: ['experiencia adicional'],
        tramos: [{ descripcion: '3 años adicionales', puntos: 2, valor: '3' }],
      },
      {
        ...base,
        criterio: FORMACION,
        puntos: 2,
        marcas: ['horas adicionales de formación'],
        tramos: [{ descripcion: '24 horas adicionales', puntos: 2, valor: '24' }],
      },
    ],
  });
}
const compromisos = () =>
  compromisosDeLaMemoria(guion(), [
    { criterio: EXPERIENCIA, nos_acogemos: true, tramo: '3 años adicionales' },
    { criterio: FORMACION, nos_acogemos: true, tramo: '24 horas adicionales' },
  ]);

test('should_warn_to_check_a_declared_merit_but_not_a_service_commitment', () => {
  const avisos = avisosDeAcreditacion(compromisos(), []);
  assert.equal(avisos.length, 1, avisos.join(' | '));
  assert.match(
    avisos[0]!,
    /^Acreditación por comprobar: la memoria declara «Experiencia adicional del jefe de proyecto» \(tramo «3 años adicionales», valor «3»\)/,
  );
  assert.match(avisos[0]!, /confírmalo antes de presentar o renuncia a esos puntos/);
});

test('should_warn_about_what_the_strategy_left_unaccredited_in_the_frontier', () => {
  const avisos = avisosDeAcreditacion(
    [],
    [
      {
        no_decir: 'Años de experiencia del JP en IA',
        motivo: 'Sin acreditar: el dossier da 5 años en un sitio y 12 en otro.',
      },
      { no_decir: 'ISO 27001', motivo: 'El dossier no la acredita.' },
      { no_decir: 'Certificaciones ambientales', motivo: 'Van en el archivo electrónico nº 2.' },
      { no_decir: 'Horas de formación', motivo: 'Se acredita en el sobre 3.' },
    ],
  );
  assert.deepEqual(
    avisos.map((a) => a.split(' (')[0]),
    [
      'Sin acreditar: la memoria no afirma «Años de experiencia del JP en IA»',
      'Sin acreditar: la memoria no afirma «ISO 27001»',
    ],
    'la frontera con otro archivo no es falta de acreditación',
  );
});

test('should_return_no_warnings_when_nothing_is_declared_or_left_out', () => {
  assert.deepEqual(avisosDeAcreditacion([], []), []);
  const dup = { no_decir: 'ISO 9001', motivo: 'No consta en el dossier.' };
  assert.equal(avisosDeAcreditacion([], [dup, dup]).length, 1, 'sin duplicados');
});
