// Lectura del Atom de la PLACSP con entradas recortadas y anonimizadas (fixtures/):
// paginación, entradas borradas y mapeo CODICE → licitación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entradas, enlaceSiguiente, borradas } from '../../src/dominios/licitaciones/placsp/atom.js';
import { mapearEntrada, type LicitacionData } from '../../src/dominios/licitaciones/placsp/mapper.js';
import { idCorto, esUrlDePlataforma, esUrlDePliego } from '../../src/dominios/licitaciones/placsp/fuentes.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const leer = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');

function mapear(f: string, id: string): LicitacionData {
  const fuente = f.startsWith('agregadas') ? 'agregadas' : 'perfiles';
  const found = entradas(leer(f))
    .map((e) => mapearEntrada(fuente, e).data)
    .find((d) => d?.id === id);
  assert.ok(found, `falta ${id} en ${f}`);
  return found;
}

test('should_split_a_page_into_entries_and_follow_the_next_link', () => {
  const xml = leer('perfiles-pagina1.atom');
  assert.equal(entradas(xml).length, 3);
  assert.equal(enlaceSiguiente(xml), 'https://contrataciondelestado.es/sindicacion/sindicacion_643/pagina2.atom');
  assert.equal(enlaceSiguiente(leer('perfiles-pagina2.atom')), null);
});

test('should_read_deleted_entries_with_their_reason', () => {
  assert.deepEqual(borradas(leer('agregadas.atom')), [
    {
      atomId: 'https://contrataciondelestado.es/sindicacion/PlataformasAgregadasSinMenores/7824336',
      cuando: '2026-10-01T18:00:01.372+02:00',
      motivo: 'CERRADA',
    },
  ]);
  assert.deepEqual(borradas(leer('perfiles-pagina1.atom')), []);
});

test('should_map_an_open_tender_with_amounts_deadline_criteria_and_documents', () => {
  const l = mapear('perfiles-pagina1.atom', 'p-20571214');
  assert.equal(l.estado, 'PUB');
  assert.equal(l.expediente, '2026/0000881Y');
  assert.deepEqual(l.organo, {
    nombre: 'Instituto Ejemplo de Cultura',
    nif: 'Q0000001H',
    dir3: null,
    ciudad: 'Valencia',
    cp: '46002',
    superior: null,
  });
  assert.equal(l.presupuesto_sin_iva, 97290.9);
  assert.equal(l.presupuesto_con_iva, 117721.98);
  assert.deepEqual(l.cpvs, ['39717200', '42512000']);
  assert.equal(l.fecha_limite, '2026-10-16T20:00:00');
  assert.deepEqual(l.duracion, { valor: 112, unidad: 'DAY' });
  assert.deepEqual(
    l.criterios.map((c) => c.peso),
    [60, 30, 10],
  );
  assert.equal(l.criterios[0]?.descripcion, 'PRECIO OFERTADO');
  assert.deepEqual(
    l.documentos.map((d) => d.clase),
    ['pcap', 'ppt', 'adicional', 'adicional', 'adicional', 'otro', 'otro', 'otro', 'otro'],
  );
  assert.ok(l.documentos.every((d) => esUrlDePlataforma(d.url)));
  // Los «Otros documentos» se llaman por su FileName: el ID es un código.
  assert.deepEqual(
    l.documentos.filter((d) => d.clase === 'otro').map((d) => d.nombre),
    [
      'Nota informativa plazo ejecución',
      'Resolución aprobación expediente',
      'Memoria justificativa',
      'Acuerdo de iniciación del expediente',
    ],
  );
  assert.ok(l.requisitos.some((r) => r.clase === 'declaracion' && r.descripcion === 'Capacidad de obrar'));
});

test('should_map_other_documents_and_the_files_attached_to_published_notices_once_each', () => {
  const l = mapear('lotes-perfiles.atom', 'p-20040420');
  assert.deepEqual(
    l.documentos.filter((d) => d.clase === 'anuncio').map((d) => d.nombre),
    ['2533001-ResolucindeAdjudicacin-001001RA_STD_CA.pdf', '2533002-ResolucindeAdjudicacin-001001RA_STD_CA.pdf'],
  );
  assert.ok(l.documentos.some((d) => d.clase === 'otro' && d.nombre.startsWith('Anexo III - Adscripción de medios')));
  assert.equal(new Set(l.documentos.map((d) => d.url)).size, l.documentos.length, 'cada URL una vez');
});

test('should_map_lots_and_award_results_with_winner_tax_id', () => {
  const l = mapear('perfiles-pagina1.atom', 'p-18431943');
  assert.equal(l.estado, 'ADJ');
  assert.equal(l.resultados.length, 4);
  assert.deepEqual(
    l.lotes.slice(0, 2).map((x) => [x.id, x.presupuesto_sin_iva]),
    [
      ['1', 124721],
      ['2', 118782],
    ],
  );
  const lote2 = l.resultados[1]!;
  assert.equal(lote2.adjudicatario_nif, 'B00000117');
  assert.equal(lote2.adjudicatario_nombre, 'CONSULTORA EJEMPLO UNO SL');
  assert.equal(lote2.ofertas, 11);
  assert.equal(lote2.oferta_min, 74998);
  assert.equal(lote2.importe_sin_iva, 76258.04);
  assert.equal(lote2.pyme, true);
});

