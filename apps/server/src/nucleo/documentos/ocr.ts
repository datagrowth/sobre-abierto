// OCR de PDF escaneados: pdftoppm pasa cada página a imagen y tesseract la lee en español.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { errorMessage, fail, ok, type Result } from '../result.js';

// Va en el servidor y no en Hermes porque el texto de los pliegos lo extrae e indexa el servidor
// (biblioteca/motor/documentos) y Hermes lo lee de ahí; no es IA. Es opcional, como LibreOffice: sin los
// binarios (o con OCR_ACTIVO=0) el PDF sigue saliendo «escaneado» y quien lo necesita lo sabe. Una página cada
// vez y tesseract con un hilo, para no quitarle la CPU al servidor.
const ejecutar = promisify(execFile);

type EstadoOcr = 'ok' | 'ausente' | 'apagado';
export type Ocr = { estado: EstadoOcr; tesseract: string | null; pdftoppm: string | null };
type Entorno = {
  OCR_ACTIVO?: string | undefined;
  TESSERACT_BIN?: string | undefined;
  PDFTOPPM_BIN?: string | undefined;
};

// Un pliego largo se lee hasta aquí: el resto queda sin texto (se dice en el aviso).
const MAX_PAGINAS_OCR = 150;
const RESOLUCION = 200;
const TIMEOUT_PAGINA_MS = 60_000;
const IDIOMA = 'spa';
const ENTORNO_TESSERACT = { ...process.env, OMP_THREAD_LIMIT: '1' };

async function responde(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await ejecutar(bin, args, { timeout: 30_000, killSignal: 'SIGKILL', windowsHide: true });
    return `${stdout}${stderr}`;
  } catch {
    return null;
  }
}

/** Sin caché: tesseract con el idioma español y pdftoppm en el entorno dado (los tests pasan el suyo). */
export async function comprobarOcr(entorno: Entorno = process.env): Promise<Ocr> {
  if (entorno.OCR_ACTIVO === '0') return { estado: 'apagado', tesseract: null, pdftoppm: null };
  const tesseract = entorno.TESSERACT_BIN?.trim() || 'tesseract';
  const pdftoppm = entorno.PDFTOPPM_BIN?.trim() || 'pdftoppm';
  const idiomas = await responde(tesseract, ['--list-langs']);
  const poppler = await responde(pdftoppm, ['-v']);
  if (!idiomas || !new RegExp(`^${IDIOMA}$`, 'm').test(idiomas) || poppler === null)
    return { estado: 'ausente', tesseract: null, pdftoppm: null };
  return { estado: 'ok', tesseract, pdftoppm };
}

let comprobacion: Promise<Ocr> | null = null;

/** Si hay OCR (cacheado por proceso: los binarios no aparecen ni desaparecen en caliente). */
export function ocrDisponible(): Promise<Ocr> {
  comprobacion ??= comprobarOcr();
  return comprobacion;
}

// Las imágenes que deja pdftoppm («p-01.png», «p-002.png»…), en orden de página.
async function imagenesDe(dir: string): Promise<string[]> {
  const nombres = (await fs.readdir(dir)).filter((n) => n.endsWith('.png'));
  const num = (n: string) => Number(/-(\d+)\.png$/.exec(n)?.[1] ?? 0);
  return nombres.sort((a, b) => num(a) - num(b)).map((n) => path.join(dir, n));
}

/** El texto de cada página de un PDF escaneado, hasta MAX_PAGINAS_OCR. */
export async function ocrDePdf(rutaAbs: string, o: Ocr, maxPaginas = MAX_PAGINAS_OCR): Promise<Result<string[]>> {
  if (o.estado !== 'ok' || !o.tesseract || !o.pdftoppm)
    return fail('ocr_ausente', 'No hay OCR en este servidor (tesseract con español y pdftoppm).');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-'));
  try {
    await ejecutar(
      o.pdftoppm,
      ['-r', String(RESOLUCION), '-gray', '-png', '-f', '1', '-l', String(maxPaginas), rutaAbs, path.join(dir, 'p')],
      { timeout: TIMEOUT_PAGINA_MS * maxPaginas, killSignal: 'SIGKILL', windowsHide: true },
    );
    const paginas: string[] = [];
    for (const img of await imagenesDe(dir)) {
      const { stdout } = await ejecutar(o.tesseract, [img, 'stdout', '-l', IDIOMA], {
        timeout: TIMEOUT_PAGINA_MS,
        killSignal: 'SIGKILL',
        windowsHide: true,
        env: ENTORNO_TESSERACT,
        maxBuffer: 16 * 1024 * 1024,
      });
      paginas.push(stdout.replace(/[ \t]+\n/g, '\n').trim());
    }
    return ok(paginas);
  } catch (err) {
    return fail('ocr_fallido', `El OCR no pudo leer el PDF: ${errorMessage(err).slice(0, 200)}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
