// Coherencia de la oferta en el caso E de las comprobaciones: seis
// lotes, lotes de interés 2 y 4, ficha hecha para el 2 y el 6, decisiones guardadas para el
// 2, el 6 y el 4 con un solo precio de 70 €/alumno (por debajo del umbral del 15 % del pliego,
// 93,71 €), equipo solo con la tutora y la nota de rectificación sin bajar. La pestaña
// Preparación decía «Todo listo»: ahora la coherencia lo bloquea y dice qué arreglar.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coherencia-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, path.join(tmp, 'salidas')]) fs.mkdirSync(d, { recursive: true });
const T_LICI = 'l'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { actualizarPersona, crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { encolar } = await import('../../src/nucleo/trabajos.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion, obtenerLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { elegirLotesInteres } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { carpetaPliegos } = await import('../../src/dominios/licitaciones/pliegos.js');
const { GuionEntrada, encolarGuionesAuto, guionVigente, proponerGuion } =
  await import('../../src/dominios/licitaciones/oferta/guion.js');
const { decisionesDe, guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { coherenciaOferta, rolExigido, umbralDelPliego, umbralIlegible } =
  await import('../../src/dominios/licitaciones/oferta/coherencia.js');
const { faltaDePreparacion } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { hojaDeDatos } = await import('../../src/dominios/licitaciones/oferta/hojaDatos.js');
const { cambiarDocumento, documentosDe } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { registrarSincronizacionDocumentos } = await import('../../src/dominios/licitaciones/oferta/documentosSync.js');
const { estadoPaquete } = await import('../../src/dominios/licitaciones/oferta/paquete.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { vueltaCadena } = await import('../../src/dominios/licitaciones/oferta/cadena.js');

iniciarNucleo();
// Como en producción (iniciarLicitaciones): la checklist se sincroniza con los eventos, no al leerla.
registrarSincronizacionDocumentos();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const AHORA = Date.parse('2026-10-14T01:30:00Z');
const ELISA = crearPersona(nucleo().db, { nombre: 'Elisa Ejemplo', tipo: 'interno', rol: 'Formadora' }).data!.id;
const MARIA = crearPersona(nucleo().db, { nombre: 'María José Ejemplo', tipo: 'externo', rol: 'Docente' }).data!.id;

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const LOTES = [
  { id: '1', nombre: 'Primeros auxilios básicos', importe: 3_000 },
  { id: '2', nombre: 'Análisis de datos con hojas de cálculo', importe: 6_063.75 },
  { id: '3', nombre: 'Archivo electrónico', importe: 2_000 },
  { id: '4', nombre: 'Atención al público', importe: 756 },
  { id: '5', nombre: 'Seguridad en el puesto', importe: 4_000 },
  { id: '6', nombre: 'Residuos sanitarios', importe: 6_682.5 },
];
const placsp = (nombre: string) => ({
  clase: 'adicional' as const,
  nombre,
  url: `https://contrataciondelestado.es/doc/${encodeURIComponent(nombre)}`,
  hash: null,
});
const BASES = { ...placsp('Bases.pdf'), clase: 'pcap' as const };
const NOTA = placsp('Nota de rectificación ENS.pdf');
const MEMORIA_JUSTIFICATIVA = placsp('Memoria justificativa.pdf');
const UMBRAL =
  'Se considerarán anormalmente bajas las ofertas inferiores en un 15 % al presupuesto base de licitación, IGIC excluido (apartado J).';

const docente = (lote: string, que: string) => ({
  tipo: 'medios_personales',
  descripcion: `Docente principal con titulación relacionada y formación específica en ${que}`,
  excluyente: true,
  cumple: 'dudoso',
  justificacion: 'Falta el certificado del curso.',
  documento: 'Bases.pdf',
  pagina: 64,
  lote,
});
const FICHA = {
  resumen: 'Formación subvencionada FFI para la plantilla de CASO_E en seis lotes (lotes 2 y 6 de interés).',
  requisitos: [docente('2', 'hojas de cálculo avanzadas'), docente('6', 'Residuos sanitarios')],
  criterios: [],
  documentacion: [],
  hitos: [],
  garantias: [],
  penalizaciones: [],
  riesgos: [],
  recomendacion: { decision: 'revisar', motivo: 'Hay que confirmar el ENS.' },
};
const GUION = {
  archivos: [
    {
      nombre: 'Archivo electrónico único',
      contenido: 'Anexos, memoria no valorable y oferta económica.',
      documentos: [{ tipo: 'declaracion', nombre: 'Anexo I', obligatorio: true, produce: 'persona' }],
      documento: 'Bases.pdf',
      pagina: 25,
    },
  ],
  memoria: null,
  automaticos: [],
  oferta_economica: {
    formula: 'P = 40 × (Om / O)',
    presupuesto_base: 6_063.75,
    impuesto_aparte: 'IGIC',
    precio_unitario: { unidad: 'alumno', maximo: 110.25 },
    umbral_anormalidad: UMBRAL,
    modelo: 'Anexo VI',
    archivo: 'Archivo electrónico único',
    documento: 'Bases.pdf',
    pagina: 53,
  },
  plazo: { fecha_limite: '2026-10-15T08:00', canal: 'PLACSP' },
  lotes: ['2', '4'],
};

const interes = (ids: string[]) => JSON.stringify(ids.map((id) => ({ id, motivo: 'criba' })));

// El plazo real era el 15/10/2026 a las 08:00; lejos, para que el aviso de plazo cercano no
// dependa del día en que se pasen las pruebas (tiene la suya, con su instante).
const LIMITE_LEJANO = '2099-10-15T08:00:00';

/** El caso de CASO_E con otro id: ficha hecha para el 2 y el 6, guion para el 2 y el 4 y las decisiones de la mañana. */
async function casoE(id: string): Promise<void> {
  const l = licitacion({
    titulo: 'Formación subvencionada FFI (6 lotes)',
    publicada: '2026-09-24',
    presupuesto: 30_000,
    lotes: LOTES,
    limite: LIMITE_LEJANO,
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, documentos: [BASES, NOTA, MEMORIA_JUSTIFICATIVA] });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, interes(['2', '6']), ts, ts);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'pcap', 'Bases.pdf', 'descargado', ?, ?)",
  ).run(id, BASES.url, `Licitaciones/Radar/2026/17-26 (${id})/Bases.pdf`, ts);
  assert.equal(
    (await proponerFicha(db, { ...FICHA, id } as Parameters<typeof proponerFicha>[1], 'licitaciones')).error,
    null,
  );
  assert.equal(elegirLotesInteres(db, id, { lotes: ['2', '4'] }).error, null);
  assert.equal((await proponerGuion(db, GuionEntrada.parse({ ...GUION, id }), 'licitaciones')).error, null);
  const datos = {
    lotes: ['2', '6', '4'],
    equipo: [{ persona_id: ELISA, rol_en_la_oferta: 'Tutora titular' }],
    automaticos: [],
    herramientas: [],
    enfoque: 'Lote 6 en Residuos sanitarios.',
    precio: { importe: 70, pendiente: false },
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guionVigente(db, id)!.id,
    JSON.stringify(datos),
    ts,
  );
}

const resumen = (id: string) => coherenciaOferta(db, id).map((c) => `${c.gravedad}:${c.tipo}`);
const mensaje = (id: string, tipo: string) => coherenciaOferta(db, id).find((c) => c.tipo === tipo)?.mensaje ?? '';

test('should_block_the_casoE_offer_listing_every_incoherence_with_what_blocks_first', async () => {
  await casoE('p-91000080');
  assert.deepEqual(
    resumen('p-91000080'),
    [
      'bloquea:ficha_lotes',
      'bloquea:pliegos',
      'bloquea:lotes_decisiones',
      'bloquea:precio_anormal',
      'bloquea:precio_anormal',
      'aviso:pliegos',
      'aviso:equipo',
    ],
    'el precio de antes vale para cada lote: los lotes 2 y 4 bajan del umbral, cada uno con su aviso',
  );
  const c = coherenciaOferta(db, 'p-91000080').filter(
    (x) => !(x.tipo === 'precio_anormal' && /lote 4/.test(x.mensaje)),
  );
  assert.deepEqual(
    c.map((x) => x.donde),
    ['ficha', 'pliegos', 'decisiones', 'decisiones', 'pliegos', 'decisiones'],
  );
  assert.equal(
    c[0]!.mensaje,
    'La ficha se hizo para los lotes 2, 6 y vamos a los lotes 2, 4: no ha comprobado los requisitos del lote 4. Genera la ficha otra vez.',
  );
  assert.match(
    c[1]!.mensaje,
    /un documento que no se ha bajado y Hermes no ha leído: «Nota de rectificación ENS\.pdf»\. Son modelos, el DEUC o rectificaciones/,
  );
  assert.equal(
    c[2]!.mensaje,
    'Las decisiones son para los lotes 2, 6, 4 y vamos a los lotes 2, 4 (bloque Lotes del Resumen): guarda otra vez las decisiones o, si son otros, cámbialos antes en el bloque Lotes.',
  );
  assert.match(
    c[3]!.mensaje,
    /^El precio por alumno del lote 2 está por debajo del umbral de anormalidad que fija el pliego \(baja del 15 %: 93,71 € por alumno\)/,
  );
  assert.match(c[4]!.mensaje, /«Memoria justificativa\.pdf»/);
  assert.match(
    c[5]!.mensaje,
    /«Docente principal con titulación relacionada y formación específica en hojas de cálculo avanzadas» \(lote 2\)/,
  );
  assert.doesNotMatch(c[5]!.mensaje, /Residuos sanitarios/, 'el requisito del lote 6 no cuenta: no vamos a ese lote');
  assert.ok(
    c.every((x) => !/\b70\b/.test(x.mensaje)),
    'los mensajes no dicen el precio decidido (también los lee Hermes)',
  );
});

test('should_take_the_lots_of_interest_when_saving_decisions_and_refuse_others', async () => {
  await casoE('p-91000090');
  const decisiones = (lotes: string[], importe: number | null = 98.3) => ({
    lotes,
    equipo: [
      { persona_id: MARIA, rol_en_la_oferta: 'Docente principal del lote 2' },
      { persona_id: ELISA, rol_en_la_oferta: 'Tutora titular' },
    ],
    automaticos: [],
    herramientas: ['Aula Abierta'],
    enfoque: 'Lote 2 con hojas de cálculo.',
    precio: { importe, pendiente: importe === null },
  });
  const otros = guardarDecisiones(db, nucleo().db, 'p-91000090', decisiones(['2', '6', '4']));
  assert.equal(otros.error?.code, 'invalid_input');
  assert.equal(
    otros.error?.message,
    'Las decisiones son para los lotes 2, 6, 4 y vamos a los lotes 2, 4 (bloque Lotes del Resumen): guarda otra vez las decisiones o, si son otros, cámbialos antes en el bloque Lotes.',
  );
  assert.match(
    guardarDecisiones(db, nucleo().db, 'p-91000090', decisiones(['2'])).error?.message ?? '',
    /son para el lote 2 y vamos a los lotes 2, 4/,
  );
  assert.match(
    guardarDecisiones(db, nucleo().db, 'p-91000090', decisiones(['9'])).error?.message ?? '',
    /El lote «9» no existe en esta licitación/,
  );

  const sinLotes = guardarDecisiones(db, nucleo().db, 'p-91000090', decisiones([]));
  assert.equal(sinLotes.error, null);
  assert.deepEqual(decisionesDe(db, 'p-91000090')?.datos.lotes, ['2', '4'], 'sin lotes, los de interés');
  assert.equal(
    guardarDecisiones(db, nucleo().db, 'p-91000090', decisiones(['4', '2'])).error,
    null,
    'el orden no cuenta',
  );
  assert.deepEqual(
    resumen('p-91000090'),
    ['bloquea:ficha_lotes', 'bloquea:pliegos', 'aviso:pliegos', 'aviso:medios_sin_acreditar'],
    'precio por lote sin avisos y docente en el equipo',
  );
  assert.match(
    mensaje('p-91000090', 'medios_sin_acreditar'),
    /^Docente de hojas de cálculo avanzadas \(lote 2\): nadie en el equipo con «hojas de cálculo avanzadas» \(María José Ejemplo \(Docente principal del lote 2\) no lo tiene registrado\)/,
    'la docente está, pero sin la formación del curso',
  );
});

test('should_ask_for_the_outline_again_when_a_person_adds_lots_the_outline_does_not_cover', async () => {
  await casoE('p-91000100');
  const listo = () => 'listo' as const;
  const claves = () =>
    (
      nucleo().db.prepare("SELECT clave FROM trabajos_ia WHERE clave LIKE 'guion-auto-p-91000100%'").all() as {
        clave: string;
      }[]
    ).map((x) => x.clave);
  assert.equal(encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo }), 0, 'el guion ya es de los lotes 2 y 4');

  assert.deepEqual(elegirLotesInteres(db, 'p-91000100', { lotes: ['2', '4', '5'] }).data?.lotes, ['2', '4', '5']);
  const ev = ultimosEventos(nucleo().db, 50).find((e) => e.tipo === 'licitacion.lotes' && e.recurso === 'p-91000100');
  assert.deepEqual(ev?.datos, { lotes: ['2', '4', '5'] });
  assert.deepEqual(
    resumen('p-91000100').filter((x) => x.endsWith('guion_lotes')),
    ['bloquea:guion_lotes'],
  );
  assert.match(
    mensaje('p-91000100', 'guion_lotes'),
    /^El guion se extrajo para los lotes 2, 4 y vamos a los lotes 2, 4, 5: hay que volver a extraerlo/,
  );

  assert.equal(encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo }), 1);
  const ficha = (
    db.prepare("SELECT MAX(id) AS id FROM fichas WHERE licitacion_id = 'p-91000100'").get() as { id: number }
  ).id;
  assert.deepEqual(claves(), [`guion-auto-p-91000100-f${ficha}-l2+4+5`]);
  assert.equal(encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo }), 0, 'una vez por ficha y lotes');
});

