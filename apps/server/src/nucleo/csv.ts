// CSV para Excel en español, sin dependencias: UTF-8 con BOM, separador «;», coma decimal y CRLF.
import type { Response } from 'express';
import { horaLocalEspana } from './fechas.js';

type Valor = string | number | boolean | null | undefined;
/** tipo: «porcentaje» para una fracción (0,085 → «8,5%»); «numero», con coma decimal; si no, texto. */
export type Columna<T> = { titulo: string; valor: (fila: T) => Valor; tipo?: 'numero' | 'porcentaje' };

// Las comillas van solo donde hacen falta. Un texto que empieza por «=», «+», «-», «@» o un tabulador va con un
// apóstrofo delante: si no, Excel lo ejecutaría como fórmula (inyección en CSV; un título de la PLACSP puede
// empezar por cualquier cosa).
const FORMULA = /^[=+\-@\t\r]/;

function texto(v: Valor, tipo: Columna<unknown>['tipo']): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number') {
    const n = tipo === 'porcentaje' ? Math.round(v * 10_000) / 100 : v;
    return `${String(n).replace('.', ',')}${tipo === 'porcentaje' ? '%' : ''}`;
  }
  return FORMULA.test(v) ? `'${v}` : v;
}

const celda = (s: string): string => (/[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** El CSV entero, con la cabecera y la marca BOM. */
export function aCsv<T>(columnas: readonly Columna<T>[], filas: readonly T[]): string {
  const lineas = [
    columnas.map((c) => celda(c.titulo)),
    ...filas.map((f) => columnas.map((c) => celda(texto(c.valor(f), c.tipo)))),
  ];
  return `\uFEFF${lineas.map((l) => l.join(';')).join('\r\n')}\r\n`;
}

/** Responde con el CSV como descarga: «<nombre>-<día peninsular>.csv». `nombre` es fijo del código. */
export function enviarCsv(res: Response, nombre: string, contenido: string): void {
  const dia = horaLocalEspana().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}-${dia}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/csv; charset=utf-8').send(contenido);
}
