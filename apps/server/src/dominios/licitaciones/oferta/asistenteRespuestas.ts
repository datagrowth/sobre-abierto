// Las respuestas del asistente de la oferta: se guardan por código o las interpreta Hermes.
import { z } from 'zod';
import { obtenerPersona } from '../../../nucleo/colaboradores/personas.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import type { Actor } from '../../../nucleo/permisos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Rol } from '../../../nucleo/usuarios.js';
import { eurosTexto } from '../lotes.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { contextoAsistente, type ContextoAsistente } from './asistenteContexto.js';
import { anotarHilo, cambiarEstado, mensajeDe } from './asistenteHilo.js';
import { encolarInterpretacion } from './asistenteInterpretar.js';
import { preguntasDeOferta } from './asistentePreguntas.js';
import { baseDelLote, esBaja, importeDeTexto } from './asistentePrecio.js';
import { seccionDeAccion, type AccionData, type Pregunta } from './asistenteTipos.js';
import { rolesNombrados } from './coherencia.js';
import { decisionesDe, presupuestosDeLotes, type DecisionesData } from './decisiones.js';
import { problemasDePrecios } from './preciosOferta.js';
import { guardarSeccion } from './decisionesSecciones.js';

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);

// Una respuesta rápida se guarda por código en su sección de las decisiones, sin IA; un texto libre lo lee el
// código si puede (un importe, unos lotes, el enfoque) y si no lo interpreta Hermes (trabajo de cola), que deja
// una decisión para que la persona la confirme. Nada se guarda sin una acción de la persona. Cambiar una
// respuesta ya dada es responder otra vez: «Qué cambia» se ve antes en la web y solo se rehace lo afectado.
// Una de tres: la opción elegida (con el importe o la evidencia que pida), un texto libre o la
// interpretación de Hermes que se confirma o se rechaza.
const RespuestaEntrada = z
  .strictObject({
    pregunta: Texto(1, 300),
    version: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe('La versión de las decisiones que se vio (GET …/oferta/preguntas)'),
    opcion: Texto(1, 120).optional(),
    importe: z.number().finite().positive().optional(),
    evidencia: Texto(3, 600).optional(),
    texto: Texto(1, 4000).optional(),
    interpretacion: z.number().int().positive().optional(),
    rechazar: z.boolean().optional(),
    quien: Texto(2, 60).optional(),
  })
  .refine(
    (r) => [r.opcion, r.texto, r.interpretacion].filter((x) => x !== undefined).length === 1,
    'Manda la opción, el texto o la interpretación que se confirma: una de las tres.',
  );
type RespuestaEntradaData = z.infer<typeof RespuestaEntrada>;

export type RespuestaHecha = {
  estado: 'guardada' | 'repregunta' | 'interpretando' | 'rechazada';
  mensaje: string;
  version: number | null;
  avisos: string[];
};

// ── Lo que lee el código de un texto libre ──

// Los lotes que nombra el texto, en el orden en que salen («el 3 y luego el 1» → 3, 1); «todos», todos.
function lotesDeTexto(texto: string, ids: string[]): string[] {
  const t = textoComparable(texto);
  if (/\btodos\b/.test(t)) return ids;
  const palabras = t.split(/[^a-z0-9]+/);
  return ids
    .map((id) => ({ id, en: palabras.indexOf(textoComparable(id)) }))
    .filter((x) => x.en >= 0)
    .sort((a, b) => a.en - b.en)
    .map((x) => x.id);
}

