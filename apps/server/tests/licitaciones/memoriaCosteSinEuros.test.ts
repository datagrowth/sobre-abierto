// Memoria técnica, compromisos con coste sin euros para los agentes: la memoria va en un sobre sin
// precios, así que ningún importe puede llegar a lo que leen la redacción, las rondas, el parche
// de hechos o el crítico. La ficha sí enseña a la persona los euros de cada compromiso cuando hay
// precio por hora configurado, calculados al enseñarlos y sin guardarlos. Datos sintéticos.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

// Antes del entorno: la config se lee al arrancar el núcleo.
process.env.LICITACIONES_PRECIO_HORA = '40';
const {
  api,
  arrancar,
  cerrar,
  conectar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  T_CURIOSO,
  T_OFERTA,
  texto,
  trabajosDe,
  trasLaEstrategia,
} = await import('../helpers/memoriaEntorno.js');
const { estrategiaCasoA } = await import('./fixtures/estrategiaCasoA.js');
const { APARTADOS, apartadoCasoA } = await import('./fixtures/casoA.js');
const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const {
  EstrategiaEntrada,
  estrategiaDe,
  instruccionesEstrategia,
  PayloadEstrategia,
  recibirEstrategia,
  TIPO_MEMORIA_ESTRATEGIA,
} = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { instruccionesHechos, PayloadHechos, TIPO_MEMORIA_HECHOS } =
  await import('../../src/dominios/licitaciones/oferta/parcheHechos.js');
const { progresoDe } = await import('../../src/dominios/licitaciones/oferta/progresoMemoria.js');
const { filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { fichaDe } = await import('../../src/dominios/licitaciones/oferta/fichaSolucion.js');
const { instruccionesRedaccion, PayloadRedaccion, TIPO_MEMORIA_REDACCION } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { CriticaEntrada, instruccionesCritica, paqueteCiego, PayloadCritica, recibirCritica, TIPO_MEMORIA_CRITICA } =
  await import('../../src/dominios/licitaciones/oferta/critica.js');
const { registrarProveedorCoste } = await import('../../src/dominios/licitaciones/oferta/compromisosMemoriaCoste.js');
const { detectarFugas } = await import('../../src/dominios/licitaciones/oferta/fugas.js');

before(arrancar);
after(cerrar);

const SIN_EUROS = /€|\beuros?\b/i;
const CARO = {
  texto: 'Entrevista individual con cada persona usuaria al empezar',
  clase: 'anadido',
  criterio: 'Apartado 1: modelo organizativo',
  compensa: 'La rúbrica valora el trato personalizado',
  horas: 150,
  supuesto: '150 personas × 1 h',
};

type Numeros = { memoria_id: number; guion_id: number; version: number };
type Ficha = { campos: { clave: string; euros?: number; valor: string }[] };
type Fichas = { web: Ficha; estado: Ficha; agentes: Ficha[] };
type ConFicha = { progreso: { ficha: Ficha } };

// La ficha pendiente como la ven la web (GET /oferta), el estado por defecto y las tools de los agentes (con y sin permiso para ver personas).
async function fichasVistas(memoriaId: number): Promise<Fichas> {
  const o = (await (await api(`/licitaciones/${ID}/oferta`, undefined, 'GET')).json()) as { memorias: ConFicha[] };
  const agentes: Ficha[] = [];
  for (const token of [T_OFERTA, T_CURIOSO]) {
    const c = await conectar(token);
    try {
      agentes.push(
        (
          JSON.parse(texto(await c.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } }))) as {
            memoria: ConFicha;
          }
        ).memoria.progreso.ficha,
      );
    } finally {
      await c.close();
    }
  }
  return {
    web: o.memorias[0]!.progreso.ficha,
    estado: progresoDe(db, filaMemoria(db, memoriaId)!).ficha as Ficha,
    agentes,
  };
}

// Una memoria del caso A con un compromiso añadido caro, la ficha aprobada y redactada entera: esperando la crítica de la ronda 0.
async function conCompromisoCaro(): Promise<{ n: Numeros; fichas: Fichas; estrategia: string; redaccion: string }> {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  const estrategia = instruccionesEstrategia(
    db,
    PayloadEstrategia.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_ESTRATEGIA).at(-1)!.payload)),
  );
  const e = estrategiaCasoA({ memoria_id: p.memoria, version: p.version });
  const r = recibirEstrategia(
    db,
    nucleo().db,
    EstrategiaEntrada.parse({ ...e, solucion: { ...e.solucion, compromisos: [CARO] } }),
    'oferta-licitaciones',
  );
  assert.equal(r.error, null, r.error?.message);
  await avanzarMemoria(nucleo().db, db, p.memoria);
  const fichas = await fichasVistas(p.memoria);
  await trasLaEstrategia(p.memoria);
  const redaccion = instruccionesRedaccion(
    db,
    nucleo().db,
    PayloadRedaccion.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!.payload)),
  );
  const m = memoriaPorId(p.memoria);
  const n = { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
  for (const k of [1, 2, 3, 4])
    assert.equal(recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones').error, null);
  await trasLaEstrategia(p.memoria);
  return { n, fichas, estrategia, redaccion };
}

const CITA = 'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas';
const MOTIVO = {
  cita: 'un indicador con meta mensual que revisará con la entidad',
  motivo: 'El indicador no tiene cifra.',
  arreglo: 'Fijar la meta del 95 % de consultas en plazo.',
};
const SOBRE_48H = {
  cita: CITA,
  motivo: 'Un único plazo de 48 horas para todo no distingue prioridades.',
  arreglo: 'Fijar 4 horas para las urgentes y 24 horas para el resto.',
};

// La crítica de la ronda 0: el apartado 1 en su máximo; el 2 con `motivo`; los demás, con el indicador sin cifra.
function criticar(n: Numeros, motivo: typeof MOTIVO): void {
  const c = CriticaEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 0,
    resumen: 'Le faltan cifras propias de la entidad.',
    apartados: APARTADOS.map((a, i) => {
      const tramo = i === 0 ? a.escala.at(-1)! : a.escala.at(-2)!;
      return {
        apartado: i + 1,
        tramo,
        puntos: tramo,
        cita: CITA,
        motivos_para_bajar: i === 0 ? [] : i === 1 ? [motivo] : [MOTIVO],
        falta: [],
      };
    }),
  });
  const r = recibirCritica(db, c, 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
}

