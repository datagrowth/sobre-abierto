// Anexos regenerados por código cuando cambia un dato de su hoja, con una
// oferta como la de CASO_E: lotes 2 y 4, un Anexo VI económico por lote (modelo Word), un Anexo I
// declaración y un Anexo VIII en PDF con formulario. Base, cola y Salidas reales en un directorio
// temporal; empresa, personas e importes inventados. Sin LibreOffice (sin PDF del Word).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';
import { DOMICILIO, modelosAnexos, P } from '../nucleo/fixtures/modelosAnexos.js';
import { pdfConFormulario } from '../nucleo/fixtures/formularioPdf.js';
import { pdfDeLineas } from '../nucleo/fixtures/pdfSinCampos.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-anexo-regeneracion-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
for (const d of [salidas, conocimiento]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = salidas;
process.env.CONVERSIONES_DIR = path.join(tmp, 'conversiones');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { raicesActuales, documentoEnDisco } = await import('../../src/nucleo/salidas.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { localizarHuecos } = await import('../../src/nucleo/documentos/rellenar.js');
const { formularioDePdf } = await import('../../src/nucleo/documentos/formularioPdf.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { documentosDe, filaDocumento } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { prepararModelosPdf, modeloPdfGuardado } = await import('../../src/dominios/licitaciones/oferta/modelosPdf.js');
const { encolarAnexosAuto } = await import('../../src/dominios/licitaciones/oferta/anexosAuto.js');
const { recibirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosRecibir.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { aplicarAccionBloqueo } = await import('../../src/dominios/licitaciones/oferta/comprobacionesBloqueos.js');
const { leerPlan } = await import('../../src/dominios/licitaciones/oferta/anexoPlan.js');
const { cambiosDeHoja, planRegenerado, regenerarAnexosPorCodigo, ESTRUCTURA_NUEVA } =
  await import('../../src/dominios/licitaciones/oferta/anexosRegeneracion.js');

iniciarNucleo();
const db = dbLicitaciones();
const LOTES = ['1', '2', '3', '4'].map((id) => ({ id, nombre: `Lote ${id}`, importe: 6_000 }));
const L = licitacion({
  titulo: 'Formación en competencias digitales',
  publicada: '2026-09-30',
  presupuesto: 24_000,
  lotes: LOTES,
  limite: `${new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)}T08:00:00`,
});
const ID = L.id;
const CARPETA = `Licitaciones/Radar/2026/casoE (${ID})`;
const MODELOS = 'Modelos CASO_E.docx';
const FORMULARIO = 'Modelos.pdf';
const TRANSCRITO = 'Modelo transcrito.pdf';
const [ECO_2, ECO_4, PDF_2, DEL_PDF] = ['a1-d2-l2', 'a1-d2-l4', 'a1-d4-l2', 'a1-d5-l2'];

const oferta = (lote: string) => ({
  lotes: [lote],
  formula: 'P = 40 × (Om / O)',
  presupuesto_base: 6_000,
  impuesto_aparte: 'IGIC',
  precios_unitarios: [],
  umbral_anormalidad: null,
  modelo: 'Anexo VI',
  archivo: 'Archivo electrónico único',
});
const GUION = {
  id: ID,
  archivos: [
    {
      nombre: 'Archivo electrónico único',
      contenido: 'Documentación administrativa y oferta económica por lote.',
      ambito: 'por_lote',
      documentos: [
        { tipo: 'deuc', nombre: 'DEUC', obligatorio: true, produce: 'persona' },
        {
          tipo: 'oferta_economica',
          nombre: 'Anexo VI. Oferta económica',
          obligatorio: true,
          produce: 'persona',
          origen: { modelo: 'Anexo VII', documento: MODELOS, pagina: 1 },
        },
        {
          tipo: 'declaracion',
          nombre: 'Anexo I. Declaración responsable',
          obligatorio: true,
          produce: 'persona',
          origen: { modelo: 'Anexo VI', documento: MODELOS, pagina: 1 },
        },
        {
          tipo: 'declaracion',
          nombre: 'Anexo VIII. Declaración de la empresa',
          obligatorio: true,
          produce: 'persona',
          origen: { modelo: 'Anexo VIII', documento: FORMULARIO, pagina: 1 },
        },
        {
          tipo: 'declaracion',
          nombre: 'Anexo IX. Declaración de domicilio',
          obligatorio: true,
          produce: 'persona',
          origen: { modelo: 'Anexo IX', documento: TRANSCRITO, pagina: 1 },
        },
      ],
    },
  ],
  memoria: null,
  automaticos: [],
  ofertas_economicas: [oferta('2'), oferta('4')],
  plazo: { fecha_limite: '2026-10-15T08:00', canal: 'PLACSP' },
  lotes: ['2', '4'],
};

function pliego(nombre: string, bytes: Buffer): void {
  fs.writeFileSync(path.join(conocimiento, CARPETA, nombre), bytes);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)",
  ).run(
    ID,
    `https://contrataciondelestado.es/${encodeURIComponent(nombre)}`,
    nombre,
    `${CARPETA}/${nombre}`,
    new Date().toISOString(),
  );
}

guardarLicitacion(db, L);
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
).run(
  ID,
  JSON.stringify([
    { id: '2', motivo: 'criba' },
    { id: '4', motivo: 'criba' },
  ]),
  new Date().toISOString(),
  new Date().toISOString(),
);
fs.mkdirSync(path.join(conocimiento, CARPETA), { recursive: true });
pliego(MODELOS, await modelosAnexos());
pliego(FORMULARIO, await pdfConFormulario());
pliego(
  TRANSCRITO,
  await pdfDeLineas([
    [
      'ANEXO IX. DECLARACION DE DOMICILIO',
      'La empresa ........................ declara que su domicilio es ............................',
    ],
  ]),
);
const g = await proponerGuion(db, GuionEntrada.parse(GUION), 'licitaciones');
assert.equal(g.error, null, g.error?.message);
// Sin ficha la oferta está frenada por elegibilidad; aquí se prueba la regeneración, así
// que una persona dio el «Vamos». El caso del freno lo vuelve a abrir.
const FICHA_FALTA = 'ficha_falta:-';
const vamos = aplicarAccionBloqueo(db, ID, FICHA_FALTA, {
  accion: 'vamos',
  motivo: 'La ficha llega después; los anexos no dependen de ella.',
});
assert.equal(vamos.error, null, vamos.error?.message);
const PERSONA_A = crearPersona(nucleo().db, { nombre: 'Persona A', tipo: 'interno', rol: 'Formadora' }).data!.id;

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ctx = () => ({ db, dbNucleo: nucleo().db, raices: raicesActuales() });

function perfil(c: { nif?: string; domicilio?: string } = {}): void {
  const r = guardarPerfilEmpresa(nucleo().db, {
    nif: c.nif ?? 'B12345678',
    nombre: 'Empresa A SL',
    domicilio: c.domicilio ?? 'Calle Uno 1, Puerto de Ejemplo',
    representante: { nombre: 'Persona B', nif: '00000000T', cargo: 'Administradora única' },
    contacto: { email: 'contacto@example.com' },
  });
  assert.equal(r.error, null, r.error?.message);
}

function decidir(c: { precio2?: number; precio4?: number; enfoque?: string } = {}): void {
  const r = guardarDecisiones(db, nucleo().db, ID, {
    lotes: ['2', '4'],
    equipo: [{ persona_id: PERSONA_A, rol_en_la_oferta: 'Formadora', dedicacion: '50 %', lotes: [] }],
    automaticos: [],
    herramientas: ['Aula virtual'],
    enfoque: c.enfoque ?? 'Formación práctica con casos reales de la plantilla.',
    ofertas: [
      { lote: '2', pendiente: false, importe: c.precio2 ?? 105 },
      { lote: '4', pendiente: false, importe: c.precio4 ?? 90 },
    ],
  });
  assert.equal(r.error, null, r.error?.message);
}

const IMPORTE = /importe de …+/.exec(
  localizarHuecos(await modelosAnexos()).data!.parrafos.find((p) => p.indice === P.importe7)!.texto,
)![0];

// Lo que manda Hermes para el Anexo VI económico: el importe (solo la cifra) y, si se pide, el domicilio.
async function rellenarEconomico(clave: string, c: { importe: string; domicilio?: string }): Promise<void> {
  const sustituciones = [
    { parrafo: P.importe7, original: IMPORTE, nuevo: `importe de ${c.importe}`, dato: 'Importe sin impuestos' },
    ...(c.domicilio
      ? [{ parrafo: P.nombre7, original: DOMICILIO, nuevo: `con domicilio en ${c.domicilio}`, dato: 'Domicilio' }]
      : []),
  ];
  const r = await recibirAnexo(ctx(), {
    id: ID,
    clave,
    desde_parrafo: P.anexo7,
    hasta_parrafo: P.firma7,
    sustituciones,
  });
  assert.equal(r.error, null, r.error?.message);
}

const fila = (clave: string) => filaDocumento(db, ID, clave)!;
const absDe = (ruta: string) => documentoEnDisco(raicesActuales(), ruta).data!;
const textoDe = (ruta: string) =>
  localizarHuecos(fs.readFileSync(absDe(ruta)))
    .data!.parrafos.map((p) => p.texto)
    .join('\n');
const sha = (ruta: string) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(absDe(ruta)))
    .digest('hex');
