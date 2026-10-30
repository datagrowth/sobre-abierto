// Primer import de index.ts: en ESM los imports se evalúan antes que el cuerpo del módulo,
// y varios módulos leen process.env al cargarse.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { logger } from './nucleo/log.js';

const log = logger('bootstrap');

const HERE = path.dirname(fileURLToPath(import.meta.url));

// .env en la raíz del repo (desarrollo local); en Docker las variables llegan del compose.
dotenv.config({ path: path.join(HERE, '..', '..', '..', '.env') });

// La bóveda por defecto (VAULT_PATH, p. ej. /opt/data/conocimiento en Docker) se crea vacía
// si no existe: así la Biblioteca arranca "configurada" y solo falta copiar las notas.
const bibliotecaPorDefecto = process.env.VAULT_PATH;
if (bibliotecaPorDefecto && !fs.existsSync(bibliotecaPorDefecto)) {
  try {
    fs.mkdirSync(bibliotecaPorDefecto, { recursive: true });
    log.info('bóveda por defecto creada', { ruta: bibliotecaPorDefecto });
  } catch (e) {
    log.warn('no se pudo crear la bóveda por defecto', {
      ruta: bibliotecaPorDefecto,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
