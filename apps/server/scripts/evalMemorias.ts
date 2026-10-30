// Banco de pruebas de memorias: encola los juicios ciegos por pares de un caso de tests/licitaciones/fixtures/eval.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nucleo } from '../src/nucleo/contexto.js';
import { dbLicitaciones } from '../src/dominios/licitaciones/db.js';
import {
  cargarCaso,
  contradiceEsperado,
  encolarJuicios,
  informeDeJuicios,
  juiciosDeLote,
  Rubrica,
  veredictoPorPares,
} from '../src/dominios/licitaciones/oferta/evalMemorias.js';

const ESPERA_MS = 30_000;
const MAX_ESPERA_MS = 3 * 60 * 60_000;

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}

async function esperar(clave: string, lote: string, n: number): Promise<void> {
  const fin = Date.now() + MAX_ESPERA_MS;
  while (juiciosDeLote(dbLicitaciones(), clave, lote).length < n) {
    if (Date.now() > fin) throw new Error('Los juicios no llegaron en 3 horas: mira la cola en Estado.');
    await new Promise((r) => setTimeout(r, ESPERA_MS));
  }
}

// Carga el caso y encola sus juicios en los dos órdenes con el mismo lote; los ejecuta el servidor en el perfil
// del crítico (este script no llama a Hermes). Con --esperar, espera a los juicios, imprime la tabla
// criterio × orden y sale con 1 si el veredicto contradice esperado.json: es la puerta antes de dar por buena
// una forma nueva de redactar la memoria.
// Uso: npx tsx scripts/evalMemorias.ts --caso casoG [--docs memoria_fuerte,memoria_floja] [--esperar] [--dir <carpeta>]
async function main(): Promise<number> {
  const clave = argumento('caso');
  if (!clave) {
    process.stderr.write('Falta --caso (p. ej. --caso casoG)\n');
    return 2;
  }
  const raiz = path.dirname(fileURLToPath(import.meta.url));
  const dir = argumento('dir') ?? path.join(raiz, '..', 'tests', 'licitaciones', 'fixtures', 'eval', clave);
  const caso = cargarCaso(dbLicitaciones(), clave, dir);
  if (caso.error) {
    process.stderr.write(`${caso.error.message}\n`);
    return 2;
  }
  for (const aviso of caso.data.avisos) process.stderr.write(`Aviso: ${aviso}\n`);
  const [a, b] = (argumento('docs') ?? 'memoria_fuerte,memoria_floja')
    .split(',')
    .map((e) => caso.data.documentos[e.trim()]);
  if (!a || !b) {
    process.stderr.write(`Documentos del caso: ${Object.keys(caso.data.documentos).join(', ')}\n`);
    return 2;
  }
  const lote = new Date().toISOString();
  encolarJuicios(nucleo().db, clave, a, b, lote);
  process.stdout.write(`Encolados los dos órdenes del lote ${lote}.\n`);
  if (argumento('esperar') === null) return 0;
  await esperar(clave, lote, 2);
  const fila = dbLicitaciones().prepare('SELECT rubrica, esperado FROM eval_casos WHERE clave = ?').get(clave) as {
    rubrica: string;
    esperado: string | null;
  };
  const etiquetas = Object.fromEntries(Object.entries(caso.data.documentos).map(([e, id]) => [id, e]));
  const juicios = juiciosDeLote(dbLicitaciones(), clave, lote);
  process.stdout.write(`${informeDeJuicios(juicios, etiquetas, Rubrica.parse(JSON.parse(fila.rubrica)))}\n`);
  return contradiceEsperado(
    veredictoPorPares(juicios),
    etiquetas,
    fila.esperado ? (JSON.parse(fila.esperado) as { preferido: string }) : null,
  )
    ? 1
    : 0;
}

main().then(
  (codigo) => process.exit(codigo),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  },
);
