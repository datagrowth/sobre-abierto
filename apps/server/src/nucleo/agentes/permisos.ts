// Qué puede hacer cada agente en cada dominio. «proponer» incluye «leer»; nada
// más: ningún agente escribe hechos ni aprueba, eso lo hacen el código y las personas.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const DOMINIOS = ['biblioteca', 'licitaciones', 'plataforma', 'colaboradores'] as const;
export type Dominio = (typeof DOMINIOS)[number];
export type Accion = 'leer' | 'proponer';
export type Permisos = Partial<Record<Dominio, Accion>>;

const RANGO: Record<Accion, number> = { leer: 1, proponer: 2 };

// Cualquier agente con token: leer licitaciones y la empresa y proponer notas. Colaboradores (los
// CV) no va por defecto: un agente con terminal que lee pliegos no confiables podría sacarlos con
// una inyección de prompt; solo lo tienen los perfiles de licitaciones, o quien lo conceda en
// permisos.json. El perfil general «hermes» propone además en licitaciones y plataforma.
// «plataforma: proponer» es proponer el perfil de la empresa, que guarda una persona.
const POR_DEFECTO: Permisos = {
  biblioteca: 'proponer',
  licitaciones: 'leer',
  plataforma: 'leer',
};
const AMPLIADOS: Record<string, Permisos> = {
  hermes: { licitaciones: 'proponer', plataforma: 'proponer' },
  // Claude Code es la herramienta de una persona del equipo en su máquina, no un agente que lea pliegos de fuera.
  'claude-code': { plataforma: 'proponer', colaboradores: 'leer' },
};
// Los agentes de un dominio solo ven sus herramientas, la Biblioteca y el perfil de la
// empresa: así el de licitaciones no se distrae con lo demás. Colaboradores va con licitaciones porque los equipos se piden en los pliegos.
const ESPECIALIZADOS: Record<string, Permisos> = {
  licitaciones: { biblioteca: 'proponer', plataforma: 'proponer', licitaciones: 'proponer', colaboradores: 'proponer' },
  // El perfil que prepara las ofertas de licitaciones (otro modelo, mismas herramientas).
  'oferta-licitaciones': {
    biblioteca: 'proponer',
    plataforma: 'proponer',
    licitaciones: 'proponer',
    colaboradores: 'proponer',
  },
  // El crítico ciego de la memoria (otro modelo): solo licitaciones, sin colaboradores (los CV)
  // ni la Biblioteca; lo que lee de más lo delata la auditoría.
  'critico-licitaciones': { licitaciones: 'proponer' },
};

const Ajuste = z.enum(['leer', 'proponer', 'ninguno']);
const ArchivoPermisos = z.record(z.string(), z.record(z.string(), Ajuste));
type Ajustes = Record<string, Partial<Record<Dominio, z.infer<typeof Ajuste>>>>;

const esDominio = (d: string): d is Dominio => (DOMINIOS as readonly string[]).includes(d);

// Un dominio retirado (o mal escrito) se descarta solo: si invalidara el archivo entero se
// perderían también los «ninguno» del resto.
function soloDominiosVigentes(archivo: z.infer<typeof ArchivoPermisos>): { data: Ajustes; descartados: string[] } {
  const descartados = new Set<string>();
  const data = Object.fromEntries(
    Object.entries(archivo).map(([agente, ajustes]) => {
      for (const d of Object.keys(ajustes)) if (!esDominio(d)) descartados.add(d);
      return [agente, Object.fromEntries(Object.entries(ajustes).filter(([d]) => esDominio(d)))];
    }),
  );
  return { data, descartados: [...descartados] };
}

export function permisosDe(nombre: string, ajustes: Ajustes = {}): Permisos {
  const propios = ESPECIALIZADOS[nombre] ?? { ...POR_DEFECTO, ...AMPLIADOS[nombre] };
  const base: Record<string, Accion | 'ninguno'> = { ...propios, ...ajustes[nombre] };
  return Object.fromEntries(Object.entries(base).filter(([, a]) => a !== 'ninguno')) as Permisos;
}

export function puede(permisos: Permisos, dominio: Dominio, accion: Accion): boolean {
  const tiene = permisos[dominio];
  return tiene !== undefined && RANGO[tiene] >= RANGO[accion];
}

/**
 * permisos.json opcional junto a los tokens; si está mal escrito se ignora entero. Los dominios
 * que no existen vuelven en `descartados`.
 */
export function leerAjustesPermisos(dir: string): { data: Ajustes; descartados: string[]; error: string | null } {
  const file = path.join(dir, 'permisos.json');
  if (!fs.existsSync(file)) return { data: {}, descartados: [], error: null };
  try {
    const parsed = ArchivoPermisos.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    return parsed.success
      ? { ...soloDominiosVigentes(parsed.data), error: null }
      : { data: {}, descartados: [], error: 'permisos.json no tiene el formato esperado' };
  } catch (err) {
    return {
      data: {},
      descartados: [],
      error: `permisos.json no se pudo leer: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