test('should_chain_a_ficha_for_the_lots_of_interest_then_the_outline_then_a_proposal_keeping_the_saved_decisions', async () => {
  // CASO_E (medición del 14/10/2026): la ficha seguía en los lotes 2 y 6 con el 2 y el 4 de interés y nada la rehacía.
  const ID = 'p-91000280';
  await casoE(ID);
  const listo = () => 'listo' as const;
  const claves = (tipo: string) =>
    (
      nucleo()
        .db.prepare("SELECT clave FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.id') = ? ORDER BY id")
        .all(tipo, ID) as { clave: string }[]
    ).map((t) => t.clave);
  const completar = (clave: string) =>
    nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE clave = ?").run(clave);
  const fichaVieja = (db.prepare('SELECT MAX(id) AS id FROM fichas WHERE licitacion_id = ?').get(ID) as { id: number })
    .id;
  const antes = decisionesDe(db, ID);

  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.deepEqual(
    claves('licitaciones.ficha'),
    [`ficha-auto-${ID}-v${fichaVieja}-l2+4`],
    'la ficha no comprobó el lote 4',
  );
  assert.deepEqual(claves('licitaciones.decisiones'), [], 'las decisiones son del guion vigente');

  // Hermes deja la ficha de los lotes 2 y 4 (simulado).
  const ficha = { ...FICHA, requisitos: [docente('2', 'hojas de cálculo avanzadas'), docente('4', 'Redes sociales')] };
  assert.equal(
    (await proponerFicha(db, { ...ficha, id: ID } as Parameters<typeof proponerFicha>[1], 'licitaciones')).error,
    null,
  );
  completar(`ficha-auto-${ID}-v${fichaVieja}-l2+4`);
  const fichaNueva = (db.prepare('SELECT MAX(id) AS id FROM fichas WHERE licitacion_id = ?').get(ID) as { id: number })
    .id;
  assert.ok(!resumen(ID).includes('bloquea:ficha_lotes'));
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.equal(claves('licitaciones.ficha').length, 1, 'la ficha nueva ya es de los lotes de interés');
  assert.deepEqual(claves('licitaciones.guion'), [`guion-auto-${ID}-f${fichaNueva}-l2+4`], 'ficha nueva: guion nuevo');

  // Hermes deja el guion (simulado) y la cadena pide la propuesta sin pisar lo guardado. Trae otro
  // presupuesto: un guion idéntico pasaría las decisiones al nuevo (rebase.ts) sin propuesta.
  const nuevo = { ...GUION, oferta_economica: { ...GUION.oferta_economica, presupuesto_base: 6_500 }, id: ID };
  const g = await proponerGuion(db, GuionEntrada.parse(nuevo), 'licitaciones');
  completar(`guion-auto-${ID}-f${fichaNueva}-l2+4`);
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.deepEqual(claves('licitaciones.decisiones'), [`decisiones-auto-${ID}-g${g.data!.guion}`]);
  assert.deepEqual(decisionesDe(db, ID), antes);
});

test('should_only_warn_when_we_go_to_fewer_lots_than_the_outline_covers', async () => {
  // CASO_E, paso 6 del diario: guion de los lotes 2 y 4 y el día antes del cierre se va solo al 2.
  await casoE('p-91000170');
  assert.equal(elegirLotesInteres(db, 'p-91000170', { lotes: ['2'] }).error, null);
  assert.deepEqual(
    resumen('p-91000170').filter((x) => x.endsWith('guion_lotes')),
    ['aviso:guion_lotes'],
  );
  assert.match(mensaje('p-91000170', 'guion_lotes'), /^El guion cubre también el lote 4 y vamos solo al lote 2/);
  assert.equal(
    encolarGuionesAuto(nucleo().db, db, AHORA, { legible: () => 'listo' as const }),
    0,
    'no hace falta otro guion',
  );
  assert.ok(!faltaDePreparacion(db, 'p-91000170').some((f) => /lotes cambiaron/.test(f)));
});

test('should_block_and_ask_for_the_outline_again_when_a_key_document_arrives_after_it', async () => {
  // CASO_E: la nota de rectificación del ENS se bajó después del guion; ya no «falta», pero Hermes no la leyó.
  await casoE('p-91000180');
  const despues = new Date(Date.now() + 60_000).toISOString();
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES ('p-91000180', ?, 'adicional', ?, 'descargado', ?)",
  ).run(NOTA.url, NOTA.nombre, despues);
  const nuevos = coherenciaOferta(db, 'p-91000180').filter((c) => c.tipo === 'pliegos_nuevos');
  assert.deepEqual(
    nuevos.map((c) => `${c.gravedad}:${c.donde}`),
    ['bloquea:guion', 'aviso:ficha'],
  );
  assert.match(
    nuevos[0]!.mensaje,
    /^Llegó un documento después del guion que Hermes no ha leído: «Nota de rectificación ENS\.pdf»/,
  );
  assert.equal(encolarGuionesAuto(nucleo().db, db, AHORA, { legible: () => 'listo' as const }), 1);
  const claves = (
    nucleo().db.prepare("SELECT clave FROM trabajos_ia WHERE clave LIKE 'guion-auto-p-91000180%'").all() as {
      clave: string;
    }[]
  ).map((x) => x.clave);
  assert.match(claves[0] ?? '', /-p1-g\d+$/, claves.join(','));
  assert.equal(
    encolarGuionesAuto(nucleo().db, db, AHORA, { legible: () => 'listo' as const }),
    0,
    'una vez por documento nuevo',
  );
});

