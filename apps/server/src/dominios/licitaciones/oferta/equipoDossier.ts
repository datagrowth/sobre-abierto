// El equipo en el dossier, rol a rol: un alias corto para citarlo y las funciones que el pliego da al rol.
import { textoComparable } from '../temas.js';
import { marcaPagina, type DocumentoLeido } from './dossierTexto.js';

// El alias sirve para citar al rol después de presentarlo (la memoria repetía «Primer perfil técnico…» 40 veces
// por apartado). Las funciones llevan su página, para que la memoria no se las invente.
const VACIAS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'e',
  'o',
  'u',
  'en',
  'para',
  'con',
  'a',
  'al',
  'por',
]);
const ORDINALES: Record<string, number> = {
  primer: 1,
  primero: 1,
  primera: 1,
  segundo: 2,
  segunda: 2,
  tercer: 3,
  tercero: 3,
  tercera: 3,
  cuarto: 4,
  cuarta: 4,
};
// Siglas que ya significan otra cosa en un pliego.
const RESERVADAS = new Set(['PPT', 'PCAP', 'PCP', 'ETC', 'IVA', 'IGIC', 'CV', 'UTE']);
const FUNCION = /funcion|tarea|responsab|encargad|se ocupara|le corresponde|dirigir|coordinar/;
const MAX_FUNCIONES = 300;

const palabras = (rol: string) =>
  textoComparable(rol)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !VACIAS.has(w));

function siglas(rol: string): string {
  const ws = palabras(rol);
  const orden = ws.map((w) => ORDINALES[w]).find((n) => n !== undefined);
  const base = ws.filter((w) => ORDINALES[w] === undefined);
  const s =
    base.length === 1
      ? base[0]!.slice(0, 3).toUpperCase()
      : base
          .slice(0, 4)
          .map((w) => w[0]!.toUpperCase())
          .join('');
  return orden ? `${s}-${orden}` : s;
}

/** Un alias corto por rol («Responsable del servicio» → RS; «Primer técnico de sistemas» → TS-1), sin repetir. */
export function aliasDeRoles(roles: string[]): string[] {
  const usados = new Map<string, number>();
  return roles.map((r) => {
    const s = siglas(r) || 'ROL';
    const veces = (usados.get(s) ?? 0) + 1;
    usados.set(s, veces);
    return veces > 1 || RESERVADAS.has(s) ? `${s}-${veces}` : s;
  });
}

/** La primera frase del pliego que da funciones a ese rol, con su página; null si no la hay. */
export function funcionesDelRol(rol: string, docs: DocumentoLeido[]): string | null {
  const clave = palabras(rol).filter((w) => w.length >= 4 && ORDINALES[w] === undefined);
  if (!clave.length) return null;
  const minimo = Math.min(2, clave.length);
  for (const d of docs) {
    for (const [n, t] of [...d.paginas.entries()].sort((a, b) => a[0] - b[0])) {
      const frase = t.split(/(?<=[.;:])\s+|\n/).find((f) => {
        const c = textoComparable(f);
        return FUNCION.test(c) && clave.filter((w) => c.includes(w)).length >= minimo;
      });
      if (frase) return `«${frase.trim().slice(0, MAX_FUNCIONES)}» ${marcaPagina(d, n)}`;
    }
  }
  return null;
}