const trabajos = () =>
  (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ?').get(TIPO_ANEXO) as { n: number }).n;
const avisos = (clave: string) => JSON.parse(fila(clave).avisos) as string[];
const version = (ruta: string | null) => Number(/-v(\d+)\./.exec(ruta ?? '')?.[1]);

// Cada caso parte de los datos de partida, sin planes guardados y sin nada en cola: solo se
// regenera lo que el caso rellena.
beforeEach(() => {
  perfil();
  decidir();
  documentosDe(db, ID);
  db.prepare(
    "UPDATE oferta_documentos SET sustituciones = NULL, cambios_huecos = NULL, estado = 'pendiente', avisos = '[]' WHERE licitacion_id = ?",
  ).run(ID);
  encolarAnexosAuto(nucleo().db, db);
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')")
    .run(TIPO_ANEXO);
});

test('should_regenerate_the_economic_annex_with_the_new_price_without_any_run', async () => {
  await rellenarEconomico(ECO_2, { importe: '105,00' });
  const antes = fila(ECO_2).ruta;
  const n0 = trabajos();
  decidir({ precio2: 98.5 });

  encolarAnexosAuto(nucleo().db, db);
  const n = await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 1);
  assert.equal(trabajos(), n0, '0 filas nuevas en trabajos_ia');
  const f = fila(ECO_2);
  assert.equal(version(f.ruta), version(antes) + 1, 'un -vN nuevo');
  assert.match(textoDe(f.ruta!), /importe de 98,50 euros/);
  assert.equal(f.estado, 'borrador');
  assert.ok(
    avisos(ECO_2).some((a) =>
      /^Regenerado por código el \d\d\/\d\d a las \d\d:\d\d: «Importe sin impuestos» pasó de «105,00 €» a «98,50 €»\.$/.test(
        a,
      ),
    ),
    avisos(ECO_2).join(' | '),
  );
  const plan = leerPlan(f.sustituciones);
  assert.equal(
    plan?.formato === 'docx' ? plan.items[0]!.valor : null,
    '98,50 €',
    'el plan nuevo parte del valor de ahora',
  );
  assert.equal(await regenerarAnexosPorCodigo(ctx()), 0, 'ya está al día');
});

