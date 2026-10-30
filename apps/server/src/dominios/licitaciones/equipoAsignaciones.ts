// Dónde está cada persona del equipo: las ofertas en cuyas decisiones figura, su rol y el estado de la oferta.
import { z } from 'zod';
import type { Asignacion, EstadoAsignacion } from '../../nucleo/colaboradores/disponibilidad.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { detalleEdicion, leerJson, sumarDuracion } from './antecedentes/linea.js';
import { corto, TITULO_FICHA } from './pipeline.js';
import type { Db } from './store.js';

// Solo el equipo de las decisiones: lo demás no hace falta y no tiene por qué validar entero.
const EquipoDecidido = z
  .object({
    equipo: z
      .array(
        z
          .object({ persona_id: z.number().int().positive(), rol_en_la_oferta: z.string() })
          .catch({ persona_id: 0, rol_en_la_oferta: '' }),
      )
      .catch([]),
  })
  .catch({ equipo: [] });

type Fila = {
  id: string;
  expediente: string;
  titulo: string;
  titulo_ficha: string | null;
  estado: string;
  adjudicada: string | null;
  fecha_limite: string | null;
  datos: string;
};

// Un contrato ganado está «en ejecución» hasta su fin (el del periodo publicado o el inicio más la duración); sin
// fecha de fin, durante el año siguiente a la adjudicación. De aquí sale la disponibilidad calculada del núcleo
// (colaboradores/disponibilidad.ts).
const DIAS_SIN_FIN = 365;

function finDelContrato(db: Db, f: Fila): string | null {
  const d = detalleEdicion(db, f.id);
  if (d.periodo?.fin) return d.periodo.fin;
  const inicio = d.periodo?.inicio ?? [...d.inicios.values()].sort()[0] ?? f.adjudicada;
  return inicio && d.duracion ? sumarDuracion(inicio.slice(0, 10), d.duracion) : null;
}

function estadoGanada(
  db: Db,
  f: Fila,
  hoy: string,
  haceUnAnio: string,
): { estado: EstadoAsignacion; hasta: string | null } {
  const fin = finDelContrato(db, f);
  if (fin) return fin >= hoy ? { estado: 'en_ejecucion', hasta: fin } : { estado: 'ganada', hasta: fin };
  const desde = (f.adjudicada ?? f.fecha_limite ?? '').slice(0, 10);
  return desde >= haceUnAnio ? { estado: 'en_ejecucion', hasta: null } : { estado: 'ganada', hasta: null };
}

const ESTADOS: Record<string, EstadoAsignacion> = {
  en_preparacion: 'en_preparacion',
  presentada: 'presentada',
  perdida: 'perdida',
};

/** Una asignación por persona y oferta, con sus roles juntos. */
export function asignacionesLicitaciones(db: Db, ahoraMs = Date.now()): Asignacion[] {
  const hoy = horaLocalEspana(ahoraMs).slice(0, 10);
  const haceUnAnio = horaLocalEspana(ahoraMs - DIAS_SIN_FIN * 86_400_000).slice(0, 10);
  const filas = db
    .prepare(
      `SELECT l.id, l.expediente, l.titulo, l.fecha_limite, o.estado, d.datos, ${TITULO_FICHA},
      (SELECT MAX(a.fecha) FROM adjudicaciones a WHERE a.licitacion_id = l.id) AS adjudicada
    FROM decisiones_oferta d JOIN oportunidades o ON o.licitacion_id = d.licitacion_id JOIN licitaciones l ON l.id = d.licitacion_id
    WHERE o.estado IN ('en_preparacion', 'presentada', 'ganada', 'perdida') AND l.borrada_en IS NULL`,
    )
    .all() as Fila[];
  return filas.flatMap((f) => {
    const roles = new Map<number, string[]>();
    for (const m of EquipoDecidido.parse(leerJson(f.datos)).equipo.filter((x) => x.persona_id > 0)) {
      roles.set(
        m.persona_id,
        [...new Set([...(roles.get(m.persona_id) ?? []), m.rol_en_la_oferta.trim()])].filter(Boolean),
      );
    }
    const { estado, hasta } =
      f.estado === 'ganada' ? estadoGanada(db, f, hoy, haceUnAnio) : { estado: ESTADOS[f.estado]!, hasta: null };
    return [...roles].map(([persona_id, rs]): Asignacion => ({
      persona_id,
      dominio: 'licitaciones',
      recurso: f.id,
      expediente: f.expediente,
      titulo: corto(f),
      rol: rs.join(', '),
      estado,
      hasta,
    }));
  });
}