test('should_requeue_the_outline_once_when_it_was_extracted_with_an_older_prompt_and_several_lots', async () => {
  await casoE('p-91000340');
  const listo = () => 'listo' as const;
  const claves = () =>
    (
      nucleo().db.prepare("SELECT clave FROM trabajos_ia WHERE clave LIKE 'guion-auto-p-91000340%'").all() as {
        clave: string;
      }[]
    ).map((x) => x.clave);
  assert.equal(encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo }), 0, 'extraído con el prompt de ahora');
  db.prepare("UPDATE guiones SET version_prompt = 3 WHERE licitacion_id = 'p-91000340'").run();
  assert.equal(encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo }), 1);
  const ficha = (
    db.prepare("SELECT MAX(id) AS id FROM fichas WHERE licitacion_id = 'p-91000340'").get() as { id: number }
  ).id;
  assert.deepEqual(claves(), [`guion-auto-p-91000340-f${ficha}-l2+4-v4`]);
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE clave LIKE 'guion-auto-p-91000340%'").run();
  assert.equal(encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo }), 0, 'una vez por ficha');

  assert.deepEqual(elegirLotesInteres(db, 'p-91000340', { lotes: ['2'] }).data?.lotes, ['2']);
  db.prepare(
    "UPDATE guiones SET datos = json_set(datos, '$.lotes', json('[\"2\"]')) WHERE licitacion_id = 'p-91000340'",
  ).run();
  assert.equal(
    encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo }),
    0,
    'con un solo lote, el guion antiguo vale',
  );
});

test('should_flag_lots_over_the_presentation_rule_instead_of_trimming_them', async () => {
  await casoE('p-91000110');
  db.prepare("UPDATE licitaciones SET max_lotes_oferta = 1 WHERE id = 'p-91000110'").run();
  const c = coherenciaOferta(db, 'p-91000110')[0]!;
  assert.deepEqual([c.tipo, c.gravedad, c.donde], ['lotes_regla', 'bloquea', 'lotes']);
  assert.equal(
    c.mensaje,
    'La regla permite un solo lote por oferta y 2 lotes son de interés (2, 4): elige a cuál vamos en el bloque Lotes.',
  );
});

test('should_warn_when_an_older_sheet_seems_made_for_other_lots', async () => {
  await casoE('p-91000120');
  const f = db.prepare("SELECT id, datos FROM fichas WHERE licitacion_id = 'p-91000120'").get() as {
    id: number;
    datos: string;
  };
  const { ambito_lotes: _ambito, ...antigua } = JSON.parse(f.datos) as Record<string, unknown>;
  db.prepare('UPDATE fichas SET datos = ? WHERE id = ?').run(JSON.stringify(antigua), f.id);
  const c = coherenciaOferta(db, 'p-91000120').find((x) => x.tipo === 'ficha_lotes')!;
  assert.deepEqual(
    [c.gravedad, c.mensaje],
    [
      'aviso',
      'La ficha parece hecha para otros lotes: trae requisitos de los lotes 2, 6 y ninguno del lote 4. Si vamos a los lotes 2, 4, genérala otra vez.',
    ],
  );
});

// Deja la ficha de `id` con estos requisitos y este ámbito (null: ficha anterior a ambito_lotes).
function fichaCon(id: string, requisitos: unknown[], ambito: string[] | null): void {
  const f = db.prepare('SELECT id, datos FROM fichas WHERE licitacion_id = ?').get(id) as { id: number; datos: string };
  const { ambito_lotes: _a, ...datos } = JSON.parse(f.datos) as Record<string, unknown>;
  db.prepare('UPDATE fichas SET datos = ? WHERE id = ?').run(
    JSON.stringify({ ...datos, requisitos, ...(ambito ? { ambito_lotes: ambito } : {}) }),
    f.id,
  );
}
const MENSAJE_SIN_LOTE_4 =
  'La ficha trae requisitos del lote 2 y ninguno del lote 4, y vamos al lote 4: no ha comprobado su solvencia. Genera la ficha otra vez.';

test('should_block_when_the_sheet_has_no_requirements_for_a_lot_we_go_to', async () => {
  // CASO_E, 14/10 12:14: ficha rehecha para {2,4} sin ningún requisito del lote 4 y aun así «Todo listo».
  await casoE('p-91000290');
  fichaCon('p-91000290', [docente('2', 'hojas de cálculo avanzadas')], ['2', '4']);
  const c = coherenciaOferta(db, 'p-91000290').find((x) => x.tipo === 'ficha_lotes')!;
  assert.deepEqual([c.gravedad, c.mensaje], ['bloquea', MENSAJE_SIN_LOTE_4]);
  fichaCon('p-91000290', [docente('2', 'hojas de cálculo avanzadas')], []);
  assert.ok(resumen('p-91000290').includes('bloquea:ficha_lotes'), 'también con la ficha del contrato entero');
});

test('should_not_block_when_every_requirement_is_common_to_all_lots', async () => {
  await casoE('p-91000300');
  const comun = { ...docente('2', 'hojas de cálculo avanzadas'), lote: undefined };
  fichaCon('p-91000300', [comun], ['2', '4']);
  assert.ok(!resumen('p-91000300').includes('bloquea:ficha_lotes'));
});

test('should_only_warn_when_the_lot_has_no_own_requirements_but_the_sheet_brings_common_ones', async () => {
  // Solvencia común al contrato: el lote 4 puede no tener la suya, así que no se bloquea para siempre.
  await casoE('p-91000320');
  const comun = { ...docente('2', 'hojas de cálculo avanzadas'), lote: undefined };
  fichaCon('p-91000320', [docente('2', 'hojas de cálculo avanzadas'), comun], ['2', '4']);
  const c = coherenciaOferta(db, 'p-91000320').find((x) => x.tipo === 'ficha_lotes')!;
  assert.deepEqual(
    [c.gravedad, c.mensaje],
    [
      'aviso',
      'La ficha no trae requisitos propios del lote 4, solo comunes, y vamos al lote 4: compruébalo en el pliego.',
    ],
  );
  assert.ok(!resumen('p-91000320').includes('bloquea:ficha_lotes'));
});

test('should_say_nothing_when_the_sheet_has_own_requirements_for_every_lot_we_go_to', async () => {
  await casoE('p-91000330');
  fichaCon('p-91000330', [docente('2', 'hojas de cálculo avanzadas'), docente('4', 'atención al público')], ['2', '4']);
  assert.equal(
    coherenciaOferta(db, 'p-91000330').find((x) => x.tipo === 'ficha_lotes'),
    undefined,
  );
});

test('should_block_an_older_sheet_with_requirements_of_only_some_lots_we_go_to', async () => {
  await casoE('p-91000310');
  fichaCon('p-91000310', [docente('2', 'hojas de cálculo avanzadas')], null);
  const c = coherenciaOferta(db, 'p-91000310').find((x) => x.tipo === 'ficha_lotes')!;
  assert.deepEqual([c.gravedad, c.mensaje], ['bloquea', MENSAJE_SIN_LOTE_4]);
});

test('should_not_flag_tender_documents_downloaded_or_left_by_hand_in_the_tender_folder', async () => {
  await casoE('p-91000130');
  const carpeta = path.join(conocimiento, carpetaPliegos(db, obtenerLicitacion(db, 'p-91000130')!));
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'Nota de rectificacion ENS.pdf'), 'pdf');
  assert.ok(!resumen('p-91000130').includes('bloquea:pliegos'), 'la nota está en la carpeta, con su nombre');
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES ('p-91000130', ?, 'adicional', 'Memoria justificativa.pdf', 'descargado', ?)",
  ).run(MEMORIA_JUSTIFICATIVA.url, new Date().toISOString());
  assert.ok(!resumen('p-91000130').some((x) => x.endsWith(':pliegos')));
});

test('should_count_a_published_zip_as_downloaded_once_it_was_unzipped', async () => {
  await casoE('p-91000150');
  const ts = new Date().toISOString();
  // La nota llega como ZIP: se descomprime (sus documentos son pliegos aparte) y el ZIP no se guarda.
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES ('p-91000150', ?, 'adicional', ?, 'descomprimido', ?)",
  ).run(NOTA.url, NOTA.nombre, ts);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES ('p-91000150', ?, 'adicional', 'Memoria justificativa.pdf', 'error', ?)",
  ).run(MEMORIA_JUSTIFICATIVA.url, ts);
  assert.ok(!resumen('p-91000150').includes('bloquea:pliegos'), 'el ZIP de la nota ya se descomprimió');
  assert.match(
    mensaje('p-91000150', 'pliegos'),
    /un documento que no se ha bajado y Hermes no ha leído: «Memoria justificativa\.pdf»/,
  );
});

test('should_put_what_blocks_first_in_what_is_missing_for_today_instead_of_calling_it_ready', async () => {
  await casoE('p-91000160');
  const falta = faltaDePreparacion(db, 'p-91000160');
  assert.equal(
    falta[0],
    'Elegibilidad: La ficha se hizo para los lotes 2, 6 y vamos a los lotes 2, 4: no ha comprobado los requisitos del lote 4. Genera la ficha otra vez.',
  );
  assert.ok(falta.length > 1, 'el resto de filas de las comprobaciones, cada una con su categoría');
  assert.ok(!falta.some((f) => f.startsWith('Por revisar')), falta.join(' | '));
});

