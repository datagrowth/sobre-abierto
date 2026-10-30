// Hoja de datos de la oferta: lo que se copia en los modelos y en la PLACSP al presentar.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { leerPerfilEmpresa, municipioDe, textoEuros, type PerfilEmpresaData } from '../../../nucleo/empresa.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { etiquetaLote, lotesDeLicitacion } from '../lotes.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { datoDecidido, datosQuePide, ordenVigente, textosDeDocumentos, type DatoAnexo } from './datosAnexo.js';
import { decisionesDe, paresDeAutomaticos, type DecisionesData } from './decisiones.js';
import type { FilaDocumento } from './documentos.js';
import { guionVigente, type AutomaticoGuion, type GuionBaseData, type OfertaEconomicaLoteData } from './guion.js';
import { automaticoDe, claveCriterio, ofertaDeLote, ofertaParaLotes, tramosDe } from './guionLotes.js';
import { importeDeLote, type OfertaLoteData } from './preciosOferta.js';

// Empresa y su representante, licitación, lotes, importe con su impuesto y la baja, y los criterios automáticos a
// los que se acoge la empresa con su casilla. Sale del perfil de la empresa, la licitación, el guion y las
// decisiones: aquí no se decide nada, y lo que falta se dice. La usan la web (paso Presentación) y el relleno de
// anexos.
export type CampoHoja = { grupo: string; etiqueta: string; valor: string | null; falta: boolean };
export type HojaDatos = { campos: CampoHoja[]; avisos: string[] };

// Tipo general de cada impuesto: el pliego puede fijar otro (reducido), por eso se avisa.
const TIPO_GENERAL = { IVA: 21, IGIC: 7, exento: 0 } as const;
const PORCENTAJE = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Licitacion = { expediente: string; titulo: string; organo_nombre: string; presupuesto_sin_iva: number | null };
type Fuentes = {
  l: Licitacion;
  perfil: PerfilEmpresaData | null;
  guion: GuionBaseData | null;
  decisiones: DecisionesData | null;
  lotes: { id: string; nombre: string | null; presupuesto_sin_iva: number | null }[];
  // Los datos de anexo que pide esta oferta (datosAnexo.ts): solo esos salen en la hoja.
  pedidos: DatoAnexo[];
};

const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();
const campo = (grupo: string, etiqueta: string, valor: string | null | undefined): CampoHoja => ({
  grupo,
  etiqueta,
  valor: valor ?? null,
  falta: !valor,
});

function camposEmpresa(p: PerfilEmpresaData | null): CampoHoja[] {
  const g = 'Empresa';
  return [
    campo(g, 'Nombre o razón social', p?.nombre),
    campo(g, 'NIF', p?.nif),
    campo(g, 'Domicilio', p?.domicilio),
    campo(g, 'Representante', p?.representante?.nombre),
    campo(g, 'NIF del representante', p?.representante?.nif),
    campo(g, 'Cargo del representante', p?.representante?.cargo),
    campo(g, 'Correo electrónico', p?.contacto?.email),
    campo(g, 'Teléfono', p?.contacto?.telefono),
    campo(g, 'Lugar', municipioDe(p?.domicilio)),
  ];
}

// La fecha que vale para cualquier día de firma : la pone el certificado al firmar.
const FECHA_FIRMA = 'a la fecha de la firma electrónica';
const camposFirma = (): CampoHoja[] => [campo('Firma', 'Fecha', FECHA_FIRMA)];

function textoLotes(f: Fuentes, solo?: string | null): string | null {
  if (!f.lotes.length) return 'Toda la licitación';
  if (solo) return etiquetaLote(solo, f.lotes.find((x) => x.id === solo)?.nombre);
  if (!f.decisiones) return null;
  if (!f.decisiones.lotes.length) return 'Toda la licitación';
  return f.decisiones.lotes.map((id) => etiquetaLote(id, f.lotes.find((x) => x.id === id)?.nombre)).join('; ');
}

const CIFRA = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

function camposLicitacion(f: Fuentes, solo?: string | null): CampoHoja[] {
  const g = 'Licitación';
  return [
    campo(g, 'Expediente', f.l.expediente),
    campo(g, 'Título', f.l.titulo),
    campo(g, 'Órgano de contratación', f.l.organo_nombre),
    campo(g, 'Lotes', textoLotes(f, solo)),
  ];
}

type LoteOferta = { lote: string | null; o: OfertaLoteData | null; oe: OfertaEconomicaLoteData | null };

const ofertaDelGuion = (f: Fuentes, lote: string | null) =>
  f.guion ? (ofertaDeLote(f.guion, lote) ?? ofertaParaLotes(f.guion, lote ? [lote] : [])) : null;

