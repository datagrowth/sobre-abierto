// Comprobaciones del paquete de presentación antes de escribirlo. Puro: los datos llegan de fuera.
import type { FormaDocx } from '../../../nucleo/documentos/formaDocx.js';
import { textoComparable } from '../temas.js';
import type { Incoherencia } from './coherencia.js';
import { enumerar } from './dependenciasAnexo.js';
import type { Fuga } from './fugas.js';
import type { ProblemaPrecio } from './preciosOferta.js';
import { lotesNombrados, marcasSinTerminar } from './textoPliego.js';

// Los textos de los documentos, la coherencia, el plazo y los precios llegan de fuera. Lo que bloquea no impide
// generarlo —en la víspera del plazo sirve igual—, pero la versión queda «NO PRESENTABLE TODAVÍA». Cada regla
// evita un fallo concreto: el índice de una oferta que citaba documentos ausentes, «30 alumnas» en el Sobre B de
// otra oferta, marcas amarillas y «[A CONFIRMAR]» sin quitar, un anexo del lote 2 en la carpeta del lote 4.
type TipoComprobacion =
  | 'plazo'
  | 'coherencia'
  | 'obligatorio'
  | 'memoria'
  | 'precio'
  | 'fuga'
  | 'sin_cerrar'
  | 'huecos'
  | 'lote_ajeno'
  | 'pdf'
  | 'memoria_por_lote'
  | 'paginas'
  | 'firma'
  | 'sobre'
  | 'nombre'
  | 'formato';
export type Comprobacion = {
  tipo: TipoComprobacion;
  gravedad: 'bloquea' | 'aviso';
  mensaje: string;
  donde: string | null;
};

export type DocumentoPlan = {
  orden: number;
  nombre: string;
  clave: string;
  tipo: string;
  obligatorio: boolean;
  estado: string;
  origen: string | null;
  editable: string | null;
  con_pdf: boolean;
  archivo_destino: string | null;
};
export type CarpetaPlan = {
  ruta: string;
  lote: string | null;
  archivo: string;
  firma: string | null;
  indice: boolean;
  economica: boolean;
  documentos: DocumentoPlan[];
};

// Lo leído de cada documento (por su ruta de origen): texto, si tiene resaltado amarillo y cuántos huecos sin rellenar.
// pdf_antiguo: el .docx editable se tocó después de exportar el PDF que va en el paquete.
// paginas y firmado: los del PDF que va (formaPdf.ts); ausentes o null si no es un PDF legible.
// formato: el del texto normal de su .docx editable (formaDocx.ts); ausente o null sin .docx.
export type LecturaDocumento = {
  texto: string;
  amarillo: boolean;
  huecos: number;
  pdf_antiguo: boolean;
  paginas?: number | null;
  firmado?: boolean | null;
  formato?: FormaDocx | null;
};
type FormatoPliego = {
  fuente?: string | undefined;
  tamano_letra?: number | undefined;
  interlineado?: number | undefined;
};

export type AnuladasMemoria = { motivo: string; fugas: Pick<Fuga, 'tipo' | 'marca' | 'criterio'>[] };
// Si el pliego pide una memoria por lote (memoriaLote.ts): sus lotes y las rutas de las memorias
// comunes (sin lote), que no valen como la de un lote.
export type MemoriaPorLotePaquete = { lotes: string[]; comunes: string[] };

export type ContextoComprobacion = {
  plazo: { vencido: boolean; restante_ms: number | null; texto: string } | null;
  coherencia: Incoherencia[];
  memoria: string[];
  precios: ProblemaPrecio[];
  pendientes: (string | null)[];
  lecturas: Map<string, LecturaDocumento>;
  fugas: (texto: string) => Fuga[];
  // Las fugas que quien dio por buena la memoria anuló con su motivo (memorias.anulacion_fugas).
  anuladas: AnuladasMemoria | null;
  importes: (texto: string) => string[];
  // null o ausente: el pliego no pide una memoria por lote (o el plan no lo sabe).
  memoria_por_lote?: MemoriaPorLotePaquete | null;
  // El límite de páginas de la memoria según el guion; null o ausente si el pliego no fija ninguno.
  // El guion trae una sola memoria: con memoria por lote, el mismo límite vale para la de cada lote.
  limite_paginas?: number | null;
  // La fuente, el tamaño y el interlineado que exige el pliego para la memoria (guion.memoria.formato).
  formato?: FormatoPliego | null;
};

