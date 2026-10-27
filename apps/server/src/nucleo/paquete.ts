// El repositorio y la versión del package.json del servidor: enlace «Código fuente» y versión de «Acerca de».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Así una copia modificada solo tiene que cambiar su package.json (o poner APP_SOURCE_URL).
// Desde src/nucleo y desde dist/nucleo, el package.json queda dos carpetas más arriba.
const PAQUETE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const Paquete = z.object({ repository: z.object({ url: z.string() }) });

/** «git+https://github.com/x/y.git» → «https://github.com/x/y»; null si no se puede leer. */
export function repositorioDelPaquete(archivo = PAQUETE): string | null {
  try {
    const p = Paquete.safeParse(JSON.parse(fs.readFileSync(archivo, 'utf8')));
    const url = p.success ? p.data.repository.url.replace(/^git\+/, '').replace(/\.git$/, '') : '';
    return /^https:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

const Version = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+/) });

/** La versión del package.json («1.0.0»); null si no se puede leer. */
export function versionDelPaquete(archivo = PAQUETE): string | null {
  try {
    const p = Version.safeParse(JSON.parse(fs.readFileSync(archivo, 'utf8')));
    return p.success ? p.data.version : null;
  } catch {
    return null;
  }
}
