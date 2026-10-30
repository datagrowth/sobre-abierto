// Verificación de la ficha por código: donde la plataforma tiene el dato, el código corrige a Hermes.
import { cifras, type PerfilEmpresaData } from '../../nucleo/empresa.js';
import type { RespuestaCandidatos } from '../../nucleo/colaboradores/busqueda.js';
import { nombresDeMaterias, type Materia } from '../../nucleo/colaboradores/materias.js';
import { mejorVolumen, parsearClasificacion, tieneClasificacion } from './evaluador.js';
import { certificaciones, codigoClasificacion } from './papeles.js';
import { textoComparable, type Cumple } from './temas.js';

// Con el dato (perfil de la empresa, sus notas e idiomas, los colaboradores), el código decide «cumple»; donde
// no lo tiene, manda Hermes. Cada corrección queda a la vista con lo que Hermes decía, la regla y el dato
// usado. Puro salvo la búsqueda de candidatos, que llega como función (la frontera con el núcleo).
// Lo que la verificación necesita de cada requisito (el de la ficha tiene más campos).
export type RequisitoVerificable = {
  tipo: string;
  descripcion: string;
  excluyente: boolean;
  valor_exigido?: string | undefined;
  cumple: Cumple;
  fuente?: string | undefined;
  justificacion: string;
  documento?: string | undefined;
  pagina?: number | undefined;
};

export type Verificacion = {
  indice: number;
  regla: string;
  resultado_ia: Cumple;
  resultado: Cumple;
  fuente: string;
  detalle: string | null;
};
type Decision = { resultado: Cumple; fuente: string; detalle: string | null };

export type ContextoVerificacion = {
  perfil: PerfilEmpresaData | null;
  hoy: Date;
  // Candidatos para los requisitos de medios personales (null: sin colaboradores o sin búsqueda).
  candidatos: (textos: string[]) => Promise<RespuestaCandidatos | null>;
};

const EUROS = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const IMPORTE_MINIMO = 1000;
const ANIOS_NUEVA_CREACION = 5;

const textoDe = (r: RequisitoVerificable) => textoComparable(`${r.descripcion} ${r.valor_exigido ?? ''}`);
const notasDe = (p: PerfilEmpresaData) => textoComparable(p.notas ?? '');
// «Concurre siempre en solitario», «sin subcontratar»: no hay UTE ni subcontratas.
const EN_SOLITARIO = /concurre[^.]{0,20}(solitario|sol[oa]\b)|sin subcontrat|no subcontrat/;

/** El importe exigido si el texto da exactamente uno (con dos, p. ej. uno por lote, no se adivina). */
export function importeExigido(texto: string): number | null {
  const importes = [...new Set(cifras(texto).filter((n) => n >= IMPORTE_MINIMO))];
  return importes.length === 1 ? importes[0]! : null;
}

function solvenciaEconomica(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  const mejor = ctx.perfil ? mejorVolumen(ctx.perfil, ctx.hoy) : null;
  const umbral = importeExigido(r.valor_exigido ?? '');
  if (!mejor || umbral === null) return null;
  return {
    resultado: mejor.importe >= umbral ? 'si' : 'no',
    fuente: `perfil.volumen_negocio ${mejor.anio}: ${EUROS.format(mejor.importe)}`,
    detalle: `Exigido ${EUROS.format(umbral)}; mejor de los tres últimos ejercicios: ${EUROS.format(mejor.importe)} (${mejor.anio}).`,
  };
}

// «No se exige», «NO PROCEDE» (cuadro de características), «no será necesario acreditar»: el
// pliego trata el tema sin pedir nada. «No será necesario aportar/presentar» no cuenta: dice
// cuándo se entrega el documento, no si se exige (una ISO excluyente pasaba a «no aplica»).
const NO_SE_EXIGE =
  /no (se )?(exige|exigid|es exigible|requiere|requerid|es obligatori[ao])|no procede|no (sera|es|resulta) (necesari[oa]|precis[oa]) (acreditar|disponer)|no se (pide|solicita|requerira)\b/;
