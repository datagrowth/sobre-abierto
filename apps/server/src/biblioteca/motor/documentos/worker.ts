// Hilo del indexador de la Biblioteca. Recibe del servidor la bóveda y dónde
// guardar índice y modelo; responde a consultas por significado y cuenta su estado.
import { parentPort, workerData } from 'node:worker_threads';
import * as store from './almacen.js';
import { MODELO_VECTORES, vectorizar, similitud } from './vectorizador.js';
import { compararIndice, vectorizarPendientes, indexarHallazgos, escanearBiblioteca } from './indexador.js';
import { VERSION_TROCEADO } from './trozos.js';
import { CONVERTIBLES, LECTURA_VERSION, TEXTO_ILEGIBLE, textoIlegible } from './extraccion.js';
import { disponible, estadoConversor } from '../../../nucleo/documentos/libreoffice.js';
import { limpiarConversiones } from '../../../nucleo/documentos/conversiones.js';
import { ocrDisponible } from '../../../nucleo/documentos/ocr.js';
import type { DatosWorker, HaciaWorker, DesdeWorker, FaseIndexador } from './protocolo.js';

const { raiz, carpetaIndice, carpetaModelos } = workerData as DatosWorker;
const LOTE_VECTORIZACION = 16;
const INACTIVIDAD_MS = 20_000;
// Sin red la primera vez no se puede bajar el modelo: se reintenta cada rato y,
// mientras, la búsqueda por palabras sigue funcionando.
const REINTENTO_MODELO_MS = 10 * 60_000;
const LIMPIEZA_CONVERSIONES_MS = 7 * 86_400_000;

const db = store.abrirIndice(carpetaIndice);
const vectores = new Map<number, Int8Array>();
let fase: FaseIndexador = 'scanning';
let errorModelo: string | null = null;
let modeloFalloEn = 0;
let despertar: (() => void) | null = null;

function enviar(mensaje: DesdeWorker): void {
  parentPort?.postMessage(mensaje);
}

function informarEstado(): void {
  enviar({
    type: 'status',
    status: {
      phase: fase,
      model: MODELO_VECTORES,
      modelError: errorModelo,
      conversor: estadoConversor(),
      ...store.estadisticasIndice(db),
    },
  });
}

// Si LibreOffice aparece (una imagen nueva con él), los .doc que fallaron por no tenerlo se
// releen; lo que ya se leyó no cambia. La caché de conversiones se poda cada semana.
async function checkConversor(): Promise<void> {
  const estado = (await disponible()).estado;
  if (store.leerMeta(db, 'conversor') !== estado) {
    if (estado === 'ok') store.olvidarArchivos(db, CONVERTIBLES);
    store.guardarMeta(db, 'conversor', estado);
  }
  const ultima = Number(store.leerMeta(db, 'conversiones_limpiadas') ?? 0);
  if (Date.now() - ultima < LIMPIEZA_CONVERSIONES_MS) return;
  await limpiarConversiones();
  store.guardarMeta(db, 'conversiones_limpiadas', String(Date.now()));
}

// Igual con el OCR: si aparece, los PDF escaneados o con el texto codificado se releen con él.
async function checkOcr(): Promise<void> {
  const estado = (await ocrDisponible()).estado;
  if (store.leerMeta(db, 'ocr') === estado) return;
  if (estado === 'ok') store.olvidarParaOcr(db, TEXTO_ILEGIBLE);
  store.guardarMeta(db, 'ocr', estado);
}

// Otra bóveda, otro modelo u otra forma de trocear: lo guardado no vale y se rehace (la
// búsqueda por palabras vuelve en cuanto se releen los archivos; los vectores, después).
function comprobarIdentidad(): void {
  const troceador = String(VERSION_TROCEADO);
  if (
    store.leerMeta(db, 'root') !== raiz ||
    store.leerMeta(db, 'model') !== MODELO_VECTORES ||
    store.leerMeta(db, 'chunker') !== troceador
  ) {
    store.reiniciarIndice(db);
    store.guardarMeta(db, 'root', raiz);
    store.guardarMeta(db, 'model', MODELO_VECTORES);
    store.guardarMeta(db, 'chunker', troceador);
  }
  const lectura = String(LECTURA_VERSION);
  if (store.leerMeta(db, 'lectura') !== lectura) {
    store.marcarIlegibles(db, textoIlegible, TEXTO_ILEGIBLE);
    store.guardarMeta(db, 'lectura', lectura);
  }
}

