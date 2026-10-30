// API web de Licitaciones: validación de entrada, lista por estados, cambios de
// estado hechos por personas y filtros del prefiltro.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rutas-lic-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.LICITACIONES_DEUC_XML = '1';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const {
  detalle,
  detalleParaAgente,
  listarOportunidades,
  plazosParaAgente,
  resumenParaAgente,
  seguirLicitacion,
  Filtro,
} = await import('../../src/dominios/licitaciones/oportunidades.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
iniciarNucleo();
procesarPagina(dbLicitaciones(), FUENTES.perfiles, fs.readFileSync(path.join(FIX, 'perfiles-pagina1.atom'), 'utf8'));
seguirLicitacion(dbLicitaciones(), 'p-20571214');

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/licitaciones`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = { 'content-type': 'application/json' };

test('should_list_opportunities_filtered_by_state_with_pagination', async () => {
  const r = await fetch(`${base}/oportunidades?estados=nueva,ficha_por_revisar&limite=5`);
  const body = (await r.json()) as { total: number; items: { id: string; estado: string }[]; limite: number };
  assert.equal(r.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.items[0]?.id, 'p-20571214');
  assert.equal(body.limite, 5);
  assert.equal((await fetch(`${base}/oportunidades?estados=inventado`)).status, 400);
  assert.equal((await fetch(`${base}/oportunidades?estados=revisar`)).status, 400, 'Revisar ya no existe');
  assert.equal((await fetch(`${base}/oportunidades?limite=1000`)).status, 400);
});

test('should_answer_400_and_not_500_when_the_list_filter_is_invalid', async () => {
  const r = await fetch(`${base}/oportunidades?texto=${'a'.repeat(201)}`);
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { error: string }).error, 'invalid_input');
});

test('should_count_by_state_sort_and_show_the_signals_to_decide_from_the_list', async () => {
  seguirLicitacion(dbLicitaciones(), 'p-18431943');
  const r = await fetch(`${base}/oportunidades?estados=nueva&orden=importe`);
  const body = (await r.json()) as {
    cuentas: Record<string, number>;
    items: { id: string; importe: number | null; semaforo: { color: string }; con_ficha: boolean; creada_en: string }[];
  };
  assert.equal(body.cuentas['nueva'], 2);
  const importes = body.items.map((i) => i.importe ?? -1);
  assert.deepEqual(
    importes,
    [...importes].sort((a, b) => b - a),
    'de mayor a menor importe',
  );
  assert.ok(['verde', 'ambar', 'rojo'].includes(body.items[0]!.semaforo.color));
  assert.equal(body.items[0]!.con_ficha, false);
  assert.match(body.items[0]!.creada_en, /^\d{4}-/);
  assert.equal((await fetch(`${base}/oportunidades?orden=azar`)).status, 400);
  const ids = async (c: string) =>
    (
      (await (await fetch(`${base}/oportunidades?estados=nueva&comunidad=${c}`)).json()) as { items: { id: string }[] }
    ).items.map((i) => i.id);
  assert.ok(
    (await ids('ES52')).includes('p-20571214'),
    'la del Instituto Ejemplo de Cultura (ES523) es de la C. Valenciana',
  );
  assert.ok(!(await ids('ES30')).includes('p-20571214'), 'y no sale en Madrid');
  assert.equal(
    body.items[0]!.semaforo !== undefined && 'idioma' in body.items[0]!,
    true,
    'cada fila dice el idioma del título',
  );
  assert.equal((await fetch(`${base}/oportunidades?comunidad=Canarias`)).status, 400);
  dbLicitaciones().prepare("DELETE FROM oportunidades WHERE licitacion_id = 'p-18431943'").run();
});

test('should_return_the_full_record_and_reject_malformed_ids', async () => {
  const r = await fetch(`${base}/licitaciones/p-18431943`);
  const d = (await r.json()) as { adjudicaciones: unknown[]; procedimiento: string; estado: string };
  assert.equal(d.adjudicaciones.length, 4);
  assert.equal(d.estado, 'sin_oportunidad');
  assert.equal((await fetch(`${base}/licitaciones/..%2F..%2Fetc`)).status, 400);
  assert.equal((await fetch(`${base}/licitaciones/p-0000`)).status, 404);
});

test('should_change_state_only_to_valid_human_states', async () => {
  const mal = await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ estado: 'candidata' }),
  });
  assert.equal(mal.status, 400);
  const vacio = await fetch(`${base}/oportunidades/p-20571214`, { method: 'PATCH', headers: json, body: '{}' });
  assert.equal(vacio.status, 400);
  const masAdelante = await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ estado: 'next' }),
  });
  assert.equal(masAdelante.status, 400, '«Más adelante» ya no existe');
  const ok = await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ estado: 'en_preparacion', notas: 'Vamos' }),
  });
  assert.deepEqual(await ok.json(), { estado: 'en_preparacion' });
});

test('should_require_a_typed_motive_when_discarding_from_the_web', async () => {
  // Arrange
  const sinTipo = { estado: 'descartada', motivo_descarte: 'no llegamos' };

  // Act
  const r = await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify(sinTipo),
  });
  const cuerpo = (await r.json()) as { error: string; message: string };

  // Assert
  assert.equal(r.status, 400);
  assert.equal(cuerpo.error, 'invalid_input');
  assert.match(cuerpo.message, /elige el tipo de motivo/);
});

test('should_derive_submitted_states_from_the_proposal_and_ask_why_when_discarding', async () => {
  const presentada = await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ estado: 'ganada' }),
  });
  assert.equal(presentada.status, 400);
  assert.match(((await presentada.json()) as { message: string }).message, /salen de la propuesta/);
  const sinMotivo = await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ estado: 'descartada' }),
  });
  assert.equal(sinMotivo.status, 400);
  const conMotivo = await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({
      estado: 'descartada',
      motivo_descarte: 'Exige ISO 27001',
      categoria_descarte: 'certificacion',
    }),
  });
  assert.deepEqual(await conMotivo.json(), { estado: 'descartada' });
  const d = (await (await fetch(`${base}/licitaciones/p-20571214`)).json()) as {
    motivo_descarte: string;
    descartada_en: string | null;
  };
  assert.equal(d.motivo_descarte, 'Exige ISO 27001');
  assert.ok(d.descartada_en && !Number.isNaN(Date.parse(d.descartada_en)), 'dice cuándo se descartó');
  await fetch(`${base}/oportunidades/p-20571214`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ estado: 'nueva' }),
  });
  const rescatada = (await (await fetch(`${base}/licitaciones/p-20571214`)).json()) as {
    motivo_descarte: string | null;
    rescatada: boolean;
  };
  assert.equal(rescatada.rescatada, true);
  assert.equal(rescatada.motivo_descarte, null, 'al salir de descartada pierde el motivo');
});

test('should_refuse_to_move_by_hand_an_opportunity_already_submitted_but_keep_its_notes', async () => {
  const db = dbLicitaciones();
  const cambiar = (body: unknown) =>
    fetch(`${base}/oportunidades/p-20571214`, { method: 'PATCH', headers: json, body: JSON.stringify(body) });
  for (const estado of ['presentada', 'ganada', 'perdida']) {
    db.prepare('UPDATE oportunidades SET estado = ? WHERE licitacion_id = ?').run(estado, 'p-20571214');
    const r = await cambiar({ estado: 'en_preparacion' });
    assert.equal(r.status, 400, `desde ${estado}`);
    assert.match(((await r.json()) as { message: string }).message, /propuesta registrada/);
  }
  assert.equal((await cambiar({ notas: 'Esperando la adjudicación' })).status, 200, 'las notas sí');
  const fila = db.prepare('SELECT estado, notas FROM oportunidades WHERE licitacion_id = ?').get('p-20571214') as {
    estado: string;
    notas: string;
  };
  assert.deepEqual(fila, { estado: 'perdida', notas: 'Esperando la adjudicación' });
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run('p-20571214');
});

test('should_validate_and_store_prefilter_settings', async () => {
  assert.equal(
    ((await (await fetch(`${base}/filtros`)).json()) as { de_ejemplo: boolean }).de_ejemplo,
    true,
    'sin guardar, los de ejemplo',
  );
  const mal = await fetch(`${base}/filtros`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ cpv_prefijos: ['abc'] }),
  });
  assert.equal(mal.status, 400);
  const filtros = {
    cpv_prefijos: ['72'],
    palabras: ['datos'],
    excluir_palabras: [],
    importe_min: 10000,
    importe_max: null,
    tipos_contrato: ['2'],
    nuts_prefijos: ['ES3'],
  };
  const ok = await fetch(`${base}/filtros`, { method: 'PUT', headers: json, body: JSON.stringify(filtros) });
  assert.equal(ok.status, 200);
  assert.deepEqual(
    await (await fetch(`${base}/filtros`)).json(),
    { ...filtros, excluir_idiomas: [], de_ejemplo: false },
    'sin idiomas que excluir por defecto',
  );
});

test('should_report_state_and_refuse_sync_without_ingestion', async () => {
  const estado = (await (await fetch(`${base}/estado`)).json()) as { activo: boolean; hermes: string };
  assert.equal(estado.activo, false);
  assert.match(estado.hermes, /sin configurar/);
  assert.equal((await fetch(`${base}/sync`, { method: 'POST' })).status, 503);
});

// Vía del agente (licitaciones_oportunidades, licitaciones_plazos y licitaciones_ver): el plazo con
// zona y en texto. La web sigue con la hora peninsular sin zona.
const ANTES_DEL_PLAZO = Date.parse('2026-10-13T10:00:00Z');

function conPlazoDeCasoE(): () => void {
  const db = dbLicitaciones();
  const previa = db
    .prepare("SELECT fecha_limite, fecha_solicitud, cpvs FROM licitaciones WHERE id = 'p-20571214'")
    .get() as Record<string, string | null>;
  db.prepare(
    "UPDATE licitaciones SET fecha_limite = '2026-10-15T08:00:00', fecha_solicitud = NULL, cpvs = ',80561000,80530000,' WHERE id = 'p-20571214'",
  ).run();
  return () =>
    db
      .prepare(
        "UPDATE licitaciones SET fecha_limite = @fecha_limite, fecha_solicitud = @fecha_solicitud, cpvs = @cpvs WHERE id = 'p-20571214'",
      )
      .run(previa);
}

test('should_give_agent_deadline_with_zone_and_the_company_time', async () => {
  const restaurar = conPlazoDeCasoE();
  try {
    const d = detalle(dbLicitaciones(), 'p-20571214');
    const agente = detalleParaAgente(d.data!, null, 'Atlantic/Canary');
    const peninsular = detalleParaAgente(d.data!, null, 'Europe/Madrid');
    const lista = listarOportunidades(
      dbLicitaciones(),
      Filtro.parse({ estados: ['nueva'] }),
      ANTES_DEL_PLAZO,
    ).items.map((r) => resumenParaAgente(r, 'Atlantic/Canary'));
    const web = (await (await fetch(`${base}/licitaciones/p-20571214`)).json()) as { fecha_limite: string };

    assert.equal(agente['fecha_limite'], '2026-10-15T08:00:00+02:00');
    assert.equal(agente['plazo_texto'], 'el 15/10/2026 a las 08:00 hora peninsular (07:00 en Canarias)');
    assert.equal(
      peninsular['plazo_texto'],
      'el 15/10/2026 a las 08:00 hora peninsular',
      'en la península, sin segunda hora',
    );
    assert.equal(lista.find((r) => r.id === 'p-20571214')?.fecha_limite, '2026-10-15T08:00:00+02:00');
    assert.equal(web.fecha_limite, '2026-10-15T08:00:00', 'la web, sin zona');
  } finally {
    restaurar();
  }
});

test('should_give_agent_cpvs_as_list', () => {
  const restaurar = conPlazoDeCasoE();
  try {
    const agente = detalleParaAgente(detalle(dbLicitaciones(), 'p-20571214').data!, null, 'Europe/Madrid');
    const plazo = plazosParaAgente(dbLicitaciones(), 7, ANTES_DEL_PLAZO).find((r) => r.id === 'p-20571214');

    assert.deepEqual(agente['cpvs'], ['80561000', '80530000']);
    assert.deepEqual(plazo?.cpvs, ['80561000', '80530000']);
  } finally {
    restaurar();
  }
});

test('should_add_pending_to_agent_deadlines', () => {
  const restaurar = conPlazoDeCasoE();
  const db = dbLicitaciones();
  db.prepare(
    `INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en, estado)
    VALUES ('p-20571214', 'Licitaciones/PCAP.pdf', '{}', 'licitaciones', '2026-10-13T09:00:00Z', 'pendiente')`,
  ).run();
  try {
    const plazo = plazosParaAgente(db, 7, ANTES_DEL_PLAZO).find((r) => r.id === 'p-20571214');

    assert.equal(plazo?.pendiente, 'Evaluación de «PCAP.pdf» por revisar');
    assert.ok(['verde', 'ambar', 'rojo'].includes(plazo?.semaforo.color ?? ''));
    assert.equal(plazo?.fecha_limite, '2026-10-15T08:00:00+02:00');
    assert.equal(
      plazo?.plazo_texto,
      'el 15/10/2026 a las 08:00 hora peninsular',
      'sin perfil, la hora peninsular sola',
    );
  } finally {
    db.prepare("DELETE FROM evaluaciones WHERE licitacion_id = 'p-20571214'").run();
    restaurar();
  }
});

test('should_return_titles_for_valid_ids', async () => {
  const r = await fetch(`${base}/titulos?ids=p-20571214,p-inexistente`);
  const body = (await r.json()) as Record<string, string>;
  assert.equal(r.status, 200);
  assert.ok(body['p-20571214'] && body['p-20571214'].length > 0);
  assert.equal('p-inexistente' in body, false, 'los ids desconocidos no salen');
});

test('should_reject_more_than_50_ids_or_malformed_ids', async () => {
  const muchos = Array.from({ length: 51 }, (_, i) => `p-${i}`).join(',');
  assert.equal((await fetch(`${base}/titulos?ids=${muchos}`)).status, 400);
  assert.equal((await fetch(`${base}/titulos?ids=p-1,x'; DROP`)).status, 400);
  assert.equal((await fetch(`${base}/titulos`)).status, 400);
});

