// Pedir a Hermes el relleno de un anexo: comprueba el guion, los frenos (plazo y vía alternativa) y
// el modelo, y encola un único trabajo aunque llegue un doble clic.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Raices } from '../../../nucleo/salidas.js';
import { encolarUnico } from '../../../nucleo/trabajos.js';
import type { Db } from '../store.js';
import { decisionesDe } from './decisiones.js';
import { seccionesDeAnexo } from './dependenciasAnexo.js';
import { documentoDelGuion, sincronizarDocumentos, type DocumentoConClave } from './documentos.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { TIPO_ANEXO, trabajoAnexo } from './anexosTrabajo.js';
import { modeloParaPedir } from './anexosModeloPdf.js';
import { frenosConfirmables } from './anexosVia.js';

type Destino = { guion: GuionGuardado; d: DocumentoConClave };
/** Las bases de datos y las carpetas con que trabaja el relleno. */
export type ContextoAnexo = { db: Db; dbNucleo: DbNucleo; raices: Raices };

export function destinoDe(db: Db, raices: Raices, id: string, clave: string): Result<Destino> {
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  if (!raices.salidas)
    return fail('no_configurado', 'Falta SALIDAS_DIR en el servidor: el anexo rellenado se guarda en Salidas.');
  const guion = guionVigente(db, id);
  if (!guion) return fail('conflicto', 'Esta licitación aún no tiene guion de la oferta: pídelo primero.');
  // Pedir y recibir un anexo escriben en su fila: la checklist tiene que estar al día con el guion.
  sincronizarDocumentos(db, id, guion);
  const d = documentoDelGuion(guion.datos, clave);
  return d
    ? ok({ guion, d })
    : fail('not_found', `El guion vigente (v${guion.version}) no tiene el documento «${clave}».`);
}

/**
 * Encola el relleno de un anexo (o devuelve el que ya está en curso) si da tiempo antes del plazo.
 * porAgente (licitaciones_pedir): no levanta el freno del tipo, que solo quita una persona.
 */
export async function pedirAnexo(
  c: ContextoAnexo,
  id: string,
  clave: string,
  op: { confirmado?: boolean; porAgente?: boolean } = {},
): Promise<Result<{ trabajo: number; clave: string }>> {
  const { db, dbNucleo, raices } = c;
  const dest = destinoDe(db, raices, id, clave);
  if (dest.error) return dest;
  const frenos = frenosConfirmables(db, id, dest.data.d, op.confirmado);
  if (frenos.error) return frenos;
  const enCurso = trabajoAnexo(db, id, clave);
  if (enCurso) return ok({ trabajo: enCurso.id, clave });
  const modelo = await modeloParaPedir(db, raices, id, dest.data.d);
  if (modelo.error) return fail('invalid_input', modelo.error.message);
  // Las instrucciones del run leen el modelo (el .docx, su conversión o el PDF) de aquí.
  db.prepare('UPDATE oferta_documentos SET anexo_modelo = ? WHERE licitacion_id = ? AND clave = ?').run(
    modelo.data,
    id,
    clave,
  );
  const pedida = new Date().toISOString();
  const dec = decisionesDe(db, id);
  const dependencias = dec ? seccionesDeAnexo(dest.data.d.doc.tipo, dest.data.d.lote, dec.datos) : undefined;
  // Único por base: tras el await de arriba, un doble clic llega aquí dos veces.
  const trabajo = encolarUnico(dbNucleo, {
    tipo: TIPO_ANEXO,
    dominio: 'licitaciones',
    base: `anexo-${id}-${clave}`,
    payload: { id, clave, pedida_en: pedida, dependencias },
    aMano: !op.porAgente,
  }).id;
  return ok({ trabajo, clave });
}
