// Genera docs/mcp.md con las tools que registra la plataforma, para que herramientas y permisos
// no se desfasen del código.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { DOMINIOS, permisosDe, type Accion, type Dominio, type Permisos } from '../src/nucleo/agentes/permisos.js';
import { permisosQueFaltan } from '../src/nucleo/mcp/herramienta.js';
import { herramientasBiblioteca } from '../src/nucleo/mcp/biblioteca.js';
import { herramientasColaboradores } from '../src/nucleo/colaboradores/tools.js';
import { herramientasLicitaciones } from '../src/dominios/licitaciones/tools.js';

// Un test comprueba que el archivo está al día. Se regenera con: npm run docs:mcp -w @sobre-abierto/server
export const ARCHIVO_MCP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'mcp.md',
);

type Registro = { nombre: string; descripcion: string; entrada: z.ZodObject };

const AGENTES = ['hermes', 'claude-code', 'licitaciones', 'oferta-licitaciones', 'critico-licitaciones'];

const TODO: Permisos = Object.fromEntries(DOMINIOS.map((d) => [d, 'proponer' as const]));

// Un McpServer que solo apunta lo que se le registra: las tools no se ejecutan.
function capturar(): { server: McpServer; registros: Registro[] } {
  const registros: Registro[] = [];
  const server = {
    registerTool(nombre: string, config: { description?: string; inputSchema: z.ZodObject }) {
      registros.push({ nombre, descripcion: config.description ?? '', entrada: config.inputSchema });
    },
  } as unknown as McpServer;
  return { server, registros };
}

function herramientasRegistradas(): Map<Dominio, Registro[]> {
  const porDominio = new Map<Dominio, Registro[]>(DOMINIOS.map((d) => [d, []]));
  for (const registrar of [herramientasBiblioteca, herramientasColaboradores, herramientasLicitaciones]) {
    const { server, registros } = capturar();
    registrar(server, { nombre: 'catalogo', permisos: TODO });
    for (const r of registros) {
      porDominio.get(permisosDeTool(r.nombre).dominio)!.push(r);
    }
  }
  return porDominio;
}

// Sin ningún permiso, lo que falta es la lista completa: el primero es el de su dominio y el resto, los extra.
function permisosDeTool(nombre: string): { dominio: Dominio; accion: Accion; extra: string[] } {
  const [propio, ...extra] = permisosQueFaltan({}, nombre);
  if (!propio) throw new Error(`La tool ${nombre} no está en el catálogo`);
  const [dominio, accion] = propio.split(':') as [Dominio, Accion];
  return { dominio, accion, extra };
}