function cargarVectores(): void {
  vectores.clear();
  for (const { id, vec: vector } of store.todosVectores(db)) vectores.set(id, vector);
}

async function sincronizarArchivos(): Promise<boolean> {
  fase = 'scanning';
  const conocidos = store.estadosArchivos(db);
  const { removed: quitados, changed: cambiado } = compararIndice(await escanearBiblioteca(raiz), conocidos);
  quitados.forEach((p) => store.quitarArchivo(db, p));
  if (cambiado.length > 0) fase = 'reading';
  for (const [i, f] of cambiado.entries()) {
    await indexarHallazgos(db, f);
    if (i % 10 === 9) informarEstado();
  }
  // Un archivo cambiado o borrado deja vectores huérfanos en memoria.
  if (quitados.length > 0 || cambiado.some((f) => conocidos.has(f.rel))) cargarVectores();
  return quitados.length > 0 || cambiado.length > 0;
}

async function vectorizarAlgunos(maxLotes: number): Promise<boolean> {
  if (errorModelo && Date.now() - modeloFalloEn < REINTENTO_MODELO_MS) return false;
  let any = false;
  for (let i = 0; i < maxLotes; i++) {
    fase = 'embedding';
    const { done, error } = await vectorizarPendientes(db, carpetaModelos, LOTE_VECTORIZACION);
    errorModelo = error;
    if (error) modeloFalloEn = Date.now();
    if (done.length === 0) break;
    done.forEach(({ id, vec: vector }) => vectores.set(id, vector));
    any = true;
  }
  return any;
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const temporizador = setTimeout(resolve, ms);
    despertar = () => {
      clearTimeout(temporizador);
      resolve();
    };
  });
}

async function bucle(): Promise<void> {
  comprobarIdentidad();
  cargarVectores();
  for (;;) {
    await checkConversor();
    await checkOcr();
    const cambiado = await sincronizarArchivos();
    const vectorizados = await vectorizarAlgunos(32);
    const ocupado = cambiado || vectorizados;
    if (!ocupado) fase = 'idle';
    informarEstado();
    if (!ocupado) await dormir(INACTIVIDAD_MS);
  }
}

// Con `ids`, solo entre esos trozos (p. ej. los pliegos de una licitación): entre todos, lo
// de un documento concreto quedaría fuera de los primeros puestos.
async function semantica(id: number, texto: string, k: number, ids?: number[]): Promise<void> {
  if (vectores.size === 0) return enviar({ type: 'result', id, hits: [], error: null });
  const { data: datos, error } = await vectorizar([texto], 'query', carpetaModelos);
  if (!datos) return enviar({ type: 'result', id, hits: [], error });
  const q = datos[0]!;
  const aciertos: { id: number; score: number }[] = [];
  const candidatos: Iterable<[number, Int8Array | undefined]> = ids ? ids.map((i) => [i, vectores.get(i)]) : vectores;
  for (const [idTrozo, vector] of candidatos) if (vector) aciertos.push({ id: idTrozo, score: similitud(q, vector) });
  aciertos.sort((a, b) => b.score - a.score);
  enviar({ type: 'result', id, hits: aciertos.slice(0, k), error: null });
}

parentPort?.on('message', (mensaje: HaciaWorker) => {
  if (mensaje.type === 'query') void semantica(mensaje.id, mensaje.text, mensaje.k, mensaje.ids);
  else if (mensaje.type === 'rescan') despertar?.();
});

bucle().catch((err: unknown) => {
  enviar({ type: 'fatal', error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
