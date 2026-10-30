// Copias de seguridad de notas: guarda la versión previa antes de modificar, borrar o renombrar una nota.
import path from 'node:path';
import fs from 'node:fs/promises';
import { obtenerRutaBiblioteca } from './configuracion.js';
import { comprobarRutaReal } from './rutaReal.js';

export class ErrorRespaldo extends Error {
  constructor(
    mensaje: string,
    public readonly code: 'not_configured' | 'not_found' | 'write_error',
  ) {
    super(mensaje);
    this.name = 'ErrorRespaldo';
  }
}

const NOMBRE_CARPETA_RESPALDO = '.hermes-vault';

function raizRespaldo(): string {
  const biblioteca = obtenerRutaBiblioteca();
  if (!biblioteca)
    throw new ErrorRespaldo(
      'No hay bóveda configurada. Ve a Biblioteca de Conocimiento → Ajustes y apunta a la carpeta de tus notas.',
      'not_configured',
    );
  return path.join(biblioteca, NOMBRE_CARPETA_RESPALDO, 'backups');
}

function carpetaMarca(d = new Date()): string {
  // YYYY-MM-DD/HHMMSS (separador '/' también en Windows: es el id de la sesión)
  const rellenar = (n: number) => String(n).padStart(2, '0');
  const dia = `${d.getFullYear()}-${rellenar(d.getMonth() + 1)}-${rellenar(d.getDate())}`;
  const hora = `${rellenar(d.getHours())}${rellenar(d.getMinutes())}${rellenar(d.getSeconds())}`;
  return `${dia}/${hora}`;
}

// Dos sesiones en el mismo segundo (guardar y renombrar seguidos, doble clic…)
// compartirían carpeta y la segunda pisaría la copia del original: se sufija -1, -2…
let ultimaCarpeta = '';
let mismoSegundo = 0;

function carpetaUnica(): string {
  const base = carpetaMarca();
  if (base === ultimaCarpeta) {
    mismoSegundo += 1;
  } else {
    ultimaCarpeta = base;
    mismoSegundo = 0;
  }
  return mismoSegundo === 0 ? base : `${base}-${mismoSegundo}`;
}

export type SesionRespaldo = {
  id: string; // ts folder relative, e.g., "2026-05-26/154233" (o "…/154233-1")
  absRoot: string;
  notes: string[]; // relative paths copiados
};

/**
 * Inicia una sesión de backup (carpeta única por timestamp).
 * El caller llamará a respaldarNota para cada archivo a modificar.
 */
export function iniciarSesionRespaldo(): SesionRespaldo {
  const id = carpetaUnica();
  return {
    id,
    absRoot: path.join(raizRespaldo(), id),
    notes: [],
  };
}

export async function respaldarNota(sesion: SesionRespaldo, rutaRelativa: string): Promise<void> {
  const biblioteca = obtenerRutaBiblioteca();
  if (!biblioteca)
    throw new ErrorRespaldo(
      'No hay bóveda configurada. Ve a Biblioteca de Conocimiento → Ajustes y apunta a la carpeta de tus notas.',
      'not_configured',
    );
  const origen = path.join(biblioteca, rutaRelativa);
  try {
    await fs.access(origen);
  } catch {
    throw new ErrorRespaldo(`No existe: ${rutaRelativa}`, 'not_found');
  }
  const destino = path.join(sesion.absRoot, rutaRelativa);
  // copyFile sigue un enlace en el destino: uno dejado en .hermes-vault/backups (el nombre
  // de la sesión se adivina) haría que la copia pisara un archivo de fuera de la bóveda.
  const rutaReal = comprobarRutaReal(biblioteca, destino);
  if (rutaReal.error)
    throw new ErrorRespaldo(`No se pudo respaldar ${rutaRelativa}: ${rutaReal.error.message}`, 'write_error');
  try {
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.copyFile(origen, destino);
    sesion.notes.push(rutaRelativa);
  } catch (err) {
    throw new ErrorRespaldo(`No se pudo respaldar ${rutaRelativa}: ${(err as Error).message}`, 'write_error');
  }
}
