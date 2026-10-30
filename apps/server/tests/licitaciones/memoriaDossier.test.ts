// Memoria técnica, paso 1: el dossier que compone el código (sin IA) con el caso A ya
// indexado. El PPT entero si cabe; si no, las páginas de los criterios y de lo que se presta,
// con la cita de la página y cómo seguir. La frontera con los otros sobres, la regla «equipo por
// roles» y la de no desmentir los anexos. En Salidas va sin los datos del CV; por MCP, el equipo
// solo a quien puede leer colaboradores.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  arrancar,
  cerrar,
  conectar,
  db,
  documentoIndexado,
  ID,
  memoriaPorId,
  nucleo,
  PAGINAS_PPT,
  pliegoIndexado,
  salidas,
  sinDocumentoIndexado,
  sinMemorias,
  T_CURIOSO,
  T_OFERTA,
  texto,
} from '../helpers/memoriaEntorno.js';
import { CARPETA_PLIEGOS, GUION_CASO_A, PAGINAS_PCAP } from './fixtures/casoA.js';

const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const {
  componerDossier,
  dossierDe,
  dossierEnMarkdown,
  equipoAnonimo,
  guardarDossier,
  recortar,
  REGLA_ANEXOS,
  REGLA_POR_ROLES,
  tramosDePaginas,
} = await import('../../src/dominios/licitaciones/oferta/dossier.js');
type Dossier = import('../../src/dominios/licitaciones/oferta/dossier.js').Dossier;

before(arrancar);
after(cerrar);

const nueva = () => {
  sinMemorias();
  return pedirMemoria(nucleo().db, db, salidas, ID).data!.memoria;
};
const seccion = (d: Dossier, clave: string) => d.secciones.find((s) => s.clave === clave)!;
const componer = async (memoria: number, topes = {}) => {
  const r = await componerDossier(db, nucleo().db, memoria, { topes });
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
};

test('should_include_whole_ppt_when_it_fits', async () => {
  const d = await componer(nueva());
  const ppt = seccion(d, 'pliego_tecnico');
  assert.equal(ppt.truncado, false);
  for (const [i, p] of PAGINAS_PPT.entries())
    assert.ok(ppt.texto.includes(`[PPT p. ${i + 1}]\n${p}`), `página ${i + 1}`);
  assert.deepEqual(
    d.secciones.map((s) => s.clave),
    [
      'identificacion',
      'pliego_tecnico',
      'aclaraciones',
      'cuadro_resumen',
      'criterios',
      'formato',
      'normativa_cliente',
      'frontera',
      'empresa',
      'equipo',
      'herramientas',
      'lecciones',
      'parecidas',
    ],
  );
  assert.deepEqual(
    d.secciones.filter((s) => s.critico).map((s) => s.clave),
    ['identificacion', 'pliego_tecnico', 'aclaraciones', 'cuadro_resumen', 'criterios', 'formato'],
  );
  const criterios = seccion(d, 'criterios').texto;
  assert.match(
    criterios,
    /### 1\. Organización y metodología del servicio \(8 puntos\)\nSe valorará \(PCAP\.pdf pág\. 31\):\n- Modelo organizativo propuesto/,
  );
  assert.ok(
    criterios.includes(`[PCAP p. 31]\n${PAGINAS_PCAP[30]!.trim()}`),
    'el texto literal del criterio con su página',
  );
  assert.match(
    seccion(d, 'identificacion').texto,
    /Plazo de presentación: el \d\d\/\d\d\/\d{4} a las 14:00 hora peninsular\./,
  );
  assert.match(seccion(d, 'formato').texto, /Límite: 25 páginas\.\n- Fuente Arial, cuerpo 11, interlineado 1\./);
  assert.match(seccion(d, 'empresa').texto, /Analítica Ejemplo SL/);
  assert.doesNotMatch(
    seccion(d, 'empresa').texto,
    /B12345678|Calle La Marina/,
    'sin NIF ni domicilio: no hacen falta para redactar',
  );
});