async function paquete(n: Numeros, parte: 'rubrica' | 'pliego' | 'memoria' | 'documento'): Promise<string> {
  let todo = '';
  for (let desde: number | null = 0; desde !== null;) {
    const r = paqueteCiego(db, { id: ID, memoria_id: n.memoria_id, parte, desde });
    assert.equal(r.error, null, r.error?.message);
    const t = r.data as { texto: string; siguiente: number | null };
    todo += t.texto;
    desde = t.siguiente;
  }
  return todo;
}

test('should_keep_euros_out_of_every_agent_instruction_even_when_the_sheet_shows_them', async () => {
  // El extractor de la parte B devuelve euros: el crítico no los ve.
  registrarProveedorCoste(() => [
    {
      texto: CARO.texto,
      cita: null,
      clase: 'anadido',
      criterio: CARO.criterio,
      horas: 150,
      euros: 6_000,
      supuesto: CARO.supuesto,
    },
  ]);
  try {
    const { n, fichas, estrategia, redaccion } = await conCompromisoCaro();
    assert.match(estrategia, /6e\. Compromisos/);
    assert.doesNotMatch(estrategia, SIN_EUROS, 'la estrategia');
    const campo = (f: Ficha) => f.campos.find((c) => c.clave === 'compromiso-1')!;
    assert.equal(campo(fichas.web).euros, 6_000, 'la persona ve los euros en la web: 150 h × 40 €/h');
    assert.equal(campo(fichas.estado).euros, undefined, 'por defecto, sin euros');
    assert.equal(fichas.agentes.length, 2);
    for (const f of fichas.agentes) {
      assert.ok(campo(f), 'el agente ve el compromiso');
      assert.doesNotMatch(JSON.stringify(f), /"euros"|€|\beuros?\b/i, 'pero nunca sus euros');
    }
    assert.doesNotMatch(JSON.stringify(fichaDe(db, n.memoria_id)), SIN_EUROS, 'la ficha guardada no los lleva');
    const e = estrategiaDe(db, n.memoria_id)!;
    assert.doesNotMatch(JSON.stringify(e.datos.hechos), SIN_EUROS, 'ni la hoja de hechos');
    assert.doesNotMatch(JSON.stringify(e.datos.solucion), SIN_EUROS, 'ni la solución');

    assert.ok(redaccion.includes(CARO.texto), 'el compromiso llega a la redacción');
    assert.doesNotMatch(redaccion, SIN_EUROS, 'la redacción');

    assert.equal(memoriaPorId(n.memoria_id).fase, 'critica');
    const critica = instruccionesCritica(
      db,
      PayloadCritica.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_CRITICA).at(-1)!.payload)),
    );
    assert.doesNotMatch(critica, SIN_EUROS, 'el crítico');
    const documento = await paquete(n, 'documento');
    assert.match(
      documento,
      /Compromete «Entrevista individual con cada persona usuaria al empezar» \(150 h, coste alto\)/,
      'el gancho llega con horas',
    );
    for (const parte of ['rubrica', 'memoria', 'documento'] as const)
      assert.doesNotMatch(await paquete(n, parte), SIN_EUROS, `el paquete del crítico: ${parte}`);

    // Ronda 1: la reescritura con lo que señala el crítico.
    criticar(n, MOTIVO);
    await avanzarMemoria(nucleo().db, db, n.memoria_id);
    assert.equal(memoriaPorId(n.memoria_id).ronda, 1);
    const ronda = instruccionesRedaccion(
      db,
      nucleo().db,
      PayloadRedaccion.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!.payload)),
    );
    assert.match(ronda, /LO QUE SEÑALA EL CRÍTICO/);
    assert.doesNotMatch(ronda, SIN_EUROS, 'las rondas');
  } finally {
    registrarProveedorCoste();
  }
});

test('should_keep_euros_out_of_the_fact_patch_instructions', async () => {
  const { n } = await conCompromisoCaro();
  criticar(n, SOBRE_48H);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(memoriaPorId(n.memoria_id).fase, 'hechos', 'el crítico cita un hecho: antes de reescribir, la hoja');
  const parche = instruccionesHechos(
    db,
    PayloadHechos.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_HECHOS).at(-1)!.payload)),
  );
  assert.match(parche, /48 horas/);
  assert.doesNotMatch(parche, SIN_EUROS, 'el parche de hechos');
});

test('should_still_reject_amounts_in_the_memoria_at_the_border', () => {
  const fugas = detectarFugas('El seguimiento individual tiene un coste de 6.000 € que asume la empresa.', {
    automaticos: [],
  });
  assert.deepEqual(
    fugas.map((f) => f.tipo),
    ['importe'],
  );
});
