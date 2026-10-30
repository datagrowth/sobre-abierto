// Falla si alguna dependencia de npm trae una licencia que no se puede combinar con la AGPL.
// Lee package-lock.json y no node_modules: así cubre también los binarios opcionales de
// otras plataformas (sharp, resvg) y no hace falta instalar ningún verificador.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Licencias que no son de código abierto, que prohíben justo lo que la AGPL permite o que no se
// pueden combinar con ella (la .0 sin «o posterior»).
const INCOMPATIBLES = [
  /SSPL/i,
  /BUSL/i,
  /Commons[- ]Clause/i,
  /CC-BY-NC/i,
  /^UNLICENSED$/i,
  /(^|[\s(])GPL-2\.0(-only)?($|[\s)])/i,
];

// En «A OR B» basta con que una de las alternativas sea compatible: el paquete se usa con esa.
function esIncompatible(licencia) {
  return licencia
    .replace(/^\((.*)\)$/, '$1')
    .split(/\s+OR\s+/i)
    .every((opcion) => INCOMPATIBLES.some((re) => re.test(opcion.trim())));
}

// El lockfile no guarda la licencia de los paquetes que la declaran con el formato antiguo
// (`licenses: [{ type }]`); se lee entonces del paquete instalado.
function licenciaInstalada(raiz, ruta) {
  try {
    const pkg = JSON.parse(readFileSync(join(raiz, ruta, 'package.json'), 'utf8'));
    if (typeof pkg.license === 'string') return pkg.license;
    const tipos = (pkg.licenses ?? []).map((l) => l.type).filter(Boolean);
    return tipos.length ? tipos.join(' AND ') : null;
  } catch {
    return null;
  }
}

export function revisarLicencias(lock, leerInstalada = () => null) {
  const problemas = [];
  for (const [ruta, pkg] of Object.entries(lock.packages ?? {})) {
    if (!ruta.includes('node_modules/') || pkg.link) continue;
    const nombre = ruta.slice(ruta.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const licencia = pkg.license ?? leerInstalada(ruta);
    if (!licencia) problemas.push(`${nombre}: sin licencia declarada`);
    else if (esIncompatible(licencia)) problemas.push(`${nombre}: ${licencia}`);
  }
  return problemas;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raiz = join(fileURLToPath(import.meta.url), '..', '..');
  const lock = JSON.parse(readFileSync(join(raiz, 'package-lock.json'), 'utf8'));
  const problemas = revisarLicencias(lock, (ruta) => licenciaInstalada(raiz, ruta));
  if (problemas.length) {
    console.error(`Licencias incompatibles con la AGPL-3.0 o sin declarar:\n  ${problemas.join('\n  ')}`);
    process.exit(1);
  }
  const total = Object.entries(lock.packages).filter(
    ([ruta, pkg]) => ruta.includes('node_modules/') && !pkg.link,
  ).length;
  console.log(`Licencias revisadas: ${total} paquetes compatibles con la AGPL-3.0.`);
}
