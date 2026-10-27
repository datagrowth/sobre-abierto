// Chequeos deterministas del documento ensamblado, antes de que lo lea el crítico. Puro, sobre el Markdown.
import { MAX_RATIFICACIONES, ratificacionesEn } from './aplazamientos.js';
import { repeticionesEn } from './repeticion.js';

// El crítico juzgaba el texto de cada apartado suelto y nunca vio lo que la mesa sí ve en el Word: la numeración
// «1.1 1.1», la misma frase o la misma etiqueta de rol 40 veces y el mismo «CASO-01» en todos los apartados. Lo
// que se mide por código se le da medido, para que lo lleve a sus motivos en vez de tener que encontrarlo.
// coste: un compromiso caro que el pliego no exige (compromisosMemoriaCoste.ts, si hay proveedor).
type TipoChequeo = 'numeracion' | 'repeticion' | 'identificador' | 'ratificacion' | 'coste';
export type Chequeo = { tipo: TipoChequeo; apartado: number | null; texto: string };

// Un identificador de caso o ejemplo («CASO-01», «», «EJ_2»): el hilo común de la memoria va
// en el mockup; en más apartados se lee como el mismo ejemplo repetido. Si detrás sigue otro
// número («EXP-2026-0123»), es el número de un expediente, que se cita igual en toda la memoria.
const IDENTIFICADOR = /\b(?:CASO|CASE|EXP|EJ|EJEMPLO)[-_]\d{1,4}\b(?![-_/.]\d)/gi;
const MAX_APARTADOS_IDENTIFICADOR = 2;

export type Seccion = { apartado: number | null; texto: string };

/** El documento por apartados («## N. Título»); lo de antes (portada, índice, guía) va sin número. */
export function secciones(md: string): Seccion[] {
  const out: Seccion[] = [{ apartado: null, texto: '' }];
  for (const linea of md.split('\n')) {
    const m = /^## (\d{1,2})\. /.exec(linea);
    if (m) out.push({ apartado: Number(m[1]), texto: '' });
    out.at(-1)!.texto += `${linea}\n`;
  }
  return out;
}

// Como en docx.ts (NUMERACION_PROPIA): detrás del segundo número va el título en mayúscula; «3.2
// 24.7 horas de cobertura» es un número de sección seguido de una cifra, no dos numeraciones.
const DOBLE = /^#{2,4}\s+(\d{1,2}(?:\.\d{1,2})*)\.?\s+(\d{1,2}(?:\.\d{1,2})+)[.)]?\s+(?=\p{Lu})/u;

function numeracion(ss: Seccion[]): Chequeo[] {
  const vistos = new Map<string, number>();
  const out: Chequeo[] = [];
  for (const s of ss) {
    for (const linea of s.texto.split('\n')) {
      const doble = DOBLE.exec(linea);
      if (doble)
        out.push({
          tipo: 'numeracion',
          apartado: s.apartado,
          texto: `Numeración duplicada en el título «${linea.replace(/^#+\s*/, '')}».`,
        });
      const num = /^###\s+(\d{1,2}\.\d{1,2})\s/.exec(linea)?.[1];
      if (num) vistos.set(num, (vistos.get(num) ?? 0) + 1);
    }
  }
  const repetidos = [...vistos.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  return [
    ...out,
    ...repetidos.map((k) => ({
      tipo: 'numeracion' as const,
      apartado: Number(k.split('.')[0]),
      texto: `El número de sección ${k} sale más de una vez.`,
    })),
  ];
}

function repeticiones(ss: Seccion[]): Chequeo[] {
  const conNumero = ss.filter((s): s is Seccion & { apartado: number } => s.apartado !== null);
  const textos: string[] = [];
  for (const s of conNumero) textos[s.apartado - 1] = s.texto;
  return repeticionesEn(Array.from(textos, (t) => t ?? '')).map((r) => ({
    tipo: 'repeticion',
    apartado: r.apartado,
    texto: `La frase «${r.frase}» sale ${r.veces} veces en el documento (la primera, en el apartado ${r.apartado}).`,
  }));
}

function identificadores(ss: Seccion[]): Chequeo[] {
  const donde = new Map<string, Set<number>>();
  for (const s of ss) {
    if (s.apartado === null) continue;
    for (const m of s.texto.matchAll(IDENTIFICADOR)) {
      const id = m[0].toUpperCase();
      donde.set(id, (donde.get(id) ?? new Set()).add(s.apartado));
    }
  }
  return [...donde.entries()]
    .filter(([, aps]) => aps.size > MAX_APARTADOS_IDENTIFICADOR)
    .map(([id, aps]) => ({
      tipo: 'identificador',
      apartado: Math.min(...aps),
      texto: `El identificador «${id}» se repite en los apartados ${[...aps].sort((a, b) => a - b).join(', ')}: el mismo ejemplo en varios apartados.`,
    }));
}

// La fórmula de ratificación posterior repetida en un apartado: los jueces la leen como aplazamiento.
function ratificaciones(ss: Seccion[]): Chequeo[] {
  return ss.flatMap((s) => {
    const hallados = s.apartado === null ? [] : ratificacionesEn(s.texto);
    return hallados.length > MAX_RATIFICACIONES
      ? [
          {
            tipo: 'ratificacion' as const,
            apartado: s.apartado,
            texto: `Deja ${hallados.length} decisiones a una ratificación posterior del órgano (p. ej. «${hallados[0]!.slice(0, 160)}»): se lee como aplazamiento.`,
          },
        ]
      : [];
  });
}

/** Numeración duplicada, frases repetidas, identificadores de caso repetidos y ratificaciones repetidas en el documento ensamblado (Markdown). */
export function chequeosDelDocumento(md: string): Chequeo[] {
  const ss = secciones(md);
  return [...numeracion(ss), ...repeticiones(ss), ...identificadores(ss), ...ratificaciones(ss)];
}

/** Los chequeos como cabecera de la parte «documento» del paquete ciego. */
export function textoDeChequeos(cs: Chequeo[]): string {
  const cabecera =
    'COMPROBACIONES AUTOMÁTICAS DEL DOCUMENTO (las hizo la plataforma antes de tu lectura; cada una es un defecto de forma que la mesa ve: llévala a «motivos_para_bajar» del apartado donde está, con una cita literal):';
  return [
    cabecera,
    ...(cs.length ? cs.map((c) => `- ${c.apartado ? `Apartado ${c.apartado}: ` : ''}${c.texto}`) : ['- Ninguna.']),
  ].join('\n');
}
