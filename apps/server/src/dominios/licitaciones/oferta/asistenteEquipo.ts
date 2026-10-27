// Preguntas de equipo del asistente: una por rol que exige el pliego y no tiene a nadie en las decisiones.
import { buscarCandidatos, type BuscadorCvs } from '../../../nucleo/colaboradores/busqueda.js';
import type { Candidato } from '../../../nucleo/colaboradores/matching.js';
import { sumarDias, sumarDiasHabiles } from '../../../nucleo/festivos.js';
import { ok } from '../../../nucleo/result.js';
import { textoComparable } from '../temas.js';
import { capital, delLote, recorte, type ContextoAsistente } from './asistenteContexto.js';
import type { MensajeHilo } from './asistenteHilo.js';
import type { Opcion, Pregunta } from './asistenteTipos.js';
import { rolesNombrados } from './coherencia.js';
import { matrizEquipo, type FilaMatriz } from './matrizEquipo.js';

const sinCv: BuscadorCvs = async () => ok([]);
// Ofrece los candidatos de Colaboradores y lo que les falta (la búsqueda por requisito, sin IA) y «Hay que
// contratarlo». Si se elige contratar, se repregunta por código lo que se deriva: si el pliego obliga a nombrarlo
// y cuándo habría que acreditarlo (con la cláusula del guion o, si no la trae, el art. 150.2 LCSP), y se guarda
// como perfil a incorporar.
const CANDIDATOS = 3;
// Desde el cierre hasta que el órgano requiere al propuesto: apertura, valoración y propuesta. Es una
// estimación (la ley no la fija); la fecha se enseña como «hacia el…».
const DIAS_HASTA_REQUERIMIENTO = 30;
const DIAS_LCSP = 10;

type Rol = { clave: string; rol: string; lote: string | null; filas: FilaMatriz[] };

const raizDe = (rol: string): string => rolesNombrados(rol)[0]?.raiz ?? textoComparable(rol).trim();
const claveRol = (rol: string, lote: string | null): string => `${raizDe(rol)}:${lote ?? '-'}`;

// Las filas excluyentes de la matriz con el rol que exige su requisito (las mismas que mira las
// comprobaciones), agrupadas por rol y lote: el mismo rol puede salir de varios requisitos.
function rolesDe(filas: FilaMatriz[]): Rol[] {
  const porClave = new Map<string, Rol>();
  for (const f of filas.filter((x) => x.excluyente && x.exigido)) {
    const clave = claveRol(f.rol, f.lote);
    const r = porClave.get(clave) ?? { clave, rol: f.rol, lote: f.lote, filas: [] };
    r.filas.push(f);
    porClave.set(clave, r);
  }
  return [...porClave.values()];
}

const frase = (t: string): string => t.trim().replace(/[.;:,\s]+$/, '');
const textoRequisitos = (r: Rol): string =>
  `${[...new Set(r.filas.flatMap((f) => [f.requisito, f.valor_exigido ?? ''].map(frase).filter(Boolean)))].join('. ')}.`;
const citasDe = (r: Rol) =>
  r.filas.filter((f) => f.documento).map((f) => ({ documento: f.documento!, pagina: f.pagina }));
const lotesDe = (r: Rol): string[] => (r.lote ? [r.lote] : []);

const ETIQUETA_REGLA: Record<string, string> = {
  anios: 'experiencia',
  titulacion: 'titulación',
  certificacion: 'certificación',
  idioma: 'idioma',
  docencia: 'docencia',
};

// Lo primero que le falta, en una frase: «docencia: 90 de 150 h en inteligencia artificial».
function detalleCandidato(c: Candidato): { detalle: string; tono: Opcion['tono'] } {
  const falla = c.reglas.find((r) => r.resultado === 'no_cumple') ?? c.reglas.find((r) => r.resultado !== 'cumple');
  const sinMateria = c.materias.filter((m) => m.evidencia === null).map((m) => m.materia);
  const ocupada = c.disponibilidad === 'disponible' ? '' : ` · ${c.disponibilidad_motivo}`;
  if (falla)
    return {
      detalle: `${ETIQUETA_REGLA[falla.regla] ?? falla.regla}: ${falla.detalle.replace(/\.$/, '')}${ocupada}`,
      tono: c.cumple_minimos ? 'riesgo' : 'impide',
    };
  if (sinMateria.length)
    return { detalle: `no consta ${sinMateria.map((m) => `«${m}»`).join(', ')}${ocupada}`, tono: 'riesgo' };
  return { detalle: `cumple lo que se puede comprobar${ocupada}`, tono: ocupada ? 'riesgo' : 'ok' };
}