// Un lote por oferta decidida (o por lote decidido, si aún no hay ofertas); sin lotes, el contrato entero.
function lotesDeOferta(f: Fuentes): LoteOferta[] {
  const ofertas = f.decisiones?.ofertas ?? [];
  const lotes: (string | null)[] = ofertas.length
    ? ofertas.map((o) => o.lote)
    : f.decisiones?.lotes.length
      ? f.decisiones.lotes
      : [null];
  return lotes.map((lote) => ({ lote, o: ofertas.find((x) => x.lote === lote) ?? null, oe: ofertaDelGuion(f, lote) }));
}

// Una sola línea sin cantidad: el importe de las decisiones es el precio unitario (€/hora).
const unidadUnica = (oe: OfertaEconomicaLoteData | null): string | null => {
  const l = oe?.precios_unitarios ?? [];
  return l.length === 1 && l[0]!.cantidad === null ? l[0]!.unidad : null;
};

// Contra qué se calcula la baja: el precio unitario máximo si se oferta por unidad; el importe
// máximo (Σ máximo × cantidad) con varias líneas; si no, el presupuesto del lote o el de la licitación.
function referenciaDe(f: Fuentes, x: LoteOferta): { importe: number | null; texto: string } {
  const lineas = x.oe?.precios_unitarios ?? [];
  if (unidadUnica(x.oe)) return { importe: lineas[0]!.maximo, texto: 'precio máximo' };
  if (lineas.length)
    return {
      importe: lineas.reduce<number | null>(
        (t, l) => (t === null || l.maximo === null || l.cantidad === null ? null : t + l.maximo * l.cantidad),
        0,
      ),
      texto: 'importe máximo',
    };
  const propia = x.lote !== null && x.oe?.lotes.length === 1 && x.oe.lotes[0] === x.lote ? x.oe.presupuesto_base : null;
  const delLote = x.lote !== null ? f.lotes.find((l) => l.id === x.lote)?.presupuesto_sin_iva : null;
  return { importe: propia || delLote || (x.oe?.presupuesto_base ?? f.l.presupuesto_sin_iva), texto: 'presupuesto' };
}

function importeDe(x: LoteOferta): number | null {
  if (!x.o || x.o.pendiente) return null;
  return unidadUnica(x.oe) ? (x.o.unitarios[0]?.precio ?? null) : importeDeLote(x.o, x.oe);
}

function preciosUnitarios(grupo: string, x: LoteOferta): CampoHoja[] {
  if (unidadUnica(x.oe)) return [];
  return (x.oe?.precios_unitarios ?? []).map((l) => {
    const p =
      x.o && !x.o.pendiente
        ? x.o.unitarios.find((u) => comparable(u.concepto) === comparable(l.concepto))?.precio
        : undefined;
    return campo(
      grupo,
      `Precio por ${l.unidad} · ${l.concepto}`,
      p === undefined ? null : `${textoEuros(p)} por ${l.unidad}`,
    );
  });
}

export type Impuesto = { impuesto: keyof typeof TIPO_GENERAL | null; tipo: number | null; decidido: boolean };

/**
 * El impuesto decidido en la oferta (datos_anexo) manda sobre el del guion y su tipo general.
 * Lo usan la hoja, los anexos y VALORES_A_TECLEAR.md: lo tecleado tiene que cuadrar con lo firmado.
 */
export function impuestoDe(
  d: Pick<DecisionesData, 'datos_anexo'> | null | undefined,
  oe: OfertaEconomicaLoteData | null,
): Impuesto {
  const decidido = d?.datos_anexo?.impuesto;
  if (decidido)
    return { impuesto: decidido.tipo, tipo: decidido.porcentaje ?? TIPO_GENERAL[decidido.tipo], decidido: true };
  const impuesto = oe?.impuesto_aparte ?? null;
  return { impuesto, tipo: impuesto ? TIPO_GENERAL[impuesto] : null, decidido: false };
}

const textoTipo = (n: number): string => CIFRA.format(n);

