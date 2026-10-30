// La skill «licitaciones» de Hermes desde la 3.0.0: un núcleo (SKILL.md), las fases en
// references/ y CHANGELOG.md. Los tests que comprueban sus ejemplos leen todos los .md, porque
// cada ejemplo vive en el archivo de su fase.
import fs from 'node:fs';
import path from 'node:path';

const DIR_SKILL = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'hermes-init',
  'skills',
  'licitaciones',
);

export type ArchivoSkill = { ruta: string; texto: string };

/** Los .md de la skill con su ruta relativa: SKILL.md primero, después references/ y el resto en orden. */
export function archivosSkill(): ArchivoSkill[] {
  const rutas = fs
    .readdirSync(DIR_SKILL, { recursive: true, encoding: 'utf8' })
    .map((r) => r.replace(/\\/g, '/'))
    .filter((r) => r.endsWith('.md'))
    .sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md') || a.localeCompare(b));
  return rutas.map((ruta) => ({ ruta, texto: fs.readFileSync(path.join(DIR_SKILL, ruta), 'utf8') }));
}

/** Todo el texto de la skill, como lo puede llegar a leer Hermes. */
export function leerSkill(): string {
  return archivosSkill()
    .map((a) => a.texto)
    .join('\n');
}