test('should_map_a_prior_notice_without_deadline_and_with_dir3', () => {
  const l = mapear('perfiles-pagina2.atom', 'p-20602993');
  assert.equal(l.estado, 'PRE');
  assert.equal(l.fecha_limite, null);
  assert.equal(l.organo.dir3, 'LA9999001');
});

test('should_map_aggregated_platform_entries_without_contracting_body_tax_id', () => {
  const l = mapear('agregadas.atom', 'a-20508788');
  assert.equal(l.fuente, 'agregadas');
  assert.equal(l.organo.nif, null);
  assert.equal(l.resultados[0]?.adjudicatario_nif, 'B00000133');
});

test('should_return_an_error_instead_of_throwing_on_a_malformed_entry', () => {
  assert.equal(mapearEntrada('perfiles', '<entry><id>x</id>').error?.code !== undefined, true);
  assert.equal(mapearEntrada('perfiles', '').error?.code, 'entrada_vacia');
  assert.equal(
    mapearEntrada('perfiles', '<entry><id>https://x/1</id><updated>2026-01-01</updated></entry>').error?.code,
    'entrada_invalida',
  );
});

test('should_build_short_ids_and_only_trust_platform_urls', () => {
  assert.equal(
    idCorto('perfiles', 'https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/20571214'),
    'p-20571214',
  );
  assert.equal(
    idCorto('agregadas', 'https://contrataciondelestado.es/sindicacion/PlataformasAgregadasSinMenores/7824336/'),
    'a-7824336',
  );
  assert.equal(
    esUrlDePlataforma('https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?x=1'),
    true,
  );
  assert.equal(esUrlDePlataforma('http://contrataciondelestado.es/a'), false);
  assert.equal(esUrlDePlataforma('https://contrataciondelestado.es.evil.com/a'), false);
  assert.equal(esUrlDePlataforma('no es una url'), false);
  assert.equal(
    esUrlDePlataforma('https://contractaciopublica.cat/portal-api/descarrega-document/1/A'),
    false,
    'el feed y el histórico, solo de la PLACSP',
  );
});

test('should_download_tender_documents_only_from_the_placsp_and_listed_regional_platforms', () => {
  assert.equal(esUrlDePliego('https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?x=1'), true);
  assert.equal(
    esUrlDePliego(
      'https://www.contratacion.euskadi.eus/ac70cPublicidadWar/downloadDokusiREST/descargaFicheroPublicadoPorIdFichero?idFichero=1',
    ),
    true,
  );
  assert.equal(esUrlDePliego('https://contractaciopublica.cat/portal-api/descarrega-document/302548773/052BE4'), true);
  assert.equal(
    esUrlDePliego('https://contratos-publicos.comunidad.madrid/sites/default/files/PCON/2026-09/pcap.pdf'),
    true,
  );
  assert.equal(esUrlDePliego('http://contratos-publicos.comunidad.madrid/pcap.pdf'), false, 'solo https');
  assert.equal(esUrlDePliego('https://contractaciopublica.cat.evil.com/a.pdf'), false);
  assert.equal(esUrlDePliego('https://169.254.169.254/latest/meta-data'), false);
});

test('should_read_the_participation_request_deadline_of_two_phase_procedures', () => {
  const xml = leer('perfiles-pagina1.atom').replace(
    '<cac:TenderSubmissionDeadlinePeriod>',
    '<cac:ParticipationRequestReceptionPeriod><cbc:EndDate>2026-10-07</cbc:EndDate><cbc:EndTime>12:00:00</cbc:EndTime></cac:ParticipationRequestReceptionPeriod><cac:TenderSubmissionDeadlinePeriod>',
  );
  const l = entradas(xml)
    .map((e) => mapearEntrada('perfiles', e).data)
    .find((d) => d?.id === 'p-20571214')!;
  assert.equal(l.fecha_solicitud, '2026-10-07T12:00:00');
  assert.equal(l.fecha_limite, '2026-10-16T20:00:00', 'la oferta sigue con su plazo');
  assert.equal(mapear('perfiles-pagina1.atom', 'p-20571214').fecha_solicitud, null, 'sin fase de solicitud, null');
});

test('should_keep_the_feed_fixtures_anonymous_with_fictitious_tax_ids_and_mailboxes', () => {
  const feeds = fs.readdirSync(FIX).filter((f) => f.endsWith('.atom'));
  assert.ok(feeds.length > 0);
  for (const f of feeds) {
    const xml = leer(f);
    const nifs = [...xml.matchAll(/schemeName="NIF">([^<]+)</g)].map((m) => m[1]!);
    for (const nif of nifs) assert.match(nif, /^(?:[A-Z]0000\d{3}[0-9A-J]|\*+\d+\*+)$/, `${f}: NIF no ficticio ${nif}`);
    const correos = [...xml.matchAll(/[\w.+-]+@([\w.-]+)/g)].map((m) => m[1]);
    assert.ok(
      correos.every((d) => d === 'example.com'),
      `${f}: correo que no es de example.com`,
    );
  }
});