function accionDeTexto(c: ContextoAsistente, p: Pregunta, texto: string): Result<AccionData> {
  if (p.seccion === 'precio') {
    const base = baseDelLote(c, p.lote);
    if (esBaja(texto) && !base)
      return fail(
        'invalid_input',
        'No sé sobre qué presupuesto calcular esa baja: escribe el importe en euros sin impuestos («29.280»).',
      );
    const importe = importeDeTexto(texto, base);
    const concepto = p.opciones.find((o) => o.concepto)?.concepto;
    return importe
      ? ok({ tipo: 'precio', lote: p.lote, importe, ...(concepto ? { concepto } : {}) })
      : fail(
          'invalid_input',
          'No encuentro un importe: escríbelo en euros sin impuestos («29.280») o como baja («8,5 % de baja»).',
        );
  }
  if (p.seccion === 'lotes' || p.clave === 'dato_anexo:orden_lotes') {
    const lotes = lotesDeTexto(texto, p.seccion === 'lotes' ? c.lotes.lotes.map((l) => l.id) : c.d.lotes);
    if (!lotes.length)
      return fail('invalid_input', 'No encuentro ningún lote en lo que has escrito: di sus números («1 y 3»).');
    return ok(
      p.seccion === 'lotes' ? { tipo: 'lotes', lotes } : { tipo: 'dato_anexo', dato: 'orden_lotes', valor: lotes },
    );
  }
  if (p.seccion === 'enfoque')
    return texto.trim().length >= 3
      ? ok({ tipo: 'enfoque', texto: texto.trim() })
      : fail('invalid_input', 'Escribe el enfoque en una frase al menos.');
  return fail('invalid_input', 'Esta pregunta se contesta con una de sus opciones.');
}

// ── Lo que se guarda en cada sección ──

const raizDe = (rol: string): string => rolesNombrados(rol)[0]?.raiz ?? textoComparable(rol).trim();
const mismoRol = (a: { rol: string; lotes: string[] }, b: { rol: string; lotes: string[] }) =>
  raizDe(a.rol) === raizDe(b.rol) && [...a.lotes].sort().join() === [...b.lotes].sort().join();

type Cambio = {
  seccion: 'lotes' | 'equipo' | 'a_incorporar' | 'precio' | 'automaticos' | 'datos_anexo' | 'enfoque';
  valor: unknown;
};

// Nombrar a alguien quita el perfil a incorporar de ese rol y al revés: dos secciones, una tras otra.
function cambiosDe(d: DecisionesData, a: AccionData): Cambio[] {
  const aIncorporar = d.a_incorporar ?? [];
  switch (a.tipo) {
    case 'lotes':
      return [{ seccion: 'lotes', valor: a.lotes }];
    case 'persona': {
      const equipo = [
        ...d.equipo.filter((m) => !mismoRol({ rol: m.rol_en_la_oferta, lotes: m.lotes }, a)),
        { persona_id: a.persona_id, rol_en_la_oferta: a.rol, lotes: a.lotes },
      ];
      const quedan = aIncorporar.filter((p) => !mismoRol({ rol: p.rol_en_la_oferta, lotes: p.lotes }, a));
      return [
        { seccion: 'equipo', valor: equipo },
        ...(quedan.length !== aIncorporar.length ? [{ seccion: 'a_incorporar' as const, valor: quedan }] : []),
      ];
    }
    case 'incorporar': {
      const nuevo = {
        rol_en_la_oferta: a.rol,
        lotes: a.lotes,
        requisitos: a.requisitos,
        acreditar_antes: a.acreditar_antes,
        plazo: a.plazo,
        cita: a.cita,
      };
      const equipo = d.equipo.filter((m) => !mismoRol({ rol: m.rol_en_la_oferta, lotes: m.lotes }, a));
      return [
        {
          seccion: 'a_incorporar',
          valor: [...aIncorporar.filter((p) => !mismoRol({ rol: p.rol_en_la_oferta, lotes: p.lotes }, a)), nuevo],
        },
        ...(equipo.length !== d.equipo.length ? [{ seccion: 'equipo' as const, valor: equipo }] : []),
      ];
    }
    case 'precio': {
      const otras = d.ofertas.filter((o) => o.lote !== a.lote);
      const previa = d.ofertas.find((o) => o.lote === a.lote);
      const precio = a.concepto
        ? { importe: null, unitarios: [{ concepto: a.concepto, precio: a.importe }] }
        : { importe: a.importe, unitarios: [] };
      return [
        {
          seccion: 'precio',
          valor: [
            ...otras,
            { lote: a.lote, pendiente: false, coste_estimado: previa?.coste_estimado ?? null, ...precio },
          ],
        },
      ];
    }
    case 'automatico': {
      const { tipo: _t, ...nuevo } = a;
      const otros = d.automaticos.filter(
        (x) => !(textoComparable(x.criterio) === textoComparable(a.criterio) && (x.lote ?? null) === a.lote),
      );
      return [{ seccion: 'automaticos', valor: [...otros, nuevo] }];
    }
    case 'dato_anexo':
      return [
        {
          seccion: 'datos_anexo',
          valor: {
            subcontratacion_servidores: null,
            orden_lotes: null,
            impuesto: null,
            ...d.datos_anexo,
            [a.dato]: a.valor,
          },
        },
      ];
    case 'enfoque':
      return [{ seccion: 'enfoque', valor: a.texto }];
    default:
      return [];
  }
}

