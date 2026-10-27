// Flujo del dominio Licitaciones con datos reales recortados: sincronización
// incremental (descargas simuladas en la frontera HTTP), guardado idempotente,
// organizaciones por NIF, prefiltro, criba por lotes, oportunidades y pliegos.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'licitaciones-'));
const conocimiento = path.join(tmp, 'conocimiento');
fs.mkdirSync(conocimiento);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = conocimiento;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { obtenerOrganizacion } = await import('../../src/nucleo/organizaciones.js');
const { abrirLicitaciones, guardarLicitacion, obtenerLicitacion, syncEstado } =
  await import('../../src/dominios/licitaciones/store.js');
const { sincronizarFuente } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { evaluar, prefiltrar, guardarFiltros, FILTROS_INICIALES } =
  await import('../../src/dominios/licitaciones/prefiltro.js');
const { crearLotes, aplicarCriba, candidatasDelLote, tocaCribar, loteCribado } =
  await import('../../src/dominios/licitaciones/criba.js');
const { listarOportunidades, cambiarOportunidad, detalle, plazos, Filtro } =
  await import('../../src/dominios/licitaciones/oportunidades.js');
const { descargarPendientes, nombreSeguro } = await import('../../src/dominios/licitaciones/pliegos.js');
const { carpetaDe } = await import('../../src/dominios/licitaciones/carpetas.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { Cambio } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { licitacion } = await import('../helpers/sinteticas.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pagina = (f: string) => ({
  xml: fs.readFileSync(path.join(FIX, f), 'utf8'),
  lastModified: 'Thu, 01 Oct 2026 20:00:00 GMT',
});
const AHORA = Date.parse('2026-10-02T12:00:00Z');

const { db: nucleoDb } = iniciarNucleo();
const db = abrirLicitaciones(process.env.PLATAFORMA_DATA_DIR!);

after(() => {
  cerrarDbLicitaciones();
  db.close();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Descargas simuladas: cada URL devuelve su fixture y se apunta qué se pidió.
function descargasDe(mapa: Record<string, ReturnType<typeof pagina> | null | 'error'>) {
  const pedidas: { url: string; desde: string | null }[] = [];
  const descargar = async (url: string, desde: string | null) => {
    pedidas.push({ url, desde });
    const r = mapa[url];
    if (r === 'error' || r === undefined)
      return { data: null, error: { code: 'placsp_http_500', message: 'caída' } } as const;
    return { data: r, error: null } as const;
  };
  return { descargar, pedidas };
}

const P1 = FUENTES.perfiles.feed;
const P2 = 'https://contrataciondelestado.es/sindicacion/sindicacion_643/pagina2.atom';

test('should_store_a_first_sync_following_next_pages_and_keep_the_newest_version', async () => {
  const { descargar, pedidas } = descargasDe({
    [P1]: pagina('perfiles-pagina1.atom'),
    [P2]: pagina('perfiles-pagina2.atom'),
  });
  const r = await sincronizarFuente(db, FUENTES.perfiles, 5, descargar);
  assert.equal(r.error, null);
  assert.equal(r.paginas, 2);
  assert.deepEqual(
    pedidas.map((p) => p.url),
    [P1, P2],
  );
  // La versión antigua de p-20571214 llega en la página 2 y no pisa la nueva.
  assert.match(obtenerLicitacion(db, 'p-20571214')!.titulo, /^Contratación suministro/);
  assert.equal(syncEstado(db, 'perfiles').hasta, '2026-10-01T19:00:47.350+02:00');
  assert.equal(syncEstado(db, 'perfiles').last_modified, 'Thu, 01 Oct 2026 20:00:00 GMT');
});

test('should_save_contracting_bodies_and_winners_once_per_tax_id', () => {
  assert.equal(obtenerOrganizacion(nucleoDb, 'Q0000001H')?.tipo, 'organismo');
  assert.equal(obtenerOrganizacion(nucleoDb, 'b00000125')?.tipo, 'empresa');
  const { n } = nucleoDb.prepare("SELECT COUNT(*) AS n FROM organizaciones WHERE nif = 'B00000125'").get() as {
    n: number;
  };
  assert.equal(n, 1, 'un adjudicatario de dos lotes es una sola organización');
});

test('should_compute_the_price_drop_per_lot_against_its_own_budget', () => {
  const filas = db
    .prepare("SELECT lote, baja FROM adjudicaciones WHERE licitacion_id = 'p-18431943' ORDER BY ord")
    .all() as { lote: string; baja: number }[];
  assert.equal(filas[0]?.baja, Math.round((1 - 85022.58 / 124721) * 10_000) / 10_000);
  assert.equal(filas[1]?.baja, Math.round((1 - 76258.04 / 118782) * 10_000) / 10_000);
});

test('should_stop_at_already_seen_entries_and_use_if_modified_since', async () => {
  const { descargar, pedidas } = descargasDe({ [P1]: null });
  const r = await sincronizarFuente(db, FUENTES.perfiles, 5, descargar);
  assert.equal(r.paginas, 0);
  assert.equal(pedidas[0]?.desde, 'Thu, 01 Oct 2026 20:00:00 GMT');
  // La entrada más antigua de la página 1 ya es anterior a lo visto menos una hora: no hace falta la 2.
  const otra = descargasDe({ [P1]: pagina('perfiles-pagina1.atom'), [P2]: pagina('perfiles-pagina2.atom') });
  await sincronizarFuente(db, FUENTES.perfiles, 5, otra.descargar);
  assert.deepEqual(
    otra.pedidas.map((p) => p.url),
    [P1],
  );
});

test('should_not_advance_the_watermark_when_a_page_fails', async () => {
  const antes = syncEstado(db, 'agregadas');
  const { descargar } = descargasDe({ [FUENTES.agregadas.feed]: 'error' });
  const r = await sincronizarFuente(db, FUENTES.agregadas, 5, descargar);
  assert.match(r.error ?? '', /placsp_http_500/);
  assert.equal(syncEstado(db, 'agregadas').hasta, antes.hasta);
  assert.match(syncEstado(db, 'agregadas').ultimo_error ?? '', /caída/);
});

test('should_mark_tenders_removed_from_the_feed', async () => {
  const { descargar } = descargasDe({ [FUENTES.agregadas.feed]: pagina('agregadas-borrada.atom') });
  await sincronizarFuente(db, FUENTES.agregadas, 5, descargar);
  const l = obtenerLicitacion(db, 'a-7824336')!;
  assert.equal(l.borrada_motivo, 'CERRADA');
});

const base = {
  titulo: 'Servicio de análisis de datos',
  estado: 'PUB',
  cpvs: ',72600000,',
  presupuesto_sin_iva: 100_000,
  tipo_contrato: '2',
  nuts: 'ES300',
  fecha_limite: '2026-10-20T10:00:00',
  borrada_en: null,
};

test('should_pass_the_prefilter_by_cpv_or_keyword_and_explain_why', () => {
  const f = { ...FILTROS_INICIALES };
  assert.equal(evaluar(f, base, AHORA), 'CPV 72… · palabra «datos»');
  assert.equal(
    evaluar(f, { ...base, cpvs: '', titulo: 'Gobierno del dato municipal' }, AHORA),
    'palabra «gobierno del dato»',
  );
  assert.equal(evaluar(f, { ...base, cpvs: ',45200000,72000000,', titulo: 'Obras' }, AHORA), 'CPV 72…');
});

test('should_drop_tenders_written_in_an_excluded_language_only_when_asked', () => {
  const catalan = { ...base, titulo: 'Servei de manteniment i suport de la plataforma de dades' };
  assert.ok(evaluar({ ...FILTROS_INICIALES }, catalan, AHORA), 'sin idiomas excluidos pasa');
  assert.equal(evaluar({ ...FILTROS_INICIALES, excluir_idiomas: ['ca'] }, catalan, AHORA), null);
  assert.ok(
    evaluar({ ...FILTROS_INICIALES, excluir_idiomas: ['eu', 'gl'] }, catalan, AHORA),
    'solo se excluyen las lenguas marcadas',
  );
  assert.ok(evaluar({ ...FILTROS_INICIALES, excluir_idiomas: ['ca'] }, base, AHORA), 'un título en español pasa');
});

test('should_reject_in_the_prefilter_closed_expired_out_of_range_or_excluded_tenders', () => {
  const f = { ...FILTROS_INICIALES, importe_max: 500_000, excluir_palabras: ['limpieza'], nuts_prefijos: ['ES3'] };
  assert.equal(evaluar(f, { ...base, cpvs: '', titulo: 'Obras de pavimentación' }, AHORA), null);
  assert.equal(evaluar(f, { ...base, estado: 'ADJ' }, AHORA), null);
  assert.equal(evaluar(f, { ...base, fecha_limite: '2026-10-01T10:00:00' }, AHORA), null);
  assert.equal(evaluar(f, { ...base, presupuesto_sin_iva: 900_000 }, AHORA), null);
  assert.equal(evaluar(f, { ...base, titulo: 'Limpieza de datos' }, AHORA), null);
  assert.equal(evaluar(f, { ...base, nuts: 'ES511' }, AHORA), null);
  assert.equal(evaluar(f, { ...base, tipo_contrato: '1' }, AHORA), null);
  assert.ok(evaluar(f, { ...base, presupuesto_sin_iva: null }, AHORA), 'sin importe no se descarta');
  assert.equal(
    evaluar(f, { ...base, borrada_en: null, fecha_limite: null }, AHORA),
    null,
    'sin plazo no se sabe si sigue abierta',
  );
});

test('should_create_candidates_only_for_open_tenders_that_pass_the_prefilter', () => {
  guardarFiltros(db, { ...FILTROS_INICIALES, cpv_prefijos: ['72', '79'], tipos_contrato: ['2'] });
  const nuevas = prefiltrar(db, 'todas', AHORA);
  const ids = (db.prepare('SELECT licitacion_id AS id FROM oportunidades ORDER BY id').all() as { id: string }[]).map(
    (r) => r.id,
  );
  // p-20379303 (servicios, CPV 72, abierta) y p-20602993 (anuncio previo de servicios, CPV 85 → no);
  // a-7824336 está borrada y p-18431943 adjudicada.
  assert.deepEqual(ids, ['p-20379303']);
  assert.equal(nuevas, 1);
  assert.equal(prefiltrar(db, 'todas', AHORA), 0, 'repetir no duplica');
});

let lote = 0;

test('should_batch_candidates_and_describe_them_compactly_for_hermes', () => {
  assert.equal(tocaCribar(db, 40, 2, AHORA), true);
  lote = crearLotes(db, 40)[0] ?? 0;
  assert.ok(lote > 0);
  assert.equal(tocaCribar(db, 40, 2, AHORA), false, 'no quedan candidatas sin lote');
  const c = candidatasDelLote(db, lote);
  assert.equal(c.data?.candidatas.length, 1);
  assert.equal(c.data?.perfil_empresa, 'Empresa/perfil-licitaciones.md');
  assert.equal((c.data?.candidatas[0] as { procedimiento: string }).procedimiento, 'Abierto');
});

test('should_reject_a_verdict_set_that_misses_repeats_or_adds_candidates', () => {
  const v = { id: 'p-20379303', veredicto: 'interesa' as const, motivo: 'Servicios de datos', confianza: 0.8 };
  assert.match(aplicarCriba(db, { lote, veredictos: [v, v] }).error?.message ?? '', /repetidos: p-20379303/);
  assert.match(
    aplicarCriba(db, { lote, veredictos: [{ ...v, id: 'p-1' }] }).error?.message ?? '',
    /no son de este lote: p-1; faltan: p-20379303/,
  );
  assert.equal(aplicarCriba(db, { lote: 999, veredictos: [v] }).error?.code, 'not_found');
  const ciega = aplicarCriba(db, {
    lote,
    veredictos: [
      { ...v, veredicto: 'revisar', motivo: 'Falta el perfil de licitaciones de la empresa.', confianza: 1 },
    ],
  });
  assert.match(ciega.error?.message ?? '', /No se criba sin el perfil/, 'una criba a ciegas no se acepta');
  assert.equal(loteCribado(db, lote), false);
});

test('should_apply_verdicts_queue_documents_and_refuse_a_second_criba', () => {
  const r = aplicarCriba(db, {
    lote,
    veredictos: [{ id: 'p-20379303', veredicto: 'interesa', motivo: 'Servicios de datos', confianza: 0.8 }],
  });
  assert.deepEqual(r.data, { interesa: 1, revisar: 0, descartar: 0 });
  assert.equal(loteCribado(db, lote), true);
  const d = detalle(db, 'p-20379303').data!;
  assert.equal(d.estado, 'nueva');
  assert.equal(d.motivo_ia, 'Servicios de datos');
  // PCAP y PPT; el DEUC en .zip no se baja porque la Biblioteca no lo puede leer.
  assert.equal(d.pliegos.length, 2);
  assert.equal(
    aplicarCriba(db, {
      lote,
      veredictos: [{ id: 'p-20379303', veredicto: 'descartar', motivo: 'otra vez', confianza: 1 }],
    }).error?.code,
    'ya_cribado',
  );
  assert.equal(
    ultimosEventos(nucleoDb, 5).some((e) => e.tipo === 'licitaciones.cribado'),
    true,
  );
});

test('should_list_follow_up_and_track_human_changes_to_opportunities', () => {
  const lista = listarOportunidades(db, Filtro.parse({}));
  assert.deepEqual(
    lista.items.map((i) => i.id),
    ['p-20379303'],
  );
  assert.equal(plazos(db, 14, AHORA).length, 1);
  assert.equal(plazos(db, 3, AHORA).length, 0);
  assert.deepEqual(cambiarOportunidad(db, 'p-20379303', { estado: 'descartada' }).data, { estado: 'descartada' });
  cambiarOportunidad(db, 'p-20379303', { estado: 'en_preparacion', notas: 'Vamos' });
  const d = detalle(db, 'p-20379303').data!;
  assert.equal(d.rescatada, true);
  assert.equal(d.notas, 'Vamos');
  assert.equal(cambiarOportunidad(db, 'p-nadie', { estado: 'en_preparacion' }).error?.code, 'not_found');
});

test('should_name_files_and_folders_safely_for_drive', () => {
  assert.equal(nombreSeguro('8 PCAP_.pdf', null), '8 PCAP_.pdf');
  assert.equal(nombreSeguro('../../etc/passwd', 'application/pdf'), 'etc passwd.pdf');
  assert.equal(nombreSeguro(' .oculto.pdf', null), 'oculto.pdf');
  assert.equal(nombreSeguro('', null), 'documento.pdf');
  assert.equal(
    nombreSeguro('Anexo I', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'Anexo I.docx',
  );
  assert.equal(
    carpetaDe({
      id: 'p-1',
      expediente: '2026/0000881Y',
      fecha_limite: '2026-10-16T20:00:00',
      actualizada_en: '2026-10-01',
    }),
    'Licitaciones/Radar/2026/2026-0000881Y (p-1)',
  );
});

test('should_download_documents_without_overwriting_files_it_did_not_create', async () => {
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(Buffer.from('%PDF-1.4 pliego'), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })) as typeof fetch;
  try {
    // Un archivo que ya estaba (de una persona) con el nombre del primer pliego.
    const destino = path.join(conocimiento, carpetaDe(obtenerLicitacion(db, 'p-20379303')!));
    fs.mkdirSync(destino, { recursive: true });
    const pliegos = detalle(db, 'p-20379303').data!.pliegos as { nombre: string }[];
    fs.writeFileSync(path.join(destino, pliegos[0]!.nombre), 'de una persona');
    assert.equal(await descargarPendientes(db, conocimiento, 10), 2);
  } finally {
    globalThis.fetch = fetchReal;
  }
  const pliegos = detalle(db, 'p-20379303').data!.pliegos as { nombre: string; estado: string; ruta: string }[];
  assert.ok(pliegos.every((p) => p.estado === 'descargado'));
  const primero = pliegos.find((p) => p.ruta.endsWith('-1.pdf') || p.ruta.endsWith('-1.docx'));
  assert.ok(primero, 'el pliego con el nombre ocupado se guarda con sufijo');
  const ocupado = path.join(conocimiento, path.dirname(primero.ruta), pliegos[0]!.nombre);
  assert.equal(fs.readFileSync(ocupado, 'utf8'), 'de una persona');
  assert.ok(fs.existsSync(path.join(conocimiento, path.dirname(primero.ruta), 'datos.json')));
  const { n } = nucleoDb.prepare("SELECT COUNT(*) AS n FROM documentos WHERE dominio = 'licitaciones'").get() as {
    n: number;
  };
  assert.equal(n, 2);
});

test('should_not_overwrite_a_datos_json_already_in_the_folder', async () => {
  const pliegos = detalle(db, 'p-20379303').data!.pliegos as { ruta: string }[];
  const datos = path.join(conocimiento, path.dirname(pliegos[0]!.ruta), 'datos.json');
  fs.writeFileSync(datos, '{"editado": true}');
  db.prepare("UPDATE pliegos SET estado = 'pendiente' WHERE licitacion_id = 'p-20379303'").run();
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(Buffer.from('%PDF-1.4 pliego'), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })) as typeof fetch;
  try {
    assert.equal(await descargarPendientes(db, conocimiento, 10), 2);
  } finally {
    globalThis.fetch = fetchReal;
  }
  assert.equal(fs.readFileSync(datos, 'utf8'), '{"editado": true}');
});

