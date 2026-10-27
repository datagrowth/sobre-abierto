// Poda del pliego técnico en el dossier: los anexos prospectivos o fuera del objeto quedan en una línea.
import { textoComparable } from '../temas.js';
import { comoLeer, type DocumentoLeido } from './dossierTexto.js';

// Los anexos que el propio pliego declara prospectivos o fuera del objeto (fases futuras) no se puntúan y
// ocupaban una cuarta parte del dossier; quedan en una línea con su ruta, por si hay que leerlos. «Informativo»
// u «orientativo» solos no bastan: así marcan los pliegos el inventario actual, las volumetrías o la
// arquitectura existente, que es justo lo que dimensiona la solución.
const ENCABEZADO = /^\s*anexo\s+([ivxlc]+|\d+)\b/i;
// Tras «Anexo N», un encabezado acaba ahí, sigue con «.», «:» o un guion, o con un título en
// mayúscula. «Anexo I, a título informativo.» o «Anexo 2 es…» es una frase partida, no el anexo.
const TRAS_EL_NUMERO = /^\s*(?:$|[.:\-–—]|\p{Lu})/u;
// «ANEXO 1. ....... 15» o «ANEXO 1. 15»: una línea del índice, no el anexo.
const DEL_INDICE = /(?:\.{3,}|\s\d{1,3})\s*$/;
const PROSPECTIVO =
  /prospectiv|fases? futuras?|futuras? fases|fuera del (?:objeto|alcance)|no forma(?:n)? parte del (?:objeto|alcance)|no (?:es|son) objeto del? (?:este |presente )?contrato/;
const ANTES = 80;
const DESPUES = 160;

type Posicion = { pagina: number; linea: number };
type Encabezado = Posicion & { id: string; titulo: string };
export type AnexoPodado = { titulo: string; paginas: number[] };

function esEncabezado(l: string): boolean {
  const resto = l.trim().replace(ENCABEZADO, '');
  return l.trim().length <= 140 && TRAS_EL_NUMERO.test(resto) && !DEL_INDICE.test(resto);
}

// Un encabezado pegado a otro de otro anexo es una entrada del índice: el anexo real tiene texto.
function enIndice(e: Encabezado, todos: Encabezado[], ls: string[]): boolean {
  const vecina = (paso: number) => {
    let i = e.linea + paso;
    while (i >= 0 && i < ls.length && !ls[i]!.trim()) i += paso;
    return todos.find((x) => x.pagina === e.pagina && x.linea === i);
  };
  return [vecina(-1), vecina(1)].some((x) => x !== undefined && x.id !== e.id);
}

// Cada anexo empieza en la ÚLTIMA aparición de su encabezado: las anteriores son el índice
// (también sin números de página). Las repeticiones seguidas del mismo anexo (su cabecera en
// cada página) cuentan como una sola, la primera.
function encabezados(lineas: [number, string[]][]): Encabezado[] {
  const todos = lineas.flatMap(([pagina, ls]) =>
    ls.flatMap((l, linea) => {
      const m = ENCABEZADO.exec(l);
      return m && esEncabezado(l) ? [{ pagina, linea, id: m[1]!.toLowerCase(), titulo: l.trim() }] : [];
    }),
  );
  const reales = todos.filter((e) => !enIndice(e, todos, lineas.find(([n]) => n === e.pagina)![1]));
  const inicios = reales.filter((e, k) => k === 0 || reales[k - 1]!.id !== e.id);
  return inicios.filter((e, k) => !inicios.slice(k + 1).some((x) => x.id === e.id));
}

const OTRO_ANEXO = /\banexo\s+(?:[ivxlc]+|\d+)\b/g;

// Lo que rodea una cita del anexo en su misma línea, sin llegar a la cita de otro anexo: en un
// índice («ANEXO 2. 16» y debajo «el Anexo 1 … orientativo») lo de uno no se le pega al otro.
function entorno(completo: string, desde: number, hasta: number): string {
  const antes = completo.slice(Math.max(0, desde - ANTES), desde);
  const inicioAntes = Math.max(
    antes.lastIndexOf('\n') + 1,
    ...[...antes.matchAll(OTRO_ANEXO)].map((m) => m.index + m[0].length),
  );
  const despues = completo.slice(hasta, hasta + DESPUES);
  const corte = despues.search(/\n|\banexo\s+(?:[ivxlc]+|\d+)\b/);
  return `${antes.slice(inicioAntes)} ${corte >= 0 ? despues.slice(0, corte) : despues}`;
}

// ¿El pliego dice de este anexo que es prospectivo o ajeno al objeto? En la frase que lo cita o al empezar el anexo.
function esProspectivo(completo: string, id: string, inicio: string): boolean {
  const cita = new RegExp(String.raw`anexo\s+${id}\b`, 'g');
  for (const m of completo.matchAll(cita)) {
    if (PROSPECTIVO.test(entorno(completo, m.index, m.index + m[0].length))) return true;
  }
  return PROSPECTIVO.test(inicio);
}

const antes = (a: Posicion, b: Posicion) => a.pagina < b.pagina || (a.pagina === b.pagina && a.linea < b.linea);

/**
 * El documento sin sus anexos prospectivos: cada uno, desde su encabezado hasta el siguiente
 * anexo (o el final), se cambia por una línea que dice qué es y dónde leerlo.
 */
export function podarAnexos(doc: DocumentoLeido): { doc: DocumentoLeido; podados: AnexoPodado[] } {
  const lineas: [number, string[]][] = [...doc.paginas.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, t]) => [n, t.split('\n')]);
  const todos = encabezados(lineas);
  const completo = textoComparable(lineas.map(([, ls]) => ls.join('\n')).join('\n'));
  const fuera = todos.flatMap((e, k) => {
    const fin = todos[k + 1] ?? null;
    const inicio = textoComparable(
      lineas
        .find(([n]) => n === e.pagina)![1]
        .slice(e.linea, e.linea + 8)
        .join('\n'),
    );
    return esProspectivo(completo, e.id, inicio) ? [{ e, fin }] : [];
  });
  if (!fuera.length) return { doc, podados: [] };
  const dentro = (p: Posicion) => fuera.find(({ e, fin }) => !antes(p, e) && (!fin || antes(p, fin)));
  const podados = fuera.map(({ e, fin }) => ({
    titulo: e.titulo,
    paginas: lineas.map(([n]) => n).filter((n) => n >= e.pagina && (!fin || n <= fin.pagina)),
  }));
  const paginas = new Map<number, string>();
  for (const [pagina, ls] of lineas) {
    const quedan = ls.flatMap((l, linea) => {
      const a = dentro({ pagina, linea });
      if (!a) return [l];
      if (a.e.pagina !== pagina || a.e.linea !== linea) return [];
      const podado = podados[fuera.indexOf(a)]!;
      return [
        `[${a.e.titulo}: anexo prospectivo o fuera del objeto del contrato; no va en el dossier: ${comoLeer(doc, podado.paginas)}]`,
      ];
    });
    if (quedan.some((l) => l.trim())) paginas.set(pagina, quedan.join('\n'));
  }
  return { doc: { ...doc, paginas }, podados };
}
