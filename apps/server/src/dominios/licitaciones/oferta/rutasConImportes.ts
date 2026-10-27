// Qué rutas llevan los importes ofertados, para que ningún agente las vea.
import path from 'node:path';
import { limpiarNombre } from '../../../nucleo/nombres.js';
import type { Db } from '../store.js';
import { documentoDelGuion, documentosDelGuion, type DocumentoConClave } from './documentos.js';
import { guionPorId, guionVigente, type GuionGuardado } from './guion.js';
import { archivosEconomicos } from './guionLotes.js';
import { Manifiesto, type ManifiestoData } from './paqueteManifiesto.js';

// salidas_listar, salidas_leer, biblioteca_buscar y biblioteca_leer no las enseñan a ningún agente: el importe
// solo va en VALORES_A_TECLEAR.md y en los documentos económicos, nunca en lo que lee Hermes
// (paqueteTextos.ts), y una ruta listada se puede leer. Se reconocen VALORES_A_TECLEAR.md, en cada paquete las
// carpetas de los archivos con importes y la proposición económica, los documentos económicos de la checklist y
// sus anexos rellenados (también las versiones anteriores, que siguen en anexos/).
export const MOTIVO_IMPORTES =
  'Ese documento lleva los importes de la oferta: ningún agente lo lista ni lo lee. Los valores los teclea una persona desde la web.';

const VALORES = 'valores_a_teclear.md';
// «Salidas/Licitaciones/<expediente> (<id>)/anexos/<archivo>», como lo escribe anexosGuardado.ts, o con
// carpeta única «Conocimiento/Licitaciones/Ofertas/<carpeta> (<id>)/Oferta/anexos/<archivo>».
const EN_ANEXOS =
  /^(?:Salidas\/Licitaciones|Conocimiento\/Licitaciones\/Ofertas)\/[^/]*\(([^()/]+)\)\/(?:Oferta\/)?anexos\/([^/]+)$/;

type FilaPaquete = { ruta: string; guion_id: number; manifiesto: string };

// Los archivos del guion que llevan importes: los de las ofertas económicas y los de los
// criterios automáticos, salvo el de la memoria (lo mismo que marca el paquete como económico).
function archivosConImportes(g: GuionGuardado): Set<string> {
  const memoria = g.datos.memoria?.archivo;
  return new Set(
    [...archivosEconomicos(g.datos), ...g.datos.automaticos.map((a) => a.archivo)].filter((a) => a !== memoria),
  );
}

function esEconomico(g: GuionGuardado, d: DocumentoConClave | null): boolean {
  return d !== null && (d.doc.tipo === 'oferta_economica' || archivosConImportes(g).has(d.archivo));
}

function manifiestoDe(f: FilaPaquete): ManifiestoData | null {
  try {
    const m = Manifiesto.safeParse(JSON.parse(f.manifiesto));
    return m.success ? m.data : null;
  } catch {
    return null;
  }
}

// Dentro de una versión del paquete: la carpeta entera de un archivo con importes (con su
// índice) y, en las demás, el documento de la proposición económica. Sin manifiesto o sin
// guion legibles no se puede saber: no se enseña nada de esa versión.
function economicoEnPaquete(db: Db, f: FilaPaquete, resto: string): boolean {
  const g = guionPorId(db, f.guion_id);
  const m = manifiestoDe(f);
  if (!g || !m) return true;
  const conImportes = archivosConImportes(g);
  return m.carpetas.some(
    (c) =>
      resto.startsWith(`${c.ruta}/`) &&
      (conImportes.has(c.archivo) ||
        c.documentos.some(
          (d) => resto === `${c.ruta}/${d.archivo}` && esEconomico(g, documentoDelGuion(g.datos, d.clave)),
        )),
  );
}

// El paquete donde se generó o su copia en lo presentado (copia_ruta, relativa a Conocimiento).
function enPaquete(db: Db, ruta: string): boolean {
  const filas = db
    .prepare(
      `SELECT ruta, guion_id, manifiesto FROM paquetes_presentacion WHERE substr(?, 1, length(ruta) + 1) = ruta || '/'
    UNION ALL SELECT 'Conocimiento/' || copia_ruta, guion_id, manifiesto FROM paquetes_presentacion
    WHERE copia_ruta IS NOT NULL AND substr(?, 1, length(copia_ruta) + 14) = 'Conocimiento/' || copia_ruta || '/'`,
    )
    .all(ruta, ruta) as FilaPaquete[];
  return filas.some((f) => economicoEnPaquete(db, f, ruta.slice(f.ruta.length + 1)));
}

// El documento de la checklist tal cual (lo pudo subir una persona en cualquier carpeta).
function enChecklist(db: Db, ruta: string): boolean {
  const filas = db
    .prepare('SELECT licitacion_id, clave FROM oferta_documentos WHERE ruta = ? OR ruta_pdf = ?')
    .all(ruta, ruta) as { licitacion_id: string; clave: string }[];
  return filas.some((f) => {
    const g = guionVigente(db, f.licitacion_id);
    return g !== null && esEconomico(g, documentoDelGuion(g.datos, f.clave));
  });
}

// Un anexo rellenado de un documento económico: «<nombre>[ lote N]-vN.docx|pdf», de cualquier versión.
function enAnexos(db: Db, ruta: string): boolean {
  const m = EN_ANEXOS.exec(ruta);
  const g = m ? guionVigente(db, m[1]!) : null;
  if (!m || !g) return false;
  const prefijos = documentosDelGuion(g.datos)
    .filter((d) => esEconomico(g, d))
    .map((d) => limpiarNombre(d.doc.nombre, 80).replace(/[.\s]+$/, ''));
  return prefijos.some((p) => p !== '' && m[2]!.startsWith(p));
}

/** ¿Lleva esta ruta («Salidas/…» o «Conocimiento/…») los importes de una oferta? */
export function rutaConImportes(db: Db, ruta: string): boolean {
  if (path.posix.basename(ruta).toLowerCase() === VALORES) return true;
  return enPaquete(db, ruta) || enChecklist(db, ruta) || enAnexos(db, ruta);
}