function guardarCambios(
  c: ContextoAsistente,
  cambios: Cambio[],
  x: { version: number | null } & Firma,
): Result<{ version: number; avisos: string[] }> {
  let version = x.version ?? c.guardadas?.version ?? 1;
  const avisos: string[] = [];
  for (const cambio of cambios) {
    const r = guardarSeccion(
      c.dbLic,
      c.dbNucleo,
      c.id,
      cambio.seccion,
      { version, valor: cambio.valor, quien: x.quien },
      { parcial: true, rol: x.rol },
    );
    if (r.error) return r;
    version = r.data.version;
    avisos.push(...r.data.avisos);
  }
  return ok({ version, avisos });
}

// ── Lo que se dice en el hilo ──

function nombre(dbNucleo: DbNucleo, id: number): string {
  const p = obtenerPersona(dbNucleo, id);
  return p.data?.nombre ?? `la persona ${id}`;
}

function textoDato(dato: string, valor: unknown): string {
  if (dato === 'subcontratacion_servidores')
    return valor ? 'Se subcontratan los servidores' : 'No se subcontratan los servidores';
  if (dato === 'orden_lotes') return `Orden de los lotes: ${Array.isArray(valor) ? valor.join(', ') : '?'}`;
  const i = (valor ?? {}) as { tipo?: string; porcentaje?: number | null };
  return i.tipo === 'exento' ? 'Oferta exenta de impuesto' : `${i.tipo ?? 'Impuesto'} al ${i.porcentaje ?? '?'} %`;
}

/** La decisión en una frase, para el hilo y para confirmar lo que entendió Hermes. */
export function describirAccion(dbNucleo: DbNucleo, a: AccionData): string {
  switch (a.tipo) {
    case 'lotes':
      return a.lotes.length === 1 ? `Vamos al lote ${a.lotes[0]}` : `Vamos a los lotes ${a.lotes.join(', ')}`;
    case 'persona':
      return `${nombre(dbNucleo, a.persona_id)} como ${a.rol.toLowerCase()}${a.lotes.length ? ` (lote ${a.lotes.join(', ')})` : ''}`;
    case 'contratar':
      return 'Hay que contratarlo';
    case 'nombrar':
      return 'Prefiero nombrar a alguien';
    case 'incorporar':
      return `${a.rol} a incorporar${a.acreditar_antes ? `: acreditarlo hacia el ${a.acreditar_antes} si nos proponen` : ''}`;
    case 'precio':
      return `Precio${a.lote ? ` del lote ${a.lote}` : ''}${a.concepto ? ` por ${a.concepto.toLowerCase()}` : ''}: ${eurosTexto(a.importe)}`;
    case 'automatico':
      return a.nos_acogemos
        ? `Nos acogemos a «${a.criterio}»${a.tramo ? `: ${a.tramo}` : ''}`
        : `No nos acogemos a «${a.criterio}»`;
    case 'dato_anexo':
      return textoDato(a.dato, a.valor);
    case 'enfoque':
      return `Enfoque: ${a.texto.length > 140 ? `${a.texto.slice(0, 139)}…` : a.texto}`;
    default:
      return 'Respuesta';
  }
}

