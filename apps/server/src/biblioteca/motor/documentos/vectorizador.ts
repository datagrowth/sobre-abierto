// Embeddings locales (búsqueda por significado): un modelo multilingüe pequeño que
// corre en el propio servidor. Se descarga la primera vez a BIBLIOTECA_MODELS_DIR.
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

export const MODELO_VECTORES = process.env.BIBLIOTECA_EMBEDDING_MODEL?.trim() || 'Xenova/multilingual-e5-small';
// El contenedor tiene 1 CPU: más hilos de ONNX solo compiten entre sí.
const HILOS = Math.max(1, Number.parseInt(process.env.BIBLIOTECA_EMBEDDING_THREADS ?? '1', 10) || 1);
const ESCALA = 127;

let cargando: Promise<FeatureExtractionPipeline> | null = null;

async function cargar(carpetaCache: string): Promise<FeatureExtractionPipeline> {
  const { pipeline: canalizacion, env: entorno } = await import('@huggingface/transformers');
  entorno.cacheDir = carpetaCache;
  return canalizacion('feature-extraction', MODELO_VECTORES, {
    dtype: 'q8',
    session_options: { intraOpNumThreads: HILOS, interOpNumThreads: 1 },
  });
}

// Vectores normalizados → int8: un cuarto de memoria y el coseno casi igual.
function cuantizar(v: ArrayLike<number>): Int8Array {
  return Int8Array.from(v, (x) => Math.max(-ESCALA, Math.min(ESCALA, Math.round(x * ESCALA))));
}

/** Coseno aproximado entre dos vectores cuantizados (−1…1). */
export function similitud(a: Int8Array, b: Int8Array): number {
  let producto = 0;
  for (let i = 0; i < a.length; i++) producto += a[i]! * b[i]!;
  return producto / (ESCALA * ESCALA);
}

export type ResultadoVectorizacion = { data: Int8Array[] | null; error: string | null };

/**
 * Vectores de varios textos. e5 distingue consultas de pasajes con un prefijo.
 * Nunca lanza: si el modelo no carga (sin red la primera vez), vuelve el error.
 */
export async function vectorizar(
  texts: string[],
  kind: 'query' | 'passage',
  carpetaCache: string,
): Promise<ResultadoVectorizacion> {
  try {
    cargando ??= cargar(carpetaCache);
    const extractorVectores = await cargando;
    const salidaModelo = await extractorVectores(
      texts.map((t) => `${kind}: ${t}`),
      { pooling: 'mean', normalize: true },
    );
    const dimensiones = salidaModelo.dims[1] ?? 0;
    const plano = salidaModelo.data as Float32Array;
    return {
      data: texts.map((_, i) => cuantizar(plano.subarray(i * dimensiones, (i + 1) * dimensiones))),
      error: null,
    };
  } catch (err) {
    cargando = null;
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
