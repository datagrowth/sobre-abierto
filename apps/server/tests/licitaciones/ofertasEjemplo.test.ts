// Criterio de hecho sobre las 5 ofertas de ejemplo (fixtures/ofertas/, sintéticas): Hoy de CASO_E ya no
// pide dar por buena una memoria de otro guion y cuenta su precio vacío; CASO_B y CASO_D no
// piden memoria; CASO_D cuenta 3 de 3 criterios; Villaejemplo rellena los Anexos V, VI y VII desde
// sus .docx; CASO_F, descartada, no empuja a prepararla. Base en un directorio temporal.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ofertas-'));
for (const d of ['salidas', 'conocimiento']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { pendientesDeRevisar } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { hoyLicitaciones } = await import('../../src/dominios/licitaciones/hoy.js');
const { faltaDePreparacion, faltaMemoria } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { decisionesDe, decisionesVigentes } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { resumenOferta } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { hojaDeDatos } = await import('../../src/dominios/licitaciones/oferta/hojaDatos.js');
const { documentosOferta } = await import('../../src/dominios/licitaciones/oferta/anexosChecklist.js');
const { numeroDeAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosModelo.js');

type Memoria = {
  id: number;
  version: number;
  guion_id: number;
  estado: string;
  ensayo: boolean;
  borrador: { estado: string } | null;
};
type Fixture = {
  oferta: string;
  licitacion_id: string;
  capturado_en: string;
  licitacion: {
    titulo: string;
    estado: string;
    fecha_limite: string;
    presupuesto: number;
    lotes: { id: string; nombre: string; importe: number }[];
    lotes_interes: string[];
  };
  pliegos: { nombre: string; clase: string }[];
  guiones_anteriores: { id: number; version: number }[];
  respuesta_oferta: {
    guion: {
      id: number;
      version: number;
      ficha_id: number | null;
      datos: { automaticos: { criterio: string }[] } & Record<string, unknown>;
    };
    decisiones: { guion_id: number; datos: Record<string, unknown> } | null;
    memorias: Memoria[];
  };
};

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ofertas');
const OFERTAS = ['casoE', 'casoB', 'casoC', 'casoD', 'casoF'] as const;
const leer = (o: string): Fixture => JSON.parse(fs.readFileSync(path.join(DIR, `${o}.json`), 'utf8')) as Fixture;
const F = Object.fromEntries(OFERTAS.map((o) => [o, leer(o)])) as Record<(typeof OFERTAS)[number], Fixture>;
const AHORA_MS = Date.parse(F.casoE.capturado_en);
const TS = F.casoE.capturado_en;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function sembrarLicitacion(f: Fixture): void {
  const l = f.licitacion;
  guardarLicitacion(db, {
    ...licitacion({
      titulo: l.titulo,
      publicada: '2026-09-30',
      presupuesto: l.presupuesto,
      lotes: l.lotes,
      limite: l.fecha_limite,
    }),
    id: f.licitacion_id,
    atom_id: `atom-${f.oferta}`,
  });
  db.prepare(
    'INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    f.licitacion_id,
    l.estado,
    'CPV 80',
    JSON.stringify(l.lotes_interes.map((id) => ({ id, motivo: 'criba' }))),
    TS,
    TS,
  );
  const carpeta = `Licitaciones/Radar/2026/${f.oferta} (${f.licitacion_id})`;
  for (const p of f.pliegos) {
    db.prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, ?, ?, 'descargado', ?, ?)",
    ).run(
      f.licitacion_id,
      `https://contrataciondelestado.es/${encodeURIComponent(p.nombre)}`,
      p.clase,
      p.nombre,
      `${carpeta}/${p.nombre}`,
      TS,
    );
  }
}

// Los guiones anteriores solo existen para que la memoria o las decisiones apunten a otro: llevan los datos del vigente.
function sembrarGuiones(f: Fixture): void {
  const g = f.respuesta_oferta.guion;
  const insertar = db.prepare(
    "INSERT INTO guiones (id, licitacion_id, version, ficha_id, datos, agente, version_prompt, creado_en) VALUES (?, ?, ?, ?, ?, 'licitaciones', 1, ?)",
  );
  for (const a of f.guiones_anteriores)
    insertar.run(a.id, f.licitacion_id, a.version, null, JSON.stringify(g.datos), TS);
  insertar.run(g.id, f.licitacion_id, g.version, null, JSON.stringify(g.datos), TS);
}