test('should_include_only_criterion_pages_when_ppt_is_too_long', async () => {
  const relleno = (n: number) => `Cláusula ${n}. Régimen general del contrato, sin contenido técnico. `.repeat(20);
  const largo = Array.from({ length: 40 }, (_, i) => relleno(i + 1));
  largo[6] = 'Metodología: el adjudicatario deberá entregar un plan de trabajo con fases y entregables mensuales.';
  largo[22] = 'Formación al personal de la entidad: dos acciones formativas al año con sus manuales.';
  const ruta = pliegoIndexado(ID, 'ppt', 'PPT.pdf', largo);
  try {
    const d = await componer(nueva(), { pliego_tecnico: 8_000 });
    const ppt = seccion(d, 'pliego_tecnico');
    assert.equal(ppt.truncado, true);
    assert.match(
      ppt.texto,
      /^El PPT entero no cabe: van las páginas de los criterios y las que tratan lo que se presta \(7, 23\)\./,
    );
    assert.ok(
      ppt.texto.includes(`[PPT p. 7]\n${largo[6]}`) && ppt.texto.includes(`[PPT p. 23]\n${largo[22]}`),
      'con la cita de la página',
    );
    assert.ok(
      ppt.texto.endsWith(`[recortado: sigue en biblioteca_leer ruta=«${ruta}», págs. 1-6, 8-22, 24-40]`),
      ppt.texto.slice(-200),
    );
    assert.ok(!ppt.texto.includes('Cláusula 3. Régimen general'), 'lo que no trata del servicio se queda fuera');
  } finally {
    pliegoIndexado(ID, 'ppt', 'PPT.pdf', PAGINAS_PPT);
  }
});

test('should_mark_truncated_sections_with_how_to_continue', async () => {
  assert.deepEqual(recortar('corto', 100, 'x'), { texto: 'corto', truncado: false });
  assert.equal(tramosDePaginas([9, 3, 4, 5, 12, 11]), '3-5, 9, 11-12');
  const d = await componer(nueva(), { criterios: 900 });
  const c = seccion(d, 'criterios');
  assert.equal(c.truncado, true);
  assert.ok(c.texto.length <= 900);
  assert.match(
    c.texto,
    /\n\[recortado: sigue en biblioteca_leer ruta=«Licitaciones\/Radar\/2026\/EXP-2026-0412 \(p-91000710\)\/PCAP\.pdf», págs\. 31-35\]$/,
  );
});