test('should_mark_at_once_as_error_a_download_that_is_a_web_page_and_not_a_document', async () => {
  db.prepare(
    "UPDATE pliegos SET estado = 'pendiente', intentos = 0, error = NULL WHERE licitacion_id = 'p-20379303'",
  ).run();
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<!DOCTYPE html><html><body>Sesión caducada</body></html>', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })) as typeof fetch;
  try {
    assert.equal(await descargarPendientes(db, conocimiento, 10), 0);
  } finally {
    globalThis.fetch = fetchReal;
  }
  const pliegos = db
    .prepare("SELECT estado, intentos, error FROM pliegos WHERE licitacion_id = 'p-20379303'")
    .all() as { estado: string; intentos: number; error: string }[];
  assert.ok(pliegos.length > 0);
  assert.ok(
    pliegos.every((p) => p.estado === 'error' && p.intentos === 1),
    'no se gastan tres intentos en lo que no va a cambiar',
  );
  assert.match(pliegos[0]!.error, /^no_es_documento/);
});

// Una oportunidad nueva aparte, para no mover la del flujo de arriba.
function oportunidadNueva(titulo: string): string {
  const l = licitacion({ titulo, publicada: '2026-10-01', limite: '2099-12-31T14:00:00' });
  guardarLicitacion(db, l);
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'nueva', 'antes', 'antes')",
  ).run(l.id);
  return l.id;
}
const filaOportunidad = (id: string) =>
  db.prepare('SELECT estado, cambiada_a_mano, actualizada_en FROM oportunidades WHERE licitacion_id = ?').get(id) as {
    estado: string;
    cambiada_a_mano: number;
    actualizada_en: string;
  };

