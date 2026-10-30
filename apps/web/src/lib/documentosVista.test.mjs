import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aceptableDeUnaVez,
  cambioConArchivo,
  destinoDeCampoHoja,
  estadoVerificado,
  lotesDeAmbito,
  lotesDeDocumento,
  tarjetasPorSobre,
  textoOtrosLotes,
  textoVerificados,
  tipoDocumento,
} from './documentosVista.js';
import { cajonDeDestino } from './comprobacionesFormato.js';

// Captura seudonimizada de CASO_B: 26 documentos en un solo archivo, 8 de ellos de los lotes 2 a 5.
const datos = JSON.parse(readFileSync(new URL('../../e2e/datos/casoB.json', import.meta.url), 'utf8'));
const API = '/api/licitaciones/licitaciones/p-91000740';
const casoB = {
  f: datos[`GET ${API}`].body,
  documentos: datos[`GET ${API}/oferta/documentos`].body.documentos,
  bloqueos: datos[`GET ${API}/comprobaciones`].body.bloqueos,
};
const porNombre = (re) => casoB.documentos.find((d) => re.test(d.nombre));

const doc = (cambios = {}) => ({
  clave: 'a1-d1',
  archivo: 'Sobre A',
  lote: null,
  nombre: 'Declaración responsable',
  tipo: 'declaracion',
  produce: 'persona',
  obligatorio: true,
  origen: null,
  estado: 'pendiente',
  nota: null,
  ...cambios,
});

test('should_group_documents_by_envelope_and_lot', () => {
  const docs = [
    doc({ clave: 'a1-d1', archivo: 'Sobre A' }),
    doc({ clave: 'a2-d1-l4', archivo: 'Sobre C', lote: '4', nombre: 'Oferta económica' }),
    doc({ clave: 'a1-d2', archivo: 'Sobre A', nombre: 'ANEXO III LOTE 2. Proposición' }),
    doc({ clave: 'a2-d1-l2', archivo: 'Sobre C', lote: '2', nombre: 'Oferta económica' }),
  ];

  const t = tarjetasPorSobre(docs, ['2', '4']);

  assert.deepEqual(
    t.map((s) => s.archivo),
    ['Sobre A', 'Sobre C'],
  );
  assert.deepEqual(
    t[0].grupos.map((g) => [g.lote, g.documentos.map((d) => d.clave)]),
    [
      [null, ['a1-d1']],
      ['2', ['a1-d2']],
    ],
  );
  assert.deepEqual(
    t[1].grupos.map((g) => [g.lote, g.documentos.map((d) => d.clave)]),
    [
      ['2', ['a2-d1-l2']],
      ['4', ['a2-d1-l4']],
    ],
  );
});

test('should_hide_rows_of_other_lots_behind_a_count', () => {
  const lotes = lotesDeAmbito(casoB.f);

  const [sobre] = tarjetasPorSobre(casoB.documentos, lotes);
  const propios = sobre.grupos.flatMap((g) => g.documentos);

  assert.deepEqual(lotes, ['1']);
  assert.equal(casoB.documentos.length, 26);
  assert.equal(propios.length, 18, 'CASO_B cuenta los del lote 1, no 26');
  assert.equal(textoOtrosLotes(sobre.otros), '8 de otros lotes');
  assert.ok(sobre.otros.every((d) => /LOTE [2-5]\b/.test(d.nombre)));
  assert.deepEqual(
    sobre.grupos.find((g) => g.lote === '1').documentos.map((d) => d.nombre.slice(0, 20)),
    ['ANEXO III LOTE 1. PR', 'ANEXO III BIS LOTE 1'],
  );
  assert.equal(textoOtrosLotes([]), null);
  assert.deepEqual(tarjetasPorSobre([], ['1']), []);
});

test('should_mark_a_missing_certificate_from_the_eligibility_blocker', () => {
  const ens = porNombre(/Certificado de Conformidad con el ENS/);
  const rolece = porNombre(/ROLECE\)$/);
  const anexoXiv = porNombre(/^ANEXO XIV/);

  assert.deepEqual(tipoDocumento(ens, casoB.bloqueos), { clave: 'no_tenemos', texto: 'Certificado que no tenemos' });
  assert.equal(tipoDocumento(rolece, casoB.bloqueos).clave, 'certificado');
  assert.equal(
    tipoDocumento(anexoXiv, casoB.bloqueos).clave,
    'rellena_hermes',
    'la vía alternativa es un modelo, no un certificado',
  );
  assert.equal(tipoDocumento(doc({ tipo: 'memoria' })).clave, 'genera_hermes');
  // Con el riesgo aceptado en las comprobaciones ya no es «que no tenemos».
  const aceptado = casoB.bloqueos.map((b) => ({ ...b, estado: 'riesgo_aceptado' }));
  assert.equal(tipoDocumento(ens, aceptado).clave, 'certificado');
});

