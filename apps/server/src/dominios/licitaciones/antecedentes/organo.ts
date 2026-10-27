// Quién es «el mismo órgano»: por NIF, por DIR3 o por el nombre normalizado, según lo que haya.

export type FilaOrgano = { organo_nif: string | null; organo_dir3?: string | null; organo_norm?: string | null };

// por: cómo se reconoce (lo que se dice en la web y en las tools).
export type ClaveOrgano = {
  por: 'nif' | 'dir3_nombre';
  nif: string | null;
  dir3: string | null;
  nombre: string | null;
};

// Por NIF cuando lo hay (perfiles de la PLACSP) y, si no (plataformas agregadas), por DIR3 o por el nombre
// normalizado. Lo usan los antecedentes y las adjudicaciones parecidas.
export function claveOrgano(f: FilaOrgano): ClaveOrgano | null {
  if (f.organo_nif) return { por: 'nif', nif: f.organo_nif, dir3: null, nombre: null };
  const dir3 = f.organo_dir3 ?? null;
  const nombre = f.organo_norm ?? null;
  return dir3 || nombre ? { por: 'dir3_nombre', nif: null, dir3, nombre } : null;
}

/**
 * Condición SQL del mismo órgano. `alias` es siempre un nombre fijo del código (la tabla
 * licitaciones en la consulta), nunca entrada; los valores van como parámetros.
 */
export function sqlOrgano(c: ClaveOrgano, alias: string): { sql: string; args: string[] } {
  if (c.nif) return { sql: `${alias}.organo_nif = ?`, args: [c.nif] };
  const partes: string[] = [];
  const args: string[] = [];
  if (c.dir3) {
    partes.push(`${alias}.organo_dir3 = ?`);
    args.push(c.dir3);
  }
  if (c.nombre) {
    partes.push(`${alias}.organo_norm = ?`);
    args.push(c.nombre);
  }
  return { sql: `(${partes.join(' OR ')})`, args };
}

/** ¿Es esta fila del órgano de la clave? */
export function esDelOrgano(c: ClaveOrgano | null, f: FilaOrgano): boolean {
  if (!c) return false;
  if (c.nif) return f.organo_nif === c.nif;
  return (c.dir3 !== null && f.organo_dir3 === c.dir3) || (c.nombre !== null && f.organo_norm === c.nombre);
}

export const COMO_SE_RECONOCE: Record<ClaveOrgano['por'], string> = {
  nif: 'mismo NIF del órgano',
  dir3_nombre: 'mismo código DIR3 o mismo nombre de órgano (la plataforma no publica su NIF)',
};