test('should_keep_the_hand_edited_version_and_write_a_new_one_with_the_changed_gaps', async () => {
  await rellenarEconomico(ECO_2, { importe: '105,00' });
  const v1 = fila(ECO_2).ruta!;
  const futuro = new Date(Date.now() + 60_000);
  fs.utimesSync(absDe(v1), futuro, futuro);
  const huella = sha(v1);
  decidir({ precio2: 98.5 });

  const n = await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 1);
  assert.equal(sha(v1), huella, 'la versión editada a mano queda intacta');
  const f = fila(ECO_2);
  assert.notEqual(f.ruta, v1);
  assert.deepEqual(JSON.parse(f.cambios_huecos!), [
    { dato: 'Importe sin impuestos', antes: '105,00 €', despues: '98,50 €', parrafo: P.importe7 },
  ]);
  assert.ok(
    avisos(ECO_2).includes(
      `La v${version(v1)} anterior tenía correcciones tuyas y no se ha tocado: pásalas a la v${version(f.ruta)} si siguen valiendo.`,
    ),
    avisos(ECO_2).join(' | '),
  );
});

test('should_regenerate_annexes_with_the_company_address_when_the_profile_changes', async () => {
  await rellenarEconomico(ECO_2, { importe: '105,00', domicilio: 'Calle Uno 1, Puerto de Ejemplo' });
  await rellenarEconomico(ECO_4, { importe: '90,00', domicilio: 'Calle Uno 1, Puerto de Ejemplo' });
  const n0 = trabajos();
  perfil({ domicilio: 'Calle Dos 2, Valle de Ejemplo' });

  const inicio = Date.now();
  const n = await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 2);
  assert.ok(Date.now() - inicio < 10_000, 'segundos, no minutos');
  assert.equal(trabajos(), n0, '0 runs');
  for (const clave of [ECO_2, ECO_4])
    assert.match(textoDe(fila(clave).ruta!), /con domicilio en Calle Dos 2, Valle de Ejemplo/);
});