// Exenciones («el lote 3 está exento», «se dispensa de acreditar»). No cuentan las fiscales
// («exento de IGIC») ni las de una clase de empresas («los empresarios de la UE están exentos
// de clasificación»): no dicen que a la empresa no se le pida.
const EXENTO = /\bexent[oa]s?\b|\bdispens[ae]/;
const EXENCION_AJENA =
  /\b(iva|igic|impuestos?)\b[^.;]{0,15}exent|exent[oa]s? del? (iva|igic|impuesto)|\b(empresa|empresari|licitador|operador)[^.;]{0,80}(exent|dispens)/;
// «No se exige ISO 9001, pero sí el ENS», «ISO 9001 obligatoria; no se exige ENS»: la exención
// es solo de una parte y lo demás sí se pide.
const SALVEDAD = /\b(pero si|salvo|excepto|sin perjuicio)\b/;
// «No será necesario acreditarlo si figura en el ROLECE / hasta la adjudicación»: dispensa con
// condición, el requisito sigue exigido.
const DISPENSA_CONDICIONADA =
  /no (sera|es|resulta) (necesari|precis)[oa] \w+[^.;]{0,80}\b(si|cuando|siempre que|hasta|en el sobre)\b/;
const NO_SE_EXIGE_TODOS = new RegExp(NO_SE_EXIGE.source, 'g');
const SE_PIDE = /\b(se exige|exigira|exigible|obligatori[oa]s?|debera|deberan|se requiere|requerira)\b/;
const NO_APLICA: Decision = { resultado: 'no_aplica', fuente: 'pliego: no se exige', detalle: null };

/** ¿Dice el texto (ya comparable) que no se exige o que se exime, sin salvedades? */
export function exime(texto: string): boolean {
  const exencion = NO_SE_EXIGE.test(texto) || (EXENTO.test(texto) && !EXENCION_AJENA.test(texto));
  return (
    exencion &&
    !SALVEDAD.test(texto) &&
    !DISPENSA_CONDICIONADA.test(texto) &&
    !SE_PIDE.test(texto.replace(NO_SE_EXIGE_TODOS, ''))
  );
}

// Lo que el pliego no pide o exime no cuenta como incumplido. Si Hermes ya lo dio por «no
// aplica», vale también la exención de su justificación: el perfil dice lo que tiene la empresa, no lo
// que se pide (un «Para el LOTE 3 no se exige seguro…» no debe pasar a «no»).
export function eximido(r: RequisitoVerificable): boolean {
  return exime(textoDe(r)) || (r.cumple === 'no_aplica' && exime(textoComparable(r.justificacion)));
}

const SEGURO_RC = /seguro (de )?(responsabilidad|rc\b|indemnizacion|riesgos)|poliza/;

// Solvencia que se acredita con un seguro de RC (p. ej. las empresas de nueva creación): el seguro se contrata si se decide concurrir, así que no tenerlo no descarta.
function solvenciaConSeguro(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  if (r.cumple !== 'no' || !ctx.perfil || ctx.perfil.seguro_rc !== null || !SEGURO_RC.test(textoDe(r))) return null;
  return {
    resultado: 'dudoso',
    fuente: 'perfil.seguro_rc: sin seguro',
    detalle: 'Se acredita con un seguro de responsabilidad civil, que se contrata si se decide concurrir: no descarta.',
  };
}

function seguro(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  if (eximido(r)) return NO_APLICA;
  if (!ctx.perfil) return null;
  const rc = ctx.perfil.seguro_rc;
  const umbral = importeExigido(r.valor_exigido ?? '');
  // Sin importe y con Hermes en duda, no se sabe si el pliego lo pide (a-20430425: pliego
  // ilegible): un «no» contaría como incumplido algo que quizá no se exige.
  if (rc === null && umbral === null && (r.cumple === 'dudoso' || r.cumple === 'no_aplica')) return null;
  if (rc === null)
    return {
      resultado: 'no',
      fuente: 'perfil.seguro_rc: sin seguro',
      detalle: 'No tenemos seguro de responsabilidad civil: se contrata si se decide concurrir (nunca descarta).',
    };
  if (umbral === null) return null;
  return {
    resultado: rc >= umbral ? 'si' : 'no',
    fuente: `perfil.seguro_rc: ${EUROS.format(rc)}`,
    detalle: `Exigido ${EUROS.format(umbral)}.`,
  };
}

