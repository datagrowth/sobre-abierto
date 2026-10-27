// Estado compartido del núcleo en el hilo principal: configuración y nucleo.db.
// Se inicia una vez al arrancar; los tests pueden iniciarlo con otra config.
import { leerConfig, type PlataformaConfig } from './config.js';
import { abrirNucleo, type Db } from './db.js';

let actual: { config: PlataformaConfig; db: Db } | null = null;

export function iniciarNucleo(config: PlataformaConfig = leerConfig()): { config: PlataformaConfig; db: Db } {
  actual?.db.close();
  actual = { config, db: abrirNucleo(config.dataDir) };
  return actual;
}

export function nucleo(): { config: PlataformaConfig; db: Db } {
  return actual ?? iniciarNucleo();
}

export function cerrarNucleo(): void {
  actual?.db.close();
  actual = null;
}
