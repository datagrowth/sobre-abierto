// Reglas de decisiones de las comprobaciones sobre los fixtures sintéticos de las ofertas (puras, sin BD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reglasDecisiones } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasDecisiones.js';
import { fasesDe } from '../../src/dominios/licitaciones/oferta/comprobacionesFases.js';
import { desfasesDe } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasDesfases.js';
import { automaticosContradictorios } from '../../src/dominios/licitaciones/oferta/automaticosHonestos.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import type { Bloqueo } from '../../src/dominios/licitaciones/oferta/comprobacionesTipos.js';
import type { DecisionesData } from '../../src/dominios/licitaciones/oferta/decisiones.js';
import type { GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');

type Memoria = { id: number; version: number; guion_id: number; revision: string; ensayo?: boolean };
type Fixture = {
  ahora: string;
  licitacion: { fecha_limite: string | null };
  oportunidad: { lotes_interes: string[] };
  guiones: { id: number; version: number; datos: GuionBaseData }[];
  decisiones: EntradasComprobaciones['decisiones'];
  propuesta: EntradasComprobaciones['propuesta'];
  memorias: Memoria[];
};

const leer = (nombre: string): Fixture =>
  JSON.parse(fs.readFileSync(path.join(DIR, `${nombre}.json`), 'utf8')) as Fixture;

// Solo lo que miran estas reglas; la memoria con el estado de revisión de su borrador, como memoriasDe.
function entradas(f: Fixture): EntradasComprobaciones {
  const m = f.memorias.find((x) => !x.ensayo) ?? null;
  return {
    ahoraMs: Date.parse(f.ahora),
    licitacion: { fecha_limite: f.licitacion.fecha_limite },
    ambito: f.oportunidad.lotes_interes,
    guion: f.guiones.at(-1) ?? null,
    decisiones: f.decisiones ?? null,
    propuesta: f.propuesta ?? null,
    memoria: m ? { id: m.id, version: m.version, guion_id: m.guion_id, borrador: { estado: m.revision } } : null,
  } as unknown as EntradasComprobaciones;
}

const porRegla = (bs: Bloqueo[], regla: string) => bs.filter((b) => b.clave.startsWith(`${regla}:`));

test('should_block_casoE_criteria_2_3_and_2_4_ticked_with_a_note_that_says_we_do_not_take_them', () => {
  const e = entradas(leer('casoE'));

  const filas = porRegla(reglasDecisiones(e), 'nos_acogemos');

  const contrarias = filas.filter((b) => b.titulo.endsWith('y tu nota dice que no'));
  assert.deepEqual(
    contrarias.map((b) => b.titulo),
    [
      'Te acoges a «Volumen de Señales Automáticas de Inactividad del Alumnado» y tu nota dice que no',
      'Te acoges a «Registro de Trazabilidad de la Atención Tutorial» y tu nota dice que no',
    ],
  );
  for (const b of filas) {
    assert.equal(b.gravedad, 'impide');
    assert.equal(b.categoria, 'decisiones');
    assert.equal(b.actor, 'tu');
    assert.equal(b.accion.tipo, 'desmarcar_criterio');
    assert.match(b.accion.destino!, /^automatico:.+\|$/);
  }
  assert.equal(contrarias[0]!.clave, 'nos_acogemos:-:volumen_de_senales_automaticas_de_inactividad_del_alumnado');
  // 1.1, 1.2, 1.3 y 2.2: acreditaciones sin con qué; 2.1 (Hermes lo da por cumplido) y los compromisos no.
  assert.equal(filas.length, 6);
  assert.ok(!filas.some((b) => b.titulo.includes('Adscripción') || b.titulo.includes('Periodicidad')));
});

test('should_block_a_criterion_that_needs_a_document_without_evidence', () => {
  const g = {
    automaticos: [
      {
        criterio: '3.1 Certificación del fabricante',
        como_se_acredita: 'Declaración del licitador.',
        exige_documento: 'Certificado del fabricante de la plataforma',
        lotes: undefined,
      },
    ],
  } as unknown as GuionBaseData;
  const decidido = (extra: object) =>
    ({
      automaticos: [
        { criterio: '3.1 Certificación del fabricante', lote: null, nos_acogemos: true, tramo: null, ...extra },
      ],
    }) as unknown as DecisionesData;

  const sinEvidencia = automaticosContradictorios(decidido({}), g, null);
  const conEvidencia = automaticosContradictorios(
    decidido({ evidencia: 'Biblioteca/Empresa/certificado-fabricante.pdf' }),
    g,
    null,
  );
  const conNota = automaticosContradictorios(decidido({ nota: 'NÓ NOS ACÓGEMOS: no lo tenemos' }), g, null);

  assert.deepEqual(sinEvidencia, [
    {
      criterio: '3.1 Certificación del fabricante',
      lote: null,
      motivo: 'sin_evidencia',
      exige: 'Certificado del fabricante de la plataforma',
    },
  ]);
  assert.deepEqual(conEvidencia, []);
  assert.equal(conNota[0]!.motivo, 'nota_contraria', 'sin distinguir mayúsculas ni tildes');
});

test('should_not_flag_a_commitment_criterion_without_evidence', () => {
  const e = entradas(leer('casoD'));
  const g = {
    automaticos: [
      {
        criterio: 'Horas adicionales de formación',
        como_se_acredita: 'Compromiso en el Anexo III.',
        tipo: 'compromiso',
      },
    ],
  } as unknown as GuionBaseData;
  const d = {
    automaticos: [{ criterio: 'Horas adicionales de formación', lote: null, nos_acogemos: true, tramo: null }],
  } as unknown as DecisionesData;

  const filas = porRegla(reglasDecisiones(e), 'nos_acogemos');

  assert.deepEqual(filas, [], 'CASO_D solo tiene compromisos');
  assert.deepEqual(automaticosContradictorios(d, g, null), []);
});

test('should_flag_casoC_proposal_from_outline_8_as_obsolete', () => {
  const e = entradas(leer('casoC'));

  const [fila, ...resto] = porRegla(reglasDecisiones(e), 'propuesta_obsoleta');

  assert.equal(resto.length, 0);
  assert.equal(fila!.titulo, 'La propuesta de Hermes es del guion v8 (vigente v16)');
  assert.equal(fila!.gravedad, 'riesgo');
  assert.equal(fila!.actor, 'hermes');
  assert.equal(fila!.clave, 'propuesta_obsoleta:-');
  assert.deepEqual(
    porRegla(reglasDecisiones(e), 'decisiones_obsoletas'),
    [],
    'las decisiones de Villaejemplo son del guion vigente',
  );
});

test('should_flag_casoD_decisions_from_outline_15_as_obsolete', () => {
  const e = entradas(leer('casoD'));

  const filas = porRegla(reglasDecisiones(e), 'decisiones_obsoletas');

  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.titulo, 'Tus decisiones son del guion v15 (vigente v17): revísalas');
  assert.equal(filas[0]!.gravedad, 'riesgo');
  assert.equal(filas[0]!.actor, 'tu');
  assert.deepEqual(
    porRegla(reglasDecisiones(e), 'propuesta_obsoleta'),
    [],
    'la propuesta de CASO_D es del guion vigente',
  );
  assert.deepEqual(
    porRegla(reglasDecisiones(e), 'propuesta_posterior'),
    [],
    'con decisiones de otro guion no se compara la fecha',
  );
});