const LENGUAS: [string, RegExp][] = [
  ['es', /castellano|espanol/],
  ['en', /ingles/],
  ['ca', /catalan|valencian/],
  ['eu', /euskera|euskara|lengua vasca/],
  ['gl', /gallego|galego/],
  ['fr', /frances/],
  ['de', /aleman/],
  ['pt', /portugues/],
  ['it', /italiano/],
];

// «En castellano o valenciano», «castellano u otra lengua oficial», «cualquiera de las lenguas
// oficiales»: basta una de ellas, no todas (una licitación se descartó por leerlo como «y»).
const NOMBRE_LENGUA = LENGUAS.map(([, re]) => re.source).join('|');
const ALTERNATIVA = new RegExp(
  `(${NOMBRE_LENGUA})\\w*\\s*,?\\s*(o|u|y/o|o bien)\\s+(en\\s+)?(${NOMBRE_LENGUA}|otr[ao])|cualquiera de las (lenguas|idiomas)`,
);

function idioma(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  const t = textoDe(r);
  const pedidas = LENGUAS.filter(([, re]) => re.test(t)).map(([c]) => c);
  if (!pedidas.length || !ctx.perfil) return null;
  const tenemos = new Set(['es', ...ctx.perfil.idiomas]);
  const fuente = `perfil.idiomas: ${[...tenemos].join(', ')}`;
  const alguna = pedidas.find((c) => tenemos.has(c));
  if (alguna && ALTERNATIVA.test(t))
    return { resultado: 'si', fuente, detalle: `Basta una de las lenguas: trabajamos en ${alguna}.` };
  const faltan = pedidas.filter((c) => !tenemos.has(c));
  if (faltan.length)
    return ctx.perfil.idiomas.length
      ? { resultado: 'no', fuente, detalle: `El equipo no trabaja en: ${faltan.join(', ')}.` }
      : null;
  // Un nivel exigido en otra lengua (C1 de inglés) no se puede comprobar con el perfil.
  if (pedidas.some((c) => c !== 'es') && /\b[abc][12]\b|nivel/.test(t)) return null;
  return { resultado: 'si', fuente, detalle: null };
}

function clasificacion(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  if (eximido(r)) return NO_APLICA;
  const codigo = codigoClasificacion(`${r.valor_exigido ?? ''} ${r.descripcion}`);
  const req = codigo ? parsearClasificacion(codigo) : null;
  if (!req || !ctx.perfil) return null;
  const fuente = `perfil.clasificaciones: ${ctx.perfil.clasificaciones.map((c) => `${c.grupo}${c.subgrupo}-${c.categoria}`).join(', ') || 'ninguna'}`;
  return { resultado: tieneClasificacion(ctx.perfil, req) ? 'si' : 'no', fuente, detalle: `Exigida ${codigo}.` };
}

// «No se exige ISO/ENS» nombra certificaciones que la empresa no tiene: sin mirar la exención contaba
// como incumplido.
function certificacion(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  if (eximido(r)) return NO_APLICA;
  const t = `${r.descripcion} ${r.valor_exigido ?? ''}`;
  const pedidas = certificaciones(t).filter((c) => c.clave !== 'partner-fabricante');
  if (!pedidas.length || !ctx.perfil) return null;
  const tenemos = new Set(certificaciones(ctx.perfil.certificaciones.join(' · ')).map((c) => c.clave));
  const faltan = pedidas.filter((c) => !tenemos.has(c.clave));
  if (!faltan.length)
    return {
      resultado: 'si',
      fuente: `perfil.certificaciones: ${ctx.perfil.certificaciones.join(', ')}`,
      detalle: null,
    };
  if (/equivalente/.test(textoComparable(t))) return null;
  const nombres = faltan.map((c) => c.nombre).join(', ');
  const sabemos =
    ctx.perfil.certificaciones.length > 0 || /\bsin\b[^.]{0,40}\b(iso|ens|certificaci)/.test(notasDe(ctx.perfil));
  if (sabemos)
    return {
      resultado: 'no',
      fuente: ctx.perfil.certificaciones.length ? 'perfil.certificaciones' : 'perfil.notas',
      detalle: `No tenemos: ${nombres}.`,
    };
  if (r.cumple !== 'si') return null;
  return {
    resultado: 'dudoso',
    fuente: 'perfil.certificaciones: vacío',
    detalle: `El perfil no lista ${nombres}: si la tenemos, añádela en Ajustes › Empresa.`,
  };
}

