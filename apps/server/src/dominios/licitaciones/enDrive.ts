// Enlaces para abrir en Drive las carpetas de una licitación (principal, pliegos y oferta).
import { z } from 'zod';
import { carpetaDeSalidasPorRuta, carpetaPorRuta, driveConectado, enlaceCarpetaDrive } from '../../nucleo/drive.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { carpetaPliegos } from './pliegos.js';
import { carpetaSalidas } from './propuestas/borrador.js';
import { obtenerLicitacion, type Db } from './store.js';
import { carpetaUnicaEnDb } from './carpetasUnicas.js';

// Con carpeta única, «principal» es esa carpeta y pliegos y oferta, sus Pliegos/ y Oferta/. Sin ella, la de sus
// pliegos (en Conocimiento: Radar o PLIEGOS de su carpeta de presentada) y la de su oferta (en Salidas), y
// «principal» es la de la oferta o, si aún no existe, la de los pliegos.
export const CarpetaDrive = z.enum(['pliegos', 'oferta', 'principal']);
export type CarpetaDriveData = z.infer<typeof CarpetaDrive>;
type CarpetaConcreta = Exclude<CarpetaDriveData, 'principal'>;
export type EnlaceDrive = { url: string; ruta: string };
type Buscar = (ruta: string) => Promise<Result<string | null>>;

// Se buscan en Drive por la ruta al pulsar el botón; el id de cada ruta se recuerda un rato, porque buscarlo son
// varias llamadas a la API.
const RECORDAR_MS = 10 * 60_000;
const recordados = new Map<string, { id: string; hasta: number }>();

const AUN_NO = {
  pliegos:
    'La carpeta de los pliegos aún no está en Drive: drive-sync la sube en su siguiente vuelta (un minuto como mucho).',
  oferta:
    'La carpeta de la oferta aún no existe en Drive: se crea con la primera memoria o anexo que genere la plataforma.',
} as const;

function rutaDe(db: Db, id: string, carpeta: CarpetaConcreta): Result<string> {
  const l = obtenerLicitacion(db, id);
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  if (carpeta === 'oferta') return ok(carpetaSalidas(l));
  if (!db.prepare('SELECT 1 FROM pliegos WHERE licitacion_id = ? AND ruta IS NOT NULL').get(id)) {
    return fail('not_found', 'Aún no hay pliegos descargados de esta licitación.');
  }
  return ok(carpetaPliegos(db, l));
}

async function idRecordado(clave: string, ruta: string, buscar: Buscar, ahora: number): Promise<Result<string | null>> {
  const r = recordados.get(clave);
  if (r && r.hasta > ahora) return ok(r.id);
  const hallado = await buscar(ruta);
  if (hallado.data) recordados.set(clave, { id: hallado.data, hasta: ahora + RECORDAR_MS });
  return hallado;
}

/** El enlace a la carpeta de Drive de los pliegos o de la oferta de una licitación (o la principal). */
export async function enlaceEnDrive(
  db: Db,
  id: string,
  carpeta: CarpetaDriveData,
  ahora = Date.now(),
): Promise<Result<EnlaceDrive>> {
  const unica = carpetaUnicaEnDb(db, id);
  if (unica && carpeta === 'principal') return enlaceDeRuta(`Conocimiento/${unica}`, 'pliegos', ahora);
  if (carpeta !== 'principal') return enlaceDeCarpeta(db, id, carpeta, ahora);
  const oferta = await enlaceDeCarpeta(db, id, 'oferta', ahora);
  return oferta.error?.code === 'not_found' ? enlaceDeCarpeta(db, id, 'pliegos', ahora) : oferta;
}

async function enlaceDeCarpeta(
  db: Db,
  id: string,
  carpeta: CarpetaConcreta,
  ahora: number,
): Promise<Result<EnlaceDrive>> {
  const ruta = rutaDe(db, id, carpeta);
  return ruta.error ? ruta : enlaceDeRuta(ruta.data, carpeta, ahora);
}

// La ruta con raíz «Salidas/…» se busca en Salidas; «Conocimiento/…» o sin raíz, en Conocimiento.
async function enlaceDeRuta(ruta: string, carpeta: CarpetaConcreta, ahora: number): Promise<Result<EnlaceDrive>> {
  if (!driveConectado()) return fail('no_configurado', 'Drive no está conectado: conéctalo en Ajustes › Drive.');
  const buscar: Buscar = ruta.startsWith('Salidas/')
    ? carpetaDeSalidasPorRuta
    : (r) => carpetaPorRuta(r.replace(/^Conocimiento\//, ''));
  const r = await idRecordado(ruta, ruta, buscar, ahora);
  if (r.error) return fail('drive_error', `No se pudo buscar la carpeta en Drive: ${r.error.message}`);
  if (r.data === null) return fail('not_found', AUN_NO[carpeta]);
  return ok({ url: enlaceCarpetaDrive(r.data), ruta });
}
