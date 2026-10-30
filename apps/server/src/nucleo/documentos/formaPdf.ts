// La forma de un PDF que se va a entregar: cuántas páginas tiene y si lleva firma electrónica incrustada. Puro.
import { PDFDocument } from 'pdf-lib';
import { errorMessage, fail, ok, type Result } from '../result.js';

// La firma es un diccionario con /ByteRange y un /SubFilter de firma: PAdES o PKCS#7, la de AutoFirma por
// defecto. No valida la firma ni el certificado ni que sea PAdES estricto: eso lo hace la sede al subirlo; aquí
// basta con saber si falta.
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const SUBFILTRO_FIRMA =
  /\/SubFilter\s*\/(?:ETSI\.CAdES\.detached|adbe\.pkcs7\.detached|adbe\.pkcs7\.sha1|ETSI\.RFC3161)/;

export type FormaPdf = { paginas: number; firmado: boolean };

// Un /ByteRange con la segunda parte vacía ([0 0 0 0], o el hueco que deja un campo reservado) es
// una firma sin hacer: solo cuenta si cubre algo después del hueco de la firma.
const BYTE_RANGE = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;

/** ¿Lleva el PDF una firma electrónica incrustada? Se busca en los bytes: pdf-lib no expone los diccionarios de firma ya cerrados. */
export function firmaIncrustada(bytes: Uint8Array): boolean {
  const texto = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const cubre = [...texto.matchAll(BYTE_RANGE)].some((m) => Number(m[2]) > 0 && Number(m[3]) > 0 && Number(m[4]) > 0);
  return cubre && SUBFILTRO_FIRMA.test(texto);
}

export async function formaDePdf(bytes: Uint8Array): Promise<Result<FormaPdf>> {
  if (bytes.length > MAX_PDF_BYTES) return fail('invalid_input', 'El PDF es demasiado grande (más de 30 MB).');
  try {
    // ignoreEncryption: un PDF firmado con permisos restringidos se puede contar igual.
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return ok({ paginas: doc.getPageCount(), firmado: firmaIncrustada(bytes) });
  } catch (err) {
    return fail('invalid_input', `No se puede leer el PDF: ${errorMessage(err).slice(0, 200)}`);
  }
}