function sembrarMemoria(f: Fixture, m: Memoria): void {
  const b = m.borrador
    ? Number(
        db
          .prepare(
            `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, guion_id, version)
      VALUES (?, ?, 'h', 10, 'plataforma', ?, ?, 'ensamblado', ?, ?)`,
          )
          .run(
            f.licitacion_id,
            `Salidas/Licitaciones/${f.oferta}/memoria-v${m.version}.docx`,
            TS,
            m.borrador.estado,
            m.guion_id,
            m.version,
          ).lastInsertRowid,
      )
    : null;
  db.prepare(
    'INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, borrador_id, ensayo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(m.id, f.licitacion_id, m.guion_id, m.version, m.estado, TS, TS, b, m.ensayo ? 1 : 0);
  if (b !== null) db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(m.id, b);
}

function sembrar(f: Fixture): void {
  sembrarLicitacion(f);
  sembrarGuiones(f);
  const d = f.respuesta_oferta.decisiones;
  if (d)
    db.prepare(
      'INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)',
    ).run(f.licitacion_id, d.guion_id, JSON.stringify(d.datos), TS);
  for (const m of f.respuesta_oferta.memorias) sembrarMemoria(f, m);
}

for (const o of OFERTAS) sembrar(F[o]);

const vigente = (o: keyof typeof F) => {
  const g = guionVigente(db, F[o].licitacion_id);
  assert.ok(g, `el guion de ${o} se lee con el esquema actual`);
  return g;
};
const itemHoy = (o: keyof typeof F) =>
  (hoyLicitaciones(db, TS, AHORA_MS).en_preparacion ?? []).find(
    (x) => x.enlace?.id === `${F[o].licitacion_id}/preparacion`,
  );

test('should_not_tell_casoE_to_accept_memoria_from_previous_outline', () => {
  const id = F.casoE.licitacion_id;

  const falta = faltaDePreparacion(db, id);
  const pendiente = pendientesDeRevisar(db, 10, id)[0];
  const hoy = itemHoy('casoE');

  assert.ok(falta.includes('Decisiones: La v1 es de un guion anterior: no la des por buena'), falta.join(' | '));
  assert.ok(hoy, 'CASO_E sigue en preparación en Hoy');
  assert.doesNotMatch(hoy.detalle ?? '', /dala por buena/);
  assert.equal(pendiente?.corto, 'Memoria v1 desfasada');
  assert.doesNotMatch(pendiente?.texto ?? '', /dala por buena/);
});

test('should_count_casoE_price_as_missing', () => {
  const falta = faltaDePreparacion(db, F.casoE.licitacion_id);

  assert.ok(falta.includes('Precio: Precio del lote 2 sin decidir'), falta.join(' | '));
  assert.match(itemHoy('casoE')?.detalle ?? '', /Precio: Precio del lote 2 sin decidir/);
});

test('should_not_ask_casoB_or_casoD_for_a_memoria', () => {
  for (const o of ['casoB', 'casoD'] as const) {
    const id = F[o].licitacion_id;

    const memoria = faltaMemoria(db, id, vigente(o));
    const hoy = itemHoy(o);

    assert.deepEqual(memoria, [], o);
    assert.ok(hoy, `${o} sigue en preparación en Hoy`);
    assert.doesNotMatch(hoy.detalle ?? '', /Memoria técnica/, o);
  }
});

test('should_count_casoD_three_of_three_automatic_criteria', () => {
  const id = F.casoD.licitacion_id;
  const delGuion = vigente('casoD').datos.automaticos.map((a) => a.criterio);

  const decididos = decisionesDe(db, id)!.datos.automaticos.filter((a) => delGuion.includes(a.criterio));
  const hoja = hojaDeDatos(db, nucleo().db, id);

  assert.equal(delGuion.length, 3);
  assert.equal(decididos.filter((a) => a.nos_acogemos).length, 3, JSON.stringify(decididos));
  assert.equal(hoja.error, null, hoja.error?.message);
  const criterios = hoja.data!.campos.filter((c) => c.grupo === 'Criterios automáticos');
  assert.equal(
    criterios.filter((c) => c.valor?.startsWith('Sí, nos acogemos')).length,
    3,
    JSON.stringify(criterios.map((c) => c.valor)),
  );
});

test('should_not_report_casoD_coded_criteria_as_missing_from_the_outline', () => {
  const problemas = decisionesVigentes(db, nucleo().db, F.casoD.licitacion_id).problemas;

  assert.ok(!problemas.some((p) => /«2B[123]\. –/.test(p)), problemas.join(' | '));
  assert.ok(!problemas.some((p) => p.startsWith('Falta decidir')), problemas.join(' | '));
  // Los tres «2B1.- Personalización…» (nos_acogemos false) son criterios de un guion anterior que
  // siguen en las decisiones reales: se avisan hasta que una persona las vuelva a guardar sin ellos.
  assert.equal(
    problemas.filter((p) => /^El criterio «2B[123]\.- .*no está en el guion vigente/.test(p)).length,
    3,
    problemas.join(' | '),
  );
});

test('should_show_each_casoE_lot_budget_next_to_its_missing_max_price', () => {
  // Guion v3: una sola oferta (presupuesto del contrato 6.819,75) para los lotes 2 y 4.
  const maximos = resumenOferta(db, F.casoE.licitacion_id).precios_maximos;

  assert.deepEqual(
    maximos?.map((x) => [x.lote, x.unidad, x.maximo, x.presupuesto]),
    [
      ['2', 'alumno', null, 6_063.75],
      ['4', 'alumno', null, 756],
    ],
  );
});

test('should_offer_fill_with_hermes_for_casoC_annexes_v_vi_vii', async () => {
  const r = await documentosOferta(db, raicesActuales(), F.casoC.licitacion_id);

  assert.equal(r.error, null, r.error?.message);
  const anexos = r.data!.documentos.filter((d) =>
    ['V', 'VI', 'VII'].includes(numeroDeAnexo(d.origen?.modelo ?? '') ?? ''),
  );
  assert.deepEqual([...new Set(anexos.map((d) => numeroDeAnexo(d.origen?.modelo ?? '')))].sort(), ['V', 'VI', 'VII']);
  for (const d of anexos) {
    assert.equal(d.anexo.rellenable, true, `${d.nombre}: ${d.anexo.motivo}`);
    assert.ok(
      d.anexo.avisos.some((a) => a.startsWith('Modelo tomado de «ANEXO')),
      d.nombre,
    );
  }
});

test('should_keep_casoF_without_preparation_push', () => {
  const id = F.casoF.licitacion_id;

  const hoy = hoyLicitaciones(db, TS, AHORA_MS);

  assert.equal(itemHoy('casoF'), undefined);
  assert.ok(
    !hoy.por_aprobar.some((x) => String(x.enlace?.id).startsWith(id)),
    JSON.stringify(hoy.por_aprobar.map((x) => x.enlace?.id)),
  );
  assert.deepEqual(pendientesDeRevisar(db, 10, id), []);
});

const PATRONES = {
  correo: /[\w.+-]+@[\w-]+\.[\w.]+/,
  nif: /\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[A-HJNP-SUVW]\d{7}[0-9A-J])\b/,
  telefono: /(?:\+34\s?)?\b[6789]\d{2}\s?\d{3}\s?\d{3}\b/,
};

test('should_not_contain_personal_data_or_offered_amounts', () => {
  for (const o of OFERTAS) {
    const texto = fs.readFileSync(path.join(DIR, `${o}.json`), 'utf8');
    const d = F[o].respuesta_oferta.decisiones?.datos as
      | {
          equipo: { persona_id: number; rol_en_la_oferta: string }[];
          ofertas: { importe: number | null; unitarios: unknown[] }[];
        }
      | undefined;

    for (const [k, re] of Object.entries(PATRONES)) assert.doesNotMatch(texto, re, `${o}: ${k}`);
    assert.doesNotMatch(texto, /"(nota|evidencia|enfoque|dedicacion|cv_ruta|linkedin)"\s*:/, o);
    assert.ok(
      (d?.equipo ?? []).every((e) => e.persona_id >= 1001 && /^Rol \d+ de la oferta$/.test(e.rol_en_la_oferta)),
      o,
    );
    assert.ok(
      (d?.ofertas ?? []).every((x) => x.importe === null && x.unitarios.length === 0),
      o,
    );
  }
});
