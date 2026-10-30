// Genera las plantillas autocontenidas de Coolify, Dokploy y Easypanel a partir de docker-compose.yml de la raíz.
// Un panel suele leer un solo archivo, así que no usan `include`: son el Compose de la raíz sin el puerto
// publicado (el panel enruta el dominio) y con un salto de proxy de confianza. Uso:
//   node deploy/generar.mjs             escribe deploy/<panel>/docker-compose.yml de cada panel
//   node deploy/generar.mjs --comprobar sale con 1 si alguna no coincide con lo que saldría (lo hace el test de infra)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CABECERA = /^[\s\S]*?\n\n/;
const PUERTO_PUBLICADO = / {4}# Solo en esta máquina[\s\S]*?\n {4}ports:\n {6}- '[^\n]*'\n/;
const PROXIES = / {6}# Saltos de proxy[\s\S]*?MONITOR_PROXIES_DE_CONFIANZA: \$\{MONITOR_PROXIES_DE_CONFIANZA:-0\}\n/;
const REDES_MONITOR = / {4}networks:\n {6}default:\n {8}aliases:\n {10}- hermes-monitor\n/;

const PANELES = {
  coolify: {
    cabecera: `# Sobre Abierto en Coolify: el Compose de la raíz sin puerto publicado (Coolify enruta el dominio al monitor).
# Generado con \`node deploy/generar.mjs\` a partir de docker-compose.yml: no lo edites a mano. Pasos en deploy/README.md.

`,
    entorno: `      # Variable mágica de Coolify: da un dominio al servicio «monitor» y lo enruta a su puerto 3110.
      SERVICE_FQDN_MONITOR_3110: ''
      # Un salto de proxy (Traefik): el bloqueo de login usa la IP real.
      MONITOR_PROXIES_DE_CONFIANZA: '1'
`,
  },
  dokploy: {
    cabecera: `# Sobre Abierto en Dokploy: el Compose de la raíz sin puerto publicado y con el monitor en dokploy-network, la red
# de Traefik (el dominio se asigna en el panel al servicio «monitor», puerto 3110). Generado con
# \`node deploy/generar.mjs\` a partir de docker-compose.yml: no lo edites a mano. Pasos en deploy/dokploy/README.md.

`,
    entorno: `      # Un salto de proxy (Traefik): el bloqueo de login usa la IP real.
      MONITOR_PROXIES_DE_CONFIANZA: '1'
`,
    // Traefik solo enruta a los contenedores que están en su red.
    redes: (compose) =>
      compose.replace(REDES_MONITOR, (bloque) => `${bloque}      dokploy-network: {}\n`) +
      '\nnetworks:\n  dokploy-network:\n    external: true\n',
  },
  easypanel: {
    cabecera: `# Sobre Abierto en Easypanel: el Compose de la raíz sin puerto publicado (el dominio se asigna en el panel al
# servicio «monitor», puerto 3110). Generado con \`node deploy/generar.mjs\` a partir de docker-compose.yml: no lo
# edites a mano. Pasos en deploy/README.md.

`,
    entorno: `      # Un salto de proxy (el de Easypanel): el bloqueo de login usa la IP real.
      MONITOR_PROXIES_DE_CONFIANZA: '1'
`,
  },
};

function plantilla(base, panel) {
  const { cabecera, entorno, redes = (compose) => compose } = PANELES[panel];
  for (const parte of [CABECERA, PUERTO_PUBLICADO, PROXIES, REDES_MONITOR]) {
    if (!parte.test(base)) throw new Error(`docker-compose.yml ya no tiene lo que generar.mjs espera: ${parte}`);
  }
  return redes(
    base
      .replace(CABECERA, cabecera)
      .replace(
        PUERTO_PUBLICADO,
        '    # El panel publica el servicio: no hace falta el 127.0.0.1:3110 del Compose base.\n',
      )
      .replace(PROXIES, entorno),
  );
}

const base = fs.readFileSync(path.join(RAIZ, 'docker-compose.yml'), 'utf8');
let desfasadas = 0;
for (const panel of Object.keys(PANELES)) {
  const destino = path.join(RAIZ, 'deploy', panel, 'docker-compose.yml');
  const esperado = plantilla(base, panel);
  if (process.argv.includes('--comprobar')) {
    const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
    if (actual !== esperado) {
      console.error(`deploy/${panel}/docker-compose.yml no coincide: ejecuta node deploy/generar.mjs`);
      desfasadas += 1;
    }
  } else {
    fs.writeFileSync(destino, esperado);
  }
}
process.exit(desfasadas > 0 ? 1 : 0);
