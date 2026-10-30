// Hermes pide o relanza una fase de la oferta (ficha, guion, propuesta, ronda de memoria o anexo).
import { z } from 'zod';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { encolarUnico } from '../../../nucleo/trabajos.js';
import { pedirFicha } from '../ficha.js';
import { pedirAnexo, type ContextoAnexo } from './anexosPedir.js';
import { VIA_SIN_CONFIRMAR } from './anexosVia.js';
import { comprobacionesDe } from './comprobaciones.js';
import { guionVigente, pedirGuion } from './guion.js';
import { actualizarMemoria } from './actualizarMemoria.js';
import { claveDeFase } from './avanceMemoria.js';
import { filaMemoria } from './ensamblado.js';
import { guardaPlazo } from './plazo.js';
import { TIPO_PROPUESTA_DECISIONES } from './propuestaDecisiones.js';
import { runsDeOfertaHoy } from './topes.js';
import { EVENTO_PEDIDO_HERMES } from './hermesEnVivo.js';

export { EVENTO_PEDIDO_HERMES };

// Pasa por las mismas puertas que la web y alguna más, porque un agente no ve la pantalla ni confirma avisos: el
// freno de elegibilidad, el tope de runs por oferta y día, la guardia de plazo (sin confirmar nunca) y sin
// levantar el freno de su tipo. Precio, aceptación y registro no son fases: son de una persona.
const FASES_PEDIBLES = ['ficha', 'guion', 'propuesta', 'ronda_memoria', 'anexo'] as const;
type FasePedible = (typeof FASES_PEDIBLES)[number];
const DIA_MS = 86_400_000;

export const PedirEntrada = z
  .strictObject({
    id: z.string().trim().min(3).max(40),
    fase: z.enum(FASES_PEDIBLES),
    clave_documento: z.string().trim().min(4).max(80).optional().describe('Solo para anexo'),
    version: z.number().int().positive().optional().describe('Solo para ronda_memoria: versión base'),
    apartados: z
      .array(z.number().int().min(1).max(20))
      .max(20)
      .optional()
      .describe(
        'Solo para ronda_memoria: los que rehacer; sin ellos, los que la evaluación deja por debajo de su tramo máximo',
      ),
    motivo: z.string().trim().min(10).max(500),
  })
  .superRefine((e, ctx) => {
    if (e.fase === 'anexo' && !e.clave_documento)
      ctx.addIssue({
        code: 'custom',
        path: ['clave_documento'],
        message: 'Un anexo se pide por su clave_documento (licitaciones_documentos › documentos[].clave).',
      });
    if (e.fase === 'ronda_memoria' && !e.version)
      ctx.addIssue({
        code: 'custom',
        path: ['version'],
        message: 'Una ronda de memoria se pide sobre una versión base: indica version.',
      });
  });
export type PedirEntrada = z.infer<typeof PedirEntrada>;
export type FasePedida = { trabajo: number; fase: FasePedible };

// Errores que la web deja pasar si la persona confirma; un agente no confirma nunca.
const CONFIRMABLES = new Set(['plazo_justo', VIA_SIN_CONFIRMAR]);

// Descartada o retirada (el veredicto de las comprobaciones) no hay nada que preparar: ni un run más.
function frenoElegibilidad(c: ContextoAnexo, id: string): Result<null> {
  const cab = comprobacionesDe(c.db, c.dbNucleo, id);
  if (cab.error) return cab;
  if (cab.data.veredicto.tipo === 'descartada')
    return fail(
      'conflicto',
      `La oferta está descartada o retirada (${cab.data.veredicto.texto}): no hay nada que pedir; si se recupera, lo hará una persona.`,
    );
  const freno = cab.data.bloqueos.find(
    (b) =>
      (b.estado === 'abierto' || b.estado === 'propuesta') && b.categoria === 'elegibilidad' && b.gravedad === 'impide',
  );
  return freno
    ? fail(
        'conflicto',
        `Hay un impide de elegibilidad abierto: una persona tiene que decir «Vamos» («${freno.titulo}»).`,
      )
    : ok(null);
}

function topeDelDia(c: ContextoAnexo, id: string): Result<null> {
  const tope = nucleo().config.licitaciones.runsOfertaDia;
  const n = runsDeOfertaHoy(c.dbNucleo, id, Date.now(), c.db);
  return n >= tope
    ? fail(
        'conflicto',
        `Esta oferta ya lanzó ${n} runs en las últimas 24 h (tope ${tope}): espera o que lo pida una persona desde la web.`,
      )
    : ok(null);
}

// Lo que identifica un pedido: la misma fase sobre el mismo anexo o la misma versión base.
const objetivoDe = (e: PedirEntrada) => ({
  fase: e.fase,
  clave_documento: e.clave_documento ?? null,
  version: e.version ?? null,
});

