// Lectura en streaming de los ZIP del histórico de la PLACSP, archivo a archivo desde el disco.
import fs from 'node:fs';
import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';

// Cada ZIP trae decenas de .atom de ~15 MB; se descomprime sin tener nunca el ZIP entero en memoria.
// Recibe el XML de cada .atom con su posición (0, 1, …) dentro del ZIP.
export type AlAtom = (xml: string, indice: number) => void;

type Lectura = { indice: number; fallo: string | null };

function unir(trozos: Uint8Array[]): Uint8Array {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) {
    out.set(t, pos);
    pos += t.length;
  }
  return out;
}

// Un archivo que no se arranca deja sus datos comprimidos en memoria dentro de fflate:
// los que se saltan también se arrancan, y lo descomprimido se tira.
function leerArchivo(file: UnzipFile, saltar: boolean, alTerminar: (xml: string) => void, estado: Lectura): void {
  const trozos: Uint8Array[] = [];
  file.ondata = (err, dato, final) => {
    if (err) {
      estado.fallo = err.message;
      return;
    }
    if (saltar) return;
    trozos.push(dato);
    if (final) alTerminar(new TextDecoder('utf-8').decode(unir(trozos)));
  };
  file.start();
}

function crearUnzip(saltar: number, alAtom: AlAtom, estado: Lectura): Unzip {
  const unzip = new Unzip((file) => {
    if (!file.name.toLowerCase().endsWith('.atom')) {
      leerArchivo(file, true, () => {}, estado);
      return;
    }
    const indice = estado.indice++;
    leerArchivo(
      file,
      indice < saltar,
      (xml) => {
        try {
          alAtom(xml, indice);
        } catch (err) {
          estado.fallo = errorMessage(err);
        }
      },
      estado,
    );
  });
  unzip.register(UnzipInflate);
  return unzip;
}

/**
 * Recorre los .atom de un ZIP en disco, en el orden en que están, y salta los
 * `saltar` primeros (ya procesados en una vuelta anterior). Devuelve cuántos hay.
 */
export async function recorrerAtoms(ruta: string, saltar: number, alAtom: AlAtom): Promise<Result<{ atoms: number }>> {
  const estado: Lectura = { indice: 0, fallo: null };
  const unzip = crearUnzip(saltar, alAtom, estado);
  try {
    for await (const trozo of fs.createReadStream(ruta, { highWaterMark: 1 << 20 })) {
      unzip.push(trozo as Buffer);
      if (estado.fallo) break;
    }
    if (!estado.fallo) unzip.push(new Uint8Array(0), true);
  } catch (err) {
    return fail('zip_ilegible', errorMessage(err));
  }
  if (estado.fallo) return fail('zip_ilegible', estado.fallo);
  // fflate no se queja de un archivo que no es ZIP: simplemente no encuentra nada.
  if (estado.indice === 0) return fail('zip_ilegible', 'El archivo no es un ZIP de la PLACSP o no trae ningún .atom.');
  return ok({ atoms: estado.indice });
}