// guardarSeccion devuelve los avisos de todo el precio y, al guardar el enfoque, los suyos: de un
// precio, solo los de su lote; del enfoque, los que no son de precio; de lo demás, ninguno.
function avisosDeLaRespuesta(c: ContextoAsistente, a: AccionData, avisos: string[]): string[] {
  if (a.tipo !== 'precio' && a.tipo !== 'enfoque') return [];
  const d = decisionesDe(c.dbLic, c.id)?.datos;
  const dePrecio = d
    ? problemasDePrecios(d, c.guion.datos, { presupuestos: presupuestosDeLotes(c.dbLic, c.id) }).filter(
        (x) => x.gravedad === 'aviso',
      )
    : [];
  if (a.tipo === 'enfoque') return avisos.filter((x) => !dePrecio.some((p) => p.mensaje === x));
  return dePrecio.filter((x) => x.lote === a.lote || x.lote === null).map((x) => x.mensaje);
}

function aplicar(
  c: ContextoAsistente,
  p: Pregunta,
  a: AccionData,
  x: { version: number | null; opcion: string | null; texto: string } & Firma,
): Result<RespuestaHecha> {
  const datos = { titulo: p.titulo, seccion: p.seccion, opcion: x.opcion, accion: a };
  if (!seccionDeAccion(a)) {
    anotarHilo(c.dbLic, c.id, { pregunta: p.clave, autor: 'persona', tipo: 'respuesta', texto: x.texto, datos });
    return ok({
      estado: 'repregunta',
      mensaje: describirAccion(c.dbNucleo, a),
      version: c.guardadas?.version ?? null,
      avisos: [],
    });
  }
  const g = guardarCambios(c, cambiosDe(c.d, a), x);
  if (g.error) {
    anotarHilo(c.dbLic, c.id, {
      pregunta: p.clave,
      autor: 'plataforma',
      tipo: 'error',
      texto: g.error.message,
      datos: { titulo: p.titulo },
    });
    return g;
  }
  anotarHilo(c.dbLic, c.id, { pregunta: p.clave, autor: 'persona', tipo: 'respuesta', texto: x.texto, datos });
  const mensaje = `Hecho: ${describirAccion(c.dbNucleo, a)}.`;
  anotarHilo(c.dbLic, c.id, {
    pregunta: p.clave,
    autor: 'plataforma',
    tipo: 'guardado',
    texto: mensaje,
    datos: { titulo: p.titulo },
  });
  // Lo guardado vale pero conviene mirarlo (p. ej. un precio por debajo del umbral de anormalidad):
  // se repregunta en el hilo, y la web ofrece cambiar esa respuesta. Solo los avisos de esta
  // respuesta: los del precio de otro lote ya se repreguntaron con su pregunta.
  for (const aviso of avisosDeLaRespuesta(c, a, g.data.avisos)) {
    anotarHilo(c.dbLic, c.id, {
      pregunta: p.clave,
      autor: 'hermes',
      tipo: 'aviso',
      texto: `${aviso} ¿Lo mantienes o lo cambias?`,
      datos: { titulo: p.titulo },
    });
  }
  return ok({ estado: 'guardada', mensaje, version: g.data.version, avisos: g.data.avisos });
}

function accionDeOpcion(p: Pregunta, r: RespuestaEntradaData): Result<{ accion: AccionData; texto: string }> {
  const o = p.opciones.find((x) => x.clave === r.opcion);
  if (!o) return fail('invalid_input', `La pregunta «${p.titulo}» no tiene la opción «${r.opcion}».`);
  if (o.pide === 'importe') {
    if (!r.importe) return fail('invalid_input', 'Escribe el importe sin impuestos.');
    return ok({
      accion: { tipo: 'precio', lote: p.lote, importe: r.importe, ...(o.concepto ? { concepto: o.concepto } : {}) },
      texto: eurosTexto(r.importe),
    });
  }
  if (!o.accion) return fail('invalid_input', 'Esa opción se resuelve en la Revisión.');
  if (o.pide === 'evidencia') {
    if (!r.evidencia || o.accion.tipo !== 'automatico')
      return fail('invalid_input', 'Di con qué se acredita (el certificado, el documento o la experiencia).');
    return ok({ accion: { ...o.accion, evidencia: r.evidencia }, texto: `${o.texto} · ${r.evidencia}` });
  }
  return ok({ accion: o.accion, texto: o.texto });
}