test('should_omit_team_section_from_salidas_markdown', async () => {
  const memoria = nueva();
  const accion = await avanzarMemoria(nucleo().db, db, memoria);
  assert.equal(memoriaPorId(memoria).fase, 'estrategia', 'con el dossier, la memoria pasa a la estrategia');
  assert.notEqual(accion.tipo, 'componer_dossier');
  const d = dossierDe(db, memoria)!;
  assert.match(
    seccion(d, 'equipo').texto,
    /- Ana García Pérez — Responsable del servicio \(alias RS\): categoría Consultora; personal propio; dedicación 50 %\. Funciones en el pliego: [^\n]+ Perfil: Grado en Derecho; 8 años de experiencia; certificaciones: CIPP\/E/,
  );
  assert.equal(d.ruta_md, `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v1-dossier.md`);
  const md = fs.readFileSync(
    path.join(salidas, 'Licitaciones', `EXP-2026-0412 (${ID})`, 'memoria-v1-dossier.md'),
    'utf8',
  );
  assert.match(md, /## Equipo\n\n2 personas: ver Decisiones de la oferta\./);
  assert.doesNotMatch(md, /Ana García|Luis Martín|cv-ana|CIPP/, 'los datos del CV solo salen hacia Hermes');
  assert.match(md, /## Pliego técnico\n\n\[PPT p\. 1\]/);
  const otra = guardarDossier(db, d);
  assert.equal(
    otra.data?.ruta_md,
    `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v1-dossier-2.md`,
    'no pisa lo que ya está en Salidas',
  );
  assert.match(dossierEnMarkdown(d, { sinPersonal: false }), /Ana García Pérez/);
});

test('should_require_role_only_team_when_pliego_asks_for_anonymous_cvs', async () => {
  assert.equal(equipoAnonimo(GuionBase.parse(GUION_CASO_A)), false, 'el caso A no lo pide');
  const con = (cambio: (g: typeof GUION_CASO_A) => void) => {
    const g = structuredClone(GUION_CASO_A);
    cambio(g);
    return equipoAnonimo(GuionBase.parse(g));
  };
  assert.equal(
    con((g) => {
      g.memoria.advertencias.push('Los currículos del equipo se presentarán anonimizados.');
    }),
    true,
  );
  assert.equal(
    con((g) => {
      g.archivos[0]!.prohibiciones!.push('En la memoria no se consignarán los nombres del personal propuesto.');
    }),
    true,
  );
  assert.equal(
    con((g) => {
      g.automaticos.push({
        ...g.automaticos[0]!,
        criterio: 'Experiencia adicional del equipo técnico',
        marcas: ['años de experiencia adicional'],
      });
    }),
    true,
    'Astilleros Ejemplo: la experiencia del equipo se puntúa en otro archivo',
  );
  const guion = db
    .prepare('SELECT id, datos FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1')
    .get(ID) as { id: number; datos: string };
  const datos = JSON.parse(guion.datos) as typeof GUION_CASO_A;
  datos.memoria.advertencias.push('Los currículos se presentarán anonimizados, sin identificar a las personas.');
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(datos), guion.id);
  try {
    const d = await componer(nueva());
    assert.equal(d.equipo_por_roles, true);
    assert.ok(seccion(d, 'frontera').texto.includes(REGLA_POR_ROLES));
    const equipo = seccion(d, 'equipo').texto;
    assert.match(
      equipo,
      /^Por roles: estos nombres no se dan; en la memoria, cada persona es su rol\.\n[^\n]+\n- Persona 1 — Responsable del servicio \(alias RS\): categoría Consultora; personal propio; dedicación 50 %\./,
    );
    assert.doesNotMatch(equipo, /Ana|Luis|cv-/);
  } finally {
    db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(guion.datos, guion.id);
  }
});

test('should_list_decided_automatic_criteria_in_frontier', async () => {
  const fila = db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(ID) as { datos: string };
  const d0 = JSON.parse(fila.datos) as { automaticos: { criterio: string; nos_acogemos: boolean; nota?: string }[] };
  d0.automaticos[0] = {
    criterio: 'Certificado ISO 14001',
    nos_acogemos: true,
    nota: 'Certificado vigente hasta 2027.',
  };
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(d0), ID);
  try {
    const f = seccion(await componer(nueva()), 'frontera');
    assert.match(
      f.texto,
      /^- Prohibición de «Archivo electrónico nº 1» \(literal\): «No podrá incluirse en este archivo ninguna información relativa a la oferta económica/,
    );
    assert.match(
      f.texto,
      /- «Mejora 1: bolsa de horas adicionales» va en «Archivo electrónico nº 2»: no se menciona, ni para afirmarlo ni para negarlo; palabras que lo delatan: «bolsa de horas»\./,
    );
    assert.match(
      f.texto,
      /- Nos acogemos a «Certificado ISO 14001» \(Certificado vigente hasta 2027\.\): no se nombra y no se desmiente\./,
    );
    assert.match(f.texto, /- «Anexo VII» es de «Archivo electrónico nº 2»: no se nombra\./);
    assert.match(
      f.texto,
      /Nada de importes, porcentajes de baja ni nada de la oferta económica \(va en «Archivo electrónico nº 2»\)\./,
    );
    assert.ok(f.texto.endsWith(REGLA_ANEXOS), 'lo marcado en los anexos no se desmiente (CASO_E)');
    assert.ok(!f.texto.includes(REGLA_POR_ROLES));
  } finally {
    db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(fila.datos, ID);
  }
});

test('should_tell_to_declare_the_commitment_when_it_is_credited_in_the_memoria_file', async () => {
  const fila = db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(ID) as { datos: string };
  const guion = db
    .prepare('SELECT id, datos FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1')
    .get(ID) as { id: number; datos: string };
  const g = JSON.parse(guion.datos) as typeof GUION_CASO_A & { automaticos: Record<string, unknown>[] };
  const formacion = g.automaticos.find((a) => a.criterio === 'Mejora 2: formación adicional')!;
  Object.assign(formacion, {
    archivo: g.memoria.archivo,
    tramos: [
      { descripcion: '12 horas adicionales', puntos: 3, valor: '12' },
      { descripcion: '20 horas adicionales', puntos: 6, valor: '20' },
    ],
  });
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(g), guion.id);
  const d0 = JSON.parse(fila.datos) as {
    automaticos: { criterio: string; nos_acogemos: boolean; tramo?: string; nota?: string }[];
  };
  d0.automaticos = d0.automaticos.map((a) =>
    a.criterio === formacion.criterio
      ? { ...a, nos_acogemos: true, tramo: '20 horas adicionales', nota: 'La imparte Ana García.' }
      : a,
  );
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(d0), ID);
  try {
    const f = seccion(await componer(nueva()), 'frontera').texto;
    assert.match(
      f,
      /- Nos acogemos a «Mejora 2: formación adicional», que se acredita EN ESTA MEMORIA: declara el compromiso con su valor \(tramo «20 horas adicionales», valor «20»\), su plan \(sesiones, destinatarios y semana; o meses, horario y prioridades\) y sin importes ni nada que permita deducir el precio\./,
    );
    assert.doesNotMatch(f, /Ana García/, 'la nota libre de la decisión puede llevar nombres: va el tramo');
    assert.doesNotMatch(
      f,
      /«Mejora 2: formación adicional»[^\n]*no se nombra/,
      'lo del propio archivo no cae en «no se nombra»',
    );
    assert.match(
      f,
      /- «Mejora 1: bolsa de horas adicionales» va en «Archivo electrónico nº 2»: no se menciona/,
      'lo de otro archivo, sí',
    );
  } finally {
    db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(fila.datos, ID);
    db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(guion.datos, guion.id);
  }
});

