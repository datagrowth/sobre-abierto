// El ensayo en seco de la carpeta única en palabras, sin React y con tests: tamaños, el
// resumen de lo que se movería y la parte de la ruta que cambia en cada paso.

/** «512 B», «3,4 MB»: con una cifra decimal a partir de KB. */
export function tamano(bytes) {
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let n = Number(bytes) || 0;
  let i = 0;
  while (n >= 1024 && i < unidades.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} B` : `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} ${unidades[i]}`;
}

const plural = (n, uno, varios) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`;

/** «3 licitaciones · 41 archivos (12,3 MB) · 57 filas guardadas que cambiarían de ruta». */
export function resumenEnsayo(t) {
  if (!t?.licitaciones) return 'Ninguna licitación del Pipeline ni presentada tiene carpetas que mover.';
  return [
    plural(t.licitaciones, 'licitación', 'licitaciones'),
    `${plural(t.archivos, 'archivo', 'archivos')} (${tamano(t.bytes)})`,
    `${plural(t.filas, 'fila guardada', 'filas guardadas')} que cambiarían de ruta`,
    ...(t.avisos ? [plural(t.avisos, 'aviso', 'avisos')] : []),
  ].join(' · ');
}

/** El destino de un paso sin la carpeta única delante («Pliegos», «Oferta/memoria-v1.docx»). */
export function dentroDeDestino(destino, a) {
  return a.startsWith(`${destino}/`) ? a.slice(destino.length + 1) : a;
}

const ESTADOS_MIGRACION = {
  sin_lanzar: { tono: 'info', texto: 'Aún no se ha migrado: todo sigue en Radar, Presentadas y Salidas.' },
  en_curso: { tono: 'info', texto: 'Moviendo carpetas…' },
  hecha: { tono: 'ok', texto: 'Migración hecha.' },
  error: { tono: 'aviso', texto: 'Migración con errores: lo que falló sigue donde estaba y se puede repetir.' },
};

/** { tono, texto } del estado de la migración, con su resumen si lo hay. */
export function avisoMigracion(m) {
  const base = ESTADOS_MIGRACION[m?.estado] ?? ESTADOS_MIGRACION.sin_lanzar;
  return { tono: base.tono, texto: m?.mensaje ? `${base.texto} ${m.mensaje}` : base.texto };
}
