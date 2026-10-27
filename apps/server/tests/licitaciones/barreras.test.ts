// «Qué nos falta»: certificaciones, seguro, clasificación y habilitaciones que piden las
// oportunidades seguidas, contadas una vez por licitación y con lo peor que salió.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { PerfilEmpresa } from '../../src/nucleo/empresa.js';
import { NIF_EJEMPLO, NOMBRE_EJEMPLO, VOLUMEN_2025 } from '../fixtures/empresaEjemplo.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import {
  barreras,
  barrerasDePersonal,
  certificaciones,
  clavesDe,
  vecesFuera,
} from '../../src/dominios/licitaciones/barreras.js';
import type { Evaluacion } from '../../src/dominios/licitaciones/evaluador.js';
import { anotarDescarte } from '../../src/dominios/licitaciones/gonogo.js';
import { componerComprobaciones, vecesFueraDe } from '../../src/dominios/licitaciones/oferta/comprobaciones.js';
import { leerEntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import { leerFixtureComprobaciones, sembrarFixture } from '../helpers/comprobacionesFixtures.js';
import { licitacion, type Sintetica } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-barreras-'));
const abiertas: { close(): void }[] = [];
after(() => {
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

const PERFIL = PerfilEmpresa.parse({
  nif: NIF_EJEMPLO,
  nombre: NOMBRE_EJEMPLO,
  certificaciones: ['ISO 9001'],
  seguro_rc: null,
  volumen_negocio: [VOLUMEN_2025],
});
const HOY = new Date('2026-10-04T12:00:00Z');

const ev = (e: Partial<Evaluacion>): Evaluacion => ({
  origen: 'ficha',
  clase: 'certificacion',
  etiqueta: 'Certificación',
  descripcion: '',
  lote: null,
  exigido: null,
  resultado: 'no_cumple',
  excluyente: true,
  motivo: 'x',
  ...e,
});

test('should_name_the_usual_certifications_whatever_the_wording', () => {
  assert.deepEqual(
    certificaciones('Esquema Nacional de Seguridad categoría MEDIA y UNE-EN ISO/IEC 27001:2022').map((c) => [
      c.clave,
      c.nivel,
    ]),
    [
      ['ens', 'media'],
      ['iso-27001', undefined],
    ],
  );
  assert.deepEqual(
    certificaciones('ENS nivel alto').map((c) => [c.clave, c.nivel]),
    [['ens', 'alta']],
    'una sola clave para el ENS',
  );
  assert.deepEqual(
    certificaciones('certificado ENS').map((c) => [c.clave, c.nivel]),
    [['ens', undefined]],
    'sin categoría',
  );
  assert.deepEqual(
    certificaciones('AWS Premier Tier y Google Premier Partner AI & Data').map((c) => c.clave),
    ['partner-fabricante'],
  );
  assert.deepEqual(
    certificaciones('CMMI nivel 3, ISO 9001 e ISO 14001').map((c) => c.clave),
    ['iso-9001', 'iso-14001', 'cmmi'],
  );
  assert.deepEqual(certificaciones('Medios materiales adecuados'), []);
});

test('should_classify_only_what_is_proved_with_a_document', () => {
  assert.deepEqual(
    clavesDe(ev({ clase: 'seguro', descripcion: 'Seguro de RC' })).map((c) => c.clave),
    ['seguro-rc'],
  );
  assert.deepEqual(
    clavesDe(ev({ origen: 'placsp', clase: 'financiera', etiqueta: 'Seguro de indemnización' })).map((c) => c.clave),
    ['seguro-rc'],
  );
  assert.deepEqual(
    clavesDe(ev({ origen: 'placsp', clase: 'clasificacion', exigido: 'V2-3' })).map((c) => c.nombre),
    ['Clasificación V-2'],
  );
  assert.deepEqual(
    clavesDe(ev({ clase: 'clasificacion', descripcion: 'Grupo V, Subgrupo 2, Categoría C' })).map((c) => c.clave),
    ['clasificacion-V-2'],
  );
  assert.deepEqual(
    clavesDe(ev({ clase: 'clasificacion', descripcion: 'Clasificación exigida en el plazo de 2 años' })).map(
      (c) => c.clave,
    ),
    ['clasificacion'],
    'sin código',
  );
  assert.equal(
    clavesDe(ev({ clase: 'certificacion', descripcion: 'Certificado de buenas prácticas de accesibilidad' }))[0]?.tipo,
    'certificacion',
  );
  assert.deepEqual(
    clavesDe(ev({ clase: 'solvencia_economica', etiqueta: 'Solvencia económica' })),
    [],
    'la solvencia no es un papel que se saque',
  );
  assert.deepEqual(clavesDe(ev({ clase: 'medios_personales' })), []);
});

function conOportunidades(sinteticas: (Sintetica & { estado?: string; creada?: string })[]): { db: Db; ids: string[] } {
  const dir = path.join(tmp, String(abiertas.length + 1));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  abiertas.push(db);
  const ids = sinteticas.map((s) => {
    const l = licitacion(s);
    guardarLicitacion(db, l);
    db.prepare(
      'INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?)',
    ).run(l.id, s.estado ?? 'nueva', 'CPV 72', s.creada ?? '2026-09-20T10:00:00Z', 'x');
    return l.id;
  });
  return { db, ids };
}

function fichaAprobada(db: Db, id: string, requisitos: unknown[]): void {
  const datos = {
    resumen: 'Ficha de prueba con requisitos.',
    requisitos,
    criterios: [],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'revisar', motivo: 'Prueba.' },
  };
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', 'x', 'x', 'x')",
  ).run(id, JSON.stringify(datos));
}

const ENS = {
  tipo: 'certificacion',
  descripcion: 'Esquema Nacional de Seguridad categoría media',
  excluyente: true,
  cumple: 'no',
  justificacion: 'El perfil no lo tiene.',
};

test('should_count_each_requirement_once_per_tender_with_what_we_lose', () => {
  const { db, ids } = conOportunidades([
    {
      titulo: 'Plataforma de datos',
      publicada: '2026-09-20',
      presupuesto: 200_000,
      limite: '2026-10-20T10:00:00',
      requisitos: [{ clase: 'financiera', codigo: '3', descripcion: 'Seguro', umbral: 600_000, lote: null }],
    },
    {
      titulo: 'Analítica sanitaria',
      publicada: '2026-09-21',
      presupuesto: 150_000,
      limite: '2026-10-21T10:00:00',
      estado: 'descartada',
    },
    { titulo: 'Cuadro de mando', publicada: '2026-09-22', presupuesto: 50_000, limite: '2026-10-22T10:00:00' },
    {
      titulo: 'Sin cribar',
      publicada: '2026-09-23',
      presupuesto: 99_000,
      limite: '2026-10-23T10:00:00',
      estado: 'candidata',
    },
    {
      titulo: 'Antigua',
      publicada: '2025-01-10',
      presupuesto: 80_000,
      limite: '2025-02-10T10:00:00',
      creada: '2025-01-10T10:00:00Z',
    },
  ]);
  fichaAprobada(db, ids[0]!, [ENS, { ...ENS, descripcion: 'ENS de categoría media para el sistema' }]);
  fichaAprobada(db, ids[1]!, [
    ENS,
    {
      tipo: 'certificacion',
      descripcion: 'ISO 9001 vigente',
      excluyente: false,
      cumple: 'si',
      justificacion: 'La tenemos.',
    },
  ]);
  fichaAprobada(db, ids[2]!, [{ ...ENS, cumple: 'dudoso', justificacion: 'No se sabe.' }]);
  fichaAprobada(db, ids[3]!, [ENS]);
  fichaAprobada(db, ids[4]!, [ENS]);

  const r = barreras(db, PERFIL, { meses: 12 }, HOY);
  assert.equal(r.oportunidades, 3, 'sin las sin cribar ni las de hace más de 12 meses');
  const ens = r.barreras.find((b) => b.clave === 'ens')!;
  assert.equal(ens.licitaciones, 3, 'una vez por licitación aunque la ficha lo repita');
  assert.equal(ens.no_cumplimos, 2);
  assert.equal(ens.nos_dejan_fuera, 2);
  assert.equal(ens.por_confirmar, 1);
  assert.equal(ens.importe_no_cumplimos, 350_000);
  assert.deepEqual(ens.niveles, { media: 3 });
  assert.deepEqual(
    ens.ejemplos.map((e) => e.titulo),
    ['Plataforma de datos', 'Analítica sanitaria', 'Cuadro de mando'],
    'primero lo que no cumplimos, por importe',
  );
  const seguro = r.barreras.find((b) => b.clave === 'seguro-rc')!;
  assert.equal(seguro.no_cumplimos, 1);
  assert.equal(seguro.nos_dejan_fuera, 0, 'el seguro se contrata: nunca deja fuera');
  assert.equal(r.barreras.find((b) => b.clave === 'iso-9001')?.no_cumplimos, 0);
  assert.equal(r.barreras[0]?.clave, 'ens', 'lo que más nos deja fuera, primero');
  assert.equal(r.barreras.filter((b) => b.clave.startsWith('ens')).length, 1, 'el ENS en una sola fila');
  assert.equal(barreras(db, PERFIL, { meses: 0 }, HOY).oportunidades, 4, 'con 0 meses, todas');
});

test('should_count_the_ens_once_per_tender_with_the_highest_category_asked', () => {
  const { db, ids } = conOportunidades([
    { titulo: 'Sistema de citas', publicada: '2026-09-20', presupuesto: 120_000, limite: '2026-10-20T10:00:00' },
    { titulo: 'Portal de datos abiertos', publicada: '2026-09-21', presupuesto: 90_000, limite: '2026-10-21T10:00:00' },
  ]);
  fichaAprobada(db, ids[0]!, [
    ENS,
    { ...ENS, descripcion: 'Certificado ENS de categoría ALTA del sistema' },
    { ...ENS, descripcion: 'Conformidad con el ENS' },
  ]);
  fichaAprobada(db, ids[1]!, [
    { ...ENS, descripcion: 'Certificado de conformidad con el Esquema Nacional de Seguridad' },
  ]);
  const ens = barreras(db, PERFIL, { meses: 12 }, HOY).barreras.find((b) => b.clave === 'ens')!;
  assert.equal(ens.licitaciones, 2, 'una vez por licitación aunque se pida con y sin categoría');
  assert.deepEqual(ens.niveles, { alta: 1, 'sin indicar': 1 });
  assert.equal(ens.nos_dejan_fuera, 2);
});

// ── La experiencia del personal ──

const MEDIOS = (descripcion: string, cumple: string) => ({
  tipo: 'medios_personales',
  descripcion,
  valor_exigido: '1 perfil y experiencia específica',
  excluyente: true,
  cumple,
  justificacion: 'Prueba.',
});
const AUDITORIA = 'Director/a técnico/a con 5 años de experiencia en auditoría de accesibilidad web.';
const descartar = (db: Db, id: string, categoria: string, motivo: string) =>
  anotarDescarte(db, id, {
    accion: 'descartada',
    categoria,
    motivo,
    automatico: false,
    quien: 'Persona A',
    ts: '2026-09-25T10:00:00Z',
  });

test('should_group_personnel_barriers_by_subject', () => {
  const { db, ids } = conOportunidades([
    { titulo: 'Informes de medios', publicada: '2026-09-20', presupuesto: 100_000, limite: '2026-10-20T10:00:00' },
    { titulo: 'Observatorio de prensa', publicada: '2026-09-21', presupuesto: 80_000, limite: '2026-10-21T10:00:00' },
    { titulo: 'Cuadro de mando', publicada: '2026-09-22', presupuesto: 60_000, limite: '2026-10-22T10:00:00' },
  ]);
  fichaAprobada(db, ids[0]!, [
    MEDIOS(AUDITORIA, 'no'),
    MEDIOS('Analista con 3 años de experiencia en Power BI.', 'si'),
  ]);
  fichaAprobada(db, ids[1]!, [
    MEDIOS('Coordinador con 7 años de experiencia en auditoría de accesibilidad web.', 'dudoso'),
  ]);
  fichaAprobada(db, ids[2]!, [MEDIOS(AUDITORIA, 'no_aplica')]);

  const personal = barreras(db, PERFIL, { meses: 12 }, HOY).personal;

  assert.equal(personal.length, 1, 'lo que cumplimos o no aplica no es barrera');
  const b = personal[0]!;
  assert.equal(b.clave, 'experiencia_personal:auditoria_de_accesibilidad_web');
  assert.equal(b.tipo, 'experiencia_personal');
  assert.equal(b.licitaciones, 2);
  assert.equal(b.nos_dejan_fuera, 1, 'el «dudoso» no deja fuera');
  assert.equal(b.anios_exigidos, 6, 'mediana de 5 y 7');
  assert.deepEqual(
    b.ejemplos.map((e) => [e.titulo, e.fuera]),
    [
      ['Informes de medios', true],
      ['Observatorio de prensa', false],
    ],
  );
});

test('should_count_typed_discards_as_left_out', () => {
  const { db, ids } = conOportunidades([
    {
      titulo: 'Informes de medios',
      publicada: '2026-09-20',
      presupuesto: 100_000,
      limite: '2026-10-20T10:00:00',
      estado: 'descartada',
    },
    {
      titulo: 'Plataforma de datos',
      publicada: '2026-09-21',
      presupuesto: 90_000,
      limite: '2026-10-21T10:00:00',
      estado: 'descartada',
    },
    {
      titulo: 'Gestión de redes',
      publicada: '2026-09-22',
      presupuesto: 70_000,
      limite: '2026-10-22T10:00:00',
      estado: 'descartada',
    },
  ]);
  for (const id of ids) fichaAprobada(db, id, [MEDIOS(AUDITORIA, 'si')]);
  descartar(db, ids[0]!, 'solvencia', 'No tenemos a nadie con 5 años en auditoría de accesibilidad web');
  descartar(db, ids[1]!, 'solvencia', 'Volumen de negocio insuficiente');
  descartar(db, ids[2]!, 'precio', 'El precio no da');

  const b = barrerasDePersonal(db, '').find((x) => x.clave === 'experiencia_personal:auditoria_de_accesibilidad_web');

  assert.equal(
    b?.licitaciones,
    1,
    'solo el descarte por solvencia que habla del personal; la ficha decía «sí» por los años',
  );
  assert.equal(b?.nos_dejan_fuera, 1);
  assert.equal(vecesFuera(db, 'experiencia_personal:auditoria_de_accesibilidad_web'), 1);
});

const CASO_F = leerFixtureComprobaciones('casoF');
const CLAVE_CASO_F = 'experiencia_personal:auditoria_de_accesibilidad_web_o_evaluacion_de_usabilidad';

function conCasoF(): { db: Db; dbNucleo: ReturnType<typeof abrirNucleo> } {
  const dir = path.join(tmp, `casoF-${abiertas.length + 1}`);
  const dbNucleo = abrirNucleo(dir);
  const db = abrirLicitaciones(dir);
  abiertas.push(db, dbNucleo);
  sembrarFixture(db, dbNucleo, CASO_F);
  descartar(db, CASO_F.id, 'solvencia', CASO_F.oportunidad.motivo_descarte ?? '');
  return { db, dbNucleo };
}

test('should_count_casoF_accessibility_audit_experience', () => {
  const { db } = conCasoF();

  const b = barreras(db, PERFIL, { meses: 0 }, HOY).personal.find((x) => x.clave === CLAVE_CASO_F);

  assert.ok(b, 'CASO_F sale en «Qué nos falta» como experiencia del personal');
  assert.equal(b.nombre, 'Experiencia del personal en auditoria de accesibilidad web o evaluacion de usabilidad');
  assert.equal(b.nos_dejan_fuera, 1);
  assert.equal(b.anios_exigidos, 5);
  assert.deepEqual(
    b.ejemplos.map((e) => e.id),
    [CASO_F.id],
  );
});

test('should_add_times_left_out_to_an_eligibility_row', () => {
  const { db, dbNucleo } = conCasoF();
  const otra = licitacion({
    titulo: 'Observatorio de accesibilidad',
    publicada: '2026-09-21',
    presupuesto: 80_000,
    limite: '2026-10-21T10:00:00',
  });
  guardarLicitacion(db, otra);
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'descartada', 'CPV 79', ?, 'x')",
  ).run(otra.id, '2026-09-21T10:00:00Z');
  fichaAprobada(db, otra.id, [
    MEDIOS('Director con 5 años de experiencia en auditoría de accesibilidad web o evaluación de usabilidad.', 'no'),
  ]);
  const e = leerEntradasComprobaciones(db, dbNucleo, CASO_F.id, Date.parse(CASO_F.ahora));
  assert.equal(e.error, null);

  const comprobaciones = componerComprobaciones(e.data!, 2, new Map(), vecesFueraDe(db, CASO_F.id));

  const fila = comprobaciones.bloqueos.find(
    (b) => b.clave === 'medios:-:auditoria_de_accesibilidad_web_o_evaluacion_de_usabilidad',
  ) as (typeof comprobaciones.bloqueos)[number] & { barrera?: { clave: string; veces_fuera: number } };
  assert.equal(fila.categoria, 'elegibilidad');
  assert.deepEqual(fila.barrera, { clave: CLAVE_CASO_F, veces_fuera: 2 }, 'la otra y la propia CASO_F, ya descartada');
  assert.ok(fila.titulo.endsWith('Esta barrera ya nos dejó fuera 2 veces'), fila.titulo);
  const sinBarrera = componerComprobaciones(e.data!, 2);
  assert.equal(
    sinBarrera.bloqueos.some((b) => b.titulo.includes('nos dejó fuera')),
    false,
    'sin base, la fila no cambia',
  );
});