test('should_not_write_or_mark_manual_when_the_state_does_not_change', () => {
  // Arrange
  const id = oportunidadNueva('Mantenimiento de la web municipal');

  // Act
  const r = cambiarOportunidad(db, id, Cambio.parse({ estado: 'nueva' }));

  // Assert
  assert.deepEqual(r.data, { estado: 'nueva' });
  assert.deepEqual({ ...filaOportunidad(id) }, { estado: 'nueva', cambiada_a_mano: 0, actualizada_en: 'antes' });
});

test('should_save_notes_without_marking_manual_when_the_state_does_not_change', () => {
  // Arrange
  const id = oportunidadNueva('Soporte de la sede electrónica');

  // Act
  cambiarOportunidad(db, id, Cambio.parse({ estado: 'nueva', notas: 'La lleva Persona A' }));

  // Assert
  const f = filaOportunidad(id);
  assert.equal(f.cambiada_a_mano, 0);
  assert.notEqual(f.actualizada_en, 'antes');
  assert.equal(detalle(db, id).data!.notas, 'La lleva Persona A');
});

test('should_ask_for_the_typed_motive_in_the_discard_message', () => {
  // Arrange / Act
  const r = Cambio.safeParse({ estado: 'descartada' });

  // Assert
  assert.equal(r.success, false);
  const mensaje = r.success ? '' : r.error.issues.map((i) => i.message).join(' ');
  assert.match(mensaje, /Al descartar, elige el motivo y dilo en pocas palabras\./);
  assert.doesNotMatch(mensaje, /criba/);
});

