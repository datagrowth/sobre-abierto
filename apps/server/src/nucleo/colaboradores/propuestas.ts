// Alta desde CV: un trabajo para Hermes lee el CV y propone el perfil estructurado; una persona lo aprueba.
import fs from 'node:fs';
import { z } from 'zod';
import { ahora, type Db } from '../db.js';
import { emitir } from '../eventos.js';
import { encolarUnico } from '../trabajos.js';
import { logger } from '../log.js';
import { fail, ok, type Result } from '../result.js';
import {
  actualizarPersona,
  crearPersona,
  cvSuprimido,
  obtenerPersona,
  PerfilProfesional,
  personaPorCv,
  RutaCv,
  type PersonaGuardada,
} from './personas.js';
import { cvEnDisco, hashCv, TIPO_PERFIL_CV } from './cvs.js';

// El CV se sube a Conocimiento/Colaboradores/ y Hermes propone el perfil con colaboradores_proponer_perfil (zod
// estricto). Queda pendiente y una persona lo aprueba (tal cual o corregido) o lo rechaza en la web.
export const PayloadPerfilCv = z.object({
  cv_ruta: z.string().min(1),
  persona_id: z.number().int().positive().nullable(),
  pedida_en: z.string().min(10),
});

export const PedidoPerfilCv = z.strictObject({ cv_ruta: RutaCv, persona_id: z.number().int().positive().optional() });

export const PerfilEntrada = z.strictObject({
  cv_ruta: RutaCv,
  persona_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Id del colaborador si el CV es de alguien que ya está dado de alta'),
  perfil: PerfilProfesional,
});
export type PerfilEntradaData = z.infer<typeof PerfilEntrada>;

export type EstadoPropuesta = 'pendiente' | 'aprobada' | 'rechazada';
export type PropuestaPerfil = {
  id: number;
  persona_id: number | null;
  cv_ruta: string;
  estado: EstadoPropuesta;
  agente: string;
  creada_en: string;
  actualizada_en: string;
  revisada_en: string | null;
  perfil: z.infer<typeof PerfilProfesional>;
};
type Fila = Omit<PropuestaPerfil, 'perfil'> & { datos: string };

const log = logger('colaboradores');

function aPropuesta(f: Fila | undefined): PropuestaPerfil | null {
  if (!f) return null;
  const perfil = PerfilProfesional.safeParse(JSON.parse(f.datos));
  if (perfil.success)
    return {
      id: f.id,
      persona_id: f.persona_id,
      cv_ruta: f.cv_ruta,
      estado: f.estado,
      agente: f.agente,
      creada_en: f.creada_en,
      actualizada_en: f.actualizada_en,
      revisada_en: f.revisada_en,
      perfil: perfil.data,
    };
  log.warn('perfil propuesto no válido', {
    propuesta: f.id,
    campos: perfil.error.issues
      .map((i) => i.path.join('.'))
      .slice(0, 10)
      .join(','),
  });
  return null;
}

function cvExiste(biblioteca: string | null, cvRuta: string): boolean {
  const destino = biblioteca === null ? null : cvEnDisco(biblioteca, cvRuta);
  return destino !== null && fs.existsSync(destino);
}

/**
 * Encola la lectura de un CV; si ya hay una en cola o en marcha para ese CV, devuelve esa.
 * `biblioteca` es la raíz de la Biblioteca, la misma en la que se subió el CV.
 */
export function pedirPerfilDesdeCv(
  db: Db,
  biblioteca: string | null,
  pedido: z.infer<typeof PedidoPerfilCv>,
): Result<{ trabajo: number }> {
  if (!cvExiste(biblioteca, pedido.cv_ruta))
    return fail('not_found', 'Ese CV no está en la Biblioteca (súbelo antes a Colaboradores/).');
  if (pedido.persona_id !== undefined && obtenerPersona(db, pedido.persona_id).error)
    return fail('not_found', `No hay ningún colaborador con id ${pedido.persona_id}.`);
  const enCurso = db
    .prepare(
      `SELECT id FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.cv_ruta') = ?`,
    )
    .get(TIPO_PERFIL_CV, pedido.cv_ruta) as { id: number } | undefined;
  if (enCurso) return ok({ trabajo: enCurso.id });
  const pedida = ahora();
  // La clave viaja a Hermes como Idempotency-Key: un hash, no el nombre del archivo.
  const hash = hashCv(pedido.cv_ruta);
  const payload = { cv_ruta: pedido.cv_ruta, persona_id: pedido.persona_id ?? null, pedida_en: pedida };
  return ok({
    trabajo: encolarUnico(db, { tipo: TIPO_PERFIL_CV, dominio: 'colaboradores', base: `perfil-cv-${hash}`, payload })
      .id,
  });
}

