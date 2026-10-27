// Aviso de caducidades de la carpeta Empresa, por email a quien lo pide.
import { anotarAviso, configResumen, enviarAviso, yaEnviado } from './avisos.js';
import { quienesQuieren } from './avisosPersona.js';
import { avisosCaducidad } from './carpetaEmpresa.js';
import type { Db } from './db.js';
import { zonaEmpresa } from './empresa.js';
import { enHoraLocal } from './fechas.js';

// El email llega el día que un documento entra en «caduca pronto» o caduca, desde la hora del resumen. Cada
// documento avisa una vez por fecha de caducidad. Los CV y los títulos de una persona no van: son datos
// personales.
const PERSONALES = new Set(['cv', 'titulo']);

export async function avisarCaducidades(db: Db, ahoraMs = Date.now()): Promise<void> {
  const c = enHoraLocal(ahoraMs, zonaEmpresa(db));
  if (c.hora < configResumen(db).hora) return;
  const nuevos = avisosCaducidad(db).filter(
    (d) => !PERSONALES.has(d.tipo) && !yaEnviado(db, `caducidad:${d.id}:${d.caduca_en}`),
  );
  if (!nuevos.length) return;
  await enviarAviso(db, {
    clave: `caducidades:${c.fecha}`,
    tipo: 'caducidades',
    para: quienesQuieren(db, 'caducidades'),
    plantilla: {
      asunto:
        nuevos.length === 1
          ? `Hermes: «${nuevos[0]!.nombre}» va a caducar`
          : `Hermes: ${nuevos.length} documentos de la empresa van a caducar`,
      titulo: 'Documentos de la empresa que caducan',
      intro: 'Renuévalos antes de presentar otra oferta: un certificado caducado puede dejarla fuera.',
      bloques: [
        {
          titulo: 'Carpeta Empresa',
          filas: nuevos.map((d) => ({ texto: d.nombre, detalle: d.texto, enlace: '#/ajustes/empresa' })),
        },
      ],
      boton: { texto: 'Abrir la carpeta Empresa', enlace: '#/ajustes/empresa' },
    },
  });
  for (const d of nuevos) anotarAviso(db, `caducidad:${d.id}:${d.caduca_en}`, 'caducidad');
}