function subcontratacion(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  if (!ctx.perfil || !EN_SOLITARIO.test(notasDe(ctx.perfil))) return null;
  // Una obligación de subcontratar (p. ej. un porcentaje con centros especiales) no se cumple yendo solos.
  if (/obligatori|debera subcontratar|deberan subcontratar|al menos (un|el) \d/.test(textoDe(r))) return null;
  return {
    resultado: 'si',
    fuente: 'perfil.notas: concurre en solitario',
    detalle: 'Ejecutamos todo con medios propios.',
  };
}

function ute(_r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  if (!ctx.perfil || !EN_SOLITARIO.test(notasDe(ctx.perfil))) return null;
  return { resultado: 'no_aplica', fuente: 'perfil.notas: concurre en solitario', detalle: null };
}

const INVOCA_NUEVA_CREACION = /nueva creacion|90\.4|articulo 90|art\. ?90/;

function aniosDeActividad(perfil: Pick<PerfilEmpresaData, 'fecha_constitucion'> | null, hoy: Date): number | null {
  const constituida = perfil?.fecha_constitucion ? new Date(perfil.fecha_constitucion) : null;
  return constituida ? (hoy.getTime() - constituida.getTime()) / (365.25 * 86_400_000) : null;
}

/** Si la empresa es de nueva creación (menos de cinco años desde su constitución); null sin la fecha. */
export function esNuevaCreacion(
  perfil: Pick<PerfilEmpresaData, 'fecha_constitucion'> | null,
  hoy = new Date(),
): boolean | null {
  const anios = aniosDeActividad(perfil, hoy);
  return anios === null ? null : anios < ANIOS_NUEVA_CREACION;
}

// La excepción de empresas de nueva creación (art. 90.4 LCSP) solo vale si el pliego la admite
// (con cita) y la empresa tiene menos de cinco años: si no, no se da por cumplido.
function nuevaCreacion(r: RequisitoVerificable, ctx: ContextoVerificacion): Decision | null {
  if (r.cumple !== 'si' || !INVOCA_NUEVA_CREACION.test(textoComparable(`${r.justificacion} ${r.fuente ?? ''}`)))
    return null;
  if (esNuevaCreacion(ctx.perfil, ctx.hoy) === false)
    return {
      resultado: 'dudoso',
      fuente: `perfil.fecha_constitucion: ${ctx.perfil!.fecha_constitucion}`,
      detalle: 'La empresa tiene cinco años o más: la excepción de nueva creación ya no le vale.',
    };
  if (!r.documento || !r.pagina)
    return {
      resultado: 'dudoso',
      fuente: 'ficha sin cita',
      detalle: 'Invoca la excepción de empresas de nueva creación sin citar la cláusula del pliego que la admite.',
    };
  return null;
}

const REGLAS: Record<string, ((r: RequisitoVerificable, ctx: ContextoVerificacion) => Decision | null)[]> = {
  solvencia_economica: [solvenciaConSeguro, solvenciaEconomica],
  seguro: [seguro],
  idioma: [idioma],
  clasificacion: [clasificacion],
  certificacion: [certificacion],
  habilitacion: [certificacion],
  subcontratacion: [subcontratacion],
  ute: [ute],
  solvencia_tecnica: [nuevaCreacion],
  experiencia: [nuevaCreacion],
};

type Candidatos = RespuestaCandidatos['requisitos'][number];
type Candidato = Candidatos['internos'][number];

// Varios perfiles en un requisito («cinco personas distintas», «un director y un técnico»,
// «cuatro monitores», «coordinadores»): que una persona acredite la materia no basta para
// darlo por cumplido. Sobredetectar solo deja el requisito en duda, nunca lo sube a «sí».
const ROLES =
  'personas|perfiles|tecnicos|profesionales|analistas|consultores|programadores|expertos|formadores|docentes|tutores|monitores|coordinadores|directores|gestores|responsables|auxiliares|oficiales|operarios';