test('should_block_the_memory_from_an_older_outline_only_when_it_is_pending_review', () => {
  const f = leer('casoE');
  const revisada = { ...f, memorias: f.memorias.map((m) => ({ ...m, revision: 'aprobada' })) };

  const pendiente = porRegla(reglasDecisiones(entradas(f)), 'memoria_obsoleta');
  const aprobada = porRegla(reglasDecisiones(entradas(revisada)), 'memoria_obsoleta');
  const casoC = porRegla(reglasDecisiones(entradas(leer('casoC'))), 'memoria_obsoleta');

  assert.equal(pendiente[0]!.gravedad, 'impide');
  assert.equal(pendiente[0]!.titulo, 'La v1 es de un guion anterior: no la des por buena');
  assert.equal(aprobada[0]!.gravedad, 'riesgo');
  assert.notEqual(aprobada[0]!.huella, pendiente[0]!.huella, 'al cambiar la gravedad, lo guardado deja de valer');
  assert.deepEqual(casoC, [], 'la última memoria de Villaejemplo ya es del guion vigente');
});

test('should_make_a_pending_price_impide_under_five_days_and_a_risk_otherwise', () => {
  const casoD = porRegla(reglasDecisiones(entradas(leer('casoD'))), 'precio');
  const casoC = porRegla(reglasDecisiones(entradas(leer('casoC'))), 'precio');
  const casoE = porRegla(reglasDecisiones(entradas(leer('casoE'))), 'precio');

  assert.deepEqual(
    casoD.map((b) => [b.clave, b.gravedad, b.titulo, b.actor, b.categoria, b.accion]),
    [
      [
        'precio:2',
        'riesgo',
        'Precio del lote 2 sin decidir',
        'tu',
        'precio',
        { tipo: 'fijar_precio', destino: 'precio-lote-2' },
      ],
    ],
    'CASO_D cierra el 26: 12 días',
  );
  assert.deepEqual(
    casoC.map((b) => [b.clave, b.gravedad]),
    [['precio:3', 'impide']],
    'Villaejemplo cierra mañana',
  );
  assert.deepEqual(
    casoE.map((b) => [b.clave, b.gravedad]),
    [
      ['precio:2', 'impide'],
      ['precio:4', 'impide'],
    ],
    'CASO_E: importe vacío sin «pendiente» no es un precio',
  );
});

