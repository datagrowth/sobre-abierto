// Embudo de la criba: las candidatas que cierran antes de cribarse salen de «Sin cribar»,
// las de un lote cuyo trabajo de Hermes falló vuelven a la cola y lo que ya tiene la ficha
// de Hermes se ve aparte de Nuevas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import {
  aplicarCriba,
  crearLotes,
  liberarLotesFallidos,
  retirarCandidatasCerradas,
  tocaCribar,
} from '../../src/dominios/licitaciones/criba.js';
import { colaCriba } from '../../src/dominios/licitaciones/programado.js';
import {
  descartarPorIdioma,
  FILTROS_INICIALES,
  guardarFiltros,
  prefiltrar,
  reevaluarCandidatas,
} from '../../src/dominios/licitaciones/prefiltro.js';
import { detalle, Filtro, listarOportunidades } from '../../src/dominios/licitaciones/oportunidades.js';
import {
  colaDePliegos,
  descartarSinPliegos,
  encolarPliegosNuevos,
  MOTIVO_SIN_PLIEGOS,
  recuperarConPliegos,
} from '../../src/dominios/licitaciones/pliegos.js';
import { licitacion, type Sintetica } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-criba-'));
const abiertas: Db[] = [];
after(() => {
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-04T12:00:00Z');
let n = 0;

function conCandidatas(sinteticas: Sintetica[]): { db: Db; ids: string[] } {
  n += 1;
  const dir = path.join(tmp, String(n));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  abiertas.push(db);
  const ids = sinteticas.map((s) => {
    const l = licitacion(s);
    guardarLicitacion(db, l);
    db.prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'candidata', 'CPV 72', 'x', 'x')",
    ).run(l.id);
    return l.id;
  });
  return { db, ids };
}

const candidatas = (db: Db) =>
  (
    db.prepare("SELECT licitacion_id AS id FROM oportunidades WHERE estado = 'candidata' ORDER BY id").all() as {
      id: string;
    }[]
  ).map((r) => r.id);

function fallarLote(db: Db, lote: number): void {
  db.prepare(
    `INSERT INTO nucleo.trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en)
    VALUES ('licitaciones.cribar', 'licitaciones', ?, '{}', 'fallido', 'x', 'x')`,
  ).run(`cribar-lote-${lote}`);
}

test('should_retire_candidates_whose_deadline_passed_without_deadline_or_awarded_before_the_criba', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Abierta', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Plazo vencido', publicada: '2026-09-01', limite: '2026-09-20T14:00:00' },
    {
      titulo: 'Ya adjudicada',
      publicada: '2026-08-01',
      limite: '2026-10-30T14:00:00',
      ganadores: [{ nif: 'B11111111', nombre: 'Otra SL', importe: 90_000, ofertas: 3 }],
    },
    { titulo: 'Sin plazo publicado', publicada: '2026-09-30', limite: null },
  ]);
  assert.equal(retirarCandidatasCerradas(db, AHORA), 3);
  assert.deepEqual(candidatas(db), [ids[0]]);
  assert.equal(retirarCandidatasCerradas(db, AHORA), 0, 'idempotente');
});

test('should_keep_closed_candidates_already_sent_to_hermes_in_a_batch', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Cierra mañana', publicada: '2026-09-24', limite: '2026-10-05T08:00:00' },
  ]);
  crearLotes(db, 40);
  assert.equal(retirarCandidatasCerradas(db, Date.parse('2026-10-06T12:00:00Z')), 0, 'espera su veredicto');
  assert.deepEqual(candidatas(db), ids);
});

