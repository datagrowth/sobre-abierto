// Comando de recuperación de acceso: pone una contraseña temporal al administrador y la escribe por la terminal.
import { validarConfig } from './nucleo/config.js';
import { abrirNucleo } from './nucleo/db.js';
import { errorMessage } from './nucleo/result.js';
import { recuperarAdmin } from './nucleo/usuarios.js';

const salir = (mensaje: string, codigo: number): never => {
  (codigo === 0 ? process.stdout : process.stderr).write(`${mensaje}
`);
  process.exit(codigo);
};

// Uso: docker compose exec monitor node apps/server/dist/recuperarAcceso.js <email>. La contraseña sale por la
// terminal, no por el log; la web obliga a cambiarla al entrar.
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email || process.argv.length > 3)
    salir('Uso: node apps/server/dist/recuperarAcceso.js <email del administrador>', 2);
  const config = validarConfig();
  if (config.error) return salir(`Entorno no válido: ${config.error.message}`, 1);
  const db = abrirNucleo(config.data.dataDir);
  const r = await recuperarAdmin(db, email).finally(() => db.close());
  if (r.error) return salir(r.error.message, 1);
  salir(
    `Contraseña temporal de ${r.data.usuario.email}: ${r.data.contrasena}
` + 'La web le pedirá cambiarla al entrar y se han cerrado sus sesiones abiertas.',
    0,
  );
}

main().catch((err: unknown) => salir(`No se pudo recuperar el acceso: ${errorMessage(err)}`, 1));