test('should_take_the_state_from_verification_not_from_a_select', () => {
  const anexoXiv = porNombre(/^ANEXO XIV/);
  const ens = porNombre(/Certificado de Conformidad con el ENS/);
  // Marcado «preparado» a mano, sigue mandando lo que dicen las comprobaciones.
  const xivPreparado = { ...anexoXiv, estado: 'preparado' };

  assert.deepEqual(
    [estadoVerificado(anexoXiv, casoB.bloqueos).clave, estadoVerificado(anexoXiv, casoB.bloqueos).texto],
    ['bloqueado', 'El Anexo XIV pasa a obligatorio: no tenemos ENS MEDIA'],
  );
  assert.equal(estadoVerificado(xivPreparado, casoB.bloqueos).clave, 'bloqueado');
  assert.equal(estadoVerificado(ens, casoB.bloqueos).texto, 'Exigen ENS MEDIA y el perfil no lo tiene');
  assert.equal(estadoVerificado(xivPreparado, []).texto, 'Verificado');
  assert.equal(estadoVerificado(doc({ estado: 'borrador' })).texto, 'Borrador por aceptar');
  assert.equal(
    estadoVerificado(doc({ estado: 'no_aplica', nota: 'No vamos en UTE.' })).texto,
    'No aplica: No vamos en UTE.',
  );
  assert.equal(estadoVerificado(doc()).texto, 'Sin preparar');
  // La clave del servidor normaliza los guiones: «obligatorio_condicionado:3:a3_d2» es el documento «a3-d2».
  const condicionado = {
    clave: 'obligatorio_condicionado:3:a3_d2',
    categoria: 'documentos',
    gravedad: 'impide',
    estado: 'abierto',
    titulo: '«Modelo» pasa a obligatoria',
    accion: {},
  };
  assert.equal(estadoVerificado(doc({ clave: 'a3-d2', estado: 'preparado' }), [condicionado]).clave, 'bloqueado');
  assert.equal(estadoVerificado(doc({ clave: 'a3-d21', estado: 'preparado' }), [condicionado]).clave, 'verificado');
  assert.equal(
    textoVerificados([
      doc({ estado: 'preparado' }),
      doc({ clave: 'a1-d2' }),
      doc({ clave: 'a1-d3', estado: 'no_aplica' }),
    ]),
    '1 de 2 verificados',
  );
});

test('should_accept_at_once_only_drafts_without_required_evidence', () => {
  assert.equal(aceptableDeUnaVez(doc({ estado: 'borrador' })), true);
  assert.equal(aceptableDeUnaVez(doc({ estado: 'borrador', tipo: 'acreditacion' })), false);
  assert.equal(aceptableDeUnaVez(doc({ estado: 'pendiente' })), false);
});

test('should_mark_prepared_when_a_person_attaches_their_own_file', () => {
  assert.deepEqual(cambioConArchivo({ ruta: 'Salidas/x.pdf' }, doc()), { ruta: 'Salidas/x.pdf', estado: 'preparado' });
  assert.deepEqual(cambioConArchivo({ nota: 'ok' }, doc()), { nota: 'ok' });
  assert.deepEqual(cambioConArchivo({ ruta: null }, doc({ estado: 'preparado' })), { ruta: null });
});

test('should_map_the_lot_2_price_field_to_the_decisions_drawer', () => {
  const destino = destinoDeCampoHoja({ grupo: 'Oferta · Lote 2', etiqueta: 'Importe sin impuestos', valor: '72 €' }, [
    '2',
    '4',
  ]);

  assert.equal(destino, 'decisiones.precio.2');
  assert.deepEqual(cajonDeDestino(destino), { nombre: 'decisiones', campo: 'precio.2' });
  assert.equal(destinoDeCampoHoja({ grupo: 'Oferta', etiqueta: 'Impuesto' }, ['1']), 'decisiones.precio.1');
  assert.equal(destinoDeCampoHoja({ grupo: 'Oferta', etiqueta: 'Impuesto' }, []), 'decisiones.precio.unico');
  assert.deepEqual(
    cajonDeDestino(destinoDeCampoHoja({ grupo: 'Criterios automáticos', etiqueta: 'C1. Años (lote 3)' })),
    { nombre: 'decisiones', campo: 'automatico:C1. Años|3' },
  );
  assert.equal(
    destinoDeCampoHoja({ grupo: 'Criterios automáticos', etiqueta: 'C5. Entorno virtual' }),
    'automatico:C5. Entorno virtual|',
  );
  assert.equal(destinoDeCampoHoja({ grupo: 'Licitación', etiqueta: 'Lotes' }), 'decisiones.lotes');
  assert.equal(destinoDeCampoHoja({ grupo: 'Empresa', etiqueta: 'NIF' }), null);
  assert.equal(destinoDeCampoHoja(null), null);
});

test('should_read_the_lots_a_document_names', () => {
  assert.deepEqual(lotesDeDocumento(doc({ nombre: 'Anexo II, lotes 2 y 03' })), ['2', '3']);
  assert.deepEqual(lotesDeDocumento(doc({ nombre: 'Anexo', origen: { modelo: 'Anexo V, LOTE 3' } })), ['3']);
  assert.deepEqual(lotesDeDocumento(doc({ lote: '4', nombre: 'Lote 2' })), ['4']);
  assert.deepEqual(lotesDeDocumento(doc({ nombre: 'Declaración de la UTE' })), []);
});