test('should_return_candidates_of_a_failed_batch_to_the_queue', () => {
  const { db } = conCandidatas([{ titulo: 'Una', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' }]);
  const [lote = 0] = crearLotes(db, 40);
  fallarLote(db, lote);
  assert.equal(liberarLotesFallidos(db), 1);
  assert.equal(liberarLotesFallidos(db), 0, 'el lote queda marcado fallido');
  const [nuevo = 0] = crearLotes(db, 40);
  assert.notEqual(nuevo, lote);
});

test('should_not_rebatch_a_full_batch_right_after_a_failure', () => {
  const { db } = conCandidatas([
    { titulo: 'Una', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Otra', publicada: '2026-09-24', limite: '2026-10-16T08:00:00' },
  ]);
  const [lote = 0] = crearLotes(db, 2);
  fallarLote(db, lote);
  liberarLotesFallidos(db);
  assert.equal(tocaCribar(db, 2, 2), false, 'no se crea otro lote en la vuelta siguiente');
  assert.equal(tocaCribar(db, 2, 2, Date.now() + 43_200_001), true, 'pasado el intervalo, sí');
});

test('should_reapply_changed_filters_to_candidates_still_waiting_for_the_criba', () => {
  const { db, ids } = conCandidatas([
    {
      titulo: 'Plataforma de datos abiertos',
      publicada: '2026-09-24',
      limite: '2026-10-15T08:00:00',
      presupuesto: 90_000,
      cpv: '72267000',
    },
    {
      titulo: 'Servicio de analítica de datos',
      publicada: '2026-09-24',
      limite: '2026-10-16T08:00:00',
      presupuesto: 450_000,
      cpv: '72267000',
    },
    {
      titulo: 'Gestión de datos sanitarios',
      publicada: '2026-09-24',
      limite: '2026-10-17T08:00:00',
      presupuesto: 600_000,
      cpv: '72267000',
    },
  ]);
  db.prepare('UPDATE oportunidades SET cambiada_a_mano = 1 WHERE licitacion_id = ?').run(ids[2]);
  guardarFiltros(db, { ...FILTROS_INICIALES, cpv_prefijos: ['72'], importe_max: 300_000 });
  assert.equal(reevaluarCandidatas(db, AHORA), 1, 'sale la de 450.000 €');
  assert.deepEqual(candidatas(db), [ids[0], ids[2]], 'la cambiada a mano no se toca');
  assert.match(
    (db.prepare('SELECT motivo_prefiltro AS m FROM oportunidades WHERE licitacion_id = ?').get(ids[0]) as { m: string })
      .m,
    /72/,
  );
  guardarFiltros(db, { ...FILTROS_INICIALES, cpv_prefijos: ['72'], importe_max: null });
  assert.equal(prefiltrar(db, 'todas', AHORA), 1, 'con los filtros de antes vuelve a entrar');
});

test('should_split_nuevas_waiting_for_hermes_from_those_with_a_ficha_to_review', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Analizada por Hermes', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Sin analizar', publicada: '2026-09-24', limite: '2026-10-16T08:00:00' },
    { titulo: 'En preparación con ficha', publicada: '2026-09-24', limite: '2026-10-17T08:00:00' },
  ]);
  const estado = db.prepare('UPDATE oportunidades SET estado = ? WHERE licitacion_id = ?');
  estado.run('nueva', ids[0]);
  estado.run('nueva', ids[1]);
  estado.run('en_preparacion', ids[2]);
  const ficha = db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES (?, 'aprobada', '{}', 'licitaciones', 'x', 'x')",
  );
  ficha.run(ids[0]);
  ficha.run(ids[2]);
  const lista = (estados: string[]) => listarOportunidades(db, Filtro.parse({ estados }), AHORA).items.map((i) => i.id);
  assert.deepEqual(lista(['nueva']), [ids[1]], 'nuevas son las que aún esperan a Hermes');
  assert.deepEqual(lista(['ficha_por_revisar']), [ids[0]]);
  assert.deepEqual(lista(['en_preparacion']), [ids[2]], 'en preparación sigue en su estado aunque tenga ficha');
  const { cuentas } = listarOportunidades(db, Filtro.parse({}), AHORA);
  assert.equal(cuentas.nueva, 1);
  assert.equal(cuentas.ficha_por_revisar, 1);
  assert.equal(cuentas.candidata, undefined);
});

test('should_list_open_tenders_by_deadline_and_expired_ones_last', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Vencida', publicada: '2026-09-01', limite: '2026-09-20T08:00:00' },
    { titulo: 'Vence más tarde', publicada: '2026-09-24', limite: '2026-10-20T08:00:00' },
    { titulo: 'Vence antes', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
  ]);
  db.prepare("UPDATE oportunidades SET estado = 'nueva'").run();
  const r = listarOportunidades(db, Filtro.parse({ estados: ['nueva'], orden: 'plazo' }), AHORA);
  assert.deepEqual(
    r.items.map((i) => i.id),
    [ids[2], ids[1], ids[0]],
  );
});

test('should_list_only_discarded_tenders_still_open', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Descartada en plazo', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Descartada cerrada', publicada: '2026-09-01', limite: '2026-09-20T08:00:00' },
  ]);
  db.prepare("UPDATE oportunidades SET estado = 'descartada'").run();
  const r = listarOportunidades(db, Filtro.parse({ estados: ['descartada'] }), AHORA);
  assert.deepEqual(
    r.items.map((i) => i.id),
    [ids[0]],
  );
  assert.equal(r.cuentas.descartada, 1, 'la cerrada tampoco cuenta');
});