test('should_ask_hermes_again_when_the_old_value_is_not_in_the_filled_text', async () => {
  // Hermes escribió el importe con otro formato: «105» no es «105,00».
  await rellenarEconomico(ECO_2, { importe: '105' });
  const antes = fila(ECO_2).ruta;
  decidir({ precio2: 98.5 });

  const n = await regenerarAnexosPorCodigo(ctx());
  await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 0, 'nunca se marca como regenerado');
  assert.equal(fila(ECO_2).ruta, antes);
  const pedidos = nucleo()
    .db.prepare("SELECT clave FROM trabajos_ia WHERE tipo = ? AND estado = 'pendiente'")
    .all(TIPO_ANEXO) as { clave: string }[];
  assert.equal(pedidos.length, 1, 'un solo run, aunque la vuelta pase dos veces');
  assert.ok(pedidos[0]!.clave.startsWith(`anexo-auto-${ID}-${ECO_2}-hoja-`), pedidos[0]!.clave);
  assert.ok(fila(ECO_2).anexo_modelo?.endsWith(MODELOS));
});

test('should_not_ask_hermes_again_for_an_offer_braked_by_eligibility', async () => {
  // Arrange: como el caso anterior (el valor viejo no está en el texto), pero sin el «Vamos» de la ficha.
  await rellenarEconomico(ECO_2, { importe: '105' });
  decidir({ precio2: 98.5 });
  const vamosDado = db
    .prepare('SELECT * FROM oferta_bloqueos WHERE licitacion_id = ? AND clave = ?')
    .all(ID, FICHA_FALTA) as Record<string, unknown>[];
  db.prepare('DELETE FROM oferta_bloqueos WHERE licitacion_id = ? AND clave = ?').run(ID, FICHA_FALTA);
  try {
    // Act
    const n = await regenerarAnexosPorCodigo(ctx());

    // Assert
    assert.equal(n, 0);
    const pedidos = nucleo()
      .db.prepare("SELECT clave FROM trabajos_ia WHERE tipo = ? AND estado = 'pendiente'")
      .all(TIPO_ANEXO);
    assert.deepEqual(pedidos, [], 'frenada: ni un run de Hermes');
    assert.ok(
      avisos(ECO_2).some((a) => a.startsWith('No se pudo regenerar por código')),
      'avisa para rehacerlo a mano',
    );
  } finally {
    for (const v of vamosDado) {
      db.prepare(
        'INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, propuesta_json, quien, motivo, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(v.licitacion_id, v.clave, v.huella, v.estado, v.propuesta_json, v.quien, v.motivo, v.en);
    }
  }
});

test('should_not_touch_an_annex_whose_data_did_not_change', async () => {
  await rellenarEconomico(ECO_2, { importe: '105,00' });
  const antes = fila(ECO_2);
  const archivos = fs.readdirSync(path.dirname(absDe(antes.ruta!))).length;
  decidir({ enfoque: 'Tutorías semanales en grupos pequeños.' });

  const n = await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 0);
  assert.deepEqual(
    [fila(ECO_2).ruta, fila(ECO_2).anexo_en, fila(ECO_2).cambios_huecos],
    [antes.ruta, antes.anexo_en, null],
  );
  assert.equal(fs.readdirSync(path.dirname(absDe(antes.ruta!))).length, archivos);
});

