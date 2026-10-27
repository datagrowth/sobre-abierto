// Búsqueda de notas por texto en título, ruta, cuerpo y frontmatter, con puntuación y fragmento de contexto.
import { listarNotas, leerNota } from './notas.js';
import { normalizarTexto, tokenizar } from './texto.js';

export type ResultadoBusqueda = {
  path: string;
  title: string;
  score: number;
  snippet: string;
  matched_in: ('title' | 'path' | 'body' | 'frontmatter')[];
};

const RADIO_FRAGMENTO = 60;
const MAX_LONGITUD_CONSULTA = 200;

function construirFragmento(cuerpo: string, buscado: string): string {
  const cuerpoNormalizado = normalizarTexto(cuerpo);
  const posicion = cuerpoNormalizado.indexOf(normalizarTexto(buscado));
  if (posicion === -1)
    return cuerpo
      .slice(0, RADIO_FRAGMENTO * 2)
      .replace(/\s+/g, ' ')
      .trim();
  const inicio = Math.max(0, posicion - RADIO_FRAGMENTO);
  const fin = Math.min(cuerpo.length, posicion + buscado.length + RADIO_FRAGMENTO);
  let fragmento = cuerpo.slice(inicio, fin).replace(/\s+/g, ' ').trim();
  if (inicio > 0) fragmento = '…' + fragmento;
  if (fin < cuerpo.length) fragmento = fragmento + '…';
  return fragmento;
}

function textoFrontmatter(fm: Record<string, unknown>): string {
  return Object.values(fm)
    .map((v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      try {
        return JSON.stringify(v);
      } catch {
        return '';
      }
    })
    .join(' ');
}

// Pesos: un match de frase completa (query contigua) vale más que términos sueltos.
const PESO_FRASE = { title: 10, path: 4, frontmatter: 5, body: 2 } as const;
const PESO_TERMINO = { title: 6, path: 2, frontmatter: 3, body: 1 } as const;

export async function buscarNotas(consultaCruda: string, limite = 20): Promise<ResultadoBusqueda[]> {
  const consulta = consultaCruda.trim().slice(0, MAX_LONGITUD_CONSULTA);
  if (consulta.length < 2) return [];

  const terminos = tokenizar(consulta);
  if (terminos.length === 0) return [];
  const frase = normalizarTexto(consulta);
  // La frase solo aporta señal extra cuando hay varios términos; con un único
  // término, frase y término coinciden y contarían doble.
  const usarFrase = terminos.length > 1;

  const todas = await listarNotas();
  const aciertos: ResultadoBusqueda[] = [];
  const limiteSeguro = Number.isFinite(limite) && limite > 0 && limite <= 100 ? Math.floor(limite) : 20;

  for (const resumen of todas) {
    let puntuacion = 0;
    const coincide = new Set<ResultadoBusqueda['matched_in'][number]>();
    let fragmento = '';

    const tituloNormalizado = normalizarTexto(resumen.title);
    const rutaNormalizada = normalizarTexto(resumen.path);

    // Términos individuales en título y ruta.
    const terminosEnTituloRuta = new Set<string>();
    for (const termino of terminos) {
      if (tituloNormalizado.includes(termino)) {
        puntuacion += PESO_TERMINO.title;
        coincide.add('title');
        terminosEnTituloRuta.add(termino);
      }
      if (rutaNormalizada.includes(termino)) {
        puntuacion += PESO_TERMINO.path;
        coincide.add('path');
        terminosEnTituloRuta.add(termino);
      }
    }
    // Bonus por frase completa contigua en título/ruta.
    if (usarFrase && tituloNormalizado.includes(frase)) {
      puntuacion += PESO_FRASE.title;
      coincide.add('title');
    }
    if (usarFrase && rutaNormalizada.includes(frase)) {
      puntuacion += PESO_FRASE.path;
      coincide.add('path');
    }

    // Leemos el cuerpo/frontmatter salvo que el título/ruta ya cubran todos los
    // términos (short-circuit para hits fuertes de título).
    const necesitaCuerpo =
      terminosEnTituloRuta.size < terminos.length || (usarFrase && !tituloNormalizado.includes(frase));
    if (necesitaCuerpo) {
      let nota;
      try {
        nota = await leerNota(resumen.path);
      } catch {
        if (puntuacion > 0) {
          aciertos.push({
            path: resumen.path,
            title: resumen.title,
            score: puntuacion,
            snippet: fragmento || resumen.path,
            matched_in: [...coincide],
          });
        }
        continue;
      }
      const cuerpoPlegado = normalizarTexto(nota.body);
      const frontmatterNormalizado = normalizarTexto(textoFrontmatter(nota.frontmatter));

      for (const termino of terminos) {
        if (cuerpoPlegado.includes(termino)) {
          puntuacion += PESO_TERMINO.body;
          coincide.add('body');
          if (!fragmento) fragmento = construirFragmento(nota.body, termino);
        }
        if (frontmatterNormalizado.includes(termino)) {
          puntuacion += PESO_TERMINO.frontmatter;
          coincide.add('frontmatter');
        }
      }
      if (usarFrase && cuerpoPlegado.includes(frase)) {
        puntuacion += PESO_FRASE.body;
        coincide.add('body');
        if (!fragmento) fragmento = construirFragmento(nota.body, consulta);
      }
      if (usarFrase && frontmatterNormalizado.includes(frase)) {
        puntuacion += PESO_FRASE.frontmatter;
        coincide.add('frontmatter');
      }

      if (coincide.has('title') && !fragmento) fragmento = construirFragmento(nota.body, terminos[0] ?? consulta);
    }

    if (puntuacion > 0) {
      aciertos.push({
        path: resumen.path,
        title: resumen.title,
        score: puntuacion,
        snippet: fragmento || resumen.path,
        matched_in: [...coincide],
      });
    }
  }

  aciertos.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return aciertos.slice(0, limiteSeguro);
}