// Un CV nuevo de alguien que ya existe se sube con otro nombre (la subida nunca pisa):
// si Hermes no manda el persona_id, vale el que se pidió al encolar la lectura.
function personaPedida(db: Db, cvRuta: string): number | null {
  const f = db
    .prepare(
      `SELECT json_extract(payload, '$.persona_id') AS persona FROM trabajos_ia WHERE tipo = ?
    AND json_extract(payload, '$.cv_ruta') = ? AND json_extract(payload, '$.persona_id') IS NOT NULL ORDER BY id DESC LIMIT 1`,
    )
    .get(TIPO_PERFIL_CV, cvRuta) as { persona: number } | undefined;
  return f && !obtenerPersona(db, f.persona).error ? f.persona : null;
}

/** Guarda el perfil leído de un CV como pendiente; si ya había uno pendiente de ese CV, lo sustituye. */
export function proponerPerfil(
  db: Db,
  entrada: PerfilEntradaData,
  agente: string,
): Result<{ propuesta: number; estado: 'pendiente'; sustituye: boolean }> {
  if (cvSuprimido(db, entrada.cv_ruta))
    return fail(
      'conflicto',
      'Ese CV es de una persona borrada y su lectura se canceló: para volver a darla de alta, pide de nuevo la lectura desde la web.',
    );
  if (entrada.persona_id !== undefined && obtenerPersona(db, entrada.persona_id).error)
    return fail('not_found', `No hay ningún colaborador con id ${entrada.persona_id}.`);
  const personaId = entrada.persona_id ?? personaPorCv(db, entrada.cv_ruta) ?? personaPedida(db, entrada.cv_ruta);
  const ts = ahora();
  const previa = db
    .prepare("SELECT id FROM personas_propuestas WHERE cv_ruta = ? AND estado = 'pendiente'")
    .get(entrada.cv_ruta) as { id: number } | undefined;
  let id = previa?.id ?? 0;
  if (previa)
    db.prepare(
      'UPDATE personas_propuestas SET datos = ?, persona_id = ?, agente = ?, actualizada_en = ? WHERE id = ?',
    ).run(JSON.stringify(entrada.perfil), personaId, agente, ts, previa.id);
  else
    id = Number(
      db
        .prepare(
          "INSERT INTO personas_propuestas (persona_id, cv_ruta, estado, datos, agente, creada_en, actualizada_en) VALUES (?, ?, 'pendiente', ?, ?, ?, ?)",
        )
        .run(personaId, entrada.cv_ruta, JSON.stringify(entrada.perfil), agente, ts, ts).lastInsertRowid,
    );
  emitir(db, {
    tipo: 'colaboradores.propuesta',
    dominio: 'colaboradores',
    recurso: String(id),
    datos: { estado: 'pendiente', agente },
  });
  return ok({ propuesta: id, estado: 'pendiente', sustituye: Boolean(previa) });
}

export function listarPropuestas(db: Db, estado: EstadoPropuesta = 'pendiente'): PropuestaPerfil[] {
  const filas = db
    .prepare('SELECT * FROM personas_propuestas WHERE estado = ? ORDER BY actualizada_en DESC, id DESC')
    .all(estado) as Fila[];
  return filas.map(aPropuesta).filter((p): p is PropuestaPerfil => p !== null);
}

/** ¿Llegó un perfil de ese CV después de pedirlo? Es la comprobación «hecho» del trabajo. */
export function perfilRecibido(db: Db, cvRuta: string, desde: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM personas_propuestas WHERE cv_ruta = ? AND actualizada_en >= ?').get(cvRuta, desde),
  );
}

// La persona decide sobre la versión que ha visto (actualizada_en). Puede corregir el
// perfil antes de aprobarlo: entonces manda la ficha completa, que se valida entera.
export const RevisionPerfil = z.strictObject({
  decision: z.enum(['aprobar', 'rechazar']),
  version: z.string().min(10).max(40),
  persona: z.unknown().optional(),
});
export type RevisionPerfilData = z.infer<typeof RevisionPerfil>;