test('should_tell_in_the_detail_whether_a_requested_ficha_is_queued_or_being_generated', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Con ficha pedida', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
  ]);
  const id = ids[0]!;
  assert.equal(detalle(db, id).data?.ficha_en_curso, null);
  db.prepare(
    `INSERT INTO nucleo.trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en)
    VALUES ('licitaciones.ficha', 'licitaciones', 'ficha-x', ?, 'pendiente', 'x', '2026-10-04T10:00:00Z')`,
  ).run(JSON.stringify({ id, pedida_en: 'x' }));
  assert.deepEqual(detalle(db, id).data?.ficha_en_curso, {
    estado: 'en_cola',
    desde: '2026-10-04T10:00:00Z',
    intentos: 0,
    proximo_intento_en: null,
    codigo: null,
  });
  db.prepare("UPDATE nucleo.trabajos_ia SET estado = 'lanzado'").run();
  assert.equal(detalle(db, id).data?.ficha_en_curso?.estado, 'generando');
  db.prepare("UPDATE nucleo.trabajos_ia SET estado = 'completado'").run();
  assert.equal(detalle(db, id).data?.ficha_en_curso, null, 'al terminar vuelve el botón');
});

test('should_discard_already_triaged_tenders_written_in_an_excluded_language', () => {
  const { db, ids } = conCandidatas([
    {
      titulo: "Servei d'assistència tècnica per a la implantació del projecte de dades",
      publicada: '2026-09-24',
      limite: '2026-10-15T08:00:00',
    },
    {
      titulo: 'Servicio de asistencia técnica para la implantación del proyecto de datos',
      publicada: '2026-09-24',
      limite: '2026-10-16T08:00:00',
    },
    {
      titulo: "Contractació del servei de manteniment dels sistemes d'informació",
      publicada: '2026-09-24',
      limite: '2026-10-17T08:00:00',
    },
  ]);
  db.prepare("UPDATE oportunidades SET estado = 'nueva'").run();
  db.prepare('UPDATE oportunidades SET cambiada_a_mano = 1 WHERE licitacion_id = ?').run(ids[2]);
  assert.equal(descartarPorIdioma(db), 0, 'sin marcar ninguna lengua no descarta nada');
  guardarFiltros(db, { ...FILTROS_INICIALES, excluir_idiomas: ['ca'] });
  assert.equal(descartarPorIdioma(db), 1);
  const fila = (id: string) =>
    db.prepare('SELECT estado, motivo_descarte FROM oportunidades WHERE licitacion_id = ?').get(id) as {
      estado: string;
      motivo_descarte: string | null;
    };
  assert.equal(fila(ids[0]!).estado, 'descartada');
  assert.match(fila(ids[0]!).motivo_descarte ?? '', /catalán/);
  assert.equal(fila(ids[1]!).estado, 'nueva', 'la de español sigue');
  assert.equal(fila(ids[2]!).estado, 'nueva', 'la que alguien movió a mano no se toca');
});

test('should_download_first_what_we_prepare_then_pcap_and_ppt_by_deadline_and_skip_what_we_dropped', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Lejana', publicada: '2026-09-24', limite: '2026-11-30T08:00:00' },
    { titulo: 'Cercana', publicada: '2026-09-24', limite: '2026-10-08T08:00:00' },
    { titulo: 'Preparando', publicada: '2026-09-24', limite: '2026-12-30T08:00:00' },
    { titulo: 'Descartada', publicada: '2026-09-24', limite: '2026-10-07T08:00:00' },
    { titulo: 'Cerrada', publicada: '2026-09-01', limite: '2026-09-20T08:00:00' },
  ]);
  const [lejana, cercana, preparando, descartada, cerrada] = ids as [string, string, string, string, string];
  const estado = db.prepare('UPDATE oportunidades SET estado = ? WHERE licitacion_id = ?');
  estado.run('nueva', lejana);
  estado.run('nueva', cercana);
  estado.run('en_preparacion', preparando);
  estado.run('descartada', descartada);
  estado.run('nueva', cerrada);
  const pliego = db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, ?, ?, 'pendiente', '2026-09-25T00:00:00Z')",
  );
  pliego.run(lejana, 'https://contrataciondelestado.es/l-anexo.pdf', 'adicional', 'l-anexo.pdf');
  pliego.run(lejana, 'https://contrataciondelestado.es/l-pcap.pdf', 'pcap', 'l-pcap.pdf');
  pliego.run(cercana, 'https://contrataciondelestado.es/c-ppt.pdf', 'ppt', 'c-ppt.pdf');
  pliego.run(cercana, 'https://contrataciondelestado.es/c-pcap.pdf', 'pcap', 'c-pcap.pdf');
  pliego.run(preparando, 'https://contrataciondelestado.es/p-anexo.pdf', 'adicional', 'p-anexo.pdf');
  pliego.run(descartada, 'https://contrataciondelestado.es/d-pcap.pdf', 'pcap', 'd-pcap.pdf');
  pliego.run(cerrada, 'https://contrataciondelestado.es/x-pcap.pdf', 'pcap', 'x-pcap.pdf');
  const cola = colaDePliegos(db, tmp, 10, AHORA).map((p) => p.nombre);
  assert.deepEqual(cola, ['p-anexo.pdf', 'c-pcap.pdf', 'l-pcap.pdf', 'c-ppt.pdf', 'l-anexo.pdf']);
});