function camposDeLote(f: Fuentes, x: LoteOferta, grupo: string): CampoHoja[] {
  const importe = importeDe(x);
  const { impuesto, tipo } = impuestoDe(f.decisiones, x.oe);
  const unidad = unidadUnica(x.oe);
  const euros = (n: number) => `${textoEuros(n)}${unidad ? ` por ${unidad}` : ''}`;
  const cuota = importe !== null && tipo !== null ? Math.round(importe * tipo) / 100 : null;
  const ref = referenciaDe(f, x);
  const baja =
    importe !== null && ref.importe
      ? `${PORCENTAJE.format((1 - importe / ref.importe) * 100)} % (${ref.texto} ${euros(ref.importe)})`
      : null;
  const nombre = impuesto === 'exento' ? 'impuesto' : (impuesto ?? 'impuesto');
  return [
    ...preciosUnitarios(grupo, x),
    campo(grupo, 'Importe sin impuestos', importe === null ? null : euros(importe)),
    campo(
      grupo,
      'Impuesto',
      impuesto === 'exento' ? 'Exento' : impuesto && tipo !== null ? `${impuesto} ${textoTipo(tipo)} %` : null,
    ),
    campo(grupo, `Cuota de ${nombre}`, cuota === null ? null : euros(cuota)),
    campo(grupo, `Total con ${nombre}`, cuota === null || importe === null ? null : euros(importe + cuota)),
    campo(grupo, 'Baja sobre el presupuesto', baja),
  ];
}

/** El grupo de la oferta de un lote: «Oferta» si hay una sola; «Oferta · Lote 2» con varias. */
const grupoOferta = (lote: string | null, varios: boolean): string =>
  varios && lote ? `Oferta · Lote ${lote}` : 'Oferta';

const SI_NO = (v: boolean | null | undefined): string | null => (v === true ? 'Sí' : v === false ? 'No' : null);
const textoOrden = (lotes: string[] | null | undefined): string | null =>
  lotes?.length ? lotes.map((l) => `Lote ${l}`).join(', ') : null;

// Lo que el anexo pide y el pliego no dice: solo si esta oferta lo pide o ya se decidió.
function camposDatosAnexo(f: Fuentes): CampoHoja[] {
  const d = f.decisiones;
  const sale = (dato: DatoAnexo) => f.pedidos.includes(dato) || datoDecidido(d, dato);
  return [
    ...(sale('subcontratacion_servidores')
      ? [campo('Oferta', 'Subcontratación de servidores', SI_NO(d?.datos_anexo?.subcontratacion_servidores))]
      : []),
    ...(sale('orden_lotes') ? [campo('Oferta', 'Orden de preferencia de lotes', textoOrden(ordenVigente(d)))] : []),
  ];
}

// Un grupo por lote: cada uno con sus precios, su impuesto y su baja (los lotes pueden tener máximos distintos).
function camposOferta(f: Fuentes, solo?: string | null): CampoHoja[] {
  const todos = lotesDeOferta(f);
  const lotes = solo === undefined ? todos : todos.filter((x) => x.lote === solo);
  return [
    ...lotes.flatMap((x) => camposDeLote(f, x, grupoOferta(x.lote, todos.length > 1 && solo === undefined))),
    ...camposDatosAnexo(f),
  ];
}

// «Sí, nos acogemos» con lo que se teclea: el valor ofertado si lo hay (p. ej. un número de
// alumnas o un plazo en años) o, si el criterio tiene tramos, el tramo elegido.
function textoDecidido(a: AutomaticoGuion, d: DecisionesData['automaticos'][number]): string {
  if (!d.nos_acogemos) return `No — ${a.casilla_en}`;
  if (d.valor !== undefined) return `Sí, nos acogemos: ${CIFRA.format(d.valor)} — ${a.casilla_en}`;
  const t =
    d.tramo && a.tramos?.length
      ? tramosDe(a).find((x) => comparable(x.descripcion) === comparable(d.tramo!))
      : undefined;
  return `Sí, nos acogemos${t ? `: «${t.descripcion}»${t.valor ? ` (${t.valor})` : ''}` : ''} — ${a.casilla_en}`;
}

// Un campo por criterio y lote (paresDeAutomaticos), con el tramo decidido.
function camposAutomaticos(f: Fuentes, solo?: string | null): CampoHoja[] {
  if (!f.guion) return [];
  const g = f.guion;
  const pares = paresDeAutomaticos(g, f.decisiones?.lotes ?? g.lotes ?? []).filter(
    (p) => solo === undefined || p.lote === null || p.lote === solo,
  );
  return pares.map((p) => {
    const a = automaticoDe(g, p.criterio, p.lote)!;
    const d = f.decisiones?.automaticos.find(
      (x) => claveCriterio(x.criterio) === claveCriterio(p.criterio) && (x.lote ?? null) === p.lote,
    );
    return campo(
      'Criterios automáticos',
      `${a.criterio}${p.lote && solo === undefined ? ` (lote ${p.lote})` : ''}`,
      d ? textoDecidido(a, d) : null,
    );
  });
}