/** El trabajo que Hermes ya pidió en las últimas 24 h para este mismo objetivo, si no falló ni se canceló. */
function yaPedido(c: ContextoAnexo, e: PedirEntrada): number | null {
  const o = objetivoDe(e);
  const f = c.dbNucleo
    .prepare(
      `SELECT json_extract(ev.datos, '$.trabajo') AS trabajo FROM eventos ev
    JOIN trabajos_ia t ON t.id = json_extract(ev.datos, '$.trabajo')
    WHERE ev.tipo = ? AND ev.recurso = ? AND ev.creado_en >= ? AND json_extract(ev.datos, '$.fase') = ?
      AND json_extract(ev.datos, '$.clave_documento') IS ? AND json_extract(ev.datos, '$.version') IS ?
      AND t.estado NOT IN ('fallido', 'cancelado')
    ORDER BY ev.id DESC LIMIT 1`,
    )
    .get(
      EVENTO_PEDIDO_HERMES,
      e.id,
      new Date(Date.now() - DIA_MS).toISOString(),
      o.fase,
      o.clave_documento,
      o.version,
    ) as { trabajo: number } | undefined;
  return f?.trabajo ?? null;
}

// Como pedirPropuestaDecisiones a mano, sin levantar el freno del tipo: la clave automática de la
// ronda 0 ya la usó la propuesta al llegar el guion, y encolar con ella devolvería ese trabajo viejo.
function pedirPropuesta(c: ContextoAnexo, id: string): Result<{ trabajo: number }> {
  const guion = guionVigente(c.db, id);
  if (!guion)
    return fail(
      'invalid_input',
      'Esta licitación aún no tiene guion de la oferta: la propuesta se hace sobre él. Pídelo primero.',
    );
  const plazo = guardaPlazo(c.db, id, 'decisiones', { aMano: false });
  if (plazo.error) return plazo;
  const payload = { id, guion_id: guion.id, pedida_en: new Date().toISOString() };
  return ok({
    trabajo: encolarUnico(c.dbNucleo, {
      tipo: TIPO_PROPUESTA_DECISIONES,
      dominio: 'licitaciones',
      base: `decisiones-${id}`,
      payload,
      aMano: false,
    }).id,
  });
}

async function despachar(c: ContextoAnexo, e: PedirEntrada): Promise<Result<{ trabajo: number }>> {
  const porAgente = true;
  switch (e.fase) {
    case 'ficha': {
      // Como las demás fases de un agente: con el plazo vencido o sin tiempo, no se gasta un run.
      const plazo = guardaPlazo(c.db, e.id, 'ficha', { aMano: false });
      return plazo.error ? plazo : pedirFicha(c.dbNucleo, c.db, e.id, { porAgente });
    }
    case 'guion':
      return pedirGuion(c.dbNucleo, c.db, e.id, { porAgente });
    case 'propuesta':
      return pedirPropuesta(c, e.id);
    case 'ronda_memoria': {
      // Una ronda de Hermes es para mejorar: con la evaluación de la base, que tiene que estar
      // evaluada. Su motivo no son indicaciones de la persona: va aparte, como contexto.
      const r = await actualizarMemoria(c.dbNucleo, c.db, c.raices.salidas, {
        id: e.id,
        version: e.version!,
        apartados: e.apartados?.length ? e.apartados : undefined,
        motivo: e.motivo,
        porAgente,
        mejora: true,
      });
      return r.error ? r : ok({ trabajo: trabajoDeRedaccion(c, r.data.memoria) });
    }
    case 'anexo':
      return pedirAnexo(c, e.id, e.clave_documento!, { porAgente });
  }
}

// Una ronda de memoria encola un solo trabajo de redacción: el pedido se enlaza con él (0 si la
// fase aún no lo ha encolado).
function trabajoDeRedaccion(c: ContextoAnexo, memoria: number): number {
  const m = filaMemoria(c.db, memoria);
  if (!m) return 0;
  const f = c.dbNucleo
    .prepare('SELECT MAX(id) AS t FROM trabajos_ia WHERE clave = ?')
    .get(claveDeFase(m, 'redaccion')) as { t: number | null };
  return f.t ?? 0;
}

const paraAgente = <T>(r: Result<T>): Result<T> =>
  r.error && CONFIRMABLES.has(r.error.code)
    ? fail(r.error.code, `${r.error.message} Un agente no puede confirmarlo: que lo pida una persona desde la web.`)
    : r;

/** Pide la fase si pasa el freno de elegibilidad, el tope del día y la guardia de plazo; deja un evento «pedido por Hermes». */
export async function pedirFase(c: ContextoAnexo, e: PedirEntrada, agente: Agente): Promise<Result<FasePedida>> {
  const freno = frenoElegibilidad(c, e.id);
  if (freno.error) return freno;
  const previo = yaPedido(c, e);
  if (previo !== null) return ok({ trabajo: previo, fase: e.fase });
  const tope = topeDelDia(c, e.id);
  if (tope.error) return tope;
  const r = paraAgente(await despachar(c, e));
  if (r.error) return r;
  emitir(c.dbNucleo, {
    tipo: EVENTO_PEDIDO_HERMES,
    dominio: 'licitaciones',
    recurso: e.id,
    datos: { ...objetivoDe(e), agente: agente.nombre, motivo: e.motivo, trabajo: r.data.trabajo },
  });
  return ok({ trabajo: r.data.trabajo, fase: e.fase });
}