// Sustantivos de persona por terminación («clientes», «estudiantes»), sin los adjetivos que
// comparten sufijo («mayores», «superiores»).
// Tampoco los plurales que no son equipo («expedientes», «clientes», «pacientes»).
const NO_EQUIPO =
  'mayores|menores|superiores|inferiores|anteriores|posteriores|interiores|expedientes|componentes|restaurantes|clientes|pacientes|estudiantes|asistentes|visitantes|residentes|solicitantes|participantes|ingredientes|proveedores|licitadores|errores|valores|sectores|factores|indicadores|servidores|ordenadores|sensores|motores';
const PERSONA_PLURAL = String.raw`(?:${ROLES}|(?!(?:${NO_EQUIPO})\b)[a-z]+(?:ores|oras|istas|entes|antes))`;
const ROL_SINGULAR =
  'tecnico|director|coordinador|responsable|auxiliar|analista|consultor|gestor|formador|docente|tutor|monitor|jefe|programador|experto|profesional|oficial|operario|especialista|ingeniero|administrativo|persona|perfil';
// Un rol en plural tras «de», «a», «y»… es el objeto («formación de formadores», «atención a
// personas mayores»), no un equipo que se pide.
const OBJETO = String.raw`(?<!\b(?:de|del|a|al|y|o|e|u|en|con|para|sobre|entre)\s)`;
const VARIOS_PERFILES = new RegExp(
  [
    String.raw`\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+${PERSONA_PLURAL}\b`,
    String.raw`\b(un|una)\s+[a-z/]+(?:\s+[a-z/]+){0,2}\s+y\s+(un|una)\s+[a-z]+`,
    String.raw`\b(un|una)\s+(?:${ROL_SINGULAR})\b[^.;]{0,100}?\s+y\s+(un|una)\s+(?:${ROL_SINGULAR})\b`,
    String.raw`${OBJETO}\b(?:${ROLES})\b`,
  ].join('|'),
);
const enumerar = (xs: string[]) => xs.slice(0, 4).join(', ') + (xs.length > 4 ? ` y ${xs.length - 4} más` : '');

// Un «sí» exige haber comprobado todas las reglas leídas: cumple_minimos es true también con
// reglas «desconocido» (años o titulación sin registrar) o «parcial».
const comprobado = (c: Candidato) => c.cumple_minimos && c.reglas.every((x) => x.resultado === 'cumple');

// Una persona acredita la materia de un requisito en duda: sube a «sí» solo si pide un único
// perfil y sus mínimos están comprobados; si no, sigue «dudoso» con la persona propuesta.
function decisionConPropuesta(r: RequisitoVerificable, c: Candidato, materias: Materia[]): Decision {
  const fuente = `colaboradores: acredita ${c.nombre}`;
  const pruebas = materias.map((m, i) => `«${m.texto}» (${c.materias[i]?.evidencia})`).join('; ');
  const pendientes = c.reglas.filter((x) => x.resultado !== 'cumple').map((x) => `${x.exigido} (${x.detalle})`);
  if (VARIOS_PERFILES.test(textoDe(r)))
    return {
      resultado: 'dudoso',
      fuente,
      detalle: `${c.nombre} tiene registrado lo que pide el pliego (${pruebas}), pero el requisito parece pedir varios perfiles: una persona no los cubre (ver Equipo).`,
    };
  if (pendientes.length)
    return {
      resultado: 'dudoso',
      fuente,
      detalle: `${c.nombre} tiene registrado lo que pide el pliego (${pruebas}), pero falta comprobar: ${pendientes.join('; ')}. Revisa su CV.`,
    };
  return {
    resultado: 'si',
    fuente,
    detalle: `${c.nombre} cumple los mínimos y tiene registrado lo que pide el pliego: ${pruebas}. Revisa su CV.`,
  };
}

