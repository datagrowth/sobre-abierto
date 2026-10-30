// Pasa los perfiles a incorporar de una oferta (decisiones.a_incorporar) a Equipo › A incorporar del núcleo.
import { guardarPerfilAIncorporar, retirarPerfilesAIncorporar } from '../../../nucleo/colaboradores/aIncorporar.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage } from '../../../nucleo/result.js';
import { tituloCorto } from '../tituloCorto.js';
import { obtenerLicitacion, type Db } from '../store.js';
import { textoComparable } from '../temas.js';
// Ciclo con decisiones.ts (avisarDecisiones llama aquí): solo se usa dentro de funciones.
import { decisionesDe, type PerfilAIncorporarDecidido } from './decisiones.js';

const log = logger('licitaciones');

/** La clave del perfil en Equipo: el mismo rol en los mismos lotes es el mismo perfil. */
const clavePerfil = (p: Pick<PerfilAIncorporarDecidido, 'rol_en_la_oferta' | 'lotes'>): string =>
  `${textoComparable(p.rol_en_la_oferta).trim()}|${[...p.lotes].sort().join(',')}`;

const nombrePerfil = (p: PerfilAIncorporarDecidido): string =>
  `${p.rol_en_la_oferta.charAt(0).toUpperCase()}${p.rol_en_la_oferta.slice(1)}${p.lotes.length ? ` · ${p.lotes.length === 1 ? 'lote' : 'lotes'} ${p.lotes.join(', ')}` : ''}`;

const SIGUEN = new Set(['en_preparacion', 'presentada', 'ganada']);

/** ¿Sigue la oferta? En preparación, presentada o ganada, y no retirada de la PLACSP. Los perfiles de las demás se retiran. */
export function ofertaSigue(dbLic: Db, id: string): boolean {
  const f = dbLic
    .prepare(
      'SELECT o.estado, l.borrada_en FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id WHERE o.licitacion_id = ?',
    )
    .get(id) as { estado: string; borrada_en: string | null } | undefined;
  return Boolean(f && SIGUEN.has(f.estado) && !f.borrada_en);
}

// Se hace cada vez que se guardan las decisiones: los perfiles que siguen se actualizan conservando su
// candidato y los que ya no están se retiran (núcleo, perfiles_a_incorporar).
/** Lleva los perfiles a incorporar de las decisiones de la oferta a Equipo. Un fallo se registra y no deshace el guardado. */
export function sincronizarAIncorporar(dbLic: Db, id: string, dbNucleoDado?: DbNucleo): void {
  try {
    const dbNucleo = dbNucleoDado ?? nucleo().db;
    const l = obtenerLicitacion(dbLic, id);
    if (!l) return;
    const perfiles = decisionesDe(dbLic, id)?.datos.a_incorporar ?? [];
    for (const p of perfiles) {
      const r = guardarPerfilAIncorporar(dbNucleo, {
        dominio: 'licitaciones',
        recurso: id,
        clave: clavePerfil(p),
        perfil: nombrePerfil(p),
        lote: p.lotes.length === 1 ? p.lotes[0] : null,
        requisitos: p.requisitos,
        expediente: l.expediente,
        titulo: tituloCorto(l.titulo),
        acreditar_antes: p.acreditar_antes,
        plazo: p.plazo,
        cita: p.cita,
      });
      if (r.error) log.warn('perfil a incorporar sin guardar', { id, error: r.error.message.slice(0, 200) });
    }
    retirarPerfilesAIncorporar(dbNucleo, 'licitaciones', id, perfiles.map(clavePerfil));
  } catch (err) {
    log.error('perfiles a incorporar sin sincronizar', { id, error: errorMessage(err).slice(0, 200) });
  }
}