function confirmar(c: ContextoAsistente, p: Pregunta, r: RespuestaEntradaData, f: Firma): Result<RespuestaHecha> {
  const m = mensajeDe(c.dbLic, c.id, r.interpretacion!);
  if (!m || m.tipo !== 'interpretacion' || m.pregunta !== p.clave)
    return fail('not_found', 'No hay ninguna interpretación de Hermes con ese id para esta pregunta.');
  if (m.estado !== 'por_confirmar') return fail('conflicto', 'Esa interpretación ya se confirmó o se rechazó.');
  if (r.rechazar || !m.datos.accion) {
    cambiarEstado(c.dbLic, c.id, m.id, 'rechazada');
    return ok({
      estado: 'rechazada',
      mensaje: 'Descartado: elige una opción o escríbelo de otra forma.',
      version: c.guardadas?.version ?? null,
      avisos: [],
    });
  }
  const hecho = aplicar(c, p, m.datos.accion, {
    version: r.version,
    ...f,
    opcion: m.datos.opcion ?? null,
    texto: m.texto,
  });
  if (!hecho.error) cambiarEstado(c.dbLic, c.id, m.id, 'confirmada');
  return hecho;
}

/** Responde a una pregunta del asistente: guarda por código, lee el texto o se lo pasa a Hermes. */
// Quien firma y con qué rol: el precio solo lo guarda un admin (escribirDecisiones).
type Firma = { quien: string; rol?: Rol };

/** actor: la persona de la sesión, que firma por encima de lo que diga el cuerpo. */
export async function responder(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  entrada: unknown,
  actor?: Actor,
): Promise<Result<RespuestaHecha>> {
  const r = RespuestaEntrada.safeParse(entrada);
  if (!r.success) return fail('invalid_input', z.prettifyError(r.error));
  const actual = decisionesDe(dbLic, id);
  if (actual && r.data.version !== null && actual.version !== r.data.version)
    return fail('conflicto', 'Otra persona guardó decisiones mientras respondías: recarga para ver las suyas.');
  const ps = await preguntasDeOferta(dbLic, dbNucleo, id);
  if (ps.error) return ps;
  const p = ps.data.preguntas.find((x) => x.clave === r.data.pregunta);
  const c = contextoAsistente(dbLic, dbNucleo, id);
  if (!p || !c) return fail('not_found', 'Esa pregunta ya no está en la oferta: recarga.');
  const f: Firma = actor ? { quien: actor.nombre, rol: actor.rol } : { quien: r.data.quien ?? 'web' };
  if (r.data.interpretacion !== undefined) return confirmar(c, p, r.data, f);
  if (r.data.opcion !== undefined) {
    const o = accionDeOpcion(p, r.data);
    return o.error
      ? o
      : aplicar(c, p, o.data.accion, { version: r.data.version, ...f, opcion: r.data.opcion, texto: o.data.texto });
  }
  const texto = r.data.texto!;
  if (p.libre === 'codigo') {
    const a = accionDeTexto(c, p, texto);
    return a.error ? a : aplicar(c, p, a.data, { version: r.data.version, ...f, opcion: null, texto });
  }
  if (p.libre !== 'hermes') return fail('invalid_input', 'Esta pregunta se contesta con una de sus opciones.');
  const libre = anotarHilo(dbLic, id, {
    pregunta: p.clave,
    autor: 'persona',
    tipo: 'libre',
    texto,
    datos: { titulo: p.titulo, seccion: p.seccion },
    estado: 'interpretando',
  });
  const t = encolarInterpretacion(dbNucleo, { id, mensaje: libre.id, pregunta: p.clave });
  if (t.error) {
    cambiarEstado(dbLic, id, libre.id, 'fallida');
    return t;
  }
  return ok({
    estado: 'interpretando',
    mensaje: 'Hermes lo está leyendo: te enseñará lo que entiende para que lo confirmes.',
    version: c.guardadas?.version ?? null,
    avisos: [],
  });
}