// La materia concreta que pide el pliego («≥5 años en monitorización de medios», «30 h de
// formación en teleformación») solo la acredita quien la tiene registrada, nunca los años
// totales (tres licitaciones reales subieron a «sí» así). Si nadie de los listados
// las cubre, un «sí» baja a «dudoso» diciendo qué falta y quién no llega; con la lista vacía o
// recortada no se concluye «nadie»: pudo quedar fuera quien la acredita.
function mediosPorMateria(r: RequisitoVerificable, res: Candidatos): Decision | null {
  const materias = res.requisito.materias;
  const todos = [...res.internos, ...res.externos];
  const aptos = todos.filter((c) => c.cumple_minimos);
  const acredita = (c: Candidato, i: number) => c.materias[i]?.evidencia ?? null;
  const sinCubrir = materias.filter((_, i) => !aptos.some((c) => acredita(c, i)));
  const cubre = (c: Candidato) => materias.every((_, i) => acredita(c, i));
  const completo =
    (r.cumple === 'dudoso' ? aptos.find((c) => comprobado(c) && cubre(c)) : undefined) ?? aptos.find(cubre);
  if (completo && r.cumple === 'dudoso') return decisionConPropuesta(r, completo, materias);
  if (completo && r.cumple === 'no')
    return {
      resultado: 'dudoso',
      fuente: `colaboradores: acredita ${completo.nombre}`,
      detalle: `${completo.nombre} tiene registrado lo que pide el pliego: comprueba si cubre lo demás (ver Equipo).`,
    };
  if (!res.activos || res.recortado || !sinCubrir.length || r.cumple !== 'si') return null;
  const faltan = nombresDeMaterias(sinCubrir);
  const quien = aptos.length
    ? ` ${enumerar(aptos.map((c) => c.nombre))} ${aptos.length === 1 ? 'cumple' : 'cumplen'} los años o la titulación, pero no lo ${aptos.length === 1 ? 'tiene' : 'tienen'} registrado.`
    : '';
  return {
    resultado: 'dudoso',
    fuente: `colaboradores: nadie acredita ${faltan}`,
    detalle: `El pliego pide ${faltan} y ningún colaborador lo tiene registrado (sectores, tecnologías, certificaciones o titulaciones): los años totales no lo acreditan.${quien} Falta quien lo acredite (ver Equipo).`,
  };
}

// Los mínimos leídos (años, titulación, certificación, idioma) son necesarios, no suficientes.
// Sin materia concreta que comprobar, el código solo baja a dudoso, nunca sube a sí.
function mediosPersonales(r: RequisitoVerificable, res: Candidatos): Decision | null {
  const leido = res.requisito;
  if (leido.materias.length) return mediosPorMateria(r, res);
  const hayReglas =
    leido.anios_minimos !== null ||
    leido.titulacion !== null ||
    leido.certificaciones.length > 0 ||
    leido.idiomas.length > 0;
  const todos = [...res.internos, ...res.externos];
  if (!hayReglas || !todos.length) return null;
  const cumplen = todos.filter((c) => c.cumple_minimos).length;
  const fuente = `colaboradores: ${cumplen} de ${todos.length} cumplen los mínimos leídos`;
  if (cumplen && r.cumple === 'no')
    return {
      resultado: 'dudoso',
      fuente,
      detalle:
        'Hay colaboradores que cumplen los mínimos leídos: comprueba si cubren lo demás que pide el pliego (ver Equipo).',
    };
  if (!cumplen && r.cumple === 'si')
    return {
      resultado: 'dudoso',
      fuente,
      detalle: 'Ningún colaborador cumple los mínimos leídos del requisito (ver Equipo).',
    };
  return null;
}

async function verificarMedios(
  requisitos: RequisitoVerificable[],
  ctx: ContextoVerificacion,
): Promise<Map<number, Decision>> {
  const indices = requisitos.flatMap((r, i) => (r.tipo === 'medios_personales' ? [i] : []));
  const out = new Map<number, Decision>();
  if (!indices.length) return out;
  const res = await ctx.candidatos(
    indices.map((i) => [requisitos[i]!.descripcion, requisitos[i]!.valor_exigido].filter(Boolean).join('. ')),
  );
  indices.forEach((i, n) => {
    const d = res?.requisitos[n] ? mediosPersonales(requisitos[i]!, res.requisitos[n]) : null;
    if (d) out.set(i, d);
  });
  return out;
}

