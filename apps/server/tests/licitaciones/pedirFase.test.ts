// licitaciones_pedir: Hermes pide una fase de la oferta de una lista cerrada. Pasa por
// el freno de elegibilidad, el tope de runs del día y la guardia de plazo (sin confirmarla nunca),
// no levanta el freno de su tipo y deja un evento «pedido por Hermes». Caso A sintético con
// el ENS sin certificado (impide de elegibilidad) y un modelo Word con el Anexo VI. Datos de
// empresa ficticios (Persona A) y ningún importe real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { CARPETA_PLIEGOS, decisionesCasoA, FICHA_CASO_A, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pedir-fase-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
for (const d of [salidas, conocimiento]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.CONVERSIONES_DIR = path.join(tmp, 'conversiones');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.LICITACIONES_RUNS_OFERTA_DIA = '5';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { claveReactivado, leerMarca } = await import('../../src/nucleo/colaMarcas.js');
const { encolar } = await import('../../src/nucleo/trabajos.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { FichaDatos } = await import('../../src/dominios/licitaciones/ficha.js');
const { GuionEntrada, guionVigente, proponerGuion, TIPO_GUION } =
  await import('../../src/dominios/licitaciones/oferta/guion.js');
const { claveAutoPropuesta, TIPO_PROPUESTA_DECISIONES } =
  await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { claveDeRonda } = await import('../../src/dominios/licitaciones/oferta/rondas.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { aplicarAccionBloqueo } = await import('../../src/dominios/licitaciones/oferta/comprobacionesBloqueos.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { EVENTO_PEDIDO_HERMES, PedirEntrada, pedirFase } =
  await import('../../src/dominios/licitaciones/oferta/pedirFase.js');
type Agente = import('../../src/nucleo/agentes/registro.js').Agente;

iniciarNucleo();
const db = dbLicitaciones();
const dbNucleo = nucleo().db;
const ctx = { db, dbNucleo, raices: { salidas, conocimiento } };
const HERMES: Agente = { nombre: 'hermes', permisos: { licitaciones: 'proponer' } };
const ahora = new Date().toISOString();

const HUECO = '……………………';
const MODELOS = [
  'ANEXO VI',
  'DECLARACIÓN RESPONSABLE',
  `D./Dña. ${HUECO}, en representación de la empresa.`,
  `Fdo.: ${HUECO}`,
];
const docx = await Packer.toBuffer(
  new Document({ sections: [{ children: MODELOS.map((t) => new Paragraph({ children: [new TextRun(t)] })) }] }),
);
fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
fs.writeFileSync(path.join(conocimiento, CARPETA_PLIEGOS, 'Modelos.docx'), docx);
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', 'Modelos.docx', 'descargado', ?, ?)",
).run(ID, 'https://contrataciondelestado.es/Modelos.docx', `${CARPETA_PLIEGOS}/Modelos.docx`, ahora);

const anexoVi = {
  tipo: 'declaracion',
  nombre: 'Anexo VI',
  obligatorio: true,
  produce: 'persona',
  origen: { modelo: 'Anexo VI', documento: 'Modelos.docx', pagina: 1 },
};
const guion = guionCon((g) => {
  g.archivos[0]!.documentos = [g.archivos[0]!.documentos[0]!, g.archivos[0]!.documentos[1]!, anexoVi] as never;
});
const ANEXO_VI = 'a1-d3';

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ahora, ahora);
assert.equal((await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones')).error, null);
const PERFIL = {
  nif: 'B00000000',
  nombre: 'Empresa Ejemplo, S.L.',
  domicilio: 'Calle Ejemplo 1, 38001 Puerto de Ejemplo',
  representante: { nombre: 'Persona A', nif: '00000000T', cargo: 'Administradora única' },
  contacto: { email: 'licitaciones@ejemplo.test' },
  certificados: [],
};
assert.equal(guardarPerfilEmpresa(dbNucleo, PERFIL).error, null);
const PERSONA = crearPersona(dbNucleo, { nombre: 'Persona A', tipo: 'interno', rol: 'Consultora' }).data!.id;
assert.equal(
  guardarDecisiones(db, dbNucleo, ID, { ...decisionesCasoA([PERSONA]), precio: { importe: 10_000, pendiente: false } })
    .error,
  null,
);
// El ENS sin certificado: un excluyente que las comprobaciones enseñan como impide de elegibilidad.
const ENS = {
  tipo: 'certificacion',
  descripcion: 'Certificado de conformidad con el ENS de categoría MEDIA',
  excluyente: true,
  valor_exigido: 'ENS MEDIA',
  cumple: 'no',
  fuente: 'perfil.certificaciones',
  justificacion: 'No tenemos ENS.',
  documento: 'PCAP.pdf',
  pagina: 18,
};
const { id: _id, ...FICHA_BASE } = FICHA_CASO_A;
db.prepare(
  "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?)",
).run(ID, JSON.stringify(FichaDatos.parse({ ...FICHA_BASE, requisitos: [ENS] })), ahora, ahora, ahora);

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MOTIVO = 'La checklist tiene el Anexo VI sin rellenar.';
const entrada = (e: object) => PedirEntrada.parse({ id: ID, motivo: MOTIVO, ...e });
const trabajosDe = (tipo: string) =>
  dbNucleo.prepare('SELECT id, a_mano FROM trabajos_ia WHERE tipo = ? ORDER BY id').all(tipo) as {
    id: number;
    a_mano: number;
  }[];
const eventos = () =>
  (
    dbNucleo
      .prepare('SELECT datos FROM eventos WHERE tipo = ? AND recurso = ? ORDER BY id')
      .all(EVENTO_PEDIDO_HERMES, ID) as { datos: string }[]
  ).map((e) => JSON.parse(e.datos) as Record<string, unknown>);

test('should_refuse_with_an_open_eligibility_brake', async () => {
  // Arrange
  const e = entrada({ fase: 'ronda_memoria', version: 1, motivo: 'Subir el apartado 2 al tramo máximo.' });
  // Act
  const r = await pedirFase(ctx, e, HERMES);
  // Assert
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /Hay un impide de elegibilidad abierto: una persona tiene que decir «Vamos»/);
  assert.match(r.error!.message, /ENS/, 'nombra el bloqueo');
  assert.deepEqual(eventos(), [], 'sin pedido no hay evento');
});

test('should_require_document_key_for_an_annex', () => {
  // Act
  const anexo = PedirEntrada.safeParse({ id: ID, fase: 'anexo', motivo: MOTIVO });
  const ronda = PedirEntrada.safeParse({ id: ID, fase: 'ronda_memoria', motivo: MOTIVO });
  const precio = PedirEntrada.safeParse({ id: ID, fase: 'precio', motivo: MOTIVO });
  // Assert
  assert.equal(anexo.success, false);
  assert.deepEqual(
    anexo.error!.issues.map((i) => i.path.join('.')),
    ['clave_documento'],
  );
  assert.deepEqual(
    ronda.error!.issues.map((i) => i.path.join('.')),
    ['version'],
  );
  assert.equal(precio.success, false, 'el precio no es una fase que pueda pedir un agente');
  assert.equal(
    PedirEntrada.safeParse({ id: ID, fase: 'anexo', clave_documento: ANEXO_VI, motivo: MOTIVO }).success,
    true,
  );
});

test('should_not_lift_the_type_brake_when_asked_by_an_agent', async () => {
  // Arrange: la persona dice «Vamos» al ENS y el freno de elegibilidad se levanta.
  const ens = comprobacionesDe(db, dbNucleo, ID).data!.bloqueos.find(
    (b) => b.clave.startsWith('excluyente_vs_perfil:') && b.estado === 'abierto',
  )!;
  assert.equal(
    aplicarAccionBloqueo(db, ID, ens.clave, { accion: 'vamos', motivo: 'Vamos con la vía alternativa del ENS.' }).error,
    null,
  );
  // Act
  const r = await pedirFase(ctx, entrada({ fase: 'anexo', clave_documento: ANEXO_VI }), HERMES);
  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(trabajosDe(TIPO_ANEXO), [{ id: r.data!.trabajo, a_mano: 0 }], 'encolado como automático');
  assert.equal(leerMarca(dbNucleo, claveReactivado(TIPO_ANEXO, ID)), null, 'el freno del tipo sigue como estaba');
});

test('should_emit_an_event_marked_as_asked_by_hermes', () => {
  // Act
  const [ev] = eventos();
  // Assert
  assert.deepEqual(ev, {
    fase: 'anexo',
    clave_documento: ANEXO_VI,
    version: null,
    agente: 'hermes',
    motivo: MOTIVO,
    trabajo: trabajosDe(TIPO_ANEXO)[0]!.id,
  });
});

// Las comprobaciones y HermesEnVivo leen ese evento: el trabajo sale como «pedido por Hermes».
test('should_show_the_job_as_asked_by_hermes_in_the_comprobaciones_and_live_view', async () => {
  // Arrange: otro trabajo vivo de la oferta que no pidió Hermes.
  const { hermesEnVivo } = await import('../../src/dominios/licitaciones/oferta/hermesEnVivo.js');
  const pedido = trabajosDe(TIPO_ANEXO)[0]!.id;
  const otro = encolar(dbNucleo, {
    tipo: 'licitaciones.prueba_persona',
    dominio: 'licitaciones',
    clave: 'prueba-persona',
    payload: { id: ID },
  });
  // Act
  const vivo = hermesEnVivo(db, dbNucleo, ID).data!;
  const comprobaciones = comprobacionesDe(db, dbNucleo, ID).data!;
  dbNucleo.prepare('DELETE FROM trabajos_ia WHERE id = ?').run(otro);
  // Assert
  assert.deepEqual(
    vivo.trabajos.map((t) => [t.id, t.pedido_por_hermes]),
    [
      [pedido, true],
      [otro, false],
    ],
  );
  assert.equal(comprobaciones.hermes?.pedido_por_hermes, true, 'el más antiguo en curso es el que pidió Hermes');
});

test('should_be_idempotent_for_the_same_phase_and_day', async () => {
  // Arrange
  const primero = trabajosDe(TIPO_ANEXO)[0]!.id;
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE id = ?").run(primero);
  // Act
  const otraVez = await pedirFase(ctx, entrada({ fase: 'anexo', clave_documento: ANEXO_VI }), HERMES);
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'fallido' WHERE id = ?").run(primero);
  const trasFallar = await pedirFase(ctx, entrada({ fase: 'anexo', clave_documento: ANEXO_VI }), HERMES);
  // Assert
  assert.equal(otraVez.data?.trabajo, primero, 'el mismo día devuelve el mismo trabajo aunque ya terminara');
  assert.equal(trasFallar.error, null, trasFallar.error?.message);
  assert.notEqual(trasFallar.data!.trabajo, primero, 'si falló, se puede volver a pedir');
  assert.equal(eventos().length, 2, 'un evento por pedido encolado, no por llamada');
});

test('should_never_skip_the_deadline_guard', async () => {
  // Arrange: quedan 30 minutos; la web lo dejaría pasar con «confirmado», un agente no.
  const original = (
    db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(ID) as { fecha_limite: string }
  ).fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(
    horaLocalEspana(Date.now() + 30 * 60_000),
    ID,
  );
  const antes = trabajosDe(TIPO_GUION).length;
  // Act
  const r = await pedirFase(ctx, entrada({ fase: 'guion' }), HERMES);
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(original, ID);
  // Assert
  assert.equal(r.error?.code, 'plazo_justo');
  assert.match(r.error!.message, /Un agente no puede confirmarlo/);
  assert.equal(trabajosDe(TIPO_GUION).length, antes, 'no se encola nada');
});

test('should_reject_when_offer_is_discarded', async () => {
  // Arrange: una persona la descartó a mano (sin bloqueo de elegibilidad).
  const estado = (db.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ?').get(ID) as { estado: string })
    .estado;
  db.prepare(
    "UPDATE oportunidades SET estado = 'descartada', motivo_descarte = 'No llegamos al plazo' WHERE licitacion_id = ?",
  ).run(ID);
  const antes = trabajosDe(TIPO_GUION).length;
  // Act
  const r = await pedirFase(ctx, entrada({ fase: 'guion' }), HERMES);
  db.prepare('UPDATE oportunidades SET estado = ?, motivo_descarte = NULL WHERE licitacion_id = ?').run(estado, ID);
  // Assert
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /descartada o retirada/);
  assert.equal(trabajosDe(TIPO_GUION).length, antes, 'no se gasta ningún run');
});

test('should_reject_ficha_when_deadline_passed', async () => {
  // Arrange: el plazo de presentación acabó hace una hora.
  const original = (
    db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(ID) as { fecha_limite: string }
  ).fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(horaLocalEspana(Date.now() - 3_600_000), ID);
  const antes = trabajosDe('licitaciones.ficha').length;
  // Act
  const r = await pedirFase(ctx, entrada({ fase: 'ficha' }), HERMES);
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(original, ID);
  // Assert
  assert.equal(r.error?.code, 'plazo_vencido');
  assert.equal(trabajosDe('licitaciones.ficha').length, antes);
});

test('should_point_to_licitaciones_documentos_for_the_document_key', () => {
  // Act
  const r = PedirEntrada.safeParse({ id: ID, fase: 'anexo', motivo: MOTIVO });
  // Assert
  assert.match(r.error!.issues[0]!.message, /licitaciones_documentos › documentos\[\]\.clave/);
});

test('should_refuse_over_the_daily_run_cap', async () => {
  // Arrange: cinco runs lanzados hoy para la oferta (LICITACIONES_RUNS_OFERTA_DIA=5).
  const lanzados = Array.from({ length: 5 }, (_, i) =>
    encolar(dbNucleo, {
      tipo: 'licitaciones.prueba',
      dominio: 'licitaciones',
      clave: `prueba-${i}`,
      payload: { id: ID },
    }),
  );
  dbNucleo
    .prepare("UPDATE trabajos_ia SET lanzado_en = ?, estado = 'completado' WHERE tipo = 'licitaciones.prueba'")
    .run(new Date().toISOString());
  // Act
  const r = await pedirFase(ctx, entrada({ fase: 'guion' }), HERMES);
  dbNucleo.prepare("DELETE FROM trabajos_ia WHERE tipo = 'licitaciones.prueba'").run();
  // Assert
  assert.equal(lanzados.length, 5);
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /tope 5/);
});

test('should_create_a_new_proposal_job_when_the_automatic_one_already_finished', async () => {
  // Arrange: la propuesta automática de la ronda 0 de este guion ya se hizo.
  const g = guionVigente(db, ID)!;
  const viejo = encolar(dbNucleo, {
    tipo: TIPO_PROPUESTA_DECISIONES,
    dominio: 'licitaciones',
    clave: claveDeRonda(claveAutoPropuesta(ID, g.id), 0),
    payload: { id: ID, guion_id: g.id, pedida_en: ahora },
  });
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE id = ?").run(viejo);
  // Act
  const r = await pedirFase(ctx, entrada({ fase: 'propuesta' }), HERMES);
  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.notEqual(r.data!.trabajo, viejo, 'un run nuevo, no el de la propuesta automática');
  const nuevo = dbNucleo.prepare('SELECT estado, a_mano FROM trabajos_ia WHERE id = ?').get(r.data!.trabajo) as {
    estado: string;
    a_mano: number;
  };
  assert.deepEqual({ ...nuevo }, { estado: 'pendiente', a_mano: 0 });
});

test('should_create_an_improvement_round_with_the_base_evaluation_when_hermes_asks_for_it', async () => {
  // Arrange: la v1 montada por fases y evaluada; los apartados 2 y 4 quedan por debajo de su tramo máximo.
  const { instruccionesRedaccion, TIPO_MEMORIA_REDACCION } =
    await import('../../src/dominios/licitaciones/oferta/redaccion.js');
  const g = guionVigente(db, ID)!;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, fase, ronda) VALUES (?, ?, 1, 'ensamblada', ?, ?, 'fin', 0)",
      )
      .run(ID, g.id, ahora, ahora).lastInsertRowid,
  );
  const titulos = g.datos.memoria!.apartados.map((a) => a.titulo);
  titulos.forEach((titulo, i) =>
    db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos) VALUES (?, ?, 'recibido', ?)").run(
      m,
      i + 1,
      JSON.stringify({
        titulo: `${i + 1}. ${titulo}`,
        bloques: [{ parrafos: [`Texto del apartado ${i + 1} con el procedimiento que sigue el equipo.`] }],
        cubre: [],
        compromisos: [],
      }),
    ),
  );
  const tramos = [8, 3, 6, 2];
  const puntos = g.datos.memoria!.apartados.map((a) => a.puntos);
  const evaluacion = {
    resumen: 'Concreta en la organización; floja en indicadores y mejoras.',
    puntuacion_total: tramos.reduce((s, t) => s + t, 0),
    puntuacion_maxima: puntos.reduce((s, p) => s + p, 0),
    criterios: titulos.map((titulo, i) => ({
      criterio: titulo,
      peso: puntos[i],
      tipo: 'juicio_valor',
      apartado: i + 1,
      tramo: tramos[i],
      puntuacion: tramos[i],
      justificacion: i === 1 ? 'Los indicadores no tienen meta ni frecuencia.' : 'Concreto.',
      referencia: `${i + 1}. ${titulo}`,
    })),
    eliminar: [],
    modificar: [{ referencia: `2. ${titulos[1]}`, que: 'Poner meta numérica a cada indicador.' }],
    reforzar: [],
    comparables: [],
    riesgos: [],
    genericos: [],
    memoria: { version: 1, guion_id: g.id },
  };
  db.prepare(
    "INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES (?, 'Salidas/memoria-v1.docx', ?, 'licitaciones', ?)",
  ).run(ID, JSON.stringify(evaluacion), ahora);
  const MOTIVO_RONDA = 'Subir los apartados flojos al tramo máximo.';

  // Act
  const r = await pedirFase(ctx, entrada({ fase: 'ronda_memoria', version: 1, motivo: MOTIVO_RONDA }), HERMES);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  const v2 = db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = 2').get(ID) as {
    id: number;
    guion_id: number;
    pedida_en: string;
    apartados_rehechos: string;
    indicaciones: string | null;
    motivo_agente: string | null;
    mejora: number;
    por_agente: number;
  };
  assert.deepEqual(
    [JSON.parse(v2.apartados_rehechos), v2.indicaciones, v2.motivo_agente, v2.mejora, v2.por_agente],
    [[2, 4], null, MOTIVO_RONDA, 1, 1],
  );
  const redaccion = trabajosDe(TIPO_MEMORIA_REDACCION);
  assert.deepEqual(redaccion, [{ id: r.data!.trabajo, a_mano: 0 }], 'el trabajo de redacción, sin levantar el freno');
  const inst = instruccionesRedaccion(db, dbNucleo, {
    id: ID,
    memoria_id: v2.id,
    guion_id: v2.guion_id,
    version: 2,
    ronda: 0,
    pedida_en: v2.pedida_en,
  });
  const apartado2 = inst.slice(inst.indexOf('=== Apartado 2 ==='), inst.indexOf('=== Apartado 4 ==='));
  assert.match(
    apartado2,
    /MEJORA DE LA VERSIÓN 1: este apartado ya se redactó y la evaluación propia lo deja en el tramo de 3 puntos/,
  );
  assert.match(apartado2, /Justificación de la evaluación: «Los indicadores no tienen meta ni frecuencia\.»/);
  assert.match(apartado2, /- Modificar: Poner meta numérica a cada indicador\./);
  assert.match(apartado2, /HERMES PIDIÓ ESTA RONDA PORQUE: Subir los apartados flojos al tramo máximo\. \(es contexto/);
  assert.doesNotMatch(inst, /CAMBIO TARDÍO|Cambió lo decidido/);
});