test('should_read_the_threshold_the_tender_fixes_over_the_budget_only', () => {
  assert.equal(umbralDelPliego(UMBRAL), 0.15);
  assert.equal(umbralDelPliego('Anormal la oferta inferior al 85 % del precio máximo unitario.'), 0.15);
  assert.equal(umbralDelPliego('Bajas inferiores en un 12,5% al presupuesto base.'), 0.125);
  assert.equal(
    umbralDelPliego('Las que sean inferiores en más de 10 unidades porcentuales a la media aritmética de las ofertas.'),
    null,
    'sobre la media depende de las demás',
  );
  assert.equal(umbralDelPliego('Según el art. 85 RGLCAP.'), null);
  assert.equal(umbralDelPliego(null), null);
  // El porcentaje del impuesto no es el umbral.
  assert.equal(
    umbralDelPliego(
      'Se considerarán anormalmente bajas las ofertas cuyo importe (IGIC del 7 % excluido) sea inferior en más de un 20 % al presupuesto base de licitación',
    ),
    0.2,
  );
  assert.equal(
    umbralDelPliego(
      'Precio máximo 110,25 € (IVA 21 % no incluido). Se considerará anormal la oferta inferior en un 15 % al precio máximo',
    ),
    0.15,
  );
  assert.equal(
    umbralDelPliego(
      'Las ofertas cuyo importe, IVA (21 %) excluido, sea inferior en más de un 25 % al presupuesto base.',
    ),
    0.25,
  );
  // «Por 100» y «por cien» también son porcentajes.
  assert.equal(umbralDelPliego('Inferiores en más de un 10 por 100 al presupuesto base.'), 0.1);
  assert.equal(umbralDelPliego('Baja superior al 12 por cien del presupuesto.'), 0.12);
});

test('should_not_guess_the_threshold_when_the_tender_gives_several_percentages', () => {
  const dudoso =
    'Con un licitador, la oferta inferior en un 25 % al presupuesto base; con dos, la inferior en más de un 20 % a la otra.';
  assert.equal(umbralDelPliego(dudoso), null);
  assert.equal(umbralIlegible(dudoso), true, 'el literal existe pero no se entiende: se avisa');
  assert.equal(umbralIlegible('Según el art. 85 RGLCAP.'), false);
  assert.equal(umbralIlegible('Inferiores en un 15 % al presupuesto base.'), false);
});

test('should_name_the_role_a_staff_requirement_asks_for', () => {
  assert.equal(rolExigido('Docente principal con titulación relacionada'), 'docent');
  assert.equal(rolExigido('El adjudicatario adscribirá una jefa de proyecto con PMP'), 'jef');
  assert.equal(rolExigido('Tutor/a con 60 h de docencia online'), 'tutor');
  assert.equal(rolExigido('Experiencia de cinco años en tutoría online'), null, 'la tutoría no es un rol');
});

test('should_return_the_coherence_in_the_offer_api_and_bloqueos_instead_in_the_mcp_tool', async () => {
  await casoE('p-91000140');
  const r = await fetch(`${base}/api/licitaciones/licitaciones/p-91000140/oferta`);
  const o = (await r.json()) as { coherencia: { tipo: string; gravedad: string }[] };
  assert.deepEqual(
    o.coherencia.map((c) => `${c.gravedad}:${c.tipo}`),
    resumen('p-91000140'),
  );

  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  try {
    const t = await client.callTool({ name: 'licitaciones_oferta', arguments: { id: 'p-91000140' } });
    const datos = JSON.parse((t.content as { text: string }[])[0]?.text ?? '{}') as Record<string, unknown>;
    assert.ok(!('coherencia' in datos), 'en MCP la coherencia ya viene como bloqueos');
    assert.ok(Array.isArray(datos.bloqueos));
    const texto = (t.content as { text: string }[])[0]?.text ?? '';
    assert.doesNotMatch(
      texto,
      /"ofertas"|"unitarios"|"importe"/,
      'should_not_give_lot_prices_to_agents: ningún precio de ningún lote',
    );
  } finally {
    await client.close();
  }
});

// CASO_E con el guion v4: una oferta por lote, con el precio por alumno de cada uno y el umbral del 15 %.
const ofertaCasoE = (lote: string, maximo: number, presupuesto: number) => ({
  lotes: [lote],
  formula: 'P = 40 × (Om / O)',
  presupuesto_base: presupuesto,
  impuesto_aparte: 'IGIC',
  precios_unitarios: [{ concepto: 'Alumno', unidad: 'alumno', maximo, cantidad: null }],
  umbral_anormalidad: UMBRAL,
  modelo: 'Anexo VI',
  archivo: 'Archivo electrónico único',
});
const GUION_V4 = {
  ...GUION,
  oferta_economica: undefined,
  ofertas_economicas: [ofertaCasoE('2', 110.25, 6_063.75), ofertaCasoE('4', 94.5, 756)],
  automaticos: [
    {
      criterio: 'Tutorización en menos de 24 h',
      puntos: 10,
      como_se_acredita: 'Declaración',
      casilla_en: 'Anexo VI',
      archivo: 'Archivo electrónico único',
      marcas: ['respuesta en 24 horas'],
      lotes: ['2', '4'],
      tramos: [
        { descripcion: 'Respuesta en 48 h', puntos: 5 },
        { descripcion: 'Respuesta en 24 h o menos', puntos: 10 },
      ],
    },
  ],
};

async function casoEV4(id: string): Promise<void> {
  await casoE(id);
  assert.equal((await proponerGuion(db, GuionEntrada.parse({ ...GUION_V4, id }), 'licitaciones')).error, null);
}

const decisionesV4 = (precios: Record<string, number | null>, extra: Record<string, unknown> = {}) => ({
  lotes: ['2', '4'],
  equipo: [{ persona_id: MARIA, rol_en_la_oferta: 'Docente principal' }],
  herramientas: [],
  enfoque: 'Formación práctica con casos reales.',
  automaticos: ['2', '4'].map((lote) => ({
    criterio: 'Tutorización en menos de 24 h',
    lote,
    nos_acogemos: true,
    tramo: 'Respuesta en 24 h o menos' as string | null,
  })),
  ofertas: Object.entries(precios).map(([lote, p]) => ({
    lote,
    pendiente: p === null,
    unitarios: p === null ? [] : [{ concepto: 'Alumno', precio: p }],
  })),
  ...extra,
});

test('should_save_with_a_warning_when_a_lot_price_is_below_its_abnormality_threshold', async () => {
  await casoEV4('p-91000350');
  const r = guardarDecisiones(db, nucleo().db, 'p-91000350', decisionesV4({ '2': 70, '4': 90 }));
  assert.equal(r.error, null);
  assert.deepEqual(r.data!.avisos, [
    'El precio por alumno del lote 2 está por debajo del umbral de anormalidad que fija el pliego (baja del 15 %: 93,71 € por alumno): habría que justificarlo y puede quedar fuera o sin puntos. Súbelo al menos hasta ahí.',
  ]);
  assert.deepEqual(
    resumen('p-91000350').filter((x) => x.includes('precio')),
    ['bloquea:precio_anormal'],
  );

  const h = hojaDeDatos(db, nucleo().db, 'p-91000350').data!;
  const lote = (n: string) =>
    h.campos.filter((c) => c.grupo === `Oferta · Lote ${n}`).map((c) => [c.etiqueta, c.valor]);
  assert.deepEqual(lote('2')[0], ['Importe sin impuestos', '70,00 € por alumno']);
  assert.deepEqual(
    lote('4').find(([e]) => e === 'Baja sobre el presupuesto'),
    ['Baja sobre el presupuesto', '4,76 % (precio máximo 94,50 € por alumno)'],
  );
});

test('should_reject_a_unit_price_above_the_maximum_of_its_lot', async () => {
  await casoEV4('p-91000360');
  const r = guardarDecisiones(db, nucleo().db, 'p-91000360', decisionesV4({ '2': 120, '4': 90 }));
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(
    r.error?.message,
    'El precio por alumno del lote 2 supera el precio máximo (110,25 € por alumno): la oferta se excluye. Bájalo.',
  );
  const api = await fetch(`${base}/api/licitaciones/licitaciones/p-91000360/oferta/decisiones`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decisionesV4({ '2': 120, '4': 90 })),
  });
  assert.equal(api.status, 400);
});

test('should_require_a_price_or_pending_for_every_lot_in_scope', async () => {
  await casoEV4('p-91000370');
  assert.equal(
    guardarDecisiones(db, nucleo().db, 'p-91000370', decisionesV4({ '2': 100 })).error?.message,
    'Falta el precio del lote 4 (o márcalo pendiente).',
  );
  assert.equal(
    guardarDecisiones(db, nucleo().db, 'p-91000370', decisionesV4({ '2': 100, '4': null })).error,
    null,
    'pendiente vale',
  );
  assert.match(
    guardarDecisiones(db, nucleo().db, 'p-91000370', decisionesV4({ '2': 100, '4': 90, '6': 90 })).error?.message ?? '',
    /Hay un precio para el lote 6, al que no vamos: quítalo\./,
  );
});