// Lo que propuso Hermes para ese rol (una persona del equipo de su propuesta en el mismo rol y lote).
function propuestoPorHermes(c: ContextoAsistente, r: Rol): number | null {
  const m = c.propuesta?.equipo.find(
    (x) => raizDe(x.rol_en_la_oferta) === raizDe(r.rol) && (!r.lote || !x.lotes.length || x.lotes.includes(r.lote)),
  );
  return m?.persona_id ?? null;
}

async function opcionesDeRol(c: ContextoAsistente, r: Rol): Promise<Opcion[]> {
  const consulta = {
    texto: recorte(textoRequisitos(r), 2000),
    cpvs: c.lotes.ambito.cpvs.filter((x) => /^\d{2,8}$/.test(x)).slice(0, 30),
    limite: CANDIDATOS,
  };
  const encontrados = await buscarCandidatos(c.dbNucleo, consulta, sinCv);
  const req = encontrados.data?.requisitos[0];
  const lista = req
    ? [...req.internos, ...req.externos]
        .sort((a, b) => Number(b.cumple_minimos) - Number(a.cumple_minimos) || b.puntuacion - a.puntuacion)
        .slice(0, CANDIDATOS)
    : [];
  const deHermes = propuestoPorHermes(c, r);
  const personas = lista.map((x): Opcion => ({
    clave: `persona-${x.id}`,
    texto: x.rol ? `${x.nombre} · ${x.rol}` : x.nombre,
    ...detalleCandidato(x),
    hermes: x.id === deHermes,
    accion: { tipo: 'persona', persona_id: x.id, rol: r.rol, lotes: lotesDe(r) },
  }));
  const contratar: Opcion = {
    clave: 'contratar',
    texto: 'Hay que contratarlo',
    detalle: null,
    tono: 'neutro',
    hermes: false,
    accion: { tipo: 'contratar', rol: r.rol, lotes: lotesDe(r) },
  };
  return [...personas, contratar];
}

// Los asignados o el perfil a incorporar, en una línea para «Lo que hay que decidir».
function respuestaDeRol(c: ContextoAsistente, r: Rol): string | null {
  const nombres = [...new Set(r.filas.flatMap((f) => f.asignados.map((a) => a.nombre)))];
  if (nombres.length) return nombres.join(', ');
  if (!r.filas.some((f) => f.a_incorporar)) return null;
  const p = (c.d.a_incorporar ?? []).find((x) => raizDe(x.rol_en_la_oferta) === raizDe(r.rol));
  return `A incorporar${p?.acreditar_antes ? ` · acreditarlo hacia el ${p.acreditar_antes}` : ''}`;
}

// «Hay que contratarlo» sin cerrar: la última respuesta de la pareja equipo/incorporar de ese rol.
function contratando(hilo: MensajeHilo[], r: Rol): boolean {
  const ultima = hilo
    .filter(
      (m) => m.tipo === 'respuesta' && (m.pregunta === `equipo:${r.clave}` || m.pregunta === `incorporar:${r.clave}`),
    )
    .at(-1);
  return ultima?.datos.accion?.tipo === 'contratar';
}

// ── El plazo para acreditar a quien se contrate ──

const NUMEROS: Record<string, number> = { cinco: 5, siete: 7, diez: 10, quince: 15, veinte: 20 };
const DIAS_HABILES = /\b(\d{1,2}|cinco|siete|diez|quince|veinte) dias habiles\b/;
const DE_MEDIOS = /medios|adscripcion|personal|solvencia|documentacion|acredit/;
// El pliego pide identificar a la persona con la oferta: un perfil sin nombre no vale.
const NOMINAL =
  /nombre y apellidos|identificad[oa]s? nominalmente|relacion nominal|de forma nominal|nominativ|curriculum (?:vitae )?(?:firmado|de cada)|aportar(?:a|an|se)? (?:el|los) (?:cv|curriculum)|adjuntar(?:a|an|se)? (?:el|los) (?:cv|curriculum)/;

export type PlazoAcreditacion = {
  plazo: string;
  cita: { documento: string; pagina: number | null; texto: string };
  acreditar_antes: string | null;
};

/** Cuándo habría que acreditar a quien se contrate, si proponen a la empresa: la cláusula del guion o el art. 150.2 LCSP. */
export function plazoAcreditacion(c: Pick<ContextoAsistente, 'guion' | 'licitacion'>): PlazoAcreditacion {
  const docs = c.guion.datos.documentos_adjudicacion ?? [];
  const conDias = docs.filter((d) => DIAS_HABILES.test(textoComparable(d.cuando)));
  const doc = conDias.find((d) => DE_MEDIOS.test(textoComparable(d.nombre))) ?? conDias[0];
  const m = doc ? DIAS_HABILES.exec(textoComparable(doc.cuando)) : null;
  const dias = m ? (NUMEROS[m[1]!] ?? Number(m[1])) : DIAS_LCSP;
  const cierre = c.licitacion.fecha_limite?.slice(0, 10) ?? null;
  return {
    plazo: doc
      ? recorte(doc.cuando, 300)
      : `${DIAS_LCSP} días hábiles desde el requerimiento al propuesto como adjudicatario`,
    cita: doc
      ? { documento: doc.documento, pagina: doc.pagina, texto: recorte(`${doc.nombre}: ${doc.cuando}`, 600) }
      : { documento: 'LCSP', pagina: null, texto: 'artículo 150.2' },
    acreditar_antes: cierre ? sumarDiasHabiles(sumarDias(cierre, DIAS_HASTA_REQUERIMIENTO), dias, null) : null,
  };
}