// ── DEUC en XML: solo el DEUC-vN.xml de anexos, siempre como descarga ──

const DEUC_REL = 'Licitaciones/EXP-2026-0412 (p-91000710)/anexos/DEUC-v1.xml';
function ponerEnSalidas(rel: string, contenido: string): void {
  const abs = path.join(tmp, 'salidas', ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contenido);
}

test('should_download_a_deuc_xml_from_salidas_as_attachment_only', async () => {
  ponerEnSalidas(DEUC_REL, '<?xml version="1.0" encoding="UTF-8"?><QualificationApplicationResponse/>');
  const r = await fetch(`${base}/salidas/documento?ruta=${encodeURIComponent(`Salidas/${DEUC_REL}`)}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^application\/xml/);
  assert.match(r.headers.get('content-disposition') ?? '', /^attachment; filename\*=UTF-8''DEUC-v1\.xml$/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await r.text(), /QualificationApplicationResponse/);
});

test('should_refuse_any_other_xml_from_salidas', async () => {
  for (const rel of [
    'Licitaciones/EXP-2026-0412 (p-91000710)/otro.xml',
    'Licitaciones/EXP-2026-0412 (p-91000710)/DEUC-v1.xml',
    'Licitaciones/EXP-2026-0412 (p-91000710)/anexos/DEUC-v1.xml.html',
    'Licitaciones/EXP-2026-0412 (p-91000710)/anexos/deuc.xml',
  ]) {
    ponerEnSalidas(rel, '<x/>');
    const r = await fetch(`${base}/salidas/documento?ruta=${encodeURIComponent(`Salidas/${rel}`)}`);
    assert.equal(r.status, 400, rel);
  }
  const conocimiento = await fetch(`${base}/salidas/documento?ruta=${encodeURIComponent(`Conocimiento/${DEUC_REL}`)}`);
  assert.equal(conocimiento.status, 400, 'solo de Salidas');
});

test('should_return_409_when_company_data_is_missing_for_the_deuc', async () => {
  const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
  const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
  const { guionCon, licitacionCasoA } = await import('./fixtures/casoA.js');
  guardarLicitacion(dbLicitaciones(), licitacionCasoA());
  assert.equal(
    (await proponerGuion(dbLicitaciones(), GuionEntrada.parse(guionCon(() => {})), 'licitaciones')).error,
    null,
  );
  const r = await fetch(`${base}/licitaciones/p-91000710/oferta/documentos/a1-d1/deuc`, { method: 'POST' });
  const body = (await r.json()) as { error: string; message: string };
  assert.equal(r.status, 409);
  assert.equal(body.error, 'conflicto');
  assert.match(body.message, /^Faltan datos de la empresa para el DEUC: NIF, domicilio\./);
  assert.equal(
    (await fetch(`${base}/licitaciones/p-91000710/oferta/documentos/a1-d2/deuc`, { method: 'POST' })).status,
    400,
    'la memoria no es el DEUC',
  );
  assert.equal(
    (await fetch(`${base}/licitaciones/p-91000710/oferta/documentos/zz/deuc`, { method: 'POST' })).status,
    400,
    'clave no válida',
  );
});