test('should_reject_automatic_decisions_and_team_members_for_lots_outside_the_scope', async () => {
  await casoEV4('p-91000380');
  const automaticos = [
    ...decisionesV4({}).automaticos,
    { criterio: 'Tutorización en menos de 24 h', lote: '1', nos_acogemos: true, tramo: 'Respuesta en 48 h' },
  ];
  const r = guardarDecisiones(
    db,
    nucleo().db,
    'p-91000380',
    decisionesV4(
      { '2': 100, '4': 90 },
      { automaticos, equipo: [{ persona_id: ELISA, rol_en_la_oferta: 'Tutora', lotes: ['1'] }] },
    ),
  );
  assert.match(
    r.error?.message ?? '',
    /El criterio «Tutorización en menos de 24 h» está decidido para el lote 1, al que no vamos: quítalo\./,
  );
  assert.match(r.error?.message ?? '', /Elisa Ejemplo está asignada al lote 1, al que no vamos: quítale ese lote\./);
  const sinTramo = decisionesV4({ '2': 100, '4': 90 });
  sinTramo.automaticos[0]!.tramo = null;
  assert.match(
    guardarDecisiones(db, nucleo().db, 'p-91000380', sinTramo).error?.message ?? '',
    /Elige el tramo de «Tutorización en menos de 24 h» \(lote 2\) al que nos acogemos\./,
  );
});

test('should_read_old_decisions_with_a_single_price_as_one_lot_offer', async () => {
  await casoEV4('p-91000390');
  const antiguas = {
    lotes: ['2'],
    equipo: [],
    automaticos: [],
    herramientas: [],
    enfoque: '',
    precio: { importe: 100, pendiente: false },
  };
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(
    JSON.stringify(antiguas),
    'p-91000390',
  );
  assert.deepEqual(decisionesDe(db, 'p-91000390')?.datos.ofertas, [
    {
      lote: '2',
      pendiente: false,
      importe: null,
      coste_estimado: null,
      unitarios: [{ concepto: 'Alumno', precio: 100 }],
    },
  ]);
});

test('should_strip_specs_citations_from_an_approach_written_by_a_person', async () => {
  await casoEV4('p-91000400');
  const r = guardarDecisiones(
    db,
    nucleo().db,
    'p-91000400',
    decisionesV4(
      { '2': 100, '4': 90 },
      { enfoque: 'Formación práctica con casos reales (Bases, pp. 12) y tutorías en grupos pequeños según PPT.pdf.' },
    ),
  );
  assert.equal(r.error, null, 'a una persona no se le rechaza');
  assert.equal(
    decisionesDe(db, 'p-91000400')?.datos.enfoque,
    'Formación práctica con casos reales y tutorías en grupos pequeños según.',
  );
});

// CASO_E: un archivo único que se sube por lote (memoria y Anexo VI de cada lote).
const GUION_POR_LOTE = {
  ...GUION_V4,
  archivos: [
    {
      ...GUION.archivos[0]!,
      ambito: 'por_lote',
      documentos: [
        { tipo: 'declaracion', nombre: 'Anexo I', obligatorio: true, produce: 'persona' },
        { tipo: 'oferta_economica', nombre: 'Anexo VI', obligatorio: true, produce: 'persona' },
      ],
    },
  ],
};

test('should_create_one_checklist_row_per_decided_lot_for_per_lot_files', async () => {
  await casoEV4('p-91000410');
  assert.equal(
    (await proponerGuion(db, GuionEntrada.parse({ ...GUION_POR_LOTE, id: 'p-91000410' }), 'licitaciones')).error,
    null,
  );
  assert.equal(guardarDecisiones(db, nucleo().db, 'p-91000410', decisionesV4({ '2': 100, '4': 90 })).error, null);
  const { documentos } = documentosDe(db, 'p-91000410');
  assert.deepEqual(
    documentos.map((d) => [d.clave, d.nombre, d.lote]),
    [
      ['a1-d1-l2', 'Anexo I', '2'],
      ['a1-d1-l4', 'Anexo I', '4'],
      ['a1-d2-l2', 'Anexo VI', '2'],
      ['a1-d2-l4', 'Anexo VI', '4'],
    ],
  );
});

test('should_keep_the_work_done_when_a_new_outline_splits_a_document_by_lot', async () => {
  await casoEV4('p-91000530');
  assert.equal(guardarDecisiones(db, nucleo().db, 'p-91000530', decisionesV4({ '2': 100, '4': 90 })).error, null);
  const antes = documentosDe(db, 'p-91000530').documentos;
  assert.ok(
    antes.some((d) => d.clave === 'a1-d1'),
    'antes, una fila común por documento',
  );
  const ruta = 'Salidas/Licitaciones/casoE/Anexo I firmado.docx';
  assert.equal(
    cambiarDocumento(db, 'p-91000530', 'a1-d1', { estado: 'preparado', ruta, nota: 'Revisado por Elisa' }).error,
    null,
  );
  assert.equal(
    (await proponerGuion(db, GuionEntrada.parse({ ...GUION_POR_LOTE, id: 'p-91000530' }), 'licitaciones')).error,
    null,
  );
  const l2 = documentosDe(db, 'p-91000530').documentos.filter((d) => d.nombre === 'Anexo I');
  assert.deepEqual(
    l2.map((d) => [d.clave, d.estado, d.ruta, d.nota]),
    [
      ['a1-d1-l2', 'borrador', ruta, 'Revisado por Elisa'],
      ['a1-d1-l4', 'borrador', ruta, 'Revisado por Elisa'],
    ],
    'con dos lotes, lo preparado pasa a borrador pero no se pierde',
  );
  assert.match(l2[0]!.avisos.join(' '), /Viene del documento común.*lote 2/);
  assert.equal(
    documentosDe(db, 'p-91000530').documentos.find((d) => d.clave === 'a1-d2-l2')?.estado,
    'pendiente',
    'lo que no estaba hecho sigue pendiente',
  );
});

test('should_hide_the_rows_of_a_lot_that_is_no_longer_decided', async () => {
  await casoEV4('p-91000420');
  assert.equal(
    (await proponerGuion(db, GuionEntrada.parse({ ...GUION_POR_LOTE, id: 'p-91000420' }), 'licitaciones')).error,
    null,
  );
  assert.equal(guardarDecisiones(db, nucleo().db, 'p-91000420', decisionesV4({ '2': 100, '4': 90 })).error, null);
  assert.equal(documentosDe(db, 'p-91000420').documentos.length, 4);
  assert.deepEqual(elegirLotesInteres(db, 'p-91000420', { lotes: ['2'] }).data?.lotes, ['2']);
  const soloL2 = { ...decisionesV4({ '2': 100 }), lotes: ['2'] };
  soloL2.automaticos = soloL2.automaticos.filter((a) => a.lote === '2');
  assert.equal(guardarDecisiones(db, nucleo().db, 'p-91000420', soloL2).error, null);
  assert.deepEqual(
    documentosDe(db, 'p-91000420').documentos.map((d) => d.clave),
    ['a1-d1-l2', 'a1-d2-l2'],
  );
  assert.equal(
    (
      db
        .prepare("SELECT oculto FROM oferta_documentos WHERE licitacion_id = 'p-91000420' AND clave = 'a1-d2-l4'")
        .get() as { oculto: number }
    ).oculto,
    1,
    'oculta, no borrada',
  );
});

test('should_fill_a_lot_annex_with_that_lot_price_only', async () => {
  await casoEV4('p-91000430');
  assert.equal(guardarDecisiones(db, nucleo().db, 'p-91000430', decisionesV4({ '2': 100, '4': 90 })).error, null);
  const h = hojaDeDatos(db, nucleo().db, 'p-91000430', { lote: '4' }).data!;
  const oferta = h.campos.filter((c) => c.grupo.startsWith('Oferta')).map((c) => [c.grupo, c.etiqueta, c.valor]);
  assert.deepEqual(oferta[0], ['Oferta', 'Importe sin impuestos', '90,00 € por alumno']);
  assert.ok(
    oferta.every(([g]) => g === 'Oferta'),
    'sin el grupo del lote 2',
  );
  assert.deepEqual(
    h.campos.filter((c) => c.grupo === 'Criterios automáticos').map((c) => c.etiqueta),
    ['Tutorización en menos de 24 h'],
    'solo su criterio',
  );
  assert.match(h.campos.find((c) => c.etiqueta === 'Lotes')!.valor!, /^Lote 4/);
});

test('should_prefill_the_registration_of_each_lot_with_its_unit_price', async () => {
  await casoEV4('p-91000440');
  assert.equal(guardarDecisiones(db, nucleo().db, 'p-91000440', decisionesV4({ '2': 100, '4': 90 })).error, null);
  const e = (await estadoPaquete(db, raicesActuales(), 'p-91000440')).data!;
  assert.deepEqual(e.registro, [
    { lote: '2', importe_ofertado: null, presupuesto: 110.25, unidad: 'alumno', precio_unitario: 100 },
    { lote: '4', importe_ofertado: null, presupuesto: 94.5, unidad: 'alumno', precio_unitario: 90 },
  ]);
});

test('should_warn_that_the_published_documents_are_unchecked_when_the_data_predates_the_new_mapper', async () => {
  await casoE('p-91000190');
  assert.ok(
    !coherenciaOferta(db, 'p-91000190').some((c) =>
      /No se ha comprobado si la PLACSP publica más documentos/.test(c.mensaje),
    ),
  );
  const { mapper: _m, ...antiguos } = JSON.parse(
    (db.prepare("SELECT datos FROM licitaciones WHERE id = 'p-91000190'").get() as { datos: string }).datos,
  ) as Record<string, unknown>;
  db.prepare("UPDATE licitaciones SET datos = ? WHERE id = 'p-91000190'").run(JSON.stringify(antiguos));
  const aviso = coherenciaOferta(db, 'p-91000190').find((c) =>
    /No se ha comprobado si la PLACSP publica más documentos/.test(c.mensaje),
  );
  assert.deepEqual([aviso?.tipo, aviso?.gravedad, aviso?.donde], ['pliegos', 'aviso', 'pliegos']);
});

