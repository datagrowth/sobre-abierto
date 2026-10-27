// Errores como valor en las fronteras de módulo: quien llama decide qué hacer,
// nada sale lanzado hacia arriba.
export type AppError = { code: string; message: string };

export type Result<T> = { data: T; error: null } | { data: null; error: AppError };

export function ok<T>(data: T): Result<T> {
  return { data, error: null };
}

export function fail<T = never>(code: string, message: string): Result<T> {
  return { data: null, error: { code, message } };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
