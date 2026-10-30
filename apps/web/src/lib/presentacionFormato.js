// Formato y lógica de la presentación de una oferta: el lote que se registra, las incoherencias entre
// lotes, ficha, pliegos, guion y decisiones, y el paquete que se copia a DOCUMENTACION PRESENTADA.
import { fechaHora, numeroONulo, plural } from './formato.js';
import { loteSugerido } from './licitacionesFormato.js';
import { importeFormulario } from './ofertaFormato.js';
import { enumerar } from './memoriaFormato.js';

/** Lote que se propone al registrar la presentación: el único de las decisiones o el único de interés. */
export function loteParaRegistrar(decisiones, ambito = null) {
  const lotes = decisiones?.datos?.lotes ?? [];
  return lotes.length === 1 ? lotes[0] : loteSugerido(ambito?.lotes ?? []);
}

/** Las incoherencias que da el servidor, primero las que bloquean; [] si no trae ninguna. */
export function incoherencias(o) {
  return o?.coherencia ?? [];
}

// Los tipos de problema de las decisiones que da el servidor (decisiones.ts), con su título corto.
// `de` saca lo propio de cada mensaje (el criterio, la persona); el resto, que se repetía en
// cada uno (caso real: la lista entera del guion siete veces), no se enseña.
const TIPOS_PROBLEMA = [
  { re: /^Falta decidir \d+ criterios? automáticos?: (.+)\.$/, titulo: 'Criterios sin decidir', lista: true },
  {
    re: /^El criterio («.+?») no está en el guion vigente/,
    titulo: 'Criterios que cambiaron de nombre o ya no están en el guion',
  },
  {
    re: /^El criterio («.+?») (?:está decidido para el lote|no se decide)/,
    titulo: 'Criterios de lotes a los que no vamos',
  },
  { re: /^El tramo «.+?» no es ninguno de (.+?): «/, titulo: 'Tramos que ya no están en el guion' },
  { re: /^Elige el tramo de (.+) al que nos acogemos\.$/, titulo: 'Criterios sin tramo elegido' },
  { re: /^No puedes acogerte a (.+?):/, titulo: 'Criterios que no podemos declarar' },
  {
    re: /^No hay ningún colaborador con id (\d+)/,
    titulo: 'Personas que ya no están en Colaboradores',
    de: (m) => `id ${m[1]}`,
  },
  {
    re: /^(.+?) está asignada al lote (.+?), al que no vamos/,
    titulo: 'Personas en lotes a los que no vamos',
    de: (m) => `${m[1]} (lote ${m[2]})`,
  },
];

const partes = (texto) => texto.split(/,\s(?=«)/);

function tipoDe(p) {
  for (const t of TIPOS_PROBLEMA) {
    const m = t.re.exec(p);
    if (m) return { t, items: t.lista ? partes(m[1]) : [t.de ? t.de(m) : m[1]] };
  }
  return null;
}

/**
 * Lo que ya no vale de las decisiones guardadas, agrupado por tipo con un título corto y sin
 * jerga: «Criterios sin decidir (2): «A», «B».». Lo que ya dice la coherencia
 * no se repite, los elementos repetidos salen una vez y lo que no tiene tipo sale tal cual.
 */
export function problemasAgrupados(o) {
  const dichos = new Set(incoherencias(o).map((c) => c.mensaje));
  const grupos = new Map();
  const sueltos = [];
  for (const p of o?.decisiones_problemas ?? []) {
    if (dichos.has(p)) continue;
    const x = tipoDe(p);
    if (!x) {
      if (!sueltos.includes(p)) sueltos.push(p);
      continue;
    }
    const items = grupos.get(x.t) ?? new Set();
    for (const i of x.items) items.add(i);
    grupos.set(x.t, items);
  }
  const agrupados = TIPOS_PROBLEMA.filter((t) => grupos.has(t)).map(
    (t) => `${t.titulo} (${grupos.get(t).size}): ${enumerar([...grupos.get(t)])}.`,
  );
  return [...agrupados, ...sueltos];
}

/** «sin» (no hay), «desfasado» (cambió algo después), «bloqueado» (tiene bloqueos) o «listo». */
export function estadoPaquete(p) {
  if (!p) return 'sin';
  if (p.desfasado) return 'desfasado';
  return p.bloqueos > 0 ? 'bloqueado' : 'listo';
}

/** «v2 · 14 oct 2026, 18:30 · 2 bloqueos · 3 avisos»; null sin paquete. */
export function resumenPaquete(p) {
  if (!p) return null;
  const cuentas = p.bloqueos ? plural(p.bloqueos, 'bloqueo') : 'sin bloqueos';
  return `v${p.version} · ${fechaHora(p.creado_en)} · ${cuentas}${p.avisos ? ` · ${plural(p.avisos, 'aviso')}` : ''}`;
}

/** Las filas del registro precargado desde el paquete: una por lote, con su importe o su precio por unidad. */
export function filasRegistroPaquete(registro = []) {
  return registro.map((r) => ({ ...r, valor: importeFormulario(r.precio_unitario ?? r.importe_ofertado) }));
}

/** Filas del registro → un cuerpo de POST …/propuestas por lote, o el error para la persona. */
export function leerRegistroPaquete(filas, version, fecha = '') {
  const cuerpos = [];
  for (const f of filas) {
    const n = numeroONulo(f.valor);
    if (n === null || Number.isNaN(n) || n <= 0)
      return {
        error: `El ${f.unidad ? `precio por ${f.unidad}` : 'importe'}${f.lote ? ` del lote ${f.lote}` : ''} es un número en € sin impuestos.`,
      };
    const precio = f.unidad
      ? { precio_unitario: n, unidad: f.unidad, importe_ofertado: f.importe_ofertado }
      : { importe_ofertado: n };
    cuerpos.push({
      lote: f.lote,
      ...precio,
      ...(f.presupuesto ? { presupuesto: f.presupuesto } : {}),
      paquete_version: version,
      ...(fecha ? { presentada_en: fecha } : {}),
    });
  }
  return { cuerpos };
}

/** «Paquete v2 copiado en DOCUMENTACION PRESENTADA» o el error; null si no se registró desde el paquete. */
export function textoCopiaPaquete(p) {
  const c = p?.copia;
  if (!c) return null;
  if (c.estado === 'hecha') return `Paquete v${p.version} copiado en ${c.ruta}.`;
  if (c.estado === 'error') return `El paquete v${p.version} no se pudo copiar a DOCUMENTACION PRESENTADA: ${c.error}`;
  return `El paquete v${p.version} se copiará a DOCUMENTACION PRESENTADA en cuanto su carpeta esté lista.`;
}