test('should_refuse_team_section_to_agent_without_colaboradores_permission', async () => {
  const memoria = nueva();
  await avanzarMemoria(nucleo().db, db, memoria);
  const llamar = async (token: string, args: Record<string, unknown>) => {
    const c = await conectar(token);
    try {
      return await c.callTool({ name: 'licitaciones_dossier', arguments: { id: ID, memoria_id: memoria, ...args } });
    } finally {
      await c.close();
    }
  };
  const indice = JSON.parse(texto(await llamar(T_CURIOSO, {}))) as {
    secciones: { clave: string; disponible: boolean; caracteres: number }[];
    como_leer: string;
  };
  assert.deepEqual(
    indice.secciones.filter((s) => !s.disponible).map((s) => s.clave),
    ['equipo'],
  );
  const negado = await llamar(T_CURIOSO, { seccion: 'equipo' });
  assert.equal(negado.isError, true);
  assert.match(texto(negado), /solo la leen los agentes con permiso sobre colaboradores/);
  const equipo = JSON.parse(texto(await llamar(T_OFERTA, { seccion: 'equipo' }))) as {
    texto: string;
    siguiente: number | null;
  };
  assert.match(equipo.texto, /Ana García Pérez/);
  const ppt = JSON.parse(texto(await llamar(T_CURIOSO, { seccion: 'pliego_tecnico', desde: 10 }))) as {
    desde: number;
    hasta: number;
    total: number;
    siguiente: number | null;
    texto: string;
  };
  assert.deepEqual([ppt.desde, ppt.hasta === ppt.total, ppt.siguiente], [10, true, null]);
  const ajena = await llamar(T_OFERTA, { memoria_id: memoria + 999 });
  assert.match(texto(ajena), /aún no tiene dossier/);
});

test('should_not_take_a_no_near_a_name_as_a_request_for_anonymous_team', () => {
  const con = (frase: string) => {
    const g = structuredClone(GUION_CASO_A);
    g.memoria.advertencias.push(frase);
    return equipoAnonimo(GuionBase.parse(g));
  };
  assert.equal(
    con('No se admitirán ofertas que no indiquen el nombre del responsable del contrato.'),
    false,
    'pide el nombre, no que se oculte',
  );
  assert.equal(
    con(
      'En el sobre B no debe figurar ningún dato económico; el nombre de cada archivo será el del documento que contiene.',
    ),
    false,
    '«el nombre» del archivo no es el del personal',
  );
  assert.equal(
    con('No se valorarán las ofertas que no incluyan el nombre y los apellidos del licitador.'),
    false,
    'el nombre del licitador tampoco',
  );
  assert.equal(con('Los CV se presentarán anonimizados.'), true);
  assert.equal(con('No se consignarán los nombres del personal adscrito.'), true);
  assert.equal(
    con('En la memoria no deberán figurar los nombres y apellidos de los técnicos propuestos.'),
    true,
    'con «y apellidos»',
  );
  assert.equal(con('Los perfiles se aportarán sin identificar.'), true);
});

// ── Lo de la carpeta de la licitación, el calendario y la poda ──

