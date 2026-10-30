// Filas de trabajos_ia sembradas a mano para los tests de la cola que no lanzan ningún run.
import type { Db } from '../../src/nucleo/db.js';

export const insertarFallido = (
  d: Db,
  clave: string,
  error: string | null,
  extra: { codigo?: string | null; dominio?: string; payload?: string; actualizado?: string; estado?: string } = {},
) =>
  d
    .prepare(
      `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, error, codigo, creado_en, actualizado_en) VALUES ('prueba', ?, ?, ?, ?, ?, ?, 'x', ?)`,
    )
    .run(
      extra.dominio ?? 'test',
      clave,
      extra.payload ?? '{}',
      extra.estado ?? 'fallido',
      error,
      extra.codigo ?? null,
      extra.actualizado ?? new Date().toISOString(),
    );

export const insertarTrabajo = (
  d: Db,
  clave: string,
  t: {
    estado: string;
    payload?: string;
    dominio?: string;
    creado: string;
    actualizado?: string;
    lanzado?: string | null;
    codigo?: string | null;
  },
) =>
  d
    .prepare(
      `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, codigo, creado_en, actualizado_en, lanzado_en) VALUES ('prueba', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.dominio ?? 'licitaciones',
      clave,
      t.payload ?? '{}',
      t.estado,
      t.codigo ?? null,
      t.creado,
      t.actualizado ?? t.creado,
      t.lanzado ?? null,
    ).lastInsertRowid as number;