function preguntaIncorporar(c: ContextoAsistente, r: Rol): Pregunta {
  const requisitos = recorte(textoRequisitos(r), 2000);
  const nominal = NOMINAL.test(textoComparable(requisitos));
  const p = plazoAcreditacion(c);
  const titulo = `${capital(r.rol)}${delLote(r.lote)} a incorporar`;
  const nombrar: Opcion = {
    clave: 'nombrar',
    texto: 'No, prefiero nombrar a alguien',
    detalle: null,
    tono: 'neutro',
    hermes: false,
    accion: { tipo: 'nombrar', rol: r.rol, lotes: lotesDe(r) },
  };
  const base = {
    clave: `incorporar:${r.clave}`,
    seccion: 'incorporar' as const,
    lote: r.lote,
    titulo,
    libre: null,
    estado: 'pendiente' as const,
    respuesta: null,
    deriva_de: `equipo:${r.clave}`,
  };
  if (nominal) {
    return {
      ...base,
      citas: citasDe(r),
      texto: `El pliego pide identificar a la persona con la oferta: un perfil sin nombre puede excluirla. Hay que tenerla antes de presentar. ¿Lo dejo como perfil por cubrir antes del cierre?`,
      opciones: [
        {
          clave: 'incorporar',
          texto: 'Sí, la busco antes del cierre',
          detalle: 'Queda en Equipo › A incorporar con la fecha del cierre',
          tono: 'riesgo',
          hermes: false,
          accion: {
            tipo: 'incorporar',
            rol: r.rol,
            lotes: lotesDe(r),
            requisitos,
            acreditar_antes: c.licitacion.fecha_limite?.slice(0, 10) ?? null,
            plazo: 'antes de presentar: el pliego pide nombrarla',
            cita: null,
          },
        },
        nombrar,
      ],
    };
  }
  const fecha = p.acreditar_antes ? ` Con las fechas del expediente, eso sería hacia el ${p.acreditar_antes}.` : '';
  return {
    ...base,
    citas: [{ documento: p.cita.documento, pagina: p.cita.pagina, texto: p.cita.texto }],
    texto: `El pliego no obliga a nombrarlo en la oferta: basta con comprometer el perfil. Hay que acreditarlo si nos proponen: ${p.plazo}.${fecha} ¿Lo pongo en la memoria y en el anexo de medios como «${r.rol.toLowerCase()} a incorporar», con los requisitos mínimos?`,
    opciones: [
      {
        clave: 'incorporar',
        texto: 'Sí, como perfil a incorporar',
        detalle: 'Queda en Equipo › A incorporar con la fecha para acreditarlo',
        tono: 'ok',
        hermes: false,
        accion: {
          tipo: 'incorporar',
          rol: r.rol,
          lotes: lotesDe(r),
          requisitos,
          acreditar_antes: p.acreditar_antes,
          plazo: p.plazo,
          cita: p.cita,
        },
      },
      nombrar,
    ],
  };
}

/** Una pregunta por rol exigido (la del perfil a incorporar si se está contratando); las cubiertas, hechas. */
export async function preguntasEquipo(c: ContextoAsistente): Promise<Pregunta[]> {
  if (!c.ficha) return [];
  const filas = matrizEquipo({
    requisitos: c.ficha.requisitos,
    decisiones: c.d,
    personas: c.personas,
    lotes: c.ambito,
  });
  const out: Pregunta[] = [];
  for (const r of rolesDe(filas)) {
    const respuesta = respuestaDeRol(c, r);
    if (!respuesta && contratando(c.hilo, r)) {
      out.push(preguntaIncorporar(c, r));
      continue;
    }
    out.push({
      clave: `equipo:${r.clave}`,
      seccion: 'equipo',
      lote: r.lote,
      titulo: `${capital(r.rol)}${delLote(r.lote)}`,
      texto: `${recorte(textoRequisitos(r), 400)} Es excluyente. ¿A quién vas a poner?`,
      citas: citasDe(r),
      opciones: await opcionesDeRol(c, r),
      libre: 'hermes',
      estado: respuesta ? 'hecha' : 'pendiente',
      respuesta,
    });
  }
  return out;
}