test('should_include_dated_clarifications_from_the_pliegos_folder_newest_first', async () => {
  const antigua = `${CARPETA_PLIEGOS}/Respuestas a consultas de licitadores 260925.pdf`;
  const nueva2 = `${CARPETA_PLIEGOS}/Aclaracion 2 07.10.2026.pdf`;
  const nuestra = `${CARPETA_PLIEGOS}/Sobre 2/Memoria tecnica v1.docx`;
  documentoIndexado(antigua, [
    'Respuesta a las consultas planteadas por los licitadores.\n1. ¿Se admite alojar los datos en la zona de datos UE? Sí, queda admitida la zona de datos UE.',
  ]);
  documentoIndexado(nueva2, [
    'Aclaración núm. 2.\nLas pruebas de intrusión las contrata la entidad, no el adjudicatario.',
  ]);
  documentoIndexado(nuestra, ['Respuesta a dudas: borrador de nuestra memoria técnica.']);
  try {
    const d = await componer(nueva());
    const a = seccion(d, 'aclaraciones').texto;
    assert.match(
      a,
      /### 07\/10\/2026 — «Aclaracion 2 07\.10\.2026\.pdf»[\s\S]*### 25\/09\/2026 — «Respuestas a consultas de licitadores 260925\.pdf»/,
      'fechadas y de la más reciente a la más antigua',
    );
    assert.ok(
      a.includes('[Aclaración 25/09/2026 p. 1]\nRespuesta a las consultas planteadas'),
      'el texto íntegro, con su cita',
    );
    assert.ok(a.includes('queda admitida la zona de datos UE') && a.includes('las contrata la entidad'));
    assert.doesNotMatch(a, /borrador de nuestra memoria/, 'lo que presentamos nosotros no es del cliente');
    const registradas = db
      .prepare(
        "SELECT ruta, fecha FROM documentos_licitacion WHERE licitacion_id = ? AND clase = 'aclaracion' ORDER BY fecha",
      )
      .all(ID);
    assert.deepEqual(
      registradas,
      [
        { ruta: antigua, fecha: '2026-09-25' },
        { ruta: nueva2, fecha: '2026-10-07' },
      ],
      'se registran con su clase al detectarlas',
    );
  } finally {
    for (const r of [antigua, nueva2, nuestra]) sinDocumentoIndexado(r);
  }
  const sin = seccion(await componer(nueva()), 'aclaraciones').texto;
  assert.match(sin, /^No hay respuestas a dudas, aclaraciones ni rectificaciones en la carpeta de la licitación/);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM documentos_licitacion WHERE licitacion_id = ?').get(ID) as { n: number }).n,
    0,
    'lo que ya no está se olvida',
  );
});

test('should_include_cuadro_resumen_with_start_date_and_date_the_calendar_from_it', async () => {
  const pcap = [...PAGINAS_PCAP];
  pcap[2] =
    'CUADRO RESUMEN\n8. DURACIÓN DEL CONTRATO\nDuración del contrato: Dos (2) meses de implantación + un (1) mes de soporte\nFecha prevista de inicio del contrato: 16.11.2026\n13. SUBCONTRATACIÓN: se admite hasta el 30 % del importe.';
  db.prepare("DELETE FROM pliegos WHERE licitacion_id = ? AND clase = 'pcap'").run(ID);
  pliegoIndexado(ID, 'pcap', 'PCAP.pdf', pcap);
  try {
    const d = await componer(nueva());
    const cuadro = seccion(d, 'cuadro_resumen').texto;
    assert.match(
      cuadro,
      /- «Mejora 1: bolsa de horas adicionales»: en «Archivo electrónico nº 2» \(Anexo VII\)\./,
      'los criterios automáticos con su archivo',
    );
    assert.ok(
      cuadro.includes(`[PCAP p. 3]\n${pcap[2]}`),
      'la página del cuadro con el inicio, la duración y la subcontratación',
    );
    assert.ok(!cuadro.includes('[PCAP p. 31]'), 'lo que ya va en «Criterios» no se repite');
    const id = seccion(d, 'identificacion').texto;
    assert.match(
      id,
      /- Inicio previsto: lunes 16\/11\/2026 \(\[PCAP p\. 3\] «fecha prevista de inicio del contrato: 16\.11\.2026»\)\./,
    );
    assert.match(
      id,
      /- Duración: «Duración del contrato: Dos \(2\) meses de implantación \+ un \(1\) mes de soporte» \[PCAP p\. 3\]; 3 meses, hasta el lunes 15\/02\/2027\./,
    );
    assert.match(
      id,
      /Festivos laborables en ese periodo, nacionales y de Comunidad de Madrid \(sede: lugar de ejecución \(NUTS ES300\)\)[^:]*: martes 08\/12\/2026 \(Inmaculada Concepción\); viernes 25\/12\/2026 \(Natividad del Señor\); viernes 01\/01\/2027 \(Año Nuevo\); miércoles 06\/01\/2027 \(Epifanía del Señor\)\./,
    );
  } finally {
    db.prepare("DELETE FROM pliegos WHERE licitacion_id = ? AND clase = 'pcap'").run(ID);
    pliegoIndexado(ID, 'pcap', 'PCAP.pdf', PAGINAS_PCAP);
  }
});

