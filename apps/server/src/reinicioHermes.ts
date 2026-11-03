// Comando para el instalador (install.sh --actualizar): qué perfiles de Hermes tienen la lista de
// herramientas de antes del despliegue y cuántos runs de IA hay en marcha.
// Uso: docker compose exec monitor node apps/server/dist/reinicioHermes.js
import { validarConfig } from './nucleo/config.js';
import { abrirNucleo } from './nucleo/db.js';
import { estadoReinicio, textoReinicio } from './nucleo/mcp/reinicio.js';
import { errorMessage } from './nucleo/result.js';

function main(): number {
  const config = validarConfig();
  if (config.error) {
    process.stderr.write(`Entorno no válido: ${config.error.message}\n`);
    return 1;
  }
  const db = abrirNucleo(config.data.dataDir);
  try {
    process.stdout.write(`${textoReinicio(estadoReinicio(db, config.data.agentesDir))}\n`);
    return 0;
  } finally {
    db.close();
  }
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`No se pudo leer el estado de Hermes: ${errorMessage(err)}\n`);
  process.exitCode = 1;
}