const DIA_MS = 86_400_000;
const bloquea = (tipo: TipoComprobacion, mensaje: string, donde: string | null = null): Comprobacion => ({
  tipo,
  gravedad: 'bloquea',
  mensaje,
  donde,
});
const aviso = (tipo: TipoComprobacion, mensaje: string, donde: string | null = null): Comprobacion => ({
  tipo,
  gravedad: 'aviso',
  mensaje,
  donde,
});
const enCarpeta = (c: CarpetaPlan, d: DocumentoPlan) => `${c.ruta}/${d.archivo_destino ?? d.nombre}`;
const A_CONFIRMAR = /\[\s*a\s+confirmar[^\]]*\]?/gi;

function dePlazo(ctx: ContextoComprobacion): Comprobacion[] {
  const p = ctx.plazo;
  if (!p) return [];
  if (p.vencido) return [bloquea('plazo', `El plazo de presentación acabó ${p.texto}.`)];
  return p.restante_ms !== null && p.restante_ms < DIA_MS
    ? [aviso('plazo', `Quedan menos de 24 horas: el plazo acaba ${p.texto}.`)]
    : [];
}

// Un obligatorio en borrador (p. ej. un anexo que rellenó Hermes y nadie ha revisado) no se da por presentable.
const borrador = (c: CarpetaPlan, d: DocumentoPlan): Comprobacion =>
  d.obligatorio
    ? bloquea(
        'obligatorio',
        `«${d.nombre}» (obligatorio) está en borrador: revísalo y márcalo preparado.`,
        enCarpeta(c, d),
      )
    : aviso('obligatorio', `«${d.nombre}» está en borrador: revísalo y márcalo preparado.`, enCarpeta(c, d));

// Sin archivo que copiar: «preparado» es un enlace o algo que se aporta en la sede (el DEUC en la PLACSP), no una falta.
function sinArchivo(c: CarpetaPlan, d: DocumentoPlan): Comprobacion[] {
  if (d.estado === 'preparado')
    return [
      aviso(
        'obligatorio',
        `«${d.nombre}» está preparado pero no hay archivo que copiar (va como enlace o se aporta en la sede): no irá en esta carpeta; apórtalo al presentar.`,
        c.ruta,
      ),
    ];
  return d.obligatorio
    ? [
        bloquea(
          'obligatorio',
          `Falta «${d.nombre}» (obligatorio) en ${c.ruta}: ponlo en la checklist o márcalo «no aplica».`,
          c.ruta,
        ),
      ]
    : [];
}

function deDocumentos(carpetas: CarpetaPlan[]): Comprobacion[] {
  return carpetas.flatMap((c) =>
    c.documentos.flatMap((d) => {
      if (!d.origen) return sinArchivo(c, d);
      return [
        ...(d.estado === 'borrador' ? [borrador(c, d)] : []),
        ...(!d.con_pdf
          ? [
              aviso(
                'pdf',
                `«${d.nombre}» no está en PDF: la sede pide PDF firmado; conviértelo antes de firmar.`,
                enCarpeta(c, d),
              ),
            ]
          : []),
      ];
    }),
  );
}

function dePrecios(ctx: ContextoComprobacion): Comprobacion[] {
  const pendientes = ctx.pendientes.map((l) =>
    bloquea('precio', `El precio${l ? ` del lote ${l}` : ''} está pendiente: fíjalo en Decisiones.`, 'decisiones'),
  );
  const problemas = ctx.precios.map((p) =>
    p.gravedad === 'error' || p.del_pliego
      ? bloquea('precio', p.mensaje, 'decisiones')
      : aviso('precio', p.mensaje, 'decisiones'),
  );
  return [...pendientes, ...problemas];
}