test('should_tell_how_many_candidates_wait_for_a_batch_and_when_the_last_one_was_made', () => {
  const { db } = conCandidatas([
    { titulo: 'Plataforma de datos', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Cuadro de mando', publicada: '2026-09-24', limite: '2026-10-16T08:00:00' },
  ]);
  assert.deepEqual(colaCriba(db), { esperando: 2, ultimo_lote: null });
  crearLotes(db, 40);
  const despues = colaCriba(db);
  assert.equal(despues.esperando, 0, 'las del lote ya no esperan');
  assert.match(despues.ultimo_lote ?? '', /^\d{4}-/);
});

test('should_queue_documents_published_after_the_triage_and_from_regional_platforms', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Publicó los pliegos tarde', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'En la plataforma vasca', publicada: '2026-09-24', limite: '2026-10-16T08:00:00' },
    { titulo: 'Descartada', publicada: '2026-09-24', limite: '2026-10-17T08:00:00' },
    { titulo: 'Cerrada', publicada: '2026-09-01', limite: '2026-09-20T08:00:00' },
  ]);
  const [tarde, vasca, descartada, cerrada] = ids as [string, string, string, string];
  const docs = db.prepare("UPDATE licitaciones SET datos = json_set(datos, '$.documentos', json(?)) WHERE id = ?");
  const placsp = JSON.stringify([
    {
      clase: 'pcap',
      nombre: 'PCAP.pdf',
      url: 'https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?a=1',
    },
  ]);
  docs.run(placsp, tarde);
  docs.run(
    JSON.stringify([
      {
        clase: 'pcap',
        nombre: 'akpa.pdf',
        url: 'https://www.contratacion.euskadi.eus/ac70cPublicidadWar/downloadDokusiREST/descargaFicheroPublicadoPorIdFichero?idFichero=1',
      },
      { clase: 'ppt', nombre: 'ppt.pdf', url: 'http://www.madrid.org/contratos-publicos/1/2.pdf' },
    ]),
    vasca,
  );
  docs.run(placsp, descartada);
  docs.run(placsp, cerrada);
  const estado = db.prepare('UPDATE oportunidades SET estado = ? WHERE licitacion_id = ?');
  for (const id of [tarde, vasca, cerrada]) estado.run('nueva', id);
  estado.run('descartada', descartada);

  assert.equal(
    encolarPliegosNuevos(db, '2026-10-04T12:00:00Z'),
    2,
    'el PCAP tardío y el de Euskadi; ni lo descartado, ni lo cerrado, ni http',
  );
  const encolados = (
    db.prepare("SELECT licitacion_id AS id FROM pliegos WHERE estado = 'pendiente' ORDER BY licitacion_id").all() as {
      id: string;
    }[]
  ).map((r) => r.id);
  assert.deepEqual(encolados, [tarde, vasca].sort());
  assert.equal(encolarPliegosNuevos(db, '2026-10-04T12:00:00Z'), 0, 'repetirlo no duplica');
});