// Lo que dice que falta la prueba. «No consta ninguna prohibición» no: es la prueba de un «sí».
const SIN_EVIDENCIA = new RegExp(
  [
    String.raw`\bno (esta |estan |queda |quedan |ha sido |han sido |se ha |se han )?(verificad|comprobad|acreditad|confirmad)`,
    String.raw`\bno (se )?(ha |han )?podido (verificar|comprobar|acreditar|confirmar)`,
    String.raw`\bno (se )?confirma\b`,
    String.raw`\bsin (verificar|comprobar|acreditar|confirmar|acreditacion|evidencia)`,
    String.raw`\bpendientes? de (verificar|comprobar|acreditar|confirmar|acreditacion|verificacion|confirmacion)`,
    String.raw`\bpor (verificar|comprobar|acreditar|confirmar)\b`,
    String.raw`\bfalta(ria)? (por )?(verificar|comprobar|acreditar|confirmar)`,
    String.raw`\bno consta(n)?\b(?![^.;]{0,40}\b(ningun|ninguna|prohibicion|sancion|deuda|incumplimiento|inhabilitacion|impedimento|incompatibilidad)\b)`,
  ].join('|'),
);

// Un «sí» que su propia justificación no acredita (p. ej. tutores en «sí»
// con «la búsqueda no confirma … las horas online»): queda en duda hasta que alguien lo
// acredite. Solo donde el código no tiene el dato: si lo tiene, decide él.
function sinEvidencia(r: RequisitoVerificable): Decision | null {
  if (r.cumple !== 'si') return null;
  const frase = SIN_EVIDENCIA.exec(textoComparable(r.justificacion))?.[0];
  if (!frase) return null;
  return {
    resultado: 'dudoso',
    fuente: 'ficha: justificación sin acreditar',
    detalle: `Pero su justificación dice «${frase}»: falta acreditarlo.`,
  };
}

// «Falta confirmar la casilla del apartado» (p. ej. la subcontratación): lo que la propia ficha
// dice que está por confirmar no sale «Cumple», ni aunque una regla del perfil lo diera por
// cumplido («concurre en solitario» no dice si el pliego prohíbe subcontratar). Un «no» del
// código con el dato sí manda.
const FALTA_CONFIRMAR = /\b(falta(ria)?( por)?|por|pendientes? de) confirmar/;
const POR_CONFIRMAR: Decision = {
  resultado: 'dudoso',
  fuente: 'ficha: falta confirmar',
  detalle: 'La ficha dice que falta confirmarlo: no se da por cumplido.',
};

function porConfirmar(r: RequisitoVerificable, d: Decision | null): boolean {
  return (
    r.cumple === 'si' && (d === null || d.resultado === 'si') && FALTA_CONFIRMAR.test(textoComparable(r.justificacion))
  );
}

function decidir(
  r: RequisitoVerificable,
  medio: Decision | undefined,
  ctx: ContextoVerificacion,
): { regla: string; d: Decision } | null {
  const regla = medio ? 'medios_personales' : r.tipo;
  const d = medio ?? (REGLAS[r.tipo] ?? []).map((f) => f(r, ctx)).find((x) => x !== null) ?? null;
  if (porConfirmar(r, d)) return { regla: 'falta_confirmar', d: POR_CONFIRMAR };
  if (d) return { regla, d };
  const e = sinEvidencia(r);
  return e ? { regla: 'evidencia', d: e } : null;
}

/**
 * Requisitos con el «cumple» que decide el código donde tiene el dato, y la lista de lo que
 * cambió respecto a Hermes. Lo que el código no puede comprobar queda como lo dejó Hermes,
 * salvo un «sí» cuya justificación dice que falta acreditarlo.
 */
export async function verificarRequisitos<R extends RequisitoVerificable>(
  requisitos: R[],
  ctx: ContextoVerificacion,
): Promise<{ requisitos: R[]; verificaciones: Verificacion[] }> {
  const medios = await verificarMedios(requisitos, ctx);
  const verificaciones: Verificacion[] = [];
  const corregidos = requisitos.map((r, indice) => {
    const decision = decidir(r, medios.get(indice), ctx);
    if (!decision) return r;
    const { regla, d } = decision;
    verificaciones.push({
      indice,
      regla,
      resultado_ia: r.cumple,
      resultado: d.resultado,
      fuente: d.fuente,
      detalle: d.detalle,
    });
    return { ...r, cumple: d.resultado, fuente: d.fuente };
  });
  return { requisitos: corregidos, verificaciones };
}