test('should_not_count_a_team_member_for_a_staff_requirement_of_a_lot_they_do_not_work_in', async () => {
  // El docente principal del lote 2 no lo cubre quien solo trabaja en el lote 4 (equipo por lote).
  await casoE('p-91000230');
  const poner = (lotes: string[]) =>
    db
      .prepare(
        "UPDATE decisiones_oferta SET datos = json_set(datos, '$.equipo', json(?)) WHERE licitacion_id = 'p-91000230'",
      )
      .run(JSON.stringify([{ persona_id: MARIA, rol_en_la_oferta: 'Docente principal', lotes }]));
  poner(['4']);
  assert.match(
    mensaje('p-91000230', 'equipo'),
    /avanzadas» \(lote 2\)/,
    'solo trabaja en el lote 4: el lote 2 queda sin docente',
  );
  assert.ok(
    !resumen('p-91000230').includes('aviso:medios_sin_acreditar'),
    'sin nadie en el rol del lote 2 no se le nombra',
  );
  poner(['2']);
  assert.equal(mensaje('p-91000230', 'equipo'), '', 'trabaja en el lote 2');
  assert.match(
    mensaje('p-91000230', 'medios_sin_acreditar'),
    /María José Ejemplo \(Docente principal\) no lo tiene registrado/,
  );
  poner([]);
  assert.equal(mensaje('p-91000230', 'equipo'), '', 'sin lotes, está en todos');
});

test('should_word_missing_means_per_role_and_subject', async () => {
  // La lista concatenada de requisitos no se leía; ahora es un aviso por rol y materia.
  await casoE('p-91000270');
  assert.equal(elegirLotesInteres(db, 'p-91000270', { lotes: ['2', '6'] }).error, null);
  db.prepare("DELETE FROM decisiones_oferta WHERE licitacion_id = 'p-91000270'").run();

  const avisos = coherenciaOferta(db, 'p-91000270').filter((c) => c.tipo === 'medios_sin_acreditar');

  assert.deepEqual(
    avisos.map((c) => c.mensaje.split('.')[0]),
    [
      'Docente de hojas de cálculo avanzadas (lote 2): nadie en Colaboradores con «hojas de cálculo avanzadas»',
      'Docente de Residuos sanitarios (lote 6): nadie en Colaboradores con «Residuos sanitarios»',
    ],
  );
  assert.ok(
    avisos.every((c) => c.gravedad === 'aviso' && !c.mensaje.includes(';')),
    'misma gravedad y sin lista concatenada',
  );
});

test('should_warn_who_lacks_the_specific_subject_a_staff_requirement_asks_for', async () => {
  // Dos casos reales: docente principal sin la formación del curso (CASO_E) y directora
  // propuesta sin auditoría de accesibilidad web (CASO_F), los dos en «sí» por los años totales.
  await casoE('p-91000220');
  db.prepare("DELETE FROM decisiones_oferta WHERE licitacion_id = 'p-91000220'").run();
  const sinDecisiones = coherenciaOferta(db, 'p-91000220').find((c) => c.tipo === 'medios_sin_acreditar');
  assert.deepEqual([sinDecisiones?.gravedad, sinDecisiones?.donde], ['aviso', 'ficha']);
  assert.match(
    sinDecisiones?.mensaje ?? '',
    /^Docente de hojas de cálculo avanzadas \(lote 2\): nadie en Colaboradores con «hojas de cálculo avanzadas»\./,
  );
  assert.doesNotMatch(sinDecisiones?.mensaje ?? '', /Residuos sanitarios/, 'el lote 6 no está en juego');

  const ana = crearPersona(nucleo().db, {
    nombre: 'Ana Hojas',
    tipo: 'interno',
    rol: 'Formadora',
    anios_experiencia: 8,
  }).data!.id;
  const decisiones = {
    lotes: ['2', '4'],
    equipo: [{ persona_id: ana, rol_en_la_oferta: 'Docente principal' }],
    automaticos: [],
    herramientas: [],
    enfoque: 'Lote 2 con hojas de cálculo.',
    precio: { importe: 100, pendiente: false },
  };
  assert.equal(guardarDecisiones(db, nucleo().db, 'p-91000220', decisiones).error, null);
  assert.match(
    mensaje('p-91000220', 'medios_sin_acreditar'),
    /: nadie en el equipo con «hojas de cálculo avanzadas» \(Ana Hojas \(Docente principal\) no lo tiene registrado\)/,
    'ocho años no acreditan la formación en hojas de cálculo',
  );

  assert.equal(
    actualizarPersona(nucleo().db, ana, {
      nombre: 'Ana Hojas',
      tipo: 'interno',
      rol: 'Formadora',
      anios_experiencia: 8,
      certificaciones: ['hojas de cálculo avanzadas'],
    }).error,
    null,
  );
  assert.ok(
    !resumen('p-91000220').includes('aviso:medios_sin_acreditar'),
    'con la certificación registrada ya no falta nadie',
  );
});

// Huecos medidos en producción el 14/10/2026 tras el despliegue de la oferta fiable.
type Automatico = { criterio: string; casilla_en: string; como_se_acredita?: string; lotes?: string[] };
const automatico = (a: Automatico) => ({
  criterio: a.criterio,
  puntos: 10,
  como_se_acredita: a.como_se_acredita ?? 'Marcando la casilla del modelo.',
  casilla_en: a.casilla_en,
  archivo: 'Archivo electrónico único',
  marcas: [],
  documento: 'Bases.pdf',
  pagina: 14,
  ...(a.lotes ? { lotes: a.lotes } : {}),
});
const modelo = (n: string, de: string) => ({
  tipo: 'declaracion',
  nombre: `Anexo ${n}. Carta de compromiso`,
  obligatorio: true,
  produce: 'persona',
  origen: { modelo: `Anexo ${n} (${de})`, documento: `Anexo ${n}.pdf`, pagina: 1 },
});
const guionCon = (lotes: string[], automaticos: Automatico[], documentos: unknown[] = []) => ({
  ...GUION,
  lotes,
  automaticos: automaticos.map(automatico),
  archivos: [{ ...GUION.archivos[0]!, documentos: [...GUION.archivos[0]!.documentos, ...documentos] }],
  oferta_economica: {
    ...GUION.oferta_economica,
    presupuesto_base: 30_000,
    precio_unitario: null,
    umbral_anormalidad: null,
  },
});
type Decidido = { criterio: string; nos_acogemos: boolean; lote?: string };
type Miembro = { persona_id: number; rol_en_la_oferta: string; lotes?: string[] };

/** Una oferta sobre la licitación de seis lotes de CASO_E con los lotes de interés, el guion y (si llegan) las decisiones dados. */
async function ofertaCon(
  id: string,
  o: { interes: string[]; guion: ReturnType<typeof guionCon>; automaticos?: Decidido[]; equipo?: Miembro[] },
): Promise<void> {
  const l = licitacion({
    titulo: 'Formación por lotes',
    publicada: '2026-09-24',
    presupuesto: 30_000,
    lotes: LOTES,
    limite: LIMITE_LEJANO,
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, documentos: [BASES] });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, interes(o.interes), ts, ts);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'pcap', 'Bases.pdf', 'descargado', ?, ?)",
  ).run(id, BASES.url, `Licitaciones/Radar/2026/17-26 (${id})/Bases.pdf`, ts);
  assert.equal(
    (await proponerFicha(db, { ...FICHA, id } as Parameters<typeof proponerFicha>[1], 'licitaciones')).error,
    null,
  );
  assert.equal(elegirLotesInteres(db, id, { lotes: o.interes }).error, null);
  assert.equal((await proponerGuion(db, GuionEntrada.parse({ ...o.guion, id }), 'licitaciones')).error, null);
  if (!o.automaticos && !o.equipo) return;
  const datos = {
    lotes: o.interes,
    equipo: o.equipo ?? [],
    automaticos: o.automaticos ?? [],
    herramientas: [],
    enfoque: '',
    precio: { importe: null, pendiente: true },
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guionVigente(db, id)!.id,
    JSON.stringify(datos),
    ts,
  );
}

const deTipo = (id: string, tipo: string) => coherenciaOferta(db, id).filter((c) => c.tipo === tipo);

