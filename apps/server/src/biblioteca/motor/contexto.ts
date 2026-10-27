// Contexto para Hermes: reúne las notas y pasajes de documentos más relevantes para una consulta.
import { buscarEnBiblioteca, type ResultadoBiblioteca, type Pasaje } from './documentos/busquedaHibrida.js';
import { leerNota, type Nota } from './notas.js';

export type OpcionesContexto = {
  limit?: number;
  include_body?: boolean;
  include_frontmatter?: boolean;
  body_max_chars?: number;
  /** Solo notas y documentos dentro de esta carpeta de la Biblioteca. */
  folder?: string;
  /** Nada de lo que está en estas carpetas (p. ej. los CV, para quien no puede verlos). */
  exclude_folders?: readonly string[];
};

export type ElementoContexto = {
  path: string;
  title: string;
  kind: ResultadoBiblioteca['kind'];
  score: number;
  snippet: string;
  matched_in: ResultadoBiblioteca['matched_in'];
  frontmatter?: Record<string, unknown>;
  body?: string;
  body_truncated?: boolean;
};

export type ResultadoContexto = {
  query: string;
  meta: {
    total_hits: number;
    returned: number;
    limit: number;
    include_body: boolean;
    include_frontmatter: boolean;
  };
  items: ElementoContexto[];
  context_md: string;
};

const VALORES_POR_DEFECTO: Required<Omit<OpcionesContexto, 'body_max_chars' | 'folder' | 'exclude_folders'>> & {
  body_max_chars: number;
} = {
  limit: 5,
  include_body: true,
  include_frontmatter: true,
  body_max_chars: 4000,
};

function frontmatterAYaml(fm: Record<string, unknown>): string {
  const lineas: string[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      lineas.push(`${k}: ${v.includes('\n') || v.includes(':') ? JSON.stringify(v) : v}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lineas.push(`${k}: ${v}`);
    } else if (Array.isArray(v)) {
      lineas.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    } else {
      try {
        lineas.push(`${k}: ${JSON.stringify(v)}`);
      } catch {
        // Valor que JSON no admite (referencia circular, BigInt): no entra en el frontmatter.
      }
    }
  }
  return lineas.join('\n');
}

function truncar(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  const porcion = s.slice(0, max);
  const ultimoSalto = porcion.lastIndexOf('\n');
  const texto = ultimoSalto > max * 0.6 ? porcion.slice(0, ultimoSalto) : porcion;
  return { text: texto + '\n…[truncated]', truncated: true };
}

export function construirContextoMd(consulta: string, elementos: ElementoContexto[]): string {
  const lineas: string[] = [];
  lineas.push(`# Context for: ${consulta}`);
  lineas.push('');
  lineas.push(
    `Selected ${elementos.length} item${elementos.length === 1 ? '' : 's'} (notes and documents) by relevance.`,
  );
  lineas.push('');
  for (const elemento of elementos) {
    lineas.push('---');
    lineas.push('');
    lineas.push(`## ${elemento.title}`);
    lineas.push(
      `Path: \`${elemento.path}\` · ${elemento.kind === 'document' ? 'documento' : 'nota'} · score ${elemento.score}`,
    );
    if (elemento.matched_in.length > 0) {
      lineas.push(`Matched in: ${elemento.matched_in.join(', ')}`);
    }
    lineas.push('');
    if (elemento.frontmatter && Object.keys(elemento.frontmatter).length > 0) {
      lineas.push('### Frontmatter');
      lineas.push('```yaml');
      lineas.push(frontmatterAYaml(elemento.frontmatter));
      lineas.push('```');
      lineas.push('');
    }
    if (elemento.body) {
      lineas.push('### Body');
      lineas.push(elemento.body);
      if (elemento.body_truncated) lineas.push('\n_(body truncated)_');
      lineas.push('');
    } else if (elemento.snippet) {
      lineas.push('### Snippet');
      lineas.push(elemento.snippet);
      lineas.push('');
    }
  }
  return lineas.join('\n');
}

function elementoBase(acierto: ResultadoBiblioteca): ElementoContexto {
  return {
    path: acierto.path,
    title: acierto.title,
    kind: acierto.kind,
    score: acierto.score,
    snippet: acierto.snippet,
    matched_in: acierto.matched_in,
  };
}

function textoPasajes(pasajes: Pasaje[]): string {
  return pasajes.map((p) => (p.page ? `[pág. ${p.page}]\n${p.text}` : p.text)).join('\n\n[…]\n\n');
}

// Documento: en vez del principio (la portada de un pliego), los fragmentos que
// responden a la consulta, con su página.
function elementoDocumento(acierto: ResultadoBiblioteca, o: typeof VALORES_POR_DEFECTO): ElementoContexto {
  const elemento = elementoBase(acierto);
  if (o.include_body && acierto.passages.length > 0) {
    const t = truncar(textoPasajes(acierto.passages), o.body_max_chars);
    elemento.body = t.text;
    if (t.truncated) elemento.body_truncated = true;
  }
  return elemento;
}

async function elementoNota(
  acierto: ResultadoBiblioteca,
  o: typeof VALORES_POR_DEFECTO,
): Promise<ElementoContexto | null> {
  const elemento = elementoBase(acierto);
  if (o.include_body || o.include_frontmatter) {
    let nota: Nota;
    try {
      nota = await leerNota(acierto.path);
    } catch {
      return null;
    }
    if (o.include_frontmatter) elemento.frontmatter = nota.frontmatter;
    if (o.include_body) {
      const t = truncar(nota.body, o.body_max_chars);
      elemento.body = t.text;
      if (t.truncated) elemento.body_truncated = true;
    }
  }
  return elemento;
}

export async function obtenerContextoPara(
  consulta: string,
  opciones: OpcionesContexto = {},
): Promise<ResultadoContexto> {
  const o = { ...VALORES_POR_DEFECTO, ...opciones };
  const limiteSeguro =
    Number.isFinite(o.limit) && o.limit > 0 && o.limit <= 50 ? Math.floor(o.limit) : VALORES_POR_DEFECTO.limit;

  const aciertos = await buscarEnBiblioteca(consulta, limiteSeguro, opciones.folder, opciones.exclude_folders);
  const elementos: ElementoContexto[] = [];

  for (const acierto of aciertos) {
    const elemento = acierto.kind === 'document' ? elementoDocumento(acierto, o) : await elementoNota(acierto, o);
    if (elemento) elementos.push(elemento);
  }

  return {
    query: consulta,
    meta: {
      total_hits: aciertos.length,
      returned: elementos.length,
      limit: limiteSeguro,
      include_body: o.include_body,
      include_frontmatter: o.include_frontmatter,
    },
    items: elementos,
    context_md: construirContextoMd(consulta, elementos),
  };
}