// Lo que no se puede entregar tal cual: marcas sin cerrar, resaltado amarillo, huecos.
function deTexto(c: CarpetaPlan, d: DocumentoPlan, l: LecturaDocumento): Comprobacion[] {
  const marcas = [...marcasSinTerminar(l.texto), ...[...l.texto.matchAll(A_CONFIRMAR)].map((m) => m[0])];
  const donde = enCarpeta(c, d);
  return [
    ...(marcas.length
      ? [
          bloquea(
            'sin_cerrar',
            `«${d.nombre}» tiene texto sin cerrar: ${[...new Set(marcas)]
              .slice(0, 3)
              .map((m) => `«${m}»`)
              .join(', ')}.`,
            donde,
          ),
        ]
      : []),
    ...(l.pdf_antiguo
      ? [
          bloquea(
            'pdf',
            `El PDF de «${d.nombre}» es anterior a su .docx (alguien lo corrigió): el paquete llevaría la versión sin las correcciones. Vuelve a exportarlo a PDF.`,
            donde,
          ),
        ]
      : []),
    ...(l.amarillo
      ? [
          bloquea(
            'sin_cerrar',
            `«${d.nombre}» tiene texto resaltado en amarillo: revísalo y quita el resaltado.`,
            donde,
          ),
        ]
      : []),
    ...(l.huecos
      ? [
          aviso(
            'huecos',
            `«${d.nombre}» tiene ${l.huecos} ${l.huecos === 1 ? 'hueco' : 'huecos'} sin rellenar (sin contar la firma).`,
            donde,
          ),
        ]
      : []),
  ];
}

const claveFuga = (f: Pick<Fuga, 'tipo' | 'marca' | 'criterio'>) =>
  `${f.tipo}|${textoComparable(f.marca)}|${textoComparable(f.criterio)}`;

// Lo que la persona que dio por buena la memoria ya anuló con su motivo no vuelve a bloquear.
function sinAnuladas(
  fugas: Fuga[],
  a: AnuladasMemoria | null,
): { fugas: Fuga[]; anuladas: { n: number; motivo: string } | null } {
  if (!a) return { fugas, anuladas: null };
  const claves = new Set(a.fugas.map(claveFuga));
  const quedan = fugas.filter((f) => !claves.has(claveFuga(f)));
  return { fugas: quedan, anuladas: { n: fugas.length - quedan.length, motivo: a.motivo } };
}

// Fugas entre sobres en lo que no es el archivo de la oferta económica ni el de los automáticos.
function deFugas(c: CarpetaPlan, d: DocumentoPlan, l: LecturaDocumento, ctx: ContextoComprobacion): Comprobacion[] {
  if (c.economica) return [];
  const donde = enCarpeta(c, d);
  const { fugas, anuladas } = sinAnuladas(ctx.fugas(l.texto), d.tipo === 'memoria' ? ctx.anuladas : null);
  const importes = ctx.importes(l.texto);
  return [
    ...(anuladas?.n
      ? [
          aviso(
            'fuga',
            `«${d.nombre}» lleva ${anuladas.n} ${anuladas.n === 1 ? 'mención' : 'menciones'} que quien la dio por buena anuló: «${anuladas.motivo}». Compruébalo una vez más antes de subirla.`,
            donde,
          ),
        ]
      : []),
    ...(fugas.length
      ? [
          bloquea(
            'fuga',
            `«${d.nombre}» delata lo que va en otro sobre (${fugas
              .slice(0, 3)
              .map((f) => `«${f.marca}»`)
              .join(', ')}): es causa de exclusión.`,
            donde,
          ),
        ]
      : []),
    ...(importes.length
      ? [
          aviso(
            'fuga',
            `«${d.nombre}» lleva importes (${importes
              .slice(0, 3)
              .map((i) => `«${i}»`)
              .join(', ')}): si son de nuestra oferta, quítalos.`,
            donde,
          ),
        ]
      : []),
  ];
}

