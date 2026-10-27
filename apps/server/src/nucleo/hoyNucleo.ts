// Lo que aporta el núcleo a «Hoy»: propuestas que esperan a una persona fuera de los
// dominios (perfil de la empresa, perfiles leídos de un CV y notas de la Biblioteca).
import type { Db } from './db.js';
import { leerPropuestaEmpresa } from './empresa.js';
import { avisosCaducidad, hoyEspana } from './carpetaEmpresa.js';
import { listarPendientes } from '../biblioteca/motor/bandeja.js';
import type { HoyDominio, ItemHoy } from './hoy.js';

const MAX = 20;

export function hoyEmpresa(db: Db, hoy = hoyEspana()): HoyDominio {
  const p = leerPropuestaEmpresa(db);
  const item: ItemHoy[] = p
    ? [
        {
          tipo: 'perfil_empresa',
          titulo: 'Perfil de la empresa',
          detalle: `propuesto por ${p.agente === 'claude-code' ? 'Claude Code' : 'Hermes'}`,
          fecha: p.propuesto_en,
          importe: null,
          enlace: { seccion: 'ajustes', vista: 'empresa' },
        },
      ]
    : [];
  return { seccion: 'ajustes', vence: vencenEmpresa(db, hoy), por_aprobar: item, novedades: [], novedades_total: 0 };
}

// Un certificado caducado o a punto de caducar en la carpeta Empresa: hay que renovarlo antes de presentar.
function vencenEmpresa(db: Db, hoy: string): ItemHoy[] {
  return avisosCaducidad(db, hoy)
    .slice(0, MAX)
    .map((a): ItemHoy => ({
      tipo: 'documento_empresa',
      titulo: a.nombre,
      detalle: a.texto,
      fecha: a.caduca_en,
      importe: null,
      enlace: { seccion: 'ajustes', vista: 'empresa', id: String(a.id) },
      corto: a.dias < 0 ? 'Documento caducado' : 'Documento por caducar',
    }));
}

// El nombre de la persona se enseña en la web (detrás del login); nunca va al log.
export function hoyEquipo(db: Db): HoyDominio {
  const filas = db
    .prepare(
      `SELECT id, persona_id, datos, agente, actualizada_en FROM personas_propuestas WHERE estado = 'pendiente'
    ORDER BY actualizada_en DESC LIMIT ?`,
    )
    .all(MAX) as { id: number; persona_id: number | null; datos: string; agente: string; actualizada_en: string }[];
  const por = filas.map((f): ItemHoy => {
    let nombre = 'Perfil leído de un CV';
    try {
      nombre = String((JSON.parse(f.datos) as { nombre?: string }).nombre ?? nombre);
    } catch {
      /* datos dañados: se enseña sin nombre */
    }
    return {
      tipo: 'perfil_cv',
      titulo: nombre,
      detalle: f.persona_id ? 'actualización leída de un CV' : 'persona nueva leída de un CV',
      fecha: f.actualizada_en,
      importe: null,
      enlace: { seccion: 'equipo', vista: 'pendientes', id: String(f.id) },
    };
  });
  return { seccion: 'equipo', vence: [], por_aprobar: por, novedades: [], novedades_total: 0 };
}

// Sin Biblioteca configurada no hay propuestas de notas: no es un error para «Hoy».
export async function hoyBiblioteca(): Promise<HoyDominio> {
  const pendientes = await listarPendientes().catch(() => []);
  const por = pendientes.slice(0, MAX).map((p): ItemHoy => ({
    tipo: 'nota',
    titulo: p.title,
    detalle: 'nota propuesta para la Biblioteca',
    fecha: p.mtime,
    importe: null,
    enlace: { seccion: 'biblioteca', vista: 'propuestas' },
  }));
  return { seccion: 'biblioteca', vence: [], por_aprobar: por, novedades: [], novedades_total: 0 };
}