function avisosDe(f: Fuentes, campos: CampoHoja[]): string[] {
  const faltanEmpresa = campos
    .filter((c) => c.grupo === 'Empresa' && c.falta && c.etiqueta !== 'Lugar')
    .map((c) => c.etiqueta.toLowerCase());
  const sinLugar = f.perfil && campos.some((c) => c.grupo === 'Empresa' && c.etiqueta === 'Lugar' && c.falta);
  const lotes = lotesDeOferta(f);
  // Con el impuesto decidido en la oferta ya no hay nada que confirmar en el pliego.
  const impuesto = f.decisiones?.datos_anexo?.impuesto ? null : (lotes[0]?.oe?.impuesto_aparte ?? null);
  const decidido = Boolean(f.decisiones?.datos_anexo?.impuesto);
  const unidad = unidadUnica(lotes[0]?.oe ?? null);
  const pendientes = f.decisiones ? lotes.filter((x) => !x.o || x.o.pendiente) : [];
  return [
    !f.perfil ? 'Falta el perfil de la empresa (Ajustes › Empresa): sin él no hay datos de la empresa.' : null,
    f.perfil && faltanEmpresa.length
      ? `Faltan datos de la empresa en Ajustes › Empresa: ${faltanEmpresa.join(', ')}.`
      : null,
    sinLugar
      ? 'El domicilio de la empresa no trae código postal y municipio (Ajustes › Empresa): el lugar de la firma queda en blanco.'
      : null,
    !f.guion
      ? 'Esta licitación aún no tiene guion de la oferta: faltan el impuesto y los criterios automáticos.'
      : null,
    !f.decisiones
      ? 'Aún no se han fijado las decisiones de la oferta: faltan los lotes, el precio y los criterios automáticos.'
      : null,
    pendientes.length
      ? `El precio está sin decidir${lotes.length > 1 ? ` (${pendientes.map((x) => `lote ${x.lote}`).join(', ')})` : ''}: los huecos del importe quedan vacíos.`
      : null,
    impuesto === 'exento'
      ? 'Según el guion la prestación está exenta de impuesto: confírmalo en el pliego antes de presentar.'
      : null,
    impuesto && impuesto !== 'exento'
      ? `${impuesto} al ${TIPO_GENERAL[impuesto]} % (tipo general): confirma el tipo en el pliego antes de presentar.`
      : null,
    unidad ? `El precio se oferta por ${unidad}: el importe de las decisiones es el precio unitario.` : null,
    f.guion && !impuesto && !decidido ? 'El guion no dice qué impuesto va aparte: confírmalo en el pliego.' : null,
  ].filter((a): a is string => a !== null);
}

// Los mismos textos que miran las comprobaciones: el guion y los modelos ya rellenados de esta oferta.
function pedidosDe(dbLic: Db, id: string, guion: GuionBaseData | null): DatoAnexo[] {
  if (!guion) return [];
  const filas = dbLic
    .prepare('SELECT clave, nombre, sustituciones FROM oferta_documentos WHERE licitacion_id = ?')
    .all(id) as Pick<FilaDocumento, 'clave' | 'nombre' | 'sustituciones'>[];
  return datosQuePide(guion, textosDeDocumentos(filas)).map((p) => p.dato);
}

/**
 * La hoja de datos de la oferta de una licitación, con lo que falta señalado. Con `lote`, la
 * de ese lote solo (para rellenar el anexo de un lote: su precio, sus criterios).
 */
export function hojaDeDatos(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  op: { lote?: string | null } = {},
): Result<HojaDatos> {
  const l = dbLic
    .prepare('SELECT expediente, titulo, organo_nombre, presupuesto_sin_iva FROM licitaciones WHERE id = ?')
    .get(id) as Licitacion | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const guion = guionVigente(dbLic, id)?.datos ?? null;
  const f: Fuentes = {
    l,
    perfil: leerPerfilEmpresa(dbNucleo)?.perfil ?? null,
    guion,
    decisiones: decisionesDe(dbLic, id)?.datos ?? null,
    lotes: lotesDeLicitacion(dbLic, id)?.lotes ?? [],
    pedidos: pedidosDe(dbLic, id, guion),
  };
  const solo = op.lote ?? undefined;
  const campos = [
    ...camposEmpresa(f.perfil),
    ...camposLicitacion(f, solo),
    ...camposOferta(f, solo),
    ...camposAutomaticos(f, solo),
    ...camposFirma(),
  ];
  return ok({ campos, avisos: avisosDe(f, campos) });
}

/** La hoja en líneas de texto, para las instrucciones de un run. */
export function hojaEnTexto(h: HojaDatos): string {
  return h.campos.map((c) => `- ${c.grupo} · ${c.etiqueta}: ${c.valor ?? '(falta: deja el hueco vacío)'}`).join('\n');
}
