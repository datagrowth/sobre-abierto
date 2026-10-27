// Borrador del Anexo XIV: la vía alternativa de un requisito excluyente abierto (el ENS
// sin certificado). Se pide solo con confirmación y la cadena automática nunca lo encola; el run
// recibe la instrucción de buscar evidencias en la Biblioteca, y un hueco redactado («Redacción»)
// solo entra citando documentos que existen, con un aviso fijo de comprobarlo antes de firmar.
// El Anexo XIV del PCAP de CASO_B (fixtures/documentos/pcapCasoB.ts) es una tabla de 11 páginas sin
// huecos (ofertaTablaRequisitos.test.ts): aquí va un modelo Word sintético con un hueco que
// pide más que la hoja. Datos de empresa ficticios (Persona A) y ningún importe real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { CARPETA_PLIEGOS, decisionesCasoA, FICHA_CASO_A, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-anexo-xiv-'));
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
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { documentoDelGuion, filaDocumento } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { AnexoEntrada } = await import('../../src/dominios/licitaciones/oferta/anexosGuardado.js');
const { encolarAnexosAuto } = await import('../../src/dominios/licitaciones/oferta/anexosAuto.js');
const { esViaAlternativa, VIA_SIN_CONFIRMAR } = await import('../../src/dominios/licitaciones/oferta/anexosVia.js');
const { instruccionesDeAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosInstrucciones.js');
const { pedirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosPedir.js');
const { recibirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosRecibir.js');
const { rutasDocumentosOferta } = await import('../../src/dominios/licitaciones/oferta/anexosRutas.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { aplicarAccionBloqueo } = await import('../../src/dominios/licitaciones/oferta/comprobacionesBloqueos.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { estadoElegibilidad } = await import('../../src/dominios/licitaciones/oferta/anexosVia.js');
const { FichaDatos } = await import('../../src/dominios/licitaciones/ficha.js');

iniciarNucleo();
const db = dbLicitaciones();
const raices = { salidas, conocimiento };
const ctx = { db, dbNucleo: nucleo().db, raices };
const ahora = new Date().toISOString();

// Párrafos del modelo, numerados como localizarHuecos (desde 1).
const HUECO = '……………………';
const MODELOS = [
  'ANEXO VI',
  'DECLARACIÓN RESPONSABLE',
  `D./Dña. ${HUECO}, en representación de la empresa.`,
  `Fdo.: ${HUECO}`,
  'ANEXO XIV',
  'EVALUACIÓN DEL CUMPLIMIENTO ENS',
  `D./Dña. ${HUECO}, en representación de la empresa, declara:`,
  `Medidas de seguridad equivalentes implantadas: ${HUECO}`,
  `Fdo.: ${HUECO}`,
];
const P_XIV = { desde: 5, hasta: 9, nombre: 7, medidas: 8 };
const docxModelos = () =>
  Packer.toBuffer(
    new Document({ sections: [{ children: MODELOS.map((t) => new Paragraph({ children: [new TextRun(t)] })) }] }),
  );

fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
fs.writeFileSync(path.join(conocimiento, CARPETA_PLIEGOS, 'Modelos.docx'), await docxModelos());
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', 'Modelos.docx', 'descargado', ?, ?)",
).run(ID, 'https://contrataciondelestado.es/Modelos.docx', `${CARPETA_PLIEGOS}/Modelos.docx`, ahora);
// La evidencia de la Biblioteca que cita la redacción.
const POLITICA = 'Conocimiento/Empresa/Seguridad/Politica de seguridad.pdf';
fs.mkdirSync(path.join(conocimiento, 'Empresa', 'Seguridad'), { recursive: true });
fs.writeFileSync(path.join(conocimiento, 'Empresa', 'Seguridad', 'Politica de seguridad.pdf'), 'política');

const anexo = (tipo: string, modelo: string) => ({
  tipo,
  nombre: modelo,
  obligatorio: true,
  produce: 'persona',
  origen: { modelo, documento: 'Modelos.docx', pagina: 1 },
});
const guion = guionCon((g) => {
  g.archivos[0]!.documentos = [
    g.archivos[0]!.documentos[0]!,
    g.archivos[0]!.documentos[1]!,
    anexo('declaracion', 'Anexo VI'),
    anexo('acreditacion', 'Anexo XIV'),
  ] as never;
});
const [ANEXO_VI, ANEXO_XIV] = ['a1-d3', 'a1-d4'];

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
};
assert.equal(guardarPerfilEmpresa(nucleo().db, PERFIL).error, null);
const PERSONA = crearPersona(nucleo().db, { nombre: 'Persona A', tipo: 'interno', rol: 'Consultora' }).data!.id;
assert.equal(
  guardarDecisiones(db, nucleo().db, ID, {
    ...decisionesCasoA([PERSONA]),
    precio: { importe: 10_000, pendiente: false },
  }).error,
  null,
);

type Requisito = { cumple: 'si' | 'no' | 'dudoso' | 'no_aplica'; excluyente?: boolean; justificacion?: string };
const ENS = (r: Requisito) => ({
  tipo: 'certificacion',
  descripcion: 'Certificado de conformidad con el ENS de categoría MEDIA',
  excluyente: r.excluyente ?? true,
  valor_exigido: 'ENS MEDIA',
  cumple: r.cumple,
  fuente: 'perfil.certificaciones',
  justificacion:
    r.justificacion ?? 'No tenemos ENS; la vía alternativa es el Anexo XIV del PCAP con evidencias equivalentes.',
  documento: 'PCAP.pdf',
  pagina: 18,
});
const { id: _id, ...FICHA_BASE } = FICHA_CASO_A;
const ficha = (r: Requisito) => FichaDatos.parse({ ...FICHA_BASE, requisitos: [ENS(r)] });
db.prepare(
  "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?)",
).run(ID, JSON.stringify(ficha({ cumple: 'no' })), ahora, ahora, ahora);

// La API de la checklist, como la llama la web.
const app = express();
const router = express.Router();
rutasDocumentosOferta(router);
app.use('/api', router);
const server = escucharLocal(http.createServer(app));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const documento = (clave: string) => documentoDelGuion(guionVigente(db, ID)!.datos, clave)!;
const trabajos = (clave: string) =>
  nucleo()
    .db.prepare("SELECT id FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.clave') = ?")
    .all(TIPO_ANEXO, clave);
const nombre = {
  parrafo: P_XIV.nombre,
  original: `D./Dña. ${HUECO}`,
  nuevo: 'D./Dña. Persona A',
  dato: 'Representante',
};
const medidas = (extra: object) => ({
  parrafo: P_XIV.medidas,
  original: `implantadas: ${HUECO}`,
  nuevo: 'implantadas: política de seguridad aprobada y doble factor en el acceso',
  dato: 'Redacción',
  ...extra,
});
const enviar = (sustituciones: unknown[]) =>
  recibirAnexo(
    ctx,
    AnexoEntrada.parse({
      id: ID,
      clave: ANEXO_XIV,
      desde_parrafo: P_XIV.desde,
      hasta_parrafo: P_XIV.hasta,
      sustituciones,
    }),
    { revisar: true },
  );

test('should_not_treat_a_document_as_alternative_route_when_the_ficha_does_not_name_it', () => {
  // Arrange
  const xiv = documento(ANEXO_XIV);
  const casos = [
    ficha({ cumple: 'no', justificacion: 'No tenemos ENS ni ISO 27001.' }),
    ficha({ cumple: 'si' }),
    ficha({ cumple: 'no', excluyente: false }),
    ficha({ cumple: 'no_aplica' }),
  ];
  // Act
  const vias = [
    ...casos.map((f) => esViaAlternativa(f, xiv)),
    esViaAlternativa(null, xiv),
    esViaAlternativa(ficha({ cumple: 'no', justificacion: 'Sin ENS: la vía es el Anexo XIVB.' }), xiv),
  ];
  // Assert
  assert.deepEqual(vias, [false, false, false, false, false, false]);
  assert.equal(esViaAlternativa(ficha({ cumple: 'dudoso' }), xiv), true, 'un excluyente dudoso sigue abierto');
  assert.equal(esViaAlternativa(ficha({ cumple: 'no' }), documento(ANEXO_VI)), false, 'el Anexo VI no es el XIV');
});

test('should_not_treat_an_ordinary_annex_cited_to_accredit_a_requirement_as_alternative_route', () => {
  // Arrange: la ficha cita el anexo con que se acredita el requisito, sin decir que sustituya a nada.
  const solvencia = (justificacion: string) =>
    FichaDatos.parse({
      ...FICHA_BASE,
      requisitos: [
        {
          tipo: 'solvencia_economica',
          descripcion: 'Volumen anual de negocios de 50.000 €',
          excluyente: true,
          valor_exigido: '50.000 €',
          cumple: 'dudoso',
          fuente: 'perfil.solvencia',
          justificacion,
          documento: 'PCAP.pdf',
          pagina: 12,
        },
      ],
    });
  // Act
  const vias = [
    esViaAlternativa(
      solvencia('Se acredita con la declaración del Anexo VI; falta el dato de 2025.'),
      documento(ANEXO_VI),
    ),
    esViaAlternativa(
      ficha({ cumple: 'dudoso', justificacion: 'Se acredita mediante el Anexo XIV; falta el certificado.' }),
      documento(ANEXO_XIV),
    ),
    esViaAlternativa(solvencia('Sin el volumen, en su defecto vale el seguro: Anexo VI.'), documento(ANEXO_VI)),
    // Como la ficha real de CASO_B (seudonimizada): la frase que nombra el XIV dice que es la vía alternativa.
    esViaAlternativa(
      ficha({
        cumple: 'dudoso',
        justificacion:
          'No tenemos ENS ni ISO. El pliego abre una vía alternativa (Anexo XIV, informe o evidencias equivalentes), pero no consta que esté preparada.',
      }),
      documento(ANEXO_XIV),
    ),
  ];
  // Assert
  assert.deepEqual(
    vias,
    [false, false, true, true],
    'solo una frase que lo marca como alternativa lo hace vía alternativa',
  );
});

test('should_never_enqueue_the_alternative_route_annex_automatically', () => {
  // Act
  encolarAnexosAuto(nucleo().db, db);
  encolarAnexosAuto(nucleo().db, db);
  // Assert
  assert.equal(trabajos(ANEXO_XIV).length, 0, 'la vía alternativa no entra en la cadena');
  // El freno de los demás anexos mientras el ENS siga abierto lee el «Vamos» de las comprobaciones: aún no está.
  assert.equal(trabajos(ANEXO_VI).length, 1, 'los demás anexos siguen su cadena hasta el freno de las comprobaciones');
});

test('should_allow_requesting_the_alternative_route_annex_with_confirmation_while_eligibility_is_blocked', async () => {
  // Act
  const sin = await pedirAnexo(ctx, ID, ANEXO_XIV);
  const con = await pedirAnexo(ctx, ID, ANEXO_XIV, { confirmado: true });
  // Assert
  assert.equal(sin.error?.code, VIA_SIN_CONFIRMAR);
  assert.equal(sin.error?.message, 'El ENS sigue abierto: preparas el Anexo XIV como vía alternativa. Gasta 1 run.');
  assert.equal(con.error, null, con.error?.message);
  assert.equal(trabajos(ANEXO_XIV).length, 1);
  const ins = await instruccionesDeAnexo(db, nucleo().db, { id: ID, clave: ANEXO_XIV, pedida_en: ahora });
  assert.match(
    ins,
    /Busca en la Biblioteca \(biblioteca_buscar\) evidencias de medidas de seguridad equivalentes; usa «Redacción» solo con fuentes; si no hay evidencias, deja el hueco vacío y dilo en el aviso\./,
  );
  const vi = await instruccionesDeAnexo(db, nucleo().db, { id: ID, clave: ANEXO_VI, pedida_en: ahora });
  assert.doesNotMatch(vi, /biblioteca_buscar/, 'solo la vía alternativa pide redactar');
});

test('should_ask_the_web_to_confirm_the_alternative_route_annex_with_a_code_it_confirms', async () => {
  // Arrange
  const url = `${base}/licitaciones/${ID}/oferta/documentos/${ANEXO_XIV}/anexo`;
  // Act
  const sin = await fetch(url, { method: 'POST' });
  const con = await fetch(`${url}?confirmar=1`, { method: 'POST' });
  // Assert: pedirConPlazo (web/src/lib/peticiones.js) confirma «via_alternativa» y repite con «?confirmar=1».
  assert.deepEqual(
    [sin.status, await sin.json()],
    [
      409,
      {
        error: 'via_alternativa',
        message: 'El ENS sigue abierto: preparas el Anexo XIV como vía alternativa. Gasta 1 run.',
      },
    ],
  );
  assert.equal(con.status, 202);
  assert.equal(((await con.json()) as { clave: string }).clave, ANEXO_XIV);
});

test('should_require_sources_for_a_written_hole_and_check_they_exist', async () => {
  // Act
  const sinFuentes = await enviar([nombre, medidas({})]);
  const vacias = await enviar([nombre, medidas({ fuentes: [] })]);
  const inexistente = await enviar([nombre, medidas({ fuentes: [{ ruta: 'Conocimiento/Empresa/No existe.pdf' }] })]);
  // Assert
  for (const r of [sinFuentes, vacias])
    assert.match(r.error?.message ?? '', /El párrafo 8 es redacción: di de qué documentos sale \(fuentes\)\./);
  assert.match(
    inexistente.error?.message ?? '',
    /No encuentro «Conocimiento\/Empresa\/No existe\.pdf»: cita un documento de la Biblioteca o de Salidas\./,
  );
  assert.equal(filaDocumento(db, ID, ANEXO_XIV)!.anexo_en, null, 'nada se guarda');
  const reservada = `Salidas/Licitaciones/EXP-2026-0412 (${ID})/VALORES_A_TECLEAR.md`;
  const conImportes = await enviar([nombre, medidas({ fuentes: [{ ruta: reservada }] })]);
  assert.match(
    conImportes.error?.message ?? '',
    /no se puede citar: lleva los importes de la oferta/,
    'lo reservado se rechaza aunque no exista',
  );
  assert.doesNotMatch(conImportes.error?.message ?? '', /No encuentro/, 'sin decir si existe');
  assert.equal(
    AnexoEntrada.safeParse({
      id: ID,
      clave: ANEXO_XIV,
      sustituciones: [medidas({ fuentes: [{ ruta: '/etc/passwd' }] })],
    }).success,
    false,
    'solo rutas de Salidas o Conocimiento',
  );
});

test('should_warn_that_written_text_must_be_checked_with_its_sources', async () => {
  // Act
  const r = await enviar([nombre, medidas({ fuentes: [{ ruta: POLITICA, pagina: 2 }] })]);
  // Assert
  assert.equal(r.error, null, r.error?.message);
  const aviso =
    'Texto redactado por Hermes en el párrafo 8 (fuentes: Politica de seguridad.pdf, pág. 2): comprueba que es cierto antes de firmar.';
  assert.ok(r.data!.avisos.includes(aviso), r.data!.avisos.join(' | '));
  const f = filaDocumento(db, ID, ANEXO_XIV)!;
  assert.equal(f.estado, 'borrador');
  assert.ok((JSON.parse(f.avisos) as string[]).includes(aviso), 'el aviso queda en la fila');
  const firmado = await enviar([
    nombre,
    medidas({ fuentes: [{ ruta: POLITICA }] }),
    { parrafo: 9, original: `Fdo.: ${HUECO}`, nuevo: 'Fdo.: Persona A', dato: 'Representante' },
  ]);
  assert.match(firmado.error?.message ?? '', /La firma se deja en blanco/, 'la firma sigue como hoy');
});

test('should_read_from_the_comprobaciones_whether_the_eligibility_block_is_still_open', () => {
  // Arrange: la ficha sigue diciendo «no cumple»; solo las comprobaciones saben si la persona dijo «Vamos».
  const xiv = documento(ANEXO_XIV);
  const abierta = estadoElegibilidad(db, ID, ficha({ cumple: 'no' }).requisitos[0]!);
  const bloqueo = comprobacionesDe(db, nucleo().db, ID).data!.bloqueos.find(
    (b) => b.clave.startsWith('excluyente_vs_perfil:') && b.estado === 'abierto',
  )!;
  // Act
  const antes = esViaAlternativa(ficha({ cumple: 'no' }), xiv, (r) => estadoElegibilidad(db, ID, r));
  const vamos = aplicarAccionBloqueo(db, ID, bloqueo.clave, {
    accion: 'vamos',
    motivo: 'Vamos con la vía alternativa del Anexo XIV.',
  });
  const despues = esViaAlternativa(ficha({ cumple: 'no' }), xiv, (r) => estadoElegibilidad(db, ID, r));
  // Assert
  assert.equal(abierta, 'abierta');
  assert.equal(vamos.error, null, vamos.error?.message);
  assert.deepEqual([antes, despues], [true, false], 'con «Vamos» la vía alternativa deja de pedir confirmación');
  assert.equal(esViaAlternativa(ficha({ cumple: 'no' }), xiv), true, 'sin comprobaciones se sigue leyendo la ficha');
});

test('should_not_ask_for_confirmation_of_the_alternative_route_once_the_comprobaciones_closed_the_block', async () => {
  // Act
  const r = await pedirAnexo(ctx, ID, ANEXO_XIV);
  // Assert
  assert.equal(r.error, null, r.error?.message);
});

// La fila del Anexo XIV como si nadie lo hubiera pedido: lo que mira la cola automática.
function sinPedirXiv(): void {
  db.prepare(
    "UPDATE oferta_documentos SET ruta = NULL, anexo_en = NULL, estado = 'pendiente' WHERE licitacion_id = ? AND clave = ?",
  ).run(ID, ANEXO_XIV);
  nucleo()
    .db.prepare("DELETE FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.clave') = ?")
    .run(TIPO_ANEXO, ANEXO_XIV);
}
const conTexto = (descripcion: string) =>
  FichaDatos.parse({
    ...FICHA_BASE,
    requisitos: [{ ...ENS({ cumple: 'no' }), descripcion, valor_exigido: descripcion }],
  });

test('should_fall_back_to_the_ficha_when_the_comprobaciones_does_not_evaluate_the_certification', () => {
  // Arrange: las comprobaciones no sacan ninguna certificación de estos textos (sin «ENS», o un partner de fabricante).
  const xiv = documento(ANEXO_XIV);
  const fichas = [
    conTexto('Certificación conforme al RD 311/2022, categoría MEDIA'),
    conTexto('Partner Microsoft Gold del fabricante'),
  ];
  // Act
  const estados = fichas.map((f) => estadoElegibilidad(db, ID, f.requisitos[0]!));
  const vias = fichas.map((f) => esViaAlternativa(f, xiv, (r) => estadoElegibilidad(db, ID, r)));
  // Assert
  assert.deepEqual(estados, [null, null], 'no se sabe: no hay fila de las comprobaciones para esa exigencia');
  assert.deepEqual(vias, [true, true], 'decide la ficha: sigue sin cumplirse');
});

test('should_enqueue_the_alternative_route_with_its_instructions_once_the_person_said_vamos', async () => {
  // Arrange: el bloqueo del ENS quedó cerrado con «Vamos» (tests de arriba).
  sinPedirXiv();
  // Act
  const estado = estadoElegibilidad(db, ID, ficha({ cumple: 'no' }).requisitos[0]!);
  encolarAnexosAuto(nucleo().db, db);
  const ins = await instruccionesDeAnexo(db, nucleo().db, { id: ID, clave: ANEXO_XIV, pedida_en: ahora });
  // Assert
  assert.equal(estado, 'cerrada');
  assert.equal(trabajos(ANEXO_XIV).length, 1, 'con «Vamos» se prepara como los demás');
  assert.match(ins, /biblioteca_buscar/, 'sigue siendo la vía alternativa');
});

test('should_skip_the_alternative_route_when_the_profile_already_covers_the_certification', async () => {
  // Arrange: la ficha se aprobó sin ENS; después el perfil lo tiene vigente.
  assert.equal(
    guardarPerfilEmpresa(nucleo().db, { ...PERFIL, certificados: [{ nombre: 'ENS', nivel: 'media', caduca: null }] })
      .error,
    null,
  );
  sinPedirXiv();
  // Act
  const estado = estadoElegibilidad(db, ID, ficha({ cumple: 'no' }).requisitos[0]!);
  encolarAnexosAuto(nucleo().db, db);
  const ins = await instruccionesDeAnexo(db, nucleo().db, { id: ID, clave: ANEXO_XIV, pedida_en: ahora });
  // Assert
  assert.equal(estado, 'cubierta');
  assert.equal(trabajos(ANEXO_XIV).length, 0, 'la vía sobra: no se gasta un run');
  assert.doesNotMatch(ins, /biblioteca_buscar/, 'ya no se rellena como vía alternativa');
});

test('should_accept_the_skill_example_for_a_written_hole', () => {
  // Arrange: el ejemplo JSON de «Huecos de redacción» de la skill, tal cual.
  const anexos = fs.readFileSync(
    new URL('../../../../infra/hermes-init/skills/licitaciones/references/anexos.md', import.meta.url),
    'utf8',
  );
  const ejemplo = anexos.split('Ejemplo de un hueco de redacción')[1]?.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? '';
  // Act
  const r = AnexoEntrada.safeParse(JSON.parse(ejemplo));
  // Assert
  assert.equal(r.success, true);
  assert.equal(r.data?.sustituciones?.[0]?.dato, 'Redacción');
  assert.equal(r.data?.sustituciones?.[0]?.fuentes?.length, 1);
});
