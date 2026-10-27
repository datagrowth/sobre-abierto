// Pasa los fixtures sintéticos de las comprobaciones (comprobaciones/, cambios/ y ofertas/) por perfilesGenericos.mjs: las
// personas a perfiles genéricos, los textos que hablan de ellas sin lo que citaba de su perfil y
// todos los textos sin la empresa real, la sede ni los lugares que delatan el contrato. Es
// idempotente: sobre un fixture ya genérico no cambia nada. Los datos de Playwright de la web
// (apps/web/e2e/datos) no se tocan aquí: se regeneran desde comprobaciones/ con `npm run e2e:datos`.
// Uso (desde apps/server): node tests/licitaciones/fixtures/generalizarFixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generalizarDatos, personasDe, sustitucionesDeTexto } from './perfilesGenericos.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const enCarpeta = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : []);
const ARCHIVOS = ['comprobaciones', 'cambios', 'ofertas'].flatMap((d) => enCarpeta(path.join(AQUI, d)));

const leidos = ARCHIVOS.map((f) => ({ f, original: fs.readFileSync(f, 'utf8') }));
// Las mismas personas salen en varios fixtures: las sustituciones se arman con todas.
const sust = sustitucionesDeTexto(leidos.flatMap(({ original }) => personasDe(JSON.parse(original))));
let cambiados = 0;
for (const { f, original } of leidos) {
  const nuevo = `${JSON.stringify(generalizarDatos(JSON.parse(original), sust), null, 2)}\n`;
  if (nuevo === original) continue;
  fs.writeFileSync(f, nuevo);
  cambiados += 1;
  process.stdout.write(`${path.relative(process.cwd(), f)}\n`);
}
process.stdout.write(`${cambiados} de ${ARCHIVOS.length} fixtures generalizados\n`);
