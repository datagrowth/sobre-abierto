// Genera src/datos/cpv.json con el vocabulario CPV 2008 oficial de la UE en español.
// Solo hace falta si la UE publica otra versión.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

type Texto = { '@_LANG': string; '#text': string };
type Codigo = { '@_CODE': string; TEXT: Texto[] };

const DESTINO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'datos', 'cpv.json');
// Los códigos van sin el dígito de control, como los guarda la ingesta (8 cifras).
const CODIGO = /^(\d{8})-\d$/;

function filas(xml: string): [string, string][] {
  const p = new XMLParser({ ignoreAttributes: false, isArray: (nombre) => nombre === 'CPV' || nombre === 'TEXT' });
  const raiz = p.parse(xml) as { CPV_CODE: { CPV: Codigo[] } };
  return raiz.CPV_CODE.CPV.map((c): [string, string] => {
    const codigo = CODIGO.exec(c['@_CODE'])?.[1];
    const es = c.TEXT.find((t) => t['@_LANG'] === 'ES')?.['#text']?.trim();
    if (!codigo || !es) throw new Error(`Código sin forma o sin texto en español: ${c['@_CODE']}`);
    return [codigo, es.replace(/\s+/g, ' ')];
  }).sort(([a], [b]) => a.localeCompare(b));
}

// El XML sale del ZIP oficial de TED:
//   curl -L -o cpv.zip https://ted.europa.eu/documents/d/ted/cpv_2008_xml && unzip cpv.zip
//   npx tsx scripts/generarCpv.ts <ruta>/cpv_2008.xml
const origen = process.argv[2];
if (!origen) {
  process.stderr.write('Uso: npx tsx scripts/generarCpv.ts <ruta>/cpv_2008.xml\n');
  process.exit(1);
}
const vocabulario = filas(fs.readFileSync(origen, 'utf8'));
// Una fila por línea: el diff de una versión nueva de la UE se lee código a código.
fs.writeFileSync(DESTINO, `[\n${vocabulario.map((f) => `  ${JSON.stringify(f)}`).join(',\n')}\n]\n`);
process.stdout.write(`${vocabulario.length} códigos en ${DESTINO}\n`);
