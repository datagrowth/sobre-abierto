// «Ver texto» de un apartado de la memoria, sin descargar el Word ni salir de las comprobaciones.
import type { Router } from 'express';
import { z } from 'zod';
import { invalido, responder } from '../../../nucleo/http.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import type { Db } from '../store.js';
import { apartadosDe, filaMemoria, type FilaApartado } from './ensamblado.js';
import { datosDeFila } from './fugasMemoria.js';
import { guionPorId } from './guion.js';
import { textoDeBloque } from './memoriaRevision.js';

// Muestra lo que Hermes redactó, la ronda en que va y cuántas veces lo rechazó el revisor (un rechazo es un
// reintento, no un error).
// texto: null mientras el apartado no se ha recibido (pendiente o fallido).
export type ApartadoTexto = {
  titulo: string;
  texto: string | null;
  ronda: number;
  rechazos: number;
  estado: FilaApartado['estado'];
};

/** El texto del apartado n (1-based) de la memoria vN, con su ronda, sus rechazos y su estado. */
function apartadoTexto(db: Db, id: string, version: number, n: number): Result<ApartadoTexto> {
  const memoria = db.prepare('SELECT id FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, version) as
    { id: number } | undefined;
  const m = memoria ? filaMemoria(db, memoria.id) : null;
  if (!m) return fail('not_found', `No hay memoria v${version} en esta oferta.`);
  // Las filas de la memoria mandan: el guion de una versión antigua puede no estar ya.
  const fila = apartadosDe(db, m.id).find((f) => f.apartado === n);
  if (!fila) return fail('not_found', `La memoria v${version} no tiene apartado ${n}.`);
  const datos = datosDeFila(fila);
  const delGuion = guionPorId(db, m.guion_id)?.datos.memoria?.apartados[n - 1]?.titulo;
  return ok({
    titulo: datos?.titulo ?? delGuion ?? `Apartado ${n}`,
    texto: datos ? datos.bloques.map(textoDeBloque).filter(Boolean).join('\n\n') : null,
    ronda: fila.ronda,
    rechazos: fila.rechazos,
    estado: fila.estado,
  });
}

const Parametros = z.object({
  version: z.coerce.number().int().positive(),
  n: z.coerce.number().int().positive().max(200),
});

export function rutasApartadoTexto(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/memoria/:version/apartados/:n',
    conId((id, req, res) => {
      const p = Parametros.safeParse(req.params);
      if (!p.success) return invalido(res, p.error);
      responder(res, apartadoTexto(dbLicitaciones(), id, p.data.version, p.data.n));
    }),
  );
}
