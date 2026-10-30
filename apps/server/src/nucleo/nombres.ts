// Nombres de archivo y carpeta que sirven a la vez en Drive, Windows y Linux.
/** Texto válido como nombre en Drive, Windows y Linux: sin separadores ni caracteres raros. */
export function limpiarNombre(nombre: string, max = 120): string {
  return (
    nombre
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se descarta
      .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+/, '')
      .slice(0, max)
      .trim()
  );
}

/** `nombre` si no está ocupado; si lo está, el primero libre de `nombre-1`, `nombre-2`… */
export function nombreLibre(ocupados: ReadonlySet<string>, nombre: string): string {
  if (!ocupados.has(nombre)) return nombre;
  for (let i = 1; ; i++) if (!ocupados.has(`${nombre}-${i}`)) return `${nombre}-${i}`;
}
