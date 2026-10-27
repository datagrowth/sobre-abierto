// De qué secciones de las decisiones sale cada anexo automático. Puro: sin base de datos.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { DecisionesData } from './decisiones.js';
import { ordenVigente, type DatoAnexo } from './datosAnexo.js';

// Antes se relanzaban todos los anexos en cuanto cambiaba la hora de las decisiones (guardar solo el enfoque
// rehacía el anexo económico y las declaraciones); ahora cada anexo guarda lo que lleva y solo se rehace si eso
// cambia. Sin base de datos, para poder ampliarlo a comparar por valores sin otra lógica.
export const SeccionesAnexo = z.object({
  precio: z.unknown().optional(),
  equipo: z.unknown().optional(),
  automaticos: z.unknown().optional(),
  lotes: z.array(z.string()).optional(),
  datos_anexo: z.record(z.string(), z.unknown()).optional(),
});
export type SeccionesAnexo = {
  precio?: unknown;
  equipo?: unknown;
  automaticos?: unknown;
  lotes?: string[];
  datos_anexo?: Record<string, unknown>;
};

// Los datos del anexo (decisiones.datos_anexo) que lleva cada tipo, como los usa la hoja de datos:
// el impuesto y el orden de los lotes, el económico; la subcontratación, las declaraciones.
const DATOS_DE_TIPO: Record<string, readonly DatoAnexo[]> = {
  oferta_economica: ['impuesto', 'orden_lotes'],
  declaracion: ['subcontratacion_servidores'],
  acreditacion: ['subcontratacion_servidores'],
  otro: ['subcontratacion_servidores'],
};

// Solo lo decidido: lo que sigue sin decidir no entra, así los anexos rellenados antes de guardar
// estos datos (sin la clave) no salen como desfasados mientras nadie los decida.
function datosAnexoDe(tipo: string, d: DecisionesData): Pick<SeccionesAnexo, 'datos_anexo'> {
  const valor = (dato: DatoAnexo): unknown =>
    dato === 'orden_lotes' ? ordenVigente(d) : (d.datos_anexo?.[dato] ?? null);
  const decididos = (DATOS_DE_TIPO[tipo] ?? []).flatMap((dato) => {
    const v = valor(dato);
    return v === null ? [] : [[dato, v] as const];
  });
  return decididos.length ? { datos_anexo: Object.fromEntries(decididos) } : {};
}

const CON_EQUIPO = new Set(['declaracion', 'acreditacion', 'otro']);

const delLote = (lote: string | null, de: string | null) => lote === null || de === null || de === lote;

function automaticosDe(lote: string | null, d: DecisionesData): unknown {
  return d.automaticos.filter((a) => delLote(lote, a.lote));
}

// Los perfiles a incorporar van en el mismo anexo de medios que el equipo («docente a incorporar»): si cambian, se rehace.
function equipoDe(lote: string | null, d: DecisionesData): unknown {
  const delLote = (lotes: string[]) => lote === null || !lotes.length || lotes.includes(lote);
  return [
    ...d.equipo
      .filter((m) => delLote(m.lotes))
      .map((m) => ({
        persona_id: m.persona_id,
        rol: m.rol_en_la_oferta,
        dedicacion: m.dedicacion ?? null,
        lotes: m.lotes,
      })),
    ...(d.a_incorporar ?? [])
      .filter((p) => delLote(p.lotes))
      .map((p) => ({ persona_id: null, rol: p.rol_en_la_oferta, a_incorporar: p.requisitos, lotes: p.lotes })),
  ];
}

/** Las secciones de las decisiones que lleva un anexo del tipo y lote dados. Enfoque y herramientas, nunca. */
export function seccionesDeAnexo(tipo: string, lote: string | null, d: DecisionesData): SeccionesAnexo {
  if (tipo === 'oferta_economica') {
    // El anexo económico lleva también los criterios por fórmula (plazos, mejoras, certificados).
    return {
      precio: d.ofertas.filter((o) => lote === null || o.lote === lote),
      automaticos: automaticosDe(lote, d),
      ...datosAnexoDe(tipo, d),
    };
  }
  if (CON_EQUIPO.has(tipo))
    return { equipo: equipoDe(lote, d), automaticos: automaticosDe(lote, d), lotes: d.lotes, ...datosAnexoDe(tipo, d) };
  return {};
}

// JSON con las claves ordenadas: el orden en que se guardó un objeto no es un cambio.
function estable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estable);
  if (typeof v !== 'object' || v === null) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, estable((v as Record<string, unknown>)[k])]),
  );
}

const canonico = (v: unknown) => JSON.stringify(estable(v ?? null));

/** Lista en castellano: «a», «a y b», «a, b y c». */
export function enumerar(t: string[]): string {
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t.at(-1)}` : t.join('');
}

// Los lotes cuya oferta cambió (null = la oferta sin lote, o una forma que no se reconoce).
function lotesConOtroPrecio(antes: unknown, ahora: unknown): (string | null)[] {
  const porLote = (v: unknown) =>
    new Map(
      (Array.isArray(v) ? v : []).map((o: { lote?: unknown }) => [
        typeof o?.lote === 'string' ? o.lote : null,
        canonico(o),
      ]),
    );
  const a = porLote(antes);
  const b = porLote(ahora);
  return [...new Set([...a.keys(), ...b.keys()])].filter((l) => a.get(l) !== b.get(l));
}

function frasePrecio(antes: unknown, ahora: unknown, lote: string | null): string {
  if (lote !== null) return `el precio del lote ${lote}`;
  const lotes = lotesConOtroPrecio(antes, ahora);
  if (!lotes.length || lotes.includes(null)) return 'el precio';
  return lotes.length === 1
    ? `el precio del lote ${lotes[0]}`
    : `el precio de los lotes ${enumerar(lotes as string[])}`;
}

/** Cómo se dice cada dato del anexo que cambió; van a la hoja de datos, como el precio. */
export const FRASE_DATO_ANEXO: Record<DatoAnexo, string> = {
  impuesto: 'el impuesto',
  orden_lotes: 'el orden de los lotes',
  subcontratacion_servidores: 'la subcontratación de servidores',
};

/** Los datos del anexo que cambiaron entre lo que llevaba un anexo y lo que lleva ahora. */
function datosAnexoCambiados(antes: SeccionesAnexo, ahora: SeccionesAnexo): DatoAnexo[] {
  return (Object.keys(FRASE_DATO_ANEXO) as DatoAnexo[]).filter(
    (k) => canonico(antes.datos_anexo?.[k]) !== canonico(ahora.datos_anexo?.[k]),
  );
}

/** Qué cambió entre lo que llevaba un anexo y lo que lleva ahora, en palabras («el precio del lote 2»). */
export function cambiosEntre(antes: SeccionesAnexo, ahora: SeccionesAnexo, lote: string | null): string[] {
  const distinto = (k: keyof SeccionesAnexo) => canonico(antes[k]) !== canonico(ahora[k]);
  return [
    distinto('precio') ? frasePrecio(antes.precio, ahora.precio, lote) : null,
    distinto('equipo') ? 'el equipo' : null,
    distinto('automaticos') ? 'los criterios automáticos' : null,
    distinto('lotes') ? 'los lotes' : null,
    ...datosAnexoCambiados(antes, ahora).map((k) => FRASE_DATO_ANEXO[k]),
  ].filter((x): x is string => x !== null);
}

/** Los 12 primeros hex del sha256 de lo que lleva el anexo: la clave idempotente de su trabajo. */
export function huella(s: SeccionesAnexo): string {
  return crypto.createHash('sha256').update(canonico(s)).digest('hex').slice(0, 12);
}