// Un anexo de un lote puede acabar en la carpeta de otro.
function deLoteAjeno(c: CarpetaPlan, d: DocumentoPlan, l: LecturaDocumento, validos: string[]): Comprobacion[] {
  if (!c.lote) return [];
  const nombrados = lotesNombrados(l.texto, validos);
  const otros = nombrados.filter((x) => x !== c.lote);
  const propio = nombrados.includes(c.lote);
  return otros.length && !propio
    ? [
        aviso(
          'lote_ajeno',
          `«${d.nombre}» está en la carpeta del lote ${c.lote} y habla del lote ${otros.join(', ')}: comprueba que es el de este lote.`,
          enCarpeta(c, d),
        ),
      ]
    : [];
}

// Portada e índice: muchos pliegos no los cuentan en el límite. Hasta dos páginas de más es un
// aviso; más, no cabe se cuenten o no.
const PAGINAS_DE_CORTESIA = 2;

// Las páginas de la memoria en PDF frente al límite del guion.
function dePaginas(c: CarpetaPlan, d: DocumentoPlan, l: LecturaDocumento, limite: number | null): Comprobacion[] {
  const n = l.paginas ?? null;
  if (d.tipo !== 'memoria' || limite === null || n === null || n <= limite) return [];
  const texto = `«${d.nombre}» tiene ${n} páginas y el pliego permite ${limite}`;
  return n > limite + PAGINAS_DE_CORTESIA
    ? [bloquea('paginas', `${texto}: recórtala antes de firmarla.`, enCarpeta(c, d))]
    : [aviso('paginas', `${texto}: si el pliego cuenta la portada y el índice, sobra; compruébalo.`, enCarpeta(c, d))];
}

// El paquete se genera antes de firmar: que falte la firma es un aviso, no un bloqueo.
function deFirma(c: CarpetaPlan, d: DocumentoPlan, l: LecturaDocumento): Comprobacion[] {
  if (!c.firma || l.firmado !== false) return [];
  return [
    aviso(
      'firma',
      `«${d.nombre}» aún no lleva firma electrónica: fírmalo (${c.firma}) antes de subirlo.`,
      enCarpeta(c, d),
    ),
  ];
}

const n = (x: number): string => String(x).replace('.', ',');

// Lo que la memoria tiene por debajo de lo que exige el pliego. Aviso: se lee el estilo del texto
// normal, no cada párrafo, y «Arial 11» suele ser un mínimo («o similar», «como mínimo»).
function diferenciasFormato(f: FormaDocx, p: FormatoPliego): string[] {
  const fuente = p.fuente ? textoComparable(p.fuente).split(/[\s,;/]+/)[0] : null;
  return [
    ...(fuente && f.fuente && !textoComparable(f.fuente).includes(fuente)
      ? [`la fuente es ${f.fuente} y el pliego pide ${p.fuente}`]
      : []),
    ...(p.tamano_letra && f.tamano !== null && f.tamano < p.tamano_letra - 0.01
      ? [`la letra es de ${n(f.tamano)} puntos y el pliego pide ${n(p.tamano_letra)}`]
      : []),
    ...(p.interlineado && f.interlineado !== null && f.interlineado < p.interlineado - 0.01
      ? [`el interlineado es ${n(f.interlineado)} y el pliego pide ${n(p.interlineado)}`]
      : []),
  ];
}

function deFormato(c: CarpetaPlan, d: DocumentoPlan, l: LecturaDocumento, p: FormatoPliego | null): Comprobacion[] {
  if (d.tipo !== 'memoria' || !p || !l.formato) return [];
  const difs = diferenciasFormato(l.formato, p);
  return difs.length
    ? [
        aviso(
          'formato',
          `«${d.nombre}»: ${difs.join('; ')}. Revísalo en el .docx antes de exportarlo a PDF.`,
          enCarpeta(c, d),
        ),
      ]
    : [];
}