test('should_regenerate_a_pdf_form_field_by_code', async () => {
  const r = await recibirAnexo(ctx(), {
    id: ID,
    clave: PDF_2,
    campos: [
      { nombre: 'NIF', valor: 'B12345678', dato: 'NIF' },
      { nombre: 'Acepta_condiciones', valor: true, dato: 'Aceptación' },
    ],
  });
  assert.equal(r.error, null, r.error?.message);
  perfil({ nif: 'B87654321' });

  const n = await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 1);
  const f = fila(PDF_2);
  assert.match(f.ruta!, /-v\d+\.pdf$/);
  const form = await formularioDePdf(fs.readFileSync(absDe(f.ruta!)));
  assert.equal(form.data?.campos.find((c) => c.nombre === 'NIF')?.valor, 'B87654321');
  assert.equal(form.data?.campos.find((c) => c.nombre === 'Acepta_condiciones')?.valor, true);
  const plan = leerPlan(f.sustituciones);
  assert.equal(plan?.formato === 'pdf' ? plan.campos[0]!.valor_hoja : null, 'B87654321');
});

test('should_only_regenerate_the_annex_of_the_lot_whose_price_changed', async () => {
  await rellenarEconomico(ECO_2, { importe: '105,00' });
  await rellenarEconomico(ECO_4, { importe: '90,00' });
  const [antes2, antes4] = [fila(ECO_2).ruta, fila(ECO_4).ruta];
  decidir({ precio2: 98.5 });

  const n = await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 1);
  assert.notEqual(fila(ECO_2).ruta, antes2);
  assert.equal(fila(ECO_4).ruta, antes4);
  assert.equal(fila(ECO_4).cambios_huecos, null);
});

test('should_fail_with_new_structure_when_the_old_value_appears_twice_or_is_empty', () => {
  const plan = {
    formato: 'docx' as const,
    lote: null,
    desde: 1,
    hasta: 2,
    items: [
      { parrafo: 1, original: 'de …', nuevo: 'de 10,00 y 10,00', dato: 'Importe sin impuestos', valor: '10,00 €' },
    ],
  };
  const hoja = {
    campos: [{ grupo: 'Oferta', etiqueta: 'Importe sin impuestos', valor: '12,00 €', falta: false }],
    avisos: [],
  } as never;

  const cambios = cambiosDeHoja(plan, hoja);
  const dos = planRegenerado(plan, cambios);
  const vacio = planRegenerado({ ...plan, items: [{ ...plan.items[0]!, nuevo: 'de 10,00', valor: null }] }, [
    { ...cambios[0]!, antes: null },
  ]);

  assert.deepEqual(cambios, [{ dato: 'Importe sin impuestos', antes: '10,00 €', despues: '12,00 €', parrafo: 1 }]);
  assert.equal(dos.error?.code, ESTRUCTURA_NUEVA);
  assert.equal(vacio.error?.code, ESTRUCTURA_NUEVA);
});

