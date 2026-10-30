// Territorios NUTS de España (nivel 1 y 2) con su nombre: la PLACSP publica el código
// del lugar de ejecución (p. ej. ES300) y en la ficha se agrupa por comunidad autónoma.
const NOMBRES: Record<string, string> = {
  ES: 'España (sin detallar)',
  ES1: 'Noroeste',
  ES2: 'Noreste',
  ES3: 'Comunidad de Madrid',
  ES4: 'Centro',
  ES5: 'Este',
  ES6: 'Sur',
  ES7: 'Canarias',
  ES11: 'Galicia',
  ES12: 'Principado de Asturias',
  ES13: 'Cantabria',
  ES21: 'País Vasco',
  ES22: 'Comunidad Foral de Navarra',
  ES23: 'La Rioja',
  ES24: 'Aragón',
  ES30: 'Comunidad de Madrid',
  ES41: 'Castilla y León',
  ES42: 'Castilla-La Mancha',
  ES43: 'Extremadura',
  ES51: 'Cataluña',
  ES52: 'Comunitat Valenciana',
  ES53: 'Illes Balears',
  ES61: 'Andalucía',
  ES62: 'Región de Murcia',
  ES63: 'Ciudad de Ceuta',
  ES64: 'Ciudad de Melilla',
  ES70: 'Canarias',
};

/** Clave de agrupación: la comunidad autónoma (NUTS 2) o el nivel publicado si es más grueso. */
export function territorioDe(nuts: string | null): string | null {
  const codigo = nuts?.trim().toUpperCase();
  if (!codigo) return null;
  return codigo.length >= 4 ? codigo.slice(0, 4) : codigo;
}

export function nombreTerritorio(codigo: string): string {
  return NOMBRES[codigo] ?? codigo;
}
