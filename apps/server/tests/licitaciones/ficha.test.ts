// Ficha y go/no-go de punta a punta: perfil de empresa en la web, descarte automático
// que respeta lo decidido por personas, la tool licitaciones_ficha por MCP (con el
// cliente oficial), que se aplica al llegar, y la cola de fichas.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { TEMAS_CHECKLIST } from '../../src/dominios/licitaciones/temas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ficha-'));
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(agentes);
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
const T_CURIOSO = 'k'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
// Un agente que lee licitaciones pero no plataforma (perfil de empresa).
fs.writeFileSync(path.join(agentes, 'curioso.token'), T_CURIOSO);
fs.writeFileSync(path.join(agentes, 'permisos.json'), JSON.stringify({ curioso: { plataforma: 'ninguno' } }));
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const { rutasPlataforma } = await import('../../src/nucleo/rutas.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { aplicarDescarteAutomatico } = await import('../../src/dominios/licitaciones/index.js');
const {
  VERSION_PROMPT_FICHA,
  FichaEntrada,
  proponerFicha,
  aplicarFichasPendientes,
  encolarFichasAuto,
  pedirFicha,
  fichaRecibida,
  fichasDe,
  instruccionesFicha,
} = await import('../../src/dominios/licitaciones/ficha.js');
const { detalle, sinCifrasDelPerfil } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { fichasRecientes } = await import('../../src/dominios/licitaciones/fichaMetricas.js');
const { candidatasARegenerar, vueltaRegeneracion, cambiarRegeneracion, resumenRegeneracion, CLAVE_REGENERACION } =
  await import('../../src/dominios/licitaciones/fichaRegeneracion.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
iniciarNucleo();
anadirHerramientas(herramientasBiblioteca);
anadirHerramientas(herramientasLicitaciones);
procesarPagina(dbLicitaciones(), FUENTES.perfiles, fs.readFileSync(path.join(FIX, 'requisitos.atom'), 'utf8'));

// Servicios con volumen exigido de 1,2 M€ (p-20435341), obras pequeñas (p-20602990) y suministro por lotes (p-20305225).
const SERVICIOS = 'p-20435341';
const OBRAS = 'p-20602990';
const LOTES = 'p-20305225';

function oportunidad(id: string, estado: string): void {
  const ts = new Date().toISOString();
  dbLicitaciones()
    .prepare(
      `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en)
    VALUES (?, ?, 'CPV 79…', ?, ?)`,
    )
    .run(id, estado, ts, ts);
}

// Sube el volumen de negocio exigido (en el contrato y en cada lote) para que no lo cumplamos.
function exigirVolumen(id: string, umbral: number): void {
  const db = dbLicitaciones();
  const { datos } = db.prepare('SELECT datos FROM licitaciones WHERE id = ?').get(id) as { datos: string };
  const d = JSON.parse(datos) as { requisitos: { codigo: string | null; umbral: number | null }[] };
  for (const r of d.requisitos) if (r.codigo === '5') r.umbral = umbral;
  db.prepare('UPDATE licitaciones SET datos = ? WHERE id = ?').run(JSON.stringify(d), id);
}

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  app.use('/api/plataforma', rutasPlataforma());
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

const json = { 'content-type': 'application/json' };
// Años relativos a hoy: el evaluador mira los tres últimos ejercicios cerrados.
const ANIO = new Date().getFullYear();
const PERFIL = {
  nif: 'B12345678',
  nombre: 'Analítica Ejemplo SL',
  clasificaciones: [{ grupo: 'V', subgrupo: 2, categoria: 'C' }],
  volumen_negocio: [
    { anio: ANIO - 3, importe: 400_000 },
    { anio: ANIO - 2, importe: 650_000 },
    { anio: ANIO - 1, importe: 900_000 },
  ],
  certificaciones: ['ISO 9001'],
  seguro_rc: 600_000,
  plantilla_media: 25,
  anios_actividad: 8,
  cpv_experiencia: ['72'],
  mayor_contrato_similar: 250_000,
  notas: '',
};

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';

function pliegoDescargado(id: string): void {
  dbLicitaciones()
    .prepare(
      `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES
    (?, 'https://contrataciondelestado.es/a', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)`,
    )
    .run(id, `Licitaciones/${id}/PCAP.pdf`, new Date(Date.now() - 10 * 60_000).toISOString());
}

// La lista de temas que toda ficha debe cubrir: los dados, en sus requisitos; el resto, «no lo pide».
function cobertura(enRequisitos: string[]) {
  return TEMAS_CHECKLIST.map((tema) => ({
    tema,
    estado: enRequisitos.includes(tema) ? 'en_requisitos' : 'no_lo_pide',
    documento: 'PCAP.pdf',
    pagina: 3,
  }));
}

function ficha(id: string, cumple: 'si' | 'no' | 'dudoso') {
  return {
    id,
    resumen: 'Servicio de vigilancia de las dependencias del Cabildo durante cuatro años.',
    requisitos: [
      {
        tipo: 'habilitacion',
        descripcion: 'Inscripción en el Registro de Empresas de Seguridad',
        excluyente: true,
        cumple,
        justificacion: 'El perfil no recoge esa inscripción.',
        fuente: 'perfil.certificaciones',
        documento: 'PCAP.pdf',
        pagina: 12,
      },
    ],
    cobertura: cobertura(['habilitacion']),
    criterios: [
      { descripcion: 'Precio', peso: 60, tipo: 'formula' },
      {
        descripcion: 'Memoria técnica',
        peso: 40,
        tipo: 'juicio_valor',
        subcriterios: [{ descripcion: 'Plan de trabajo', peso: 20 }],
      },
    ],
    documentacion: [
      { sobre: '1', documento: 'DEUC', obligatorio: true },
      { sobre: '2', documento: 'Memoria técnica', obligatorio: true, pagina: 30 },
    ],
    hitos: [{ hito: 'Fin de presentación', fecha: '2026-10-20T14:00' }],
    garantias: [{ tipo: 'definitiva', porcentaje: 5 }],
    penalizaciones: [{ descripcion: 'Un 1 % del precio por cada día de retraso', pagina: 40 }],
    riesgos: [{ descripcion: 'Subrogación de 120 vigilantes', gravedad: 'alta' }],
    recomendacion: { decision: cumple === 'no' ? 'no_go' : 'revisar', motivo: 'Habilitación de seguridad privada.' },
  };
}

test('should_validate_and_store_the_company_profile_through_the_web', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/plataforma/empresa`)).json(), {
    perfil: null,
    actualizado_en: null,
    propuesta: null,
  });
  const mal = await fetch(`${base}/api/plataforma/empresa`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ ...PERFIL, nif: 'X' }),
  });
  assert.equal(mal.status, 400);
  assert.match(((await mal.json()) as { message: string }).message, /NIF/);
  const bien = await fetch(`${base}/api/plataforma/empresa`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify(PERFIL),
  });
  assert.equal(bien.status, 200);
  const leido = (await (await fetch(`${base}/api/plataforma/empresa`)).json()) as {
    perfil: typeof PERFIL;
    actualizado_en: string;
  };
  // Los datos de empresa, el domicilio y la dirección y los certificados estructurados vuelven con su valor por defecto.
  assert.deepEqual(leido.perfil, {
    ...PERFIL,
    domicilio: null,
    direccion: null,
    certificados: null,
    representante: null,
    contacto: null,
    fecha_constitucion: null,
    tamano: null,
    idiomas: [],
    nombre_comercial: null,
    zona_horaria: 'Europe/Madrid',
    areas_formacion: [],
  });
  assert.ok(ultimosEventos(nucleo().db, 5).some((e) => e.tipo === 'plataforma.empresa'));
});

test('should_show_an_agent_proposal_in_the_web_until_a_person_closes_it', async () => {
  const { proponerPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
  proponerPerfilEmpresa(
    nucleo().db,
    { ...PERFIL, plantilla_media: 99 },
    'claude-code',
    'Plantilla del informe de la Seguridad Social',
  );
  const leido = (await (await fetch(`${base}/api/plataforma/empresa`)).json()) as {
    perfil: typeof PERFIL;
    propuesta: { agente: string; perfil: typeof PERFIL };
  };
  assert.equal(leido.propuesta.agente, 'claude-code');
  assert.equal(leido.propuesta.perfil.plantilla_media, 99);
  assert.notEqual(leido.perfil.plantilla_media, 99, 'el perfil guardado no cambia');
  const cerrada = await fetch(`${base}/api/plataforma/empresa/propuesta`, { method: 'DELETE' });
  assert.deepEqual(await cerrada.json(), { cerrada: true });
  assert.equal(
    ((await (await fetch(`${base}/api/plataforma/empresa`)).json()) as { propuesta: unknown }).propuesta,
    null,
  );
});

test('should_discard_only_automatic_states_untouched_by_people', async () => {
  // Las tres incumplen un excluyente: SERVICIOS sigue en un estado automático, OBRAS
  // (clasificación obligatoria al superar 500.000 €) está en preparación y a LOTES la
  // dejó una persona en «nueva» a mano (la sacó de preparación: pedir «nueva» a una nueva no
  // es un cambio y no la marca).
  oportunidad(SERVICIOS, 'nueva');
  oportunidad(OBRAS, 'en_preparacion');
  dbLicitaciones().prepare('UPDATE licitaciones SET valor_estimado = 750000 WHERE id = ?').run(OBRAS);
  oportunidad(LOTES, 'en_preparacion');
  exigirVolumen(LOTES, 10_000_000);
  const r = await fetch(`${base}/api/licitaciones/oportunidades/${LOTES}`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ estado: 'nueva' }),
  });
  assert.equal(r.status, 200);

  assert.equal(aplicarDescarteAutomatico(), 1);
  const estado = (id: string) =>
    dbLicitaciones().prepare('SELECT estado, motivo_descarte FROM oportunidades WHERE licitacion_id = ?').get(id) as {
      estado: string;
      motivo_descarte: string | null;
    };
  assert.equal(estado(SERVICIOS).estado, 'descartada');
  assert.match(estado(SERVICIOS).motivo_descarte ?? '', /Volumen anual de negocio/);
  assert.equal(estado(OBRAS).estado, 'en_preparacion');
  assert.equal(estado(LOTES).estado, 'nueva', 'lo puesto a mano no lo toca el código');
  const evento = ultimosEventos(nucleo().db, 10).find((e) => e.tipo === 'licitacion.descarte_automatico');
  assert.equal(evento?.recurso, SERVICIOS);
  assert.equal(evento?.datos['origen'], 'requisitos');
  assert.equal(aplicarDescarteAutomatico(), 0, 'repetir no vuelve a mover nada');
});

test('should_show_the_traffic_light_and_evaluated_requirements_in_the_detail', async () => {
  const d = (await (await fetch(`${base}/api/licitaciones/licitaciones/${SERVICIOS}`)).json()) as {
    motivo_descarte: string;
    descarte_automatico: boolean;
    go_no_go: {
      semaforo: { color: string };
      requisitos: { etiqueta: string; resultado: string }[];
      perfil_empresa: boolean;
    };
  };
  assert.equal(d.go_no_go.semaforo.color, 'rojo');
  assert.equal(d.go_no_go.perfil_empresa, true);
  assert.ok(
    d.go_no_go.requisitos.some((r) => r.etiqueta === 'Volumen anual de negocio' && r.resultado === 'no_cumple'),
  );
  assert.match(d.motivo_descarte, /Requisito excluyente/);
  assert.equal(d.descarte_automatico, true);
});

test('should_hide_company_profile_figures_from_agents_that_cannot_read_the_platform', async () => {
  const curioso = await conectar(T_CURIOSO);
  const lici = await conectar(T_LICI);
  try {
    assert.ok(!(await curioso.listTools()).tools.some((t) => t.name === 'plataforma_empresa'));
    const oculto = texto(await curioso.callTool({ name: 'licitaciones_ver', arguments: { id: SERVICIOS } }));
    const visible = texto(await lici.callTool({ name: 'licitaciones_ver', arguments: { id: SERVICIOS } }));

    assert.match(visible, /900\.000 €/);
    assert.doesNotMatch(oculto, /900\.000|600\.000|250\.000/);
    assert.match(oculto, /cifras reservadas/);
    assert.match(oculto, /"color":"rojo"/, 'el resultado sí se ve (JSON compacto: el detalle va entero)');
  } finally {
    await curioso.close();
    await lici.close();
  }
});

test('should_point_hermes_to_the_evaluated_requirements_in_its_instructions', () => {
  const instrucciones = instruccionesFicha(SERVICIOS, 'Analítica Ejemplo');

  assert.match(instrucciones, /go_no_go\.requisitos/);
  assert.doesNotMatch(instrucciones, /requisitos_evaluados/);
});

test('should_tell_hermes_to_read_rectifications_in_the_instructions', () => {
  const instrucciones = instruccionesFicha(SERVICIOS, 'Analítica Ejemplo');

  assert.match(
    instrucciones,
    /Lee también las rectificaciones, aclaraciones y notas posteriores \(licitaciones_pliegos las da\): mandan sobre el pliego original; cita la nota y su página\./,
  );
  const donde = instrucciones.indexOf('rectificaciones');
  assert.ok(
    donde > instrucciones.indexOf('3. Pliegos') && donde < instrucciones.indexOf('4. Medios'),
    'tras el paso 3',
  );
});

test('should_reject_a_ficha_that_ignores_the_ens_of_a_rectification_note', async () => {
  // CASO_E: la ficha decía «certificaciones: no_lo_pide» y la nota de rectificación exigía el ENS.
  const nota = {
    ruta: `Licitaciones/${LOTES}/Rectificación de errores materiales del pliego 27-09-2027 1032.pdf`,
    clase: 'adicional',
    pagina: 1,
    texto:
      'Los licitadores deberán presentar, junto con la oferta técnica, la correspondiente Declaración de conformidad con el Esquema Nacional de Seguridad (ENS), categoría BÁSICA, como requisito exigible.',
  };
  const temas = [{ tema: 'certificaciones' as const, etiqueta: 'Certificaciones', encontrado: true, pasajes: [nota] }];
  const pasajes = async (id: string) => ({
    data: { id, documentos: [], temas, sin_pasajes: [], aviso: null },
    error: null,
  });
  const antes = fichasDe(dbLicitaciones(), LOTES).aprobada?.id ?? null;
  // Fuera de la ventana de rechazos de las pruebas anteriores: la revisión se exige.
  const hoy = new Date(Date.now() + 3 * 3600_000);

  const r = await proponerFicha(dbLicitaciones(), FichaEntrada.parse(ficha(LOTES, 'dudoso')), 'licitaciones', {
    revisar: true,
    pasajes,
    hoy,
    candidatos: async () => null,
  });

  assert.equal(r.error?.code, 'invalid_input');
  assert.match(
    r.error?.message ?? '',
    /«Rectificación de errores materiales del pliego 27-09-2027 1032\.pdf» pág\. 1 dice: «Los licitadores deberán presentar.*\(ENS\), categoría BÁSICA/,
  );
  assert.equal(fichasDe(dbLicitaciones(), LOTES).aprobada?.id ?? null, antes, 'no se guarda');
});

test('should_describe_the_no_go_discard_and_its_undo_in_the_ficha_tool', async () => {
  // Arrange
  const lici = await conectar(T_LICI);
  try {
    // Act
    const tool = (await lici.listTools()).tools.find((t) => t.name === 'licitaciones_ficha');

    // Assert
    const d = tool?.description ?? '';
    assert.match(d, /pasa sola a Descartadas si la recomendación es no_go y la oportunidad sigue por decidir/);
    assert.match(d, /si una ficha posterior deja de ser no_go, vuelve sola a Ficha por revisar/);
    assert.match(d, /si una persona la recuperó, otra no_go ya no la descarta/);
  } finally {
    await lici.close();
  }
});

test('should_offer_the_ficha_tool_only_to_agents_that_may_propose', async () => {
  const claude = await conectar(T_CLAUDE);
  const lici = await conectar(T_LICI);
  try {
    const deClaude = (await claude.listTools()).tools.map((t) => t.name);
    assert.ok(!deClaude.includes('licitaciones_ficha'), 'Claude Code solo lee');
    assert.ok(deClaude.includes('plataforma_empresa'));
    assert.ok((await lici.listTools()).tools.some((t) => t.name === 'licitaciones_ficha'));
    await assert.rejects(claude.callTool({ name: 'licitaciones_ficha', arguments: ficha(OBRAS, 'si') }), /not found/);
  } finally {
    await claude.close();
    await lici.close();
  }
});

test('should_reject_an_invalid_or_unknown_ficha_with_a_tool_error', async () => {
  const client = await conectar(T_LICI);
  try {
    const sinCampos = await client.callTool({ name: 'licitaciones_ficha', arguments: { id: OBRAS, resumen: 'corto' } });
    assert.equal(sinCampos.isError, true);
    const extra = await client.callTool({
      name: 'licitaciones_ficha',
      arguments: { ...ficha(OBRAS, 'si'), inventado: true },
    });
    assert.equal(extra.isError, true, 'el esquema es estricto');
    const malCumple = {
      ...ficha(OBRAS, 'si'),
      requisitos: [{ ...ficha(OBRAS, 'si').requisitos[0], cumple: 'quizás' }],
    };
    assert.equal((await client.callTool({ name: 'licitaciones_ficha', arguments: malCumple })).isError, true);
    const noExiste = await client.callTool({ name: 'licitaciones_ficha', arguments: ficha('p-0000', 'si') });
    assert.equal(noExiste.isError, true);
    assert.match(texto(noExiste), /No hay ninguna licitación/);
    const empresa = await client.callTool({ name: 'plataforma_empresa', arguments: {} });
    assert.match(texto(empresa), /Analítica Ejemplo SL/);
  } finally {
    await client.close();
  }
});

test('should_apply_a_valid_ficha_on_arrival_and_replace_it_on_resend', async () => {
  const pedida = new Date(Date.now() - 1000).toISOString();
  const client = await conectar(T_LICI);
  try {
    const r = await client.callTool({ name: 'licitaciones_ficha', arguments: ficha(OBRAS, 'si') });
    assert.equal(r.isError, undefined);
    assert.match(texto(r), /"estado": "aprobada"/, 'sin paso de aprobación');
    const otra = await client.callTool({ name: 'licitaciones_ficha', arguments: ficha(OBRAS, 'dudoso') });
    assert.match(texto(otra), /"sustituye": true/);
  } finally {
    await client.close();
  }
  const ultima = fichasDe(dbLicitaciones(), OBRAS).aprobada;
  assert.equal(ultima?.datos.requisitos[0]?.cumple, 'dudoso', 'cuenta la última que envió Hermes');
  assert.equal(fichaRecibida(dbLicitaciones(), OBRAS, pedida), true);
  assert.equal(fichaRecibida(dbLicitaciones(), OBRAS, new Date(Date.now() + 60_000).toISOString()), false);
});

test('should_queue_a_ficha_on_request_without_duplicating_one_in_progress', async () => {
  const pedir = () => fetch(`${base}/api/licitaciones/oportunidades/${OBRAS}/ficha`, { method: 'POST' });
  const sinPliegos = await pedir();
  assert.equal(sinPliegos.status, 400);
  assert.match(((await sinPliegos.json()) as { message: string }).message, /pliegos descargados/);
  pliegoDescargado(OBRAS);
  const a = await pedir();
  assert.equal(a.status, 202);
  const { trabajo } = (await a.json()) as { trabajo: number };
  assert.deepEqual(await (await pedir()).json(), { trabajo });
  assert.equal((await fetch(`${base}/api/licitaciones/oportunidades/p-0000/ficha`, { method: 'POST' })).status, 404);
});

test('should_queue_automatic_fichas_once_documents_are_downloaded', () => {
  const db = dbLicitaciones();
  pliegoDescargado(LOTES);
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run(LOTES);
  // Solo lo que sigue abierto: la del fixture ya venció.
  db.prepare("UPDATE licitaciones SET fecha_limite = '2099-01-01T00:00:00' WHERE id = ?").run(LOTES);
  assert.equal(encolarFichasAuto(nucleo().db, db), 1);
  assert.equal(encolarFichasAuto(nucleo().db, db), 0, 'no se encola dos veces');
  const t = nucleo().db.prepare('SELECT tipo, payload FROM trabajos_ia WHERE clave = ?').get(`ficha-auto-${LOTES}`) as {
    tipo: string;
    payload: string;
  };
  assert.equal(t.tipo, 'licitaciones.ficha');
  assert.equal((JSON.parse(t.payload) as { id: string }).id, LOTES);

  // Si falla, se vuelve a pedir pasada una hora, como mucho tres rondas.
  const hace2h = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const fallar = (clave: string) =>
    nucleo()
      .db.prepare("UPDATE trabajos_ia SET estado = 'fallido', actualizado_en = ? WHERE clave = ?")
      .run(hace2h, clave);
  fallar(`ficha-auto-${LOTES}`);
  assert.equal(encolarFichasAuto(nucleo().db, db), 1, 'segunda ronda');
  fallar(`ficha-auto-${LOTES}-r1`);
  assert.equal(encolarFichasAuto(nucleo().db, db), 1, 'tercera ronda');
  fallar(`ficha-auto-${LOTES}-r2`);
  assert.equal(encolarFichasAuto(nucleo().db, db), 0, 'tras tres rondas fallidas ya no se pide sola');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE clave LIKE ?").run(`ficha-auto-${LOTES}%`);
});

test('should_discard_on_arrival_a_ficha_with_an_unmet_exclusion_but_never_a_human_state', async () => {
  const client = await conectar(T_LICI);
  try {
    // OBRAS está en preparación (estado humano): su ficha con un excluyente no la toca.
    const obras = await client.callTool({ name: 'licitaciones_ficha', arguments: ficha(OBRAS, 'no') });
    assert.match(texto(obras), /"descartada": false/);
    dbLicitaciones()
      .prepare("UPDATE oportunidades SET estado = 'nueva', cambiada_a_mano = 0 WHERE licitacion_id = ?")
      .run(LOTES);
    const lotes = await client.callTool({ name: 'licitaciones_ficha', arguments: ficha(LOTES, 'no') });
    assert.match(texto(lotes), /"descartada": true/);
  } finally {
    await client.close();
  }
  const d = (await (await fetch(`${base}/api/licitaciones/licitaciones/${LOTES}`)).json()) as {
    estado: string;
    motivo_descarte: string;
    go_no_go: { semaforo: { color: string }; ficha: { aprobada: { estado: string } | null } };
  };
  assert.equal(d.estado, 'descartada');
  assert.match(d.motivo_descarte, /Según la ficha de los pliegos/);
  assert.equal(d.go_no_go.semaforo.color, 'rojo');
  assert.equal(d.go_no_go.ficha.aprobada?.estado, 'aprobada');
  assert.equal(
    (
      await fetch(`${base}/api/licitaciones/licitaciones/${LOTES}/ficha/revision`, {
        method: 'POST',
        headers: json,
        body: '{}',
      })
    ).status,
    404,
    'ya no hay revisión',
  );
});

test('should_apply_fichas_left_pending_by_the_previous_flow', () => {
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'nueva', cambiada_a_mano = 0 WHERE licitacion_id = ?").run(SERVICIOS);
  const datos = { ...FichaEntrada.parse(ficha(SERVICIOS, 'no')), id: undefined };
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES (?, 'pendiente', ?, 'licitaciones', 'x', 'x')",
  ).run(SERVICIOS, JSON.stringify(datos));
  assert.equal(aplicarFichasPendientes(db), 1);
  assert.ok(fichasDe(db, SERVICIOS).aprobada);
  assert.equal(
    (db.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ?').get(SERVICIOS) as { estado: string })
      .estado,
    'descartada',
    'se aplica como si hubiera llegado ahora',
  );
  assert.equal(aplicarFichasPendientes(db), 0);
});

test('should_mark_placsp_doubts_as_resolved_once_a_ficha_is_approved', async () => {
  // La habilitación la PLACSP nunca la publica estructurada: siempre queda «desconocido».
  const db = dbLicitaciones();
  const { datos } = db.prepare('SELECT datos FROM licitaciones WHERE id = ?').get(OBRAS) as { datos: string };
  const conHabilitacion = JSON.parse(datos) as { requisitos: unknown[] };
  conHabilitacion.requisitos.push({
    clase: 'habilitacion',
    codigo: null,
    descripcion: 'Registro de empresas de seguridad',
    umbral: null,
    lote: null,
  });
  db.prepare('UPDATE licitaciones SET datos = ? WHERE id = ?').run(JSON.stringify(conHabilitacion), OBRAS);

  const d = (await (await fetch(`${base}/api/licitaciones/licitaciones/${OBRAS}`)).json()) as {
    go_no_go: { requisitos: { resultado: string; en_ficha?: boolean }[]; ficha: { aprobada: unknown } };
  };
  const dudas = d.go_no_go.requisitos.filter((r) => r.resultado === 'desconocido');

  assert.ok(d.go_no_go.ficha.aprobada);
  assert.ok(dudas.length > 0);
  assert.ok(dudas.every((r) => r.en_ficha === true));
});

test('should_hide_profile_figures_inside_the_ficha_from_agents_that_cannot_read_the_platform', () => {
  const d = detalle(dbLicitaciones(), OBRAS).data!;
  const aprobada = d.go_no_go.ficha.aprobada!;
  const datos = {
    ...aprobada.datos,
    requisitos: aprobada.datos.requisitos.map((r) => ({
      ...r,
      justificacion: 'Nuestro volumen de 900.000 € no llega.',
    })),
    recomendacion: { decision: 'revisar' as const, motivo: 'El volumen (900.000 €) va justo.' },
    riesgos: [{ descripcion: 'Nuestro seguro de 600.000 € se queda corto.', gravedad: 'media' as const }],
  };
  const conCifras = { ...d, go_no_go: { ...d.go_no_go, ficha: { aprobada: { ...aprobada, datos } } } };

  const oculto = JSON.stringify(sinCifrasDelPerfil(conCifras));

  assert.doesNotMatch(oculto, /900\.000|600\.000/);
  assert.match(oculto, /cifras reservadas/);
  assert.match(oculto, /Registro de Empresas de Seguridad/, 'lo que pide el pliego sí se ve');
  assert.match(oculto, /"gravedad":"media"/, 'y la gravedad del riesgo');
});

test('should_queue_an_automatic_ficha_despite_an_old_rejected_one_and_return_it_when_asked_by_hand', async () => {
  const db = dbLicitaciones();
  const OTRA = 'p-20415829';
  oportunidad(OTRA, 'nueva');
  db.prepare("UPDATE licitaciones SET fecha_limite = '2099-01-01T00:00:00' WHERE id = ?").run(OTRA);
  pliegoDescargado(OTRA);
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES (?, 'rechazada', '{}', 'licitaciones', 'x', 'x')",
  ).run(OTRA);

  assert.equal(encolarFichasAuto(nucleo().db, db), 1, 'una ficha rechazada del flujo anterior no cuenta como ficha');
  const auto = nucleo().db.prepare('SELECT id FROM trabajos_ia WHERE clave = ?').get(`ficha-auto-${OTRA}`) as {
    id: number;
  };
  const pedida = await fetch(`${base}/api/licitaciones/oportunidades/${OTRA}/ficha`, { method: 'POST' });
  assert.deepEqual(await pedida.json(), { trabajo: auto.id }, 'la automática en cola sirve también a quien la pide');
});

test('should_not_ask_for_an_automatic_ficha_while_the_pcap_cannot_be_read', () => {
  const db = dbLicitaciones();
  const ID = OBRAS;
  db.prepare("UPDATE oportunidades SET estado = 'nueva', cambiada_a_mano = 0 WHERE licitacion_id = ?").run(ID);
  db.prepare("UPDATE licitaciones SET fecha_limite = '2099-01-01T00:00:00' WHERE id = ?").run(ID);
  db.prepare('DELETE FROM fichas WHERE licitacion_id = ?').run(ID);
  nucleo().db.prepare('DELETE FROM trabajos_ia WHERE clave LIKE ?').run(`%${ID}%`);
  db.prepare(
    `INSERT OR IGNORE INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES
    (?, 'https://contrataciondelestado.es/roto', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)`,
  ).run(ID, `Licitaciones/${ID}/PCAP.pdf`, new Date(Date.now() - 10 * 60_000).toISOString());
  const soloEsta = (estado: 'ilegible' | 'listo') => (id: string) => (id === ID ? estado : ('esperar' as const));
  assert.equal(encolarFichasAuto(nucleo().db, db, Date.now(), soloEsta('ilegible')), 0);
  assert.equal(
    encolarFichasAuto(nucleo().db, db, Date.now(), soloEsta('listo')),
    1,
    'en cuanto se puede leer, se pide',
  );
});

test('should_offer_the_passages_of_the_tender_documents_and_explain_when_there_is_no_index', async () => {
  const lici = await conectar(T_LICI);
  try {
    assert.ok((await lici.listTools()).tools.some((t) => t.name === 'licitaciones_pliegos'));
    const r = await lici.callTool({ name: 'licitaciones_pliegos', arguments: { id: SERVICIOS } });
    assert.equal(r.isError, true);
    assert.match(texto(r), /no_indexado|sin_pliegos/);
    const malo = await lici.callTool({
      name: 'licitaciones_pliegos',
      arguments: { id: SERVICIOS, temas: ['astrologia'] },
    });
    assert.equal(malo.isError, true, 'solo temas conocidos');
  } finally {
    await lici.close();
  }
});

test('should_refuse_an_incomplete_ficha_twice_and_then_accept_it_with_warnings', async () => {
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = ?").run(SERVICIOS);
  const incompleta = { ...ficha(SERVICIOS, 'dudoso'), cobertura: undefined };
  const lici = await conectar(T_LICI);
  try {
    for (let i = 0; i < 2; i++) {
      const r = await lici.callTool({ name: 'licitaciones_ficha', arguments: incompleta });
      assert.equal(r.isError, true);
      assert.match(texto(r), /Falta en «cobertura»/);
    }
    const tercera = await lici.callTool({ name: 'licitaciones_ficha', arguments: incompleta });
    assert.equal(tercera.isError, undefined, 'a la tercera se acepta para no frenar las fichas');
    assert.match(texto(tercera), /"avisos": \[\s*"Falta en «cobertura»/);
  } finally {
    await lici.close();
  }
  const g = fichasDe(db, SERVICIOS).aprobada!;
  assert.equal(g.version_prompt, VERSION_PROMPT_FICHA);
  assert.ok(g.datos.calidad!.avisos.length > 0);
  assert.ok(g.datos.calidad!.puntuacion < 100);
});

test('should_store_what_the_code_checked_and_show_it_in_the_go_no_go', async () => {
  const db = dbLicitaciones();
  const lici = await conectar(T_LICI);
  const idioma = {
    tipo: 'idioma',
    descripcion: 'Atención telefónica y manuales en castellano',
    excluyente: true,
    cumple: 'dudoso',
    justificacion: 'El perfil no indica idiomas.',
    documento: 'PPT.pdf',
    pagina: 15,
  };
  const f = {
    ...ficha(SERVICIOS, 'dudoso'),
    requisitos: [...ficha(SERVICIOS, 'dudoso').requisitos, idioma],
    cobertura: cobertura(['habilitacion', 'idioma']),
  };
  try {
    const r = await lici.callTool({ name: 'licitaciones_ficha', arguments: f });
    assert.equal(r.isError, undefined, texto(r));
    assert.match(texto(r), /"requisito": "Atención telefónica[^"]*",\s*"hermes": "dudoso",\s*"codigo": "si"/);
  } finally {
    await lici.close();
  }
  const datos = fichasDe(db, SERVICIOS).aprobada!.datos;
  assert.equal(datos.requisitos[1]!.cumple, 'si');
  assert.match(datos.requisitos[1]!.fuente ?? '', /perfil\.idiomas/);
  assert.deepEqual(
    datos.verificaciones?.map((v) => [v.regla, v.resultado_ia, v.resultado]),
    [['idioma', 'dudoso', 'si']],
  );
});

test('should_still_read_a_ficha_saved_with_the_first_version', () => {
  const db = dbLicitaciones();
  const v1 = {
    resumen: 'Ficha antigua, sin cobertura ni verificaciones.',
    requisitos: [
      {
        tipo: 'idioma',
        descripcion: 'Castellano',
        excluyente: true,
        cumple: 'dudoso',
        justificacion: 'El perfil no indica idiomas.',
      },
    ],
    criterios: [],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'revisar', motivo: 'Dudas.' },
  };
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?)",
  ).run(OBRAS, JSON.stringify(v1), '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
  const g = fichasDe(db, OBRAS).aprobada;
  assert.ok(g, 'la ficha v1 sigue valiendo');
  assert.equal(g.version_prompt, 1);
});

test('should_summarise_the_fichas_of_hermes_by_model_with_their_job_metrics', () => {
  const db = dbLicitaciones();
  const ts = new Date().toISOString();
  const trabajo = Number(
    nucleo()
      .db.prepare(
        `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, metricas)
    VALUES ('licitaciones.ficha', 'licitaciones', 'metricas-prueba', '{}', 'completado', ?, ?, ?)`,
      )
      .run(
        ts,
        ts,
        JSON.stringify({
          modelo: 'gpt-6-luna',
          duracion_s: 600,
          tokens_entrada: 100_000,
          tokens_salida: 5_000,
          llamadas_herramientas: 9,
          respuestas_recortadas: 0,
          rechazos: 1,
        }),
      ).lastInsertRowid,
  );
  const ultima = db
    .prepare('SELECT id, licitacion_id FROM fichas WHERE version_prompt = ? ORDER BY id DESC LIMIT 1')
    .get(VERSION_PROMPT_FICHA) as { id: number; licitacion_id: string };
  db.prepare('UPDATE fichas SET trabajo_id = ? WHERE id = ?').run(trabajo, ultima.id);
  const r = fichasRecientes(db);
  const fila = r.recientes.find((x) => x.licitacion === ultima.licitacion_id && x.modelo === 'gpt-6-luna');
  assert.ok(fila);
  assert.equal(fila.tokens, 105_000);
  assert.equal(fila.version, VERSION_PROMPT_FICHA);
  assert.ok(r.por_modelo.some((m) => m.modelo === 'gpt-6-luna' && m.fichas >= 1 && m.duracion_media_s === 600));
  assert.equal(
    fichasDe(db, ultima.licitacion_id).aprobada?.metricas?.modelo,
    'gpt-6-luna',
    'la ficha lleva las métricas de su trabajo',
  );
});

test('should_regenerate_old_fichas_of_live_opportunities_a_few_at_a_time_and_pausable', () => {
  const db = dbLicitaciones();
  const nuc = nucleo().db;
  nuc.prepare("DELETE FROM trabajos_ia WHERE tipo = 'licitaciones.ficha'").run();
  nuc.prepare('DELETE FROM operaciones_unicas WHERE clave = ?').run(CLAVE_REGENERACION);
  // Tres oportunidades vivas con una ficha v1 y otra ya en la v2.
  const ids = [SERVICIOS, OBRAS, LOTES];
  for (const [i, id] of ids.entries()) {
    db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run(id);
    db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(`2099-0${i + 1}-01T12:00:00`, id);
    db.prepare('UPDATE fichas SET version_prompt = 1 WHERE licitacion_id = ?').run(id);
  }
  db.prepare('UPDATE fichas SET version_prompt = ? WHERE licitacion_id = ?').run(VERSION_PROMPT_FICHA, LOTES);
  // Solo las de esta prueba (el resto de oportunidades de la base, fuera de plazo o sin ficha).
  db.prepare("UPDATE oportunidades SET estado = 'descartada' WHERE licitacion_id NOT IN (?, ?, ?)").run(...ids);
  assert.deepEqual(candidatasARegenerar(db), [SERVICIOS, OBRAS], 'por plazo, sin las que ya están al día');

  const todas = () => 'listo' as const;
  assert.equal(
    vueltaRegeneracion(nuc, db, (id) => (id === OBRAS ? 'esperar' : 'listo')),
    1,
    'solo las que se pueden leer ya',
  );
  assert.ok(
    nuc.prepare('SELECT 1 FROM trabajos_ia WHERE clave = ?').get(`ficha-${SERVICIOS}-regen-v${VERSION_PROMPT_FICHA}`),
    'con su clave de regeneración',
  );
  assert.deepEqual(candidatasARegenerar(db), [OBRAS], 'cada una se pide una sola vez por versión');

  assert.equal(cambiarRegeneracion(nuc, 'pausar').data?.estado, 'pausada');
  assert.equal(vueltaRegeneracion(nuc, db, todas), 0, 'pausada no encola');
  cambiarRegeneracion(nuc, 'reanudar');
  assert.equal(vueltaRegeneracion(nuc, db, todas), 1);
  assert.equal(vueltaRegeneracion(nuc, db, todas), 0);
  assert.equal(resumenRegeneracion(nuc, db).estado, 'hecha');
  assert.equal(resumenRegeneracion(nuc, db).encoladas, 2);
  nuc.prepare("DELETE FROM trabajos_ia WHERE tipo = 'licitaciones.ficha'").run();
});

test('should_save_new_sheets_with_current_prompt_version', () => {
  const db = dbLicitaciones();
  const n = (
    db.prepare('SELECT COUNT(*) AS n FROM fichas WHERE version_prompt = ?').get(VERSION_PROMPT_FICHA) as { n: number }
  ).n;
  assert.ok(n >= 1, 'las fichas guardadas en esta prueba llevan la versión vigente');
});

test('should_pick_live_sheets_from_previous_version_for_regeneration', () => {
  const db = dbLicitaciones();
  nucleo().db.prepare("DELETE FROM trabajos_ia WHERE tipo = 'licitaciones.ficha'").run();
  db.prepare("UPDATE oportunidades SET estado = 'descartada' WHERE licitacion_id <> ?").run(SERVICIOS);
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run(SERVICIOS);
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run('2099-01-01T12:00:00', SERVICIOS);
  db.prepare('UPDATE fichas SET version_prompt = 2 WHERE licitacion_id = ?').run(SERVICIOS);
  assert.deepEqual(candidatasARegenerar(db), [SERVICIOS]);
});

test('should_not_regenerate_discarded_opportunities', () => {
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'descartada' WHERE licitacion_id = ?").run(SERVICIOS);
  db.prepare('UPDATE fichas SET version_prompt = 2 WHERE licitacion_id = ?').run(SERVICIOS);
  assert.ok(!candidatasARegenerar(db).includes(SERVICIOS));
});

test('should_enqueue_at_most_two_regenerations_at_once', () => {
  const db = dbLicitaciones();
  const nuc = nucleo().db;
  nuc.prepare("DELETE FROM trabajos_ia WHERE tipo = 'licitaciones.ficha'").run();
  nuc.prepare('DELETE FROM operaciones_unicas WHERE clave = ?').run(CLAVE_REGENERACION);
  for (const [i, id] of [SERVICIOS, OBRAS, LOTES].entries()) {
    db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run(id);
    db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(`2099-0${i + 1}-01T12:00:00`, id);
    db.prepare('UPDATE fichas SET version_prompt = 1 WHERE licitacion_id = ?').run(id);
  }
  const listo = () => 'listo' as const;
  assert.equal(vueltaRegeneracion(nuc, db, listo), 2);
  assert.equal(vueltaRegeneracion(nuc, db, listo), 0, 'con 2 en cola no pide más');
  nuc.prepare("DELETE FROM trabajos_ia WHERE tipo = 'licitaciones.ficha'").run();
});

test('should_not_treat_a_downloaded_deuc_as_documents_to_read_for_the_ficha', () => {
  const db = dbLicitaciones();
  const ID = LOTES;
  db.prepare("UPDATE oportunidades SET estado = 'nueva', cambiada_a_mano = 0 WHERE licitacion_id = ?").run(ID);
  db.prepare("UPDATE licitaciones SET fecha_limite = '2099-01-01T00:00:00' WHERE id = ?").run(ID);
  db.prepare('DELETE FROM fichas WHERE licitacion_id = ?').run(ID);
  db.prepare('DELETE FROM pliegos WHERE licitacion_id = ?').run(ID);
  nucleo().db.prepare('DELETE FROM trabajos_ia WHERE clave LIKE ?').run(`%${ID}%`);
  db.prepare(
    `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, tipo, actualizado_en) VALUES
    (?, 'https://contrataciondelestado.es/deuc', 'otro', 'DEUC.xml', 'descargado', ?, 'deuc', ?)`,
  ).run(ID, `Licitaciones/${ID}/DEUC.xml`, new Date(Date.now() - 10 * 60_000).toISOString());

  const r = pedirFicha(nucleo().db, db, ID);

  assert.equal(r.error?.code, 'invalid_input', 'solo con el DEUC no hay qué leer');
  assert.equal(
    encolarFichasAuto(nucleo().db, db, Date.now(), () => 'listo'),
    0,
    'la automática tampoco',
  );
  db.prepare("UPDATE pliegos SET tipo = NULL, clase = 'pcap' WHERE licitacion_id = ?").run(ID);
  assert.equal(
    encolarFichasAuto(nucleo().db, db, Date.now(), () => 'listo'),
    1,
    'con un pliego de verdad sí',
  );
  nucleo().db.prepare('DELETE FROM trabajos_ia WHERE clave LIKE ?').run(`%${ID}%`);
});