test('should_discard_new_tenders_without_documents_and_bring_them_back_as_news_when_published', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Sin pliegos en la plataforma', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Pliegos en madrid.org por http', publicada: '2026-09-24', limite: '2026-10-16T08:00:00' },
    { titulo: 'Puesta a mano en Nuevas', publicada: '2026-09-24', limite: '2026-10-17T08:00:00' },
    { titulo: 'La descarga falla en la PLACSP', publicada: '2026-09-24', limite: '2026-10-18T08:00:00' },
  ]);
  const [sin, http, aMano, falla] = ids as [string, string, string, string];
  db.prepare("UPDATE oportunidades SET estado = 'nueva', creada_en = '2026-09-25T10:00:00Z'").run();
  db.prepare('UPDATE oportunidades SET cambiada_a_mano = 1 WHERE licitacion_id = ?').run(aMano);
  const docs = db.prepare("UPDATE licitaciones SET datos = json_set(datos, '$.documentos', json(?)) WHERE id = ?");
  docs.run(
    JSON.stringify([{ clase: 'pcap', nombre: 'pcap.pdf', url: 'http://www.madrid.org/contratos-publicos/1/2.pdf' }]),
    http,
  );
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/x', 'pcap', 'PCAP.pdf', 'error', 'x')",
  ).run(falla);

  assert.equal(descartarSinPliegos(db), 2);
  const fila = (id: string) =>
    db
      .prepare('SELECT estado, motivo_descarte, descarte_automatico FROM oportunidades WHERE licitacion_id = ?')
      .get(id) as { estado: string; motivo_descarte: string | null; descarte_automatico: number };
  assert.deepEqual(fila(sin), { estado: 'descartada', motivo_descarte: MOTIVO_SIN_PLIEGOS, descarte_automatico: 1 });
  assert.equal(fila(http).estado, 'descartada', 'un pliego que no se puede bajar es como no tenerlo');
  assert.equal(fila(aMano).estado, 'nueva', 'lo puesto a mano no se toca');
  assert.equal(fila(falla).estado, 'nueva', 'con pliegos que fallan al bajar no se descarta');

  assert.equal(recuperarConPliegos(db, '2026-10-04T12:00:00Z'), 0, 'sin pliegos nuevos, sigue descartada');
  docs.run(
    JSON.stringify([
      {
        clase: 'pcap',
        nombre: 'PCAP.pdf',
        url: 'https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?b=2',
      },
    ]),
    sin,
  );
  assert.equal(recuperarConPliegos(db, '2026-10-04T12:00:00Z'), 1);
  assert.deepEqual(fila(sin), { estado: 'nueva', motivo_descarte: null, descarte_automatico: 0 });
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM pliegos WHERE licitacion_id = ? AND estado = 'pendiente'").get(sin) as {
        n: number;
      }
    ).n,
    1,
    'sus pliegos entran en cola',
  );
  const lista = listarOportunidades(db, Filtro.parse({ estados: ['nueva'], orden: 'llegada' }), AHORA).items;
  assert.equal(lista[0]?.id, sin, 'la primera por llegada');
  assert.equal(lista[0]?.creada_en, '2026-10-04T12:00:00Z', 'cuenta como novedad desde que volvió');
  assert.equal(descartarSinPliegos(db), 0, 'con pliegos en cola ya no se descarta');
});

const PCAP_PLACSP = JSON.stringify([
  {
    clase: 'pcap',
    nombre: 'PCAP.pdf',
    url: 'https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?c=3',
  },
]);
const ponerDocumentos = (db: Db, id: string, docs: string) =>
  db.prepare("UPDATE licitaciones SET datos = json_set(datos, '$.documentos', json(?)) WHERE id = ?").run(docs, id);
const pliegosDe = (db: Db, id: string) =>
  (db.prepare('SELECT COUNT(*) AS n FROM pliegos WHERE licitacion_id = ?').get(id) as { n: number }).n;

test('should_reject_a_blind_criba_but_accept_a_reason_that_mentions_a_missing_staff_profile', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Ingeniería de datos', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
  ]);
  const lote = crearLotes(db, 40)[0]!;
  const criba = (motivo: string) =>
    aplicarCriba(db, { lote, veredictos: [{ id: ids[0]!, veredicto: 'revisar', motivo, confianza: 0.6 }] });
  assert.match(criba('No pude leer Empresa/perfil-licitaciones.md').error?.message ?? '', /No se criba sin el perfil/);
  assert.match(
    criba('FALTA EL PERFIL DE LICITACIONES de la empresa').error?.message ?? '',
    /No se criba sin el perfil/,
  );
  assert.deepEqual(criba('Encaja, aunque nos falta perfil de ingeniero de datos senior').data, {
    interesa: 0,
    revisar: 1,
    descartar: 0,
  });
});