const CONFLICTO = 'Hermes ha enviado otra versión de este perfil: recarga y revísalo antes de decidir.';

// Al aprobar sobre alguien que ya existe, lo que no sale de un CV (tarifa, notas, activo)
// se conserva. Con la ficha corregida en la web, manda esa.
function personaAprobada(db: Db, p: PropuestaPerfil, editada: unknown): Result<PersonaGuardada> {
  const previa = p.persona_id ? obtenerPersona(db, p.persona_id).data : null;
  const conservado = previa ? { tarifa_hora: previa.tarifa_hora, notas: previa.notas, activo: previa.activo } : {};
  const datos = editada ?? { ...conservado, ...p.perfil, cv_ruta: p.cv_ruta };
  return p.persona_id ? actualizarPersona(db, p.persona_id, datos) : crearPersona(db, datos);
}

/** Una persona aprueba (creando o actualizando el colaborador) o rechaza el perfil que vio. */
export function revisarPerfil(
  db: Db,
  id: number,
  rev: RevisionPerfilData,
): Result<{ propuesta: number; estado: EstadoPropuesta; persona: number | null }> {
  const p = aPropuesta(
    db.prepare("SELECT * FROM personas_propuestas WHERE id = ? AND estado = 'pendiente'").get(id) as Fila | undefined,
  );
  if (!p) return fail('not_found', 'No hay ningún perfil pendiente con ese id.');
  if (p.actualizada_en !== rev.version) return fail('conflicto', CONFLICTO);
  return db.transaction((): Result<{ propuesta: number; estado: EstadoPropuesta; persona: number | null }> => {
    const persona = rev.decision === 'aprobar' ? personaAprobada(db, p, rev.persona) : null;
    if (persona?.error) return persona;
    const estado: EstadoPropuesta = rev.decision === 'aprobar' ? 'aprobada' : 'rechazada';
    const cambio = db
      .prepare(
        "UPDATE personas_propuestas SET estado = ?, persona_id = COALESCE(?, persona_id), revisada_en = ? WHERE id = ? AND estado = 'pendiente' AND actualizada_en = ?",
      )
      .run(estado, persona?.data.id ?? null, ahora(), id, rev.version);
    if (cambio.changes === 0) return fail('conflicto', CONFLICTO);
    emitir(db, { tipo: 'colaboradores.propuesta', dominio: 'colaboradores', recurso: String(id), datos: { estado } });
    return ok({ propuesta: id, estado, persona: persona?.data.id ?? null });
  })();
}

export function instruccionesPerfilCv(p: z.infer<typeof PayloadPerfilCv>, empresa: string): string {
  const destino = p.persona_id ? ` y persona_id=${p.persona_id} (actualiza a un colaborador que ya existe)` : '';
  return [
    `Tarea automática de la plataforma de ${empresa}: lee un CV y propone el perfil del colaborador.`,
    `1. Lee el CV con biblioteca_leer (ruta=${p.cv_ruta}), por partes y hasta el final (sigue con desde=hasta).`,
    `2. Envía el perfil con colaboradores_proponer_perfil (cv_ruta=${p.cv_ruta}${destino}): nombre, tipo («interno» si el CV es de alguien de ${empresa}, «externo» si no; ante la duda, «externo»), rol, titulaciones (con nivel y rama, p. ej. «Grado en Ingeniería Informática»), certificaciones, anios_experiencia (años de experiencia profesional, no de estudios), sectores, cpv (solo si los proyectos los dejan claros; si no, vacío), tecnologias (herramientas, lenguajes y metodologías), idiomas con su nivel A1–C2 o «nativo» (null si el CV no lo dice), docencia (una entrada por materia impartida: materia, horas, años desde y hasta, y evidencia con la página del CV, p. ej. «CV, pág. 2»; solo horas que el CV dé en cifra, sin estimarlas) y linkedin con la dirección del perfil (linkedin.com/in/…) si el CV la trae: el PDF que exporta LinkedIn la pone en «Contactar».`,
    '   Salvo el LinkedIn, no incluyas datos de contacto, DNI, dirección, fecha de nacimiento ni foto: el esquema no los admite. No inventes: lo que el CV no diga, déjalo vacío o null.',
    '3. Si la herramienta responde con un error, corrige lo que indique y vuelve a enviarlo.',
    'No hagas nada más: no propongas notas, no escribas en la Biblioteca ni respondas en ningún canal.',
  ].join('\n');
}