test('should_ask_for_decisions_and_the_single_price_when_there_are_none', () => {
  const f = leer('casoC');
  const e = { ...entradas(f), decisiones: null, propuesta: null, ambito: [] } as unknown as EntradasComprobaciones;

  const filas = reglasDecisiones(e);

  assert.deepEqual(
    filas.map((b) => [b.clave, b.titulo, b.gravedad]),
    [
      ['precio:-', 'Precio sin decidir', 'impide'],
      ['decisiones_falta:-', 'Decisiones sin fijar', 'impide'],
    ],
  );
});

test('should_never_put_an_amount_in_a_title', () => {
  for (const nombre of ['casoE', 'casoD', 'casoC', 'casoB', 'casoF']) {
    for (const b of reglasDecisiones(entradas(leer(nombre))))
      assert.doesNotMatch(b.titulo, /€|euros?\b/i, `${nombre}: ${b.titulo}`);
  }
});

test('should_not_flag_a_presentada_from_an_older_outline', () => {
  // Arrange
  const e = entradas(leer('casoE'));
  const presentada = { ...e, memoria: { ...e.memoria!, presentada: true } } as EntradasComprobaciones;

  // Act
  const filas = porRegla(reglasDecisiones(presentada), 'memoria_obsoleta');

  // Assert
  assert.deepEqual(filas, [], 'lo entregado ya no se rehace');
});

// CASO_E con una memoria por lote: la v6 del lote 2, ensamblada y aceptada con el guion vigente; la v4
// del lote 4, ensamblada, por revisar y de un guion anterior. La memoria «de trabajo» es la v6.
function porLote(): EntradasComprobaciones {
  const f = leer('casoE');
  const vigente = f.guiones.at(-1)!.id;
  const memoria = (version: number, guion_id: number, estado: string, lote: string) => ({
    id: 900 + version,
    version,
    guion_id,
    lote,
    estado: 'ensamblada',
    presentada: false,
    guion_cambiado: guion_id !== vigente,
    borrador: { estado },
    apartados: [],
  });
  const v6 = memoria(6, vigente, 'aceptada', '2');
  const v4 = memoria(4, vigente - 1, 'pendiente', '4');
  const lote = (l: string, m: unknown) => ({
    lote: l,
    memoria: m,
    hallazgos: [],
    fugas: null,
    aceptadas: [],
    textos: [],
  });
  return {
    ...entradas(f),
    memoria: v6,
    trabajos: [],
    pliegos: [],
    documentos: { filas: [], del_guion: [] },
    paquete: null,
    oportunidad: null,
    coherencia: [],
    memoria_lotes: { lotes: ['2', '4'], por_lote: [lote('2', v6), lote('4', v4)], rutas_memoria: [] },
  } as unknown as EntradasComprobaciones;
}

test('should_flag_the_memory_of_each_lot_from_an_older_outline', () => {
  // Arrange
  const e = porLote();

  // Act
  const filas = porRegla(reglasDecisiones(e), 'memoria_obsoleta');

  // Assert
  assert.deepEqual(
    filas.map((b) => [b.clave, b.gravedad, b.titulo]),
    [['memoria_obsoleta:4', 'impide', 'La v4 (lote 4) es de un guion anterior: no la des por buena']],
  );
});

test('should_not_mark_the_memory_phase_done_until_every_lot_has_its_accepted_memory', () => {
  // Arrange
  const e = porLote();

  // Act
  const fase = fasesDe(e, reglasDecisiones(e)).find((x) => x.nombre === 'memoria')!;

  // Assert
  assert.notEqual(fase.estado, 'hecho', 'la v4 del lote 4 sigue por revisar');
});

test('should_flag_the_cover_of_each_lot_memory_assembled_before_the_company_changed', () => {
  // Arrange: la empresa cambió después de montar las dos; la v6 se volvió a montar después.
  const base = porLote();
  const ml = base.memoria_lotes!;
  const conFecha = (i: number, en: string) => ({
    ...ml.por_lote[i]!,
    memoria: { ...ml.por_lote[i]!.memoria!, ensamblada_en: en },
  });
  const e = {
    ...base,
    perfil: { actualizado_en: '2026-10-14T10:00:00.000Z' },
    memoria_lotes: {
      ...ml,
      por_lote: [conFecha(0, '2026-10-14T11:00:00.000Z'), conFecha(1, '2026-10-14T09:00:00.000Z')],
    },
  } as unknown as EntradasComprobaciones;

  // Act
  const portadas = desfasesDe(e).filter((d) => d.clave.endsWith(':portada'));

  // Assert
  assert.deepEqual(
    portadas.map((d) => [d.clave, d.pieza]),
    [['desfase:4:portada', 'La portada de la v4 (lote 4)']],
  );
});