// CASO_E tal como estaba el 14/10/2026 (fixtures/comprobaciones): en preparación, lotes de interés 2 y 4.
// Va al final: siembra el perfil de empresa del fixture en el núcleo.
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { primerBloqueoAbierto } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
const CASO_E = leerFixtureComprobaciones('casoE');
const AHORA_CASO_E = Date.parse(CASO_E.ahora);
const filaCasoE = () =>
  listarOportunidades(
    db,
    Filtro.parse({ estados: ['en_preparacion'], texto: CASO_E.licitacion.titulo.slice(0, 60), limite: 50 }),
    AHORA_CASO_E,
  ).items.find((i) => i.id === CASO_E.id);

test('should_return_the_same_verdict_and_first_blocker_as_comprobaciones_for_offers_in_preparation', () => {
  // Arrange
  sembrarFixture(db, nucleoDb, CASO_E);
  const comprobaciones = comprobacionesDe(db, nucleoDb, CASO_E.id, AHORA_CASO_E).data!;
  const primero = primerBloqueoAbierto(comprobaciones.bloqueos)!;

  // Act
  const fila = filaCasoE();

  // Assert
  assert.ok(fila, 'la oferta en preparación sale en «Mi mesa»');
  assert.deepEqual(fila.veredicto, comprobaciones.veredicto);
  assert.deepEqual(fila.primer_bloqueo, { clave: primero.clave, titulo: primero.titulo });
});

test('should_count_only_exclusion_requirements_of_lots_of_interest', () => {
  // Arrange: 8 excluyentes dudosos en los lotes 2 y 4 (uno del 2, uno del 4 y 6 del contrato entero).
  const antes = filaCasoE()!.excluyentes_por_confirmar;
  db.prepare('UPDATE oportunidades SET lotes_interes = ? WHERE licitacion_id = ?').run(
    JSON.stringify([{ id: '2', motivo: 'criba' }]),
    CASO_E.id,
  );

  // Act
  const soloLote2 = filaCasoE()!.excluyentes_por_confirmar;

  // Assert
  assert.equal(antes, 8);
  assert.equal(soloLote2, 7, 'el excluyente del lote 4 ya no decide esta oferta');
});
