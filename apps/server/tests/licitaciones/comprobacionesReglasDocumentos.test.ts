// Reglas de documentos de las comprobaciones sobre entradas sacadas de los fixtures sintéticos de las
// 5 ofertas (perfil, guion, decisiones, checklist y memoria literales). Puras, sin BD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reglasDocumentos } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasDocumentos.js';
import { documentosDelGuion } from '../../src/dominios/licitaciones/oferta/documentos.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import type { Bloqueo } from '../../src/dominios/licitaciones/oferta/comprobacionesTipos.js';
import type { Hallazgo } from '../../src/dominios/licitaciones/oferta/hechos.js';

type Fixture = {
  licitacion: { fecha_limite: string; lotes?: { id: string }[] };
  oportunidad: { lotes_interes: string[] };
  ficha: { datos: unknown };
  guiones: { datos: Parameters<typeof documentosDelGuion>[0] }[];
  decisiones: {
    datos: { lotes?: string[]; automaticos: { criterio: string; lote: string | null; nos_acogemos: boolean }[] };
  };
  memorias: { id: number; estado: string; fugas: EntradasComprobaciones['fugas']; coherencia: Hallazgo[] }[];
  documentos: { clave: string; estado: string; oculto?: number }[];
  perfil: Record<string, unknown>;
};