function deContenido(carpetas: CarpetaPlan[], ctx: ContextoComprobacion): Comprobacion[] {
  const lotes = [...new Set(carpetas.flatMap((c) => (c.lote ? [c.lote] : [])))];
  return carpetas.flatMap((c) =>
    c.documentos.flatMap((d) => {
      const l = d.origen ? ctx.lecturas.get(d.origen) : undefined;
      return l
        ? [
            ...deTexto(c, d, l),
            ...deFugas(c, d, l, ctx),
            ...deLoteAjeno(c, d, l, lotes),
            ...dePaginas(c, d, l, ctx.limite_paginas ?? null),
            ...deFirma(c, d, l),
            ...deFormato(c, d, l, ctx.formato ?? null),
          ]
        : [];
    }),
  );
}

// La memoria en el archivo del precio o la oferta económica fuera de él: se abriría en otro momento
// de la mesa y es causa de exclusión. Solo con archivos separados: en un archivo único va todo junto.
function deSobres(carpetas: CarpetaPlan[]): Comprobacion[] {
  if (!carpetas.some((c) => c.economica) || carpetas.every((c) => c.economica)) return [];
  return carpetas.flatMap((c) =>
    c.documentos
      .filter((d) => d.origen)
      .flatMap((d) => {
        if (d.tipo === 'memoria' && c.economica)
          return [
            bloquea(
              'sobre',
              `«${d.nombre}» (la memoria) va en el archivo de la oferta económica: muévela a su archivo en la checklist.`,
              enCarpeta(c, d),
            ),
          ];
        if (d.tipo === 'oferta_economica' && !c.economica)
          return [
            bloquea(
              'sobre',
              `«${d.nombre}» (la oferta económica) va en un archivo que no es el del precio: muévela en la checklist.`,
              enCarpeta(c, d),
            ),
          ];
        return [];
      }),
  );
}

// Dos filas de la checklist con el mismo nombre en una carpeta: en la sede no se distinguen. Las de
// lotes distintos en un archivo único («a1-d7-l2» y «-l4», la memoria de cada lote) sí. Los
// caracteres y la longitud no se comprueban aquí porque ya salen bien: el nombre de cada archivo lo
// pone el plan con limpiarNombre (sin \ / : * ? " < > | # ^ [ ] ni de control, 80 caracteres como
// mucho, más el número de orden y la extensión). Las reglas propias de cada sede (tildes, eñes) no
// se publican de forma uniforme y quedan fuera.
function deNombres(carpetas: CarpetaPlan[]): Comprobacion[] {
  return carpetas.flatMap((c) => {
    const vistos = new Set<string>();
    return c.documentos
      .filter((d) => d.origen)
      .flatMap((d) => {
        const k = `${textoComparable(d.nombre.trim())}|${LOTE_DE_CLAVE.exec(d.clave)?.[1] ?? ''}`;
        if (!vistos.has(k)) {
          vistos.add(k);
          return [];
        }
        return [
          aviso(
            'nombre',
            `«${d.nombre}» va dos veces en ${c.ruta}: quita la fila repetida o dale otro nombre en la checklist.`,
            c.ruta,
          ),
        ];
      });
  });
}

// La misma memoria en dos lotes: el pliego pide una memoria por lote (p. ej. la misma para dos lotes,
// con el suplente de uno igual al docente del otro). El lote de cada memoria es el de su carpeta
// o, si el pliego pide una por lote y va en un archivo único, el de su fila de la checklist
// («a1-d7-l2», documentos.ts). Con una memoria propia por lote no bloquea; una común en la fila de
// un lote, sí; una sola memoria sin lote en el archivo común, solo un aviso.
const LOTE_DE_CLAVE = /-l([A-Za-z0-9._-]{1,20})$/;
const RESOLVER = 'redáctalas en Memoria («Redactar las memorias, una por lote») o sube la de cada lote';