test('should_block_automatic_criteria_and_warn_of_people_decided_for_lots_we_do_not_go_to', async () => {
  // CASO_D (p-91000880): la empresa va solo al lote 2 y las decisiones marcaban los 2B1-2B3 del lote 1
  // (el criterio no dice el lote; su anexo, sí) y llevaban a Olga de apoyo en el lote 1.
  const olga = crearPersona(nucleo().db, { nombre: 'Olga Ejemplo', tipo: 'interno', rol: 'Marketing' }).data!.id;
  const guion = guionCon(
    ['1', '2'],
    [
      {
        criterio: '2B1.- Personalización de los materiales sin coste adicional',
        casilla_en: 'Anexo II, «Personalización con serigrafía a color»',
      },
      { criterio: '2B2.- Merchandising adicional sin coste adicional', casilla_en: 'Anexo III, «botella y gorro»' },
      {
        criterio: '2B1. – Servicio de soporte técnico de la plataforma virtual',
        casilla_en: 'Anexo V, «seis (6) meses»',
      },
    ],
    [modelo('II', 'lote 1, criterio 2B1'), modelo('III', 'lote 1, criterio 2B2'), modelo('V', 'lote 2, criterio 2B1')],
  );
  await ofertaCon('p-91000880', {
    interes: ['2'],
    guion,
    automaticos: [
      { criterio: '2B1.- Personalización de los materiales sin coste adicional', nos_acogemos: true },
      { criterio: '2B2.- Merchandising adicional sin coste adicional', nos_acogemos: false },
      { criterio: '2B1. – Servicio de soporte técnico de la plataforma virtual', nos_acogemos: true },
    ],
    equipo: [
      { persona_id: ELISA, rol_en_la_oferta: 'Formación al personal de CASO_D (lote 2)' },
      { persona_id: olga, rol_en_la_oferta: 'Personal de apoyo durante la formación presencial (lote 1)' },
    ],
  });
  const [criterios] = deTipo('p-91000880', 'automaticos_lotes');
  assert.deepEqual([criterios?.gravedad, criterios?.donde], ['bloquea', 'decisiones']);
  assert.equal(
    criterios?.mensaje,
    'Las decisiones se acogen a criterios automáticos de lotes a los que no vamos: «2B1.- Personalización de los materiales sin coste adicional» (lote 1). Vamos al lote 2: desmárcalos en Decisiones (su anexo no se presenta) o, si vamos también a esos lotes, añádelos en el bloque Lotes.',
  );
  const [equipo] = deTipo('p-91000880', 'equipo_lotes');
  assert.deepEqual([equipo?.gravedad, equipo?.donde], ['aviso', 'decisiones']);
  assert.match(
    equipo?.mensaje ?? '',
    /: Olga Ejemplo \(«Personal de apoyo durante la formación presencial \(lote 1\)»\)\. Vamos al lote 2/,
  );
  assert.doesNotMatch(equipo?.mensaje ?? '', /Elisa/, 'quien está para el lote 2 sí va');

  db.prepare(
    "UPDATE decisiones_oferta SET datos = json_set(datos, '$.automaticos[0].nos_acogemos', json('false'), '$.equipo', json_array(json_extract(datos, '$.equipo[0]'))) WHERE licitacion_id = 'p-91000880'",
  ).run();
  assert.deepEqual(
    [...deTipo('p-91000880', 'automaticos_lotes'), ...deTipo('p-91000880', 'equipo_lotes')],
    [],
    'desmarcado y sin Olga, no queda nada de otros lotes',
  );
});

test('should_not_block_a_criterion_decided_for_a_lot_we_go_to_when_another_lot_has_one_with_the_same_name', async () => {
  // Guion v4: un automático por conjunto de lotes, con el mismo nombre. La empresa va al lote 2 y se acoge al suyo.
  const guion = guionCon(
    ['1', '2'],
    [
      { criterio: 'Experiencia del equipo', casilla_en: 'Anexo II', lotes: ['1'] },
      { criterio: 'Experiencia del equipo', casilla_en: 'Anexo II', lotes: ['2'] },
    ],
  );
  await ofertaCon('p-91000900', {
    interes: ['2'],
    guion,
    automaticos: [{ criterio: 'Experiencia del equipo', lote: '2', nos_acogemos: true }],
  });
  assert.deepEqual(deTipo('p-91000900', 'automaticos_lotes'), [], 'el criterio del lote 2 es de un lote al que vamos');
  db.prepare(
    "UPDATE decisiones_oferta SET datos = json_set(datos, '$.automaticos[0].lote', '1') WHERE licitacion_id = 'p-91000900'",
  ).run();
  assert.match(
    deTipo('p-91000900', 'automaticos_lotes')[0]?.mensaje ?? '',
    /«Experiencia del equipo» \(lote 1\)/,
    'el del lote 1 sí es ajeno',
  );
});

test('should_warn_when_we_take_a_criterion_whose_tier_needs_a_document_that_is_not_on_record', async () => {
  // CASO_E (p-91000080): 2.3 y 2.4 marcados al máximo sin el dossier homologado del fabricante.
  const exportacion = 'Formatos de descarga de los registros de actividad';
  const indicadores = 'Volumen de Señales Automáticas de Inactividad del Alumnado';
  const analista = 'Adscripción de Equipo Técnico de Calidad Formativa';
  await ofertaCon('p-91000240', {
    interes: ['2', '4'],
    guion: guionCon(
      ['2', '4'],
      [
        {
          criterio: exportacion,
          casilla_en: 'ANEXO VI, 1.1',
          como_se_acredita: 'ANEXO VI, 1.1: Si permite la exportación en tres o más formatos: Seis (6) puntos.',
        },
        {
          criterio: indicadores,
          casilla_en: 'ANEXO VI, 2.3',
          como_se_acredita:
            'ANEXO VI, 2.3: 5 o más indicadores de riesgo concurrentes: Ocho (8) puntos. Dossier técnico del fabricante de la plataforma que certifique el cumplimiento de los indicadores automáticos de riesgo.',
        },
        {
          criterio: analista,
          casilla_en: 'ANEXO VI, 1.4',
          como_se_acredita:
            'ANEXO VI, 1.4: Analista Académico con titulación universitaria: 6 puntos. Copia de la titulación acompañada de su Currículum Vitae.',
        },
      ],
    ),
    automaticos: [exportacion, indicadores, analista].map((criterio) => ({ criterio, nos_acogemos: true })),
  });
  const [sinPropuesta] = deTipo('p-91000240', 'automaticos_sin_acreditar');
  assert.deepEqual([sinPropuesta?.gravedad, sinPropuesta?.donde], ['aviso', 'decisiones']);
  assert.equal(
    sinPropuesta?.mensaje,
    `Las decisiones se acogen a criterios que hay que acreditar y no consta con qué: «${indicadores}» (no consta que lo tengamos; se acredita con: Dossier técnico del fabricante de la plataforma que certifique el cumplimiento de los indicadores automáticos de riesgo.). Consigue el documento antes de presentar o desmárcalos en Decisiones: marcarlos sin poder acreditarlos es una declaración inexacta.`,
  );

  // Con la propuesta de Hermes: el dossier consta («si») y el título del analista no («falta_dato»).
  const propuesta = {
    lotes: ['2', '4'],
    equipo: [],
    herramientas: [],
    enfoque: 'Formación online por lotes con plataforma Aula Abierta y tutorización humana.',
    resumen: 'Confirmar el título del analista.',
    automaticos: [
      {
        criterio: exportacion,
        tipo: 'compromiso',
        nos_acogemos: true,
        nivel: 'Tres o más formatos',
        motivo: 'Aula Abierta exporta CSV, XLSX y JSON.',
      },
      {
        criterio: indicadores,
        tipo: 'acreditacion',
        nos_acogemos: true,
        cumple: 'si',
        motivo: 'Dossier del fabricante en el perfil de la empresa.',
      },
      {
        criterio: analista,
        tipo: 'acreditacion',
        nos_acogemos: false,
        cumple: 'falta_dato',
        motivo: 'Falta el título del analista en Colaboradores.',
      },
    ],
  };
  db.prepare(
    "INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, avisos, agente, creada_en) VALUES ('p-91000240', ?, ?, '[]', 'licitaciones', ?)",
  ).run(guionVigente(db, 'p-91000240')!.id, JSON.stringify(propuesta), new Date().toISOString());
  const [conPropuesta] = deTipo('p-91000240', 'automaticos_sin_acreditar');
  assert.match(
    conPropuesta?.mensaje ?? '',
    new RegExp(`: «${analista}» \\(Hermes no encontró con qué acreditarlo\\)\\. Consigue`),
  );
  assert.doesNotMatch(conPropuesta?.mensaje ?? '', /Indicadores/, 'el dossier consta');
  assert.doesNotMatch(conPropuesta?.mensaje ?? '', /exportación/, 'un compromiso sin documento no se acredita');
});

test('should_block_an_outline_whose_criteria_cover_only_some_of_the_lots_we_go_to', async () => {
  // CASO_B (p-91000740): guion v1 con los criterios solo del lote 1 y la empresa va del 1 al 5.
  const lotes = ['1', '2', '3', '4', '5'];
  const c1 = (casilla: string) => ({ criterio: 'C1. Años de docencia previa del profesorado', casilla_en: casilla });
  const c2 = (casilla: string) => ({ criterio: 'C2. Horas de docencia acreditadas', casilla_en: casilla });
  await ofertaCon('p-91000740', {
    interes: lotes,
    guion: guionCon(lotes, [c1('ANEXO III BIS LOTE 1: 1.C1'), c2('ANEXO III BIS LOTE 1: 1.C2')]),
  });
  const [solo] = deTipo('p-91000740', 'guion_criterios');
  assert.deepEqual([solo?.gravedad, solo?.donde], ['bloquea', 'guion']);
  assert.equal(
    solo?.mensaje,
    'El guion solo trae criterios del lote 1 y vamos a los lotes 1, 2, 3, 4, 5: faltan los de los lotes 2, 3, 4, 5. Vuelve a extraer el guion del pliego con los criterios de cada lote.',
  );

  const todos = 'ANEXO III BIS LOTE 1: 1.C1; LOTE 2: 2.C1; LOTE 3: 3.C1; LOTE 4: 4.C1; LOTE 5: 5.C1';
  await ofertaCon('p-91000750', {
    interes: lotes,
    guion: guionCon(lotes, [c1(todos), c2('Anexo III bis de los lotes 1 a 5')]),
  });
  assert.deepEqual(deTipo('p-91000750', 'guion_criterios'), [], 'el guion v2 trae los criterios de los cinco lotes');

  await ofertaCon('p-91000760', {
    interes: lotes,
    guion: guionCon(lotes, [c1('ANEXO III BIS LOTE 1: 1.C1'), c2('Anexo III bis, casilla C2')]),
  });
  assert.deepEqual(
    deTipo('p-91000760', 'guion_criterios'),
    [],
    'un criterio sin lote puede valer para todos: no se adivina',
  );
});