test('should_not_count_or_queue_documents_for_a_candidate_a_person_already_moved', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Cribada por Hermes', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Movida a mano antes de la criba', publicada: '2026-09-24', limite: '2026-10-16T08:00:00' },
  ]);
  const [cribada, movida] = ids as [string, string];
  ponerDocumentos(db, cribada, PCAP_PLACSP);
  ponerDocumentos(db, movida, PCAP_PLACSP);
  const lote = crearLotes(db, 40)[0]!;
  db.prepare("UPDATE oportunidades SET estado = 'descartada', cambiada_a_mano = 1 WHERE licitacion_id = ?").run(movida);
  const v = (id: string) => ({ id, veredicto: 'interesa' as const, motivo: 'Servicios de datos', confianza: 0.8 });

  const r = aplicarCriba(db, { lote, veredictos: [v(cribada), v(movida)] });

  assert.deepEqual(r.data, { interesa: 1, revisar: 0, descartar: 0 });
  assert.equal(pliegosDe(db, cribada), 1);
  assert.equal(pliegosDe(db, movida), 0, 'lo que la persona descartó no baja pliegos');
});

test('should_queue_new_documents_for_tenders_in_preparation_but_not_for_submitted_or_resolved_ones', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Preparando (plazo ya vencido)', publicada: '2026-09-01', limite: '2026-09-20T08:00:00' },
    { titulo: 'Presentada', publicada: '2026-09-01', limite: '2026-09-20T08:00:00' },
    { titulo: 'Ganada', publicada: '2026-09-01', limite: '2026-09-20T08:00:00' },
  ]);
  const [preparando, presentada, ganada] = ids as [string, string, string];
  const estado = db.prepare('UPDATE oportunidades SET estado = ? WHERE licitacion_id = ?');
  estado.run('en_preparacion', preparando);
  estado.run('presentada', presentada);
  estado.run('ganada', ganada);
  for (const id of ids) ponerDocumentos(db, id, PCAP_PLACSP);

  assert.equal(encolarPliegosNuevos(db, '2026-10-04T12:00:00Z'), 1);
  assert.deepEqual(
    ids.map((id) => pliegosDe(db, id)),
    [1, 0, 0],
  );
});

test('should_count_only_readable_annexes_as_documents_and_ignore_fichas_rejected_in_the_old_flow', () => {
  const { db, ids } = conCandidatas([
    { titulo: 'Solo un DEUC en zip', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' },
    { titulo: 'Con una ficha rechazada antigua', publicada: '2026-09-24', limite: '2026-10-16T08:00:00' },
  ]);
  const [soloZip, rechazada] = ids as [string, string];
  db.prepare("UPDATE oportunidades SET estado = 'nueva'").run();
  ponerDocumentos(
    db,
    soloZip,
    JSON.stringify([{ clase: 'adicional', nombre: 'DEUC.zip', url: 'https://contrataciondelestado.es/deuc.zip' }]),
  );
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES (?, 'rechazada', '{}', 'licitaciones', 'x', 'x')",
  ).run(rechazada);

  assert.equal(descartarSinPliegos(db), 2, 'un anexo que no se encolaría no cuenta como pliego');
  assert.equal(encolarPliegosNuevos(db, '2026-10-04T12:00:00Z'), 0);
  assert.equal(recuperarConPliegos(db, '2026-10-04T12:00:00Z'), 0, 'con el zip solo, sigue descartada');
});

test('should_compare_deadlines_with_the_time_in_spain_and_not_with_utc', () => {
  // A las 12:00 UTC son las 14:00 en Madrid: un plazo a las 13:30 (hora local) ya pasó.
  const { db, ids } = conCandidatas([
    { titulo: 'Cerró a mediodía', publicada: '2026-09-24', limite: '2026-10-04T13:30:00' },
    { titulo: 'Descartada que cerró a mediodía', publicada: '2026-09-24', limite: '2026-10-04T13:30:00' },
  ]);
  const [nueva, descartada] = ids as [string, string];
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run(nueva);
  db.prepare("UPDATE oportunidades SET estado = 'descartada' WHERE licitacion_id = ?").run(descartada);
  ponerDocumentos(db, nueva, PCAP_PLACSP);

  assert.equal(encolarPliegosNuevos(db, new Date(AHORA).toISOString()), 0);
  assert.deepEqual(listarOportunidades(db, Filtro.parse({ estados: ['descartada'] }), AHORA).items, []);
  assert.equal(
    listarOportunidades(db, Filtro.parse({ estados: ['nueva'] }), AHORA).items.length,
    1,
    'la nueva se lista aunque haya cerrado',
  );
});