type MemoriaEnLote = { origen: string; lote: string };

function memoriasEnLotes(carpetas: CarpetaPlan[], porLote: boolean): MemoriaEnLote[] {
  return carpetas.flatMap((c) =>
    c.documentos
      .filter((d) => d.tipo === 'memoria' && d.origen)
      .flatMap((d) => {
        const lote = c.lote ?? (porLote ? LOTE_DE_CLAVE.exec(d.clave)?.[1] : undefined);
        return lote ? [{ origen: d.origen!, lote }] : [];
      }),
  );
}

function repetida(enLotes: MemoriaEnLote[]): string[] | null {
  const porOrigen = new Map<string, Set<string>>();
  for (const m of enLotes) porOrigen.set(m.origen, (porOrigen.get(m.origen) ?? new Set()).add(m.lote));
  const lotes = [...porOrigen.values()].find((ls) => ls.size > 1);
  return lotes ? [...lotes] : null;
}

function deMemoriaPorLote(carpetas: CarpetaPlan[], ctx: ContextoComprobacion): Comprobacion[] {
  const m = ctx.memoria_por_lote ?? null;
  const enLotes = memoriasEnLotes(carpetas, m !== null);
  const misma = repetida(enLotes);
  if (misma)
    return [
      bloquea(
        'memoria_por_lote',
        `La misma memoria va en los lotes ${misma.join(', ')} y el pliego pide una por lote: ${RESOLVER}.`,
      ),
    ];
  const conComun = m ? [...new Set(enLotes.filter((x) => m.comunes.includes(x.origen)).map((x) => x.lote))] : [];
  if (conComun.length) {
    const donde = conComun.length === 1 ? `el lote ${conComun[0]}` : `los lotes ${enumerar(conComun)}`;
    return [bloquea('memoria_por_lote', `La memoria común va en ${donde} y el pliego pide una por lote: ${RESOLVER}.`)];
  }
  const comunSinLote = (c: CarpetaPlan) =>
    c.documentos.some((d) => d.tipo === 'memoria' && d.origen && !(m && LOTE_DE_CLAVE.test(d.clave)));
  const comun = carpetas.some((c) => !c.lote && c.ruta.startsWith('Comun/') && comunSinLote(c));
  return comun
    ? [
        aviso(
          'memoria_por_lote',
          'Una sola memoria va en el archivo común de todos los lotes: si el pliego pide una por lote, no es presentable.',
        ),
      ]
    : [];
}

/** Las comprobaciones del paquete, primero lo que bloquea. */
export function comprobarPaquete(carpetas: CarpetaPlan[], ctx: ContextoComprobacion): Comprobacion[] {
  const todas = [
    ...dePlazo(ctx),
    // Los precios van aparte (dePrecios), lote a lote.
    ...ctx.coherencia
      .filter((c) => c.gravedad === 'bloquea' && !c.tipo.startsWith('precio'))
      .map((c) => bloquea('coherencia', c.mensaje, c.donde)),
    ...ctx.memoria.map((m) =>
      bloquea('memoria', `${m}: el paquete lleva la memoria aceptada del guion vigente.`, 'memoria'),
    ),
    ...deDocumentos(carpetas),
    ...dePrecios(ctx),
    ...deContenido(carpetas, ctx),
    ...deMemoriaPorLote(carpetas, ctx),
    ...deSobres(carpetas),
    ...deNombres(carpetas),
  ];
  const vistas = new Set<string>();
  const unicas = todas.filter((c) => {
    const k = `${c.tipo}|${textoComparable(c.mensaje)}`;
    const nueva = !vistas.has(k);
    vistas.add(k);
    return nueva;
  });
  return [...unicas.filter((c) => c.gravedad === 'bloquea'), ...unicas.filter((c) => c.gravedad === 'aviso')];
}