test('should_warn_with_the_hours_left_when_the_deadline_is_under_48_hours_and_something_still_blocks', async () => {
  await casoE('p-91000250');
  // 15/10/2099 08:00 peninsular (horario de verano) = 06:00 UTC.
  const plazo = (ahora: string) =>
    coherenciaOferta(db, 'p-91000250', { ahoraMs: Date.parse(ahora) }).filter((c) => c.tipo === 'plazo');
  const [aviso] = plazo('2099-10-14T00:00:00Z');
  assert.deepEqual([aviso?.gravedad, aviso?.donde], ['aviso', 'ficha'], 'enlaza con lo primero que bloquea');
  assert.equal(
    aviso?.mensaje,
    'Quedan 30 h para el plazo (el 15/10/2099 a las 08:00 hora peninsular) y hay 5 cosas que bloquean la oferta: arréglalo ya o, si no da tiempo, decide si se presenta.',
  );
  const tipos = coherenciaOferta(db, 'p-91000250', { ahoraMs: Date.parse('2099-10-14T00:00:00Z') }).map(
    (c) => `${c.gravedad}:${c.tipo}`,
  );
  assert.equal(
    tipos.indexOf('aviso:plazo'),
    tipos.filter((t) => t.startsWith('bloquea')).length,
    'el primer aviso, justo después de lo que bloquea',
  );
  assert.match(plazo('2099-10-15T05:30:00Z')[0]?.mensaje ?? '', /^Quedan 30 min para el plazo/);
  assert.deepEqual(plazo('2099-10-12T00:00:00Z'), [], 'a más de 48 h, no');
  assert.deepEqual(plazo('2099-10-15T07:00:00Z'), [], 'vencido, no');

  db.prepare("UPDATE licitaciones SET fecha_limite = NULL WHERE id = 'p-91000250'").run();
  assert.deepEqual(plazo('2099-10-14T00:00:00Z'), [], 'sin plazo, no');
});

test('should_not_warn_of_the_deadline_when_nothing_blocks', async () => {
  await ofertaCon('p-91000260', { interes: ['2'], guion: guionCon(['2'], []) });
  const c = coherenciaOferta(db, 'p-91000260', { ahoraMs: Date.parse('2099-10-14T00:00:00Z') });
  assert.ok(!c.some((x) => x.gravedad === 'bloquea'), c.map((x) => x.mensaje).join(' | '));
  assert.ok(!c.some((x) => x.tipo === 'plazo'));
});

test('should_suggest_the_price_of_the_lots_we_go_to_not_those_of_an_older_proposal', async () => {
  // CASO_D: sin decisiones, el precio sugerido se calculaba para los lotes de la propuesta (2 y 1),
  // el del contrato entero; el formulario lo rellenaba y la coherencia decía que supera el del lote 2.
  await ofertaCon('p-91000890', { interes: ['2'], guion: guionCon(['1', '2'], []) });
  const propuesta = {
    lotes: ['2', '1'],
    equipo: [],
    automaticos: [],
    herramientas: [],
    enfoque: 'Solo lote 2: implantación de la plataforma y formación al personal.',
    resumen: 'Lotes 2 y 1 de la criba.',
  };
  db.prepare(
    "INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, avisos, agente, creada_en) VALUES ('p-91000890', ?, ?, '[]', 'licitaciones', ?)",
  ).run(guionVigente(db, 'p-91000890')!.id, JSON.stringify(propuesta), new Date().toISOString());
  const o = (await (await fetch(`${base}/api/licitaciones/licitaciones/p-91000890/oferta`)).json()) as {
    precios_sugeridos: Record<string, { base: number; referencia: string } | null>;
  };
  assert.deepEqual(Object.keys(o.precios_sugeridos), ['2'], 'solo el lote de interés, no los de la propuesta');
  assert.deepEqual(
    [o.precios_sugeridos['2']?.base, o.precios_sugeridos['2']?.referencia],
    [6_063.75, 'lote'],
    'el presupuesto del lote 2, el de interés',
  );

  const datos = {
    lotes: ['2'],
    equipo: [],
    automaticos: [],
    herramientas: [],
    enfoque: '',
    precio: { importe: 6_000, pendiente: false },
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    'p-91000890',
    guionVigente(db, 'p-91000890')!.id,
    JSON.stringify(datos),
    new Date().toISOString(),
  );
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  try {
    const t = await client.callTool({ name: 'licitaciones_oferta', arguments: { id: 'p-91000890' } });
    const texto = (t.content as { text: string }[])[0]?.text ?? '{}';
    const d = (JSON.parse(texto) as { decisiones: Record<string, unknown> }).decisiones;
    assert.equal(d['precio_fijado'], true, 'Hermes sabe que hay un precio fijado');
    assert.ok(!('precio' in d) && !/6000|6\.000/.test(texto), 'pero no el importe');
  } finally {
    await client.close();
  }
});

test('should_not_take_the_lot_a_criterion_mentions_only_to_compare_itself_for_the_lot_it_belongs_to', async () => {
  // El criterio del lote 2 (su anexo lo dice) acaba con «igual que en el lote 1»: no es del lote 1.
  const guion = guionCon(
    ['1', '2'],
    [
      {
        criterio: '2B1.- Servicio de soporte técnico de la plataforma virtual',
        casilla_en: 'Anexo V, «seis (6) meses»',
        como_se_acredita: 'Marcando la casilla, igual que en el lote 1.',
      },
    ],
    [modelo('V', 'lote 2, criterio 2B1')],
  );
  await ofertaCon('p-91000910', {
    interes: ['2'],
    guion,
    automaticos: [{ criterio: '2B1.- Servicio de soporte técnico de la plataforma virtual', nos_acogemos: true }],
  });
  assert.deepEqual(
    deTipo('p-91000910', 'automaticos_lotes'),
    [],
    'el anexo dice lote 2: manda sobre lo que cuenta «cómo se acredita»',
  );
});

test('should_only_warn_when_the_lot_of_an_automatic_criterion_comes_from_how_it_is_proven', async () => {
  const guion = guionCon(
    ['1', '2'],
    [
      {
        criterio: 'Servicio de soporte técnico',
        casilla_en: 'Anexo V, «seis (6) meses»',
        como_se_acredita: 'Solo puntúa en el lote 1 y se declara en el anexo.',
      },
    ],
  );
  await ofertaCon('p-91000920', {
    interes: ['2'],
    guion,
    automaticos: [{ criterio: 'Servicio de soporte técnico', nos_acogemos: true }],
  });
  const [aviso] = deTipo('p-91000920', 'automaticos_lotes');
  assert.deepEqual(
    [aviso?.gravedad, aviso?.donde],
    ['aviso', 'decisiones'],
    'es una pista, no una certeza: no bloquea',
  );
  assert.match(aviso?.mensaje ?? '', /«Servicio de soporte técnico» \(lote 1\)/);
});

test('should_not_warn_of_a_team_member_whose_role_only_mentions_another_lot_to_replace_them', async () => {
  const equipo = [
    { persona_id: ELISA, rol_en_la_oferta: 'Apoyo (sustituye al del lote 1)' },
    { persona_id: MARIA, rol_en_la_oferta: 'Docente principal', lotes: ['1'] },
  ];
  await ofertaCon('p-91000930', { interes: ['2'], guion: guionCon(['1', '2'], []), equipo });
  const [aviso] = deTipo('p-91000930', 'equipo_lotes');
  assert.match(aviso?.mensaje ?? '', /María José Ejemplo/, 'su campo de lotes dice 1');
  assert.doesNotMatch(aviso?.mensaje ?? '', /Elisa/, '«sustituye al del lote 1» compara, no sitúa');
});

test('should_count_a_document_downloaded_while_the_outline_run_was_working_against_when_it_was_asked_for', async () => {
  const ID = 'p-91000940';
  await ofertaCon(ID, { interes: ['2'], guion: guionCon(['1', '2'], []) });
  const ts = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  db.prepare('UPDATE guiones SET creado_en = ? WHERE licitacion_id = ?').run(ts(10), ID);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'adicional', 'Anexo II. Modelo.pdf', 'descargado', ?)",
  ).run(ID, `https://contrataciondelestado.es/doc/anexo-${ID}`, ts(20));
  assert.ok(!resumen(ID).includes('bloquea:pliegos_nuevos'), 'sin trabajo enlazado se mide contra cuando se guardó');
  const trabajo = encolar(nucleo().db, {
    tipo: 'licitaciones.guion',
    dominio: 'licitaciones',
    clave: `guion-pedido-${ID}`,
    payload: { id: ID, pedida_en: ts(30) },
  });
  db.prepare('UPDATE guiones SET trabajo_id = ? WHERE licitacion_id = ?').run(trabajo, ID);
  assert.ok(
    resumen(ID).includes('bloquea:pliegos_nuevos'),
    'el documento llegó después de pedir el guion: Hermes no lo leyó',
  );
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE id = ?").run(trabajo);
});

test('should_warn_the_person_when_the_marks_of_a_criterion_come_only_from_its_name', async () => {
  const sin = { criterio: '2B1.- Servicio de soporte técnico de la plataforma virtual', casilla_en: 'Anexo V' };
  await ofertaCon('p-91000950', { interes: ['2'], guion: guionCon(['2'], [sin]) });
  const avisos = guionVigente(db, 'p-91000950')!.avisos;
  assert.ok(
    avisos.some((a) =>
      a.startsWith(
        'Las marcas de estos criterios salen solo de su nombre: revísalas: «2B1.- Servicio de soporte técnico',
      ),
    ),
    'un aviso para la persona',
  );
});