const fixture = (nombre: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/comprobaciones/${nombre}.json`, import.meta.url), 'utf8')) as Fixture;

// certificados: [] es «no tenemos ninguno»; así la regla de elegibilidad sabe qué falta.
function entradas(nombre: string, cambiar: (f: Fixture) => void = () => {}): EntradasComprobaciones {
  const f = fixture(nombre);
  f.perfil = { certificados: [], ...f.perfil };
  cambiar(f);
  const guion = f.guiones[f.guiones.length - 1]!;
  const memoria = f.memorias[0] ?? null;
  return {
    id: nombre,
    ahoraMs: Date.parse('2026-10-14T20:34:44.000Z'),
    licitacion: { fecha_limite: f.licitacion.fecha_limite },
    ambito: f.oportunidad.lotes_interes,
    lotes: { lotes: f.licitacion.lotes ?? [] },
    ficha: f.ficha,
    guion,
    decisiones: f.decisiones,
    memoria,
    fugas: memoria?.fugas ?? null,
    hallazgos: memoria?.coherencia ?? [],
    documentos: {
      filas: f.documentos,
      del_guion: documentosDelGuion(guion.datos, f.decisiones.datos.lotes ?? guion.datos.lotes ?? []),
    },
    perfil: f.perfil === null ? null : { perfil: f.perfil, actualizado_en: '2026-10-14T00:00:00.000Z' },
  } as unknown as EntradasComprobaciones;
}

const porClave = (r: Bloqueo[], clave: string): Bloqueo | undefined => r.find((b) => b.clave === clave);
const deCategoria = (r: Bloqueo[], c: Bloqueo['categoria']): Bloqueo[] => r.filter((b) => b.categoria === c);

test('should_block_the_missing_address_in_casoC_casoD_casoB_and_casoE', () => {
  for (const nombre of ['casoC', 'casoD', 'casoB', 'casoE']) {
    const r = reglasDocumentos(entradas(nombre));

    const b = porClave(r, 'empresa:-:domicilio');
    assert.ok(b, nombre);
    assert.equal(b.gravedad, 'impide');
    assert.equal(b.actor, 'tu');
    assert.equal(b.categoria, 'empresa');
    assert.deepEqual(b.accion, { tipo: 'completar_empresa', destino: 'empresa.domicilio' });
    assert.equal(b.titulo, 'Falta el domicilio de la empresa (va en el DEUC y en los anexos)');
  }
});

test('should_ask_contact_data_as_a_risk_and_skip_what_the_profile_has', () => {
  const r = reglasDocumentos(entradas('casoD'));

  assert.deepEqual(
    deCategoria(r, 'empresa').map((b) => [b.clave, b.gravedad]),
    [
      ['empresa:-:domicilio', 'impide'],
      ['empresa:-:contacto_email', 'riesgo'],
      ['empresa:-:contacto_telefono', 'riesgo'],
    ],
  );
});

test('should_accept_a_structured_address_or_one_with_postcode_and_town', () => {
  const conDireccion = entradas('casoD', (f) => {
    f.perfil.direccion = {
      calle: 'Calle Mayor 1',
      codigo_postal: '38003',
      municipio: 'Santa Cruz de Tenerife',
      provincia: 'Santa Cruz de Tenerife',
    };
  });
  const conTexto = entradas('casoD', (f) => {
    f.perfil.domicilio = 'Calle Mayor 1, 38003 Santa Cruz de Tenerife';
  });
  const sinCp = entradas('casoD', (f) => {
    f.perfil.domicilio = 'Calle Mayor 1';
  });

  assert.equal(porClave(reglasDocumentos(conDireccion), 'empresa:-:domicilio'), undefined);
  assert.equal(porClave(reglasDocumentos(conTexto), 'empresa:-:domicilio'), undefined);
  assert.equal(porClave(reglasDocumentos(sinCp), 'empresa:-:domicilio')?.gravedad, 'impide');
});

test('should_block_once_when_there_is_no_company_profile', () => {
  const e = entradas('casoD', (f) => {
    f.perfil = null as unknown as Record<string, unknown>;
  });

  const empresa = deCategoria(reglasDocumentos(e), 'empresa');

  assert.equal(empresa.length, 1);
  assert.equal(empresa[0]!.clave, 'empresa:-:perfil');
  assert.equal(empresa[0]!.gravedad, 'impide');
  assert.equal(empresa[0]!.titulo, 'Falta el perfil de la empresa (sus datos van en el DEUC y en los anexos)');
});

test('should_not_ask_company_data_when_no_document_is_produced_by_the_person', () => {
  const e = entradas('casoD', (f) => {
    for (const a of f.guiones[0]!.datos.archivos) for (const d of a.documentos) d.produce = 'hermes';
  });

  assert.deepEqual(deCategoria(reglasDocumentos(e), 'empresa'), []);
});

test('should_make_the_recording_declaration_mandatory_when_we_take_that_criterion', () => {
  const r = reglasDocumentos(entradas('casoC'));

  const condicionados = r.filter((b) => b.clave.startsWith('obligatorio_condicionado:'));
  assert.equal(condicionados.length, 1);
  const b = condicionados[0]!;
  assert.equal(b.clave, 'obligatorio_condicionado:-:a3_d2');
  assert.equal(b.gravedad, 'impide');
  assert.equal(b.actor, 'tu');
  assert.deepEqual(b.accion, { tipo: 'preparar_documento', destino: 'documentos.a3-d2' });
  assert.match(
    b.titulo,
    /^«Declaración responsable sobre la grabación de las tutorías del personal participante» pasa a obligatoria: te acoges a «Ofrecer la grabación de las tutorías/,
  );
  // La UTE y los empresarios extranjeros siguen sin ser obligatorios.
  assert.equal(
    r.some((x) => /a1_d[45]/.test(x.clave)),
    false,
  );
});

test('should_not_make_the_declaration_mandatory_when_we_do_not_take_the_criterion_or_it_is_prepared', () => {
  const sinAcoger = entradas('casoC', (f) => {
    for (const a of f.decisiones.datos.automaticos) a.nos_acogemos = false;
  });
  const preparada = entradas('casoC', (f) => {
    f.documentos.find((d) => d.clave === 'a3-d2')!.estado = 'preparado';
  });

  assert.equal(
    reglasDocumentos(sinAcoger).some((b) => b.clave.startsWith('obligatorio_condicionado:')),
    false,
  );
  assert.equal(
    reglasDocumentos(preparada).some((b) => b.clave.startsWith('obligatorio_condicionado:')),
    false,
  );
});

test('should_group_unprepared_mandatory_documents_by_file_and_lot', () => {
  const r = reglasDocumentos(entradas('casoC'));

  assert.deepEqual(
    r
      .filter((b) => b.clave.startsWith('documentos_sin_preparar:'))
      .map((b) => [b.clave, b.lote, b.gravedad, b.titulo, b.minutos]),
    [
      ['documentos_sin_preparar:3:sobre_a', '3', 'riesgo', 'Sobre A · lote 3: 3 documentos sin preparar', 1.5],
      // Sin la memoria: la redacta Hermes y tiene su propia fase.
      ['documentos_sin_preparar:3:sobre_b', '3', 'riesgo', 'Sobre B · lote 3: 1 documento sin preparar', 0.5],
      ['documentos_sin_preparar:3:sobre_c', '3', 'riesgo', 'Sobre C · lote 3: 1 documento sin preparar', 0.5],
    ],
  );
});

test('should_not_count_twice_the_certificates_that_eligibility_already_blocks', () => {
  const casoE = reglasDocumentos(entradas('casoE'));
  const casoB = reglasDocumentos(entradas('casoB'));

  // CASO_E: 12 documentos menos la memoria, la declaración ENS (elegibilidad) y 3 no obligatorios.
  assert.match(
    deCategoria(casoE, 'documentos').find((b) => b.clave.startsWith('documentos_sin_preparar:'))!.titulo,
    /: 7 documentos sin preparar$/,
  );
  // CASO_B: el Anexo XIV ya lo hace obligatorio la regla de elegibilidad, no sale como condicionado.
  assert.equal(
    casoB.some((b) => b.clave.includes('a1_d21')),
    false,
  );
});

test('should_not_count_the_documents_named_for_lots_we_do_not_go_to', () => {
  // Arrange: CASO_B, la empresa va al lote 1; los Anexos III y III BIS de los lotes 2 a 5 van sin lote en su fila.
  const e = entradas('casoB');

  // Act
  const fila = reglasDocumentos(e).find((b) => b.clave.startsWith('documentos_sin_preparar:'))!;

  // Assert: 21 con los 8 anexos de los lotes 2 a 5; sin ellos, los 13 del lote 1, como en el cajón.
  assert.match(fila.titulo, /lote 1: 13 documentos sin preparar$/);
  const anexos = e.documentos.del_guion.filter((d) => /ANEXO III/.test(d.doc.nombre)).map((d) => d.clave);
  assert.equal(anexos.length, 10);
});

test('should_drop_a_document_from_the_count_once_it_is_prepared', () => {
  const e = entradas('casoC', (f) => {
    f.documentos.find((d) => d.clave === 'a1-d1')!.estado = 'preparado';
  });

  assert.equal(
    porClave(reglasDocumentos(e), 'documentos_sin_preparar:3:sobre_a')?.titulo,
    'Sobre A · lote 3: 2 documentos sin preparar',
  );
});

test('should_block_a_single_memory_when_the_file_goes_per_lot', () => {
  const r = reglasDocumentos(entradas('casoE'));

  const b = porClave(r, 'memoria_por_lote:-');
  assert.ok(b);
  assert.equal(b.gravedad, 'impide');
  assert.equal(b.actor, 'tu');
  assert.equal(
    b.titulo,
    'El pliego pide una memoria por lote: redáctalas en Memoria («Redactar las memorias, una por lote») o sube la de cada lote',
  );
});

test('should_block_a_single_memory_when_the_outline_marks_the_file_per_lot', () => {
  const e = entradas('casoC', (f) => {
    f.oportunidad.lotes_interes = ['2', '3'];
    f.decisiones.datos.lotes = ['2', '3'];
    f.guiones[0]!.datos.archivos[1]!.ambito = 'por_lote';
  });

  assert.ok(porClave(reglasDocumentos(e), 'memoria_por_lote:-'));
});

test('should_not_block_the_memory_when_we_go_to_a_single_lot', () => {
  const e = entradas('casoE', (f) => {
    f.oportunidad.lotes_interes = ['2'];
    f.decisiones.datos.lotes = ['2'];
  });

  assert.equal(porClave(reglasDocumentos(e), 'memoria_por_lote:-'), undefined);
});

test('should_not_block_when_the_outline_says_one_memoria_although_the_text_mentions_each_lote', () => {
  // Arrange: el guion trae por_lote: false y una advertencia «se valorará la metodología de cada lote».
  const e = entradas('casoE', (f) => {
    const mem = f.guiones.at(-1)!.datos.memoria!;
    mem.por_lote = false;
    mem.advertencias = [...mem.advertencias, 'Se valorará la metodología de cada lote.'];
  });

  // Act
  const b = porClave(reglasDocumentos(e), 'memoria_por_lote:-');

  // Assert
  assert.equal(b, undefined, 'el pedido de la memoria da una común: las comprobaciones no la pueden exigir por lote');
});

test('should_not_block_when_only_one_lote_of_interest_is_decided', () => {
  // Arrange: ámbito 2 y 4, pero en las decisiones solo el 2.
  const e = entradas('casoE', (f) => {
    f.decisiones.datos.lotes = ['2'];
  });

  // Act
  const b = porClave(reglasDocumentos(e), 'memoria_por_lote:-');

  // Assert
  assert.equal(b, undefined);
});

const FUGA = {
  tipo: 'marca' as const,
  marca: 'ISO 14001',
  cita: 'Contamos con la ISO 14001.',
  criterio: 'Certificación ambiental',
  archivo: 'Sobre C',
  apartado: 2,
  titulo: 'Metodología',
  descripcion: '',
};

test('should_turn_an_unannulled_leak_into_an_impide', () => {
  const otra = { ...FUGA, marca: 'tutores adicionales', criterio: 'Tutores', cita: 'Sumamos tutores adicionales.' };
  const e = entradas('casoE', (f) => {
    f.memorias[0]!.fugas = {
      hallazgos: [FUGA, otra, { ...FUGA, cita: 'Otra vez la ISO 14001.' }],
      anulada: { motivo: 'Es el nombre del órgano', en: '2026-10-14', fugas: [otra] },
    };
  });

  const fugas = deCategoria(reglasDocumentos(e), 'fugas');

  assert.equal(fugas.length, 1);
  assert.equal(fugas[0]!.gravedad, 'impide');
  assert.equal(fugas[0]!.actor, 'tu');
  assert.equal(fugas[0]!.titulo, 'Fuga entre sobres en el apartado 2: «ISO 14001»');
  assert.deepEqual(fugas[0]!.accion, { tipo: 'revisar_memoria', destino: 'memoria.apartado.2' });
});

test('should_treat_an_echo_as_a_risk_and_never_print_an_amount', () => {
  const e = entradas('casoE', (f) => {
    f.memorias[0]!.fugas = {
      hallazgos: [
        { ...FUGA, tipo: 'eco' },
        { ...FUGA, tipo: 'importe', marca: '12.500,00 €', apartado: 3 },
      ],
      anulada: null,
    };
  });

  const fugas = deCategoria(reglasDocumentos(e), 'fugas');

  assert.deepEqual(
    fugas.map((b) => [b.gravedad, b.titulo]),
    [
      ['riesgo', 'Fuga entre sobres en el apartado 2: «ISO 14001»'],
      ['impide', 'Fuga entre sobres en el apartado 3: «el importe»'],
    ],
  );
});

test('should_not_report_leaks_without_a_memory', () => {
  assert.deepEqual(deCategoria(reglasDocumentos(entradas('casoD')), 'fugas'), []);
});

test('should_turn_a_fact_contradiction_into_a_risk', () => {
  const contradiccion: Hallazgo = {
    apartado: 1,
    hecho: 'inicio',
    cita: 'Los cursos empiezan en la semana 6.',
    encontrado: 'semana 6',
    esperado: '15 días',
    tipo: 'contradiccion',
  };
  const herramienta: Hallazgo = {
    apartado: 1,
    hecho: '',
    cita: 'Usaremos Zoom.',
    encontrado: 'Zoom',
    esperado: '',
    tipo: 'herramienta',
  };
  const e = entradas('casoC', (f) => {
    f.memorias[0]!.coherencia = [contradiccion, herramienta, contradiccion];
  });

  const r = deCategoria(reglasDocumentos(e), 'coherencia');

  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravedad, 'riesgo');
  assert.equal(r[0]!.actor, 'tu');
  assert.equal(r[0]!.titulo, 'La memoria dice «semana 6» y las decisiones «15 días»');
  assert.equal(r[0]!.cita?.texto, 'Los cursos empiezan en la semana 6.');
});

test('should_turn_a_name_in_a_role_based_memory_into_a_risk', () => {
  const nombre: Hallazgo = {
    apartado: 2,
    hecho: '',
    cita: 'Coordina Persona A.',
    encontrado: 'Persona A',
    esperado: 'el rol, sin el nombre',
    tipo: 'nombre',
  };
  const e = entradas('casoC', (f) => {
    f.memorias[0]!.coherencia = [nombre];
  });

  const r = deCategoria(reglasDocumentos(e), 'coherencia');

  assert.equal(r.length, 1);
  assert.equal(r[0]!.titulo, 'La memoria nombra a «Persona A» y el pliego pide el equipo por roles, sin nombres');
});

test('should_keep_the_same_keys_between_recalculations', () => {
  const a = reglasDocumentos(entradas('casoC')).map((b) => [b.clave, b.huella]);
  const b = reglasDocumentos(entradas('casoC')).map((x) => [x.clave, x.huella]);

  assert.deepEqual(a, b);
  assert.equal(new Set(a.map(([k]) => k)).size, a.length);
});

// Lo presentado ya no se corrige; las comprobaciones, el MCP y Hoy no lo cuentan como bloqueo.
test('should_not_turn_leaks_or_fact_contradictions_of_the_presentada_into_rows', () => {
  // Arrange
  const contradiccion: Hallazgo = {
    apartado: 1,
    hecho: 'inicio',
    cita: 'Los cursos empiezan en la semana 6.',
    encontrado: 'semana 6',
    esperado: '15 días',
    tipo: 'contradiccion',
  };
  const e = entradas('casoC', (f) => {
    Object.assign(f.memorias[0]!, {
      presentada: true,
      coherencia: [contradiccion],
      fugas: { hallazgos: [FUGA], anulada: null },
    });
  });

  // Act
  const r = reglasDocumentos(e);

  // Assert
  assert.deepEqual([...deCategoria(r, 'fugas'), ...deCategoria(r, 'coherencia')], []);
});

test('should_keep_the_leaks_of_the_open_lote_when_another_lote_is_presented', () => {
  // Arrange
  const base = entradas('casoC');
  const memoria = (version: number, presentada: boolean) => ({
    id: version,
    version,
    estado: 'ensamblada',
    presentada,
    fugas: { hallazgos: [FUGA], anulada: null },
  });
  const e = {
    ...base,
    memoria_lotes: {
      lotes: ['2', '4'],
      rutas_memoria: [],
      por_lote: [
        { lote: '2', memoria: memoria(3, true), hallazgos: [], fugas: memoria(3, true).fugas, aceptadas: [] },
        { lote: '4', memoria: memoria(5, false), hallazgos: [], fugas: memoria(5, false).fugas, aceptadas: [] },
      ],
    },
  } as unknown as EntradasComprobaciones;

  // Act
  const fugas = deCategoria(reglasDocumentos(e), 'fugas');

  // Assert
  assert.deepEqual(
    fugas.map((b) => [b.lote, b.gravedad]),
    [['4', 'impide']],
  );
});

test('should_place_a_leak_of_a_whole_uploaded_version_in_the_text_not_in_section_0', () => {
  // Arrange: la versión subida entera (subidaFlexible.ts) no tiene apartados: la fuga va en el 0.
  const e = entradas('casoE', (f) => {
    f.memorias[0]!.fugas = { hallazgos: [{ ...FUGA, apartado: 0, titulo: '' }], anulada: null };
  });

  // Act
  const fugas = deCategoria(reglasDocumentos(e), 'fugas');

  // Assert
  assert.deepEqual(
    fugas.map((b) => [b.titulo, b.accion.destino]),
    [['Fuga entre sobres en el texto de la memoria: «ISO 14001»', 'memoria']],
  );
});