test('should_index_client_rules_with_code_and_passages_per_section', async () => {
  const norma = `${CARPETA_PLIEGOS}/NORMATIVA INTERNA CLIENTE/Procedimiento de consultas.pdf`;
  documentoIndexado(norma, [
    'P-XX-010 Procedimiento de atención de consultas\nREVISIÓN: 03',
    'Las consultas de las áreas se registran en el gestor de peticiones y el procedimiento de atención de consultas fija una respuesta en 48 horas.',
  ]);
  try {
    const n = seccion(await componer(nueva()), 'normativa_cliente').texto;
    assert.match(
      n,
      /- P-XX-010 \(revisión 03\): «Procedimiento de consultas\.pdf» — Licitaciones\/Radar\/2026\/EXP-2026-0412 \(p-91000710\)\/NORMATIVA INTERNA CLIENTE\/Procedimiento de consultas\.pdf/,
    );
    assert.match(
      n,
      /### 1\. Organización y metodología del servicio\n(?:\[[^\n]*\n)*\[P-XX-010 p\. 2\] Las consultas de las áreas se registran en el gestor de peticiones/,
    );
  } finally {
    sinDocumentoIndexado(norma);
  }
  assert.match(seccion(await componer(nueva()), 'normativa_cliente').texto, /^No hay normativa interna del cliente/);
});

test('should_weigh_less_without_the_informative_annex_and_keep_one_copy_of_criteria', async () => {
  const anexo =
    'Fase 3: asistente conversacional para toda la plantilla con integración en los sistemas corporativos. '.repeat(60);
  const ppt = (aviso: string) => [
    ...PAGINAS_PPT.slice(0, 4),
    `${PAGINAS_PPT[4]} ${aviso}`,
    `ANEXO 1. Evolución futura de la solución\n${anexo}`,
  ];
  try {
    pliegoIndexado(
      ID,
      'ppt',
      'PPT.pdf',
      ppt('Las fases 2 y 3 se describen en el Anexo 1 con carácter exclusivamente informativo y prospectivo.'),
    );
    const podado = await componer(nueva());
    pliegoIndexado(
      ID,
      'ppt',
      'PPT.pdf',
      ppt('Las fases 2 y 3 se describen en el Anexo 1, que el adjudicatario deberá cumplir.'),
    );
    const entero = await componer(nueva());
    const t = seccion(podado, 'pliego_tecnico').texto;
    assert.ok(!t.includes('asistente conversacional'), 'el anexo informativo no va');
    assert.ok(
      t.includes(
        '[ANEXO 1. Evolución futura de la solución: anexo prospectivo o fuera del objeto del contrato; no va en el dossier: sigue en biblioteca_leer ruta=«Licitaciones/Radar/2026/EXP-2026-0412 (p-91000710)/PPT.pdf», págs. 6]',
      ),
      t.slice(-400),
    );
    assert.ok(
      seccion(entero, 'pliego_tecnico').texto.includes('asistente conversacional'),
      'un anexo que obliga sí va',
    );
    assert.ok(
      podado.caracteres < entero.caracteres - anexo.length / 2,
      `pesa menos: ${podado.caracteres} frente a ${entero.caracteres}`,
    );
    assert.match(
      seccion(podado, 'formato').texto,
      /Cláusula del pliego:\nestá en «Criterios» \(PCAP p\. 31\): no se repite\./,
    );
    const md = dossierEnMarkdown(podado, { sinPersonal: false });
    assert.equal(md.split(PAGINAS_PCAP[30]!.trim()).length - 1, 1, 'el texto de los criterios, una sola vez');
  } finally {
    pliegoIndexado(ID, 'ppt', 'PPT.pdf', PAGINAS_PPT);
  }
});