function primeraFrase(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  // «pág.» no cierra la frase; el resto, con una mayúscula detrás o al final.
  const corte = plano.search(/(?<!pág)[.!?](\s+(?=[A-ZÁÉÍÓÚ¿¡`«])|$)/);
  const frase = corte === -1 ? plano : plano.slice(0, corte + 1);
  return frase.length > 220 ? `${frase.slice(0, 217)}…` : frase;
}

function parametros(entrada: z.ZodObject): string {
  const campos = Object.entries(entrada.shape).map(([k, v]) => `\`${k}\`${(v as z.ZodType).isOptional() ? '' : '*'}`);
  return campos.length ? campos.join(', ') : '—';
}

const celda = (t: string) => t.replace(/\|/g, '\\|');

function tablaDe(registros: Registro[]): string {
  const filas = registros
    .map((r) => {
      const { dominio, accion, extra } = permisosDeTool(r.nombre);
      return { ...r, permiso: [`${dominio}:${accion}`, ...extra].join(' + ') };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(
      (r) =>
        `| \`${r.nombre}\` | ${r.permiso} | ${celda(primeraFrase(r.descripcion))} | ${celda(parametros(r.entrada))} |`,
    );
  return ['| Tool | Permiso | Qué hace | Parámetros |', '|---|---|---|---|', ...filas].join('\n');
}

function tablaAgentes(): string {
  const celdaPermiso = (p: Permisos, d: Dominio) => p[d] ?? '—';
  const filas = AGENTES.map((a) => {
    const p = permisosDe(a);
    return `| \`${a}\` | ${DOMINIOS.map((d) => celdaPermiso(p, d)).join(' | ')} |`;
  });
  const otro = permisosDe('cualquier-otro');
  filas.push(`| cualquier otro agente con token | ${DOMINIOS.map((d) => celdaPermiso(otro, d)).join(' | ')} |`);
  return [`| Agente | ${DOMINIOS.join(' | ')} |`, `|---|${DOMINIOS.map(() => '---').join('|')}|`, ...filas].join('\n');
}

const TITULOS: Record<Dominio, string> = {
  biblioteca: 'Biblioteca de Conocimiento',
  plataforma: 'Plataforma (perfil de la empresa, estado, trabajos y Salidas)',
  licitaciones: 'Licitaciones',
  colaboradores: 'Colaboradores',
};

export function generarDocumentoMcp(): string {
  const porDominio = herramientasRegistradas();
  const total = [...porDominio.values()].reduce((n, l) => n + l.length, 0);
  const secciones = DOMINIOS.filter((d) => porDominio.get(d)!.length > 0).map(
    (d) => `## ${TITULOS[d]}\n\n${tablaDe(porDominio.get(d)!)}`,
  );
  return `# Servidor MCP

<!-- Generado con «npm run docs:mcp -w @sobre-abierto/server». No lo edites a mano: un test falla si no coincide con el código. -->

La plataforma expone sus herramientas a los agentes (Hermes, sus perfiles y, si lo configuras, Claude Code u otro
cliente MCP) por el endpoint \`/mcp\`, con transporte HTTP. Hay ${total} herramientas. Cada agente se autentica con su
propio token \`Bearer\` y ve solo las que su permiso permite; cada llamada queda en la auditoría.

## Permisos

Hay dos acciones: \`leer\` y \`proponer\` (incluye leer). Ningún agente escribe hechos ni aprueba: lo que propone lo
revisa una persona o lo valida el código.

${tablaAgentes()}

- \`hermes\` es el perfil general; \`licitaciones\`, \`oferta-licitaciones\` y \`critico-licitaciones\` son los perfiles
  que crea \`install.sh\`. El crítico solo ve Licitaciones: no lee la Biblioteca ni los CV.
- Un archivo \`permisos.json\` junto a los tokens (\`/opt/data/.agentes\`) ajusta los permisos por agente y dominio con
  \`leer\`, \`proponer\` o \`ninguno\`. Un dominio que no existe se ignora, y un archivo mal formado se descarta entero.
- Las tools con dos permisos (por ejemplo, \`licitaciones_equipo\` también necesita \`colaboradores:leer\`) no se
  registran si falta alguno.
- \`plataforma_estado\` dice a quien lo llama qué herramientas tiene y cuáles le faltan, con el permiso que las daría.

## Conectar un agente

1. Crea un token de al menos 24 caracteres y guárdalo en \`AGENTE_TOKEN_<NOMBRE>\` (el nombre en mayúsculas, con \`_\`
   en lugar de \`-\`) en el \`.env\` del monitor, o como archivo \`<nombre>.token\` en \`/opt/data/.agentes\`.
2. En el cliente, apunta al endpoint \`https://<tu-dominio>/mcp\` con la cabecera \`Authorization: Bearer <token>\`.
3. Pide \`plataforma_estado\` para comprobar qué herramientas ve.

Las respuestas muy largas se recortan y dicen cómo seguir (\`como_seguir\`). Los parámetros con \`*\` son obligatorios.

${secciones.join('\n\n')}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.writeFileSync(ARCHIVO_MCP, generarDocumentoMcp());
  process.stdout.write(`Escrito ${ARCHIVO_MCP}\n`);
}