test('should_regenerate_by_code_an_annex_filled_from_a_transcribed_pdf_model', async () => {
  const analizados = await prepararModelosPdf(db, raicesActuales());
  const analisis = db.prepare("SELECT ruta, sha256, modelo FROM modelos_pdf WHERE tipo = 'transcrito'").get() as {
    ruta: string;
    sha256: string;
    modelo: string;
  };
  const transcrito = modeloPdfGuardado(db, analisis.ruta, analisis.sha256, analisis.modelo)!;
  const parrafo = localizarHuecos(fs.readFileSync(transcrito.docx!)).data!.parrafos.find((p) =>
    /domicilio es/.test(p.texto),
  )!;
  const antes = 'Calle Uno 1, Puerto de Ejemplo';
  const nuevo = parrafo.texto.replace(/\.{10,}$/, antes);
  const r = await recibirAnexo(ctx(), {
    id: ID,
    clave: DEL_PDF,
    desde_parrafo: parrafo.indice,
    hasta_parrafo: parrafo.indice,
    sustituciones: [{ parrafo: parrafo.indice, original: parrafo.texto, nuevo, dato: 'Domicilio' }],
  });
  assert.equal(r.error, null, r.error?.message);
  const n0 = trabajos();
  perfil({ domicilio: 'Calle Dos 2, Valle de Ejemplo' });

  const n = await regenerarAnexosPorCodigo(ctx());

  assert.ok(analizados >= 1);
  assert.equal(n, 1);
  assert.equal(trabajos(), n0, '0 runs: el modelo transcrito se rellena por código');
  assert.match(textoDe(fila(DEL_PDF).ruta!), /Calle Dos 2, Valle de Ejemplo/);
  assert.ok(
    avisos(DEL_PDF).some((a) => /^Regenerado por código/.test(a)),
    avisos(DEL_PDF).join(' | '),
  );
});

test('should_ask_hermes_again_with_the_transcribed_docx_when_the_filled_text_no_longer_matches', async () => {
  await prepararModelosPdf(db, raicesActuales());
  const analisis = db.prepare("SELECT ruta, sha256, modelo FROM modelos_pdf WHERE tipo = 'transcrito'").get() as {
    ruta: string;
    sha256: string;
    modelo: string;
  };
  const transcrito = modeloPdfGuardado(db, analisis.ruta, analisis.sha256, analisis.modelo)!;
  const parrafo = localizarHuecos(fs.readFileSync(transcrito.docx!)).data!.parrafos.find((p) =>
    /domicilio es/.test(p.texto),
  )!;
  const r = await recibirAnexo(ctx(), {
    id: ID,
    clave: DEL_PDF,
    desde_parrafo: parrafo.indice,
    hasta_parrafo: parrafo.indice,
    sustituciones: [
      {
        parrafo: parrafo.indice,
        original: parrafo.texto,
        nuevo: parrafo.texto.replace(/\.{10,}$/, 'Otra dirección'),
        dato: 'Domicilio',
      },
    ],
  });
  assert.equal(r.error, null, r.error?.message);
  const n0 = trabajos();
  perfil({ domicilio: 'Calle Dos 2, Valle de Ejemplo' });

  const n = await regenerarAnexosPorCodigo(ctx());

  assert.equal(n, 0);
  assert.equal(trabajos(), n0 + 1, 'el valor anterior no está en el texto: vuelve a Hermes');
  assert.equal(fila(DEL_PDF).anexo_modelo, transcrito.docx, 'el run recibe el .docx transcrito, no el PDF');
});
