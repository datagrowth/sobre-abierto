// Los pasos para dejar una instalación nueva trabajando: perfil de la empresa, qué licitaciones
// buscar, la IA de Hermes y, aparte, Drive (opcional). No guardan nada: cada paso lleva a la pestaña
// de Ajustes donde ya se hace, y se da por hecho cuando lo que hay allí ya no es el de fábrica.

/**
 * @param {{ empresa?: { perfil?: { nombre?: string } | null } | null, prefiltro?: { de_ejemplo?: boolean } | null,
 *           estado?: { hermes?: string } | null, drive?: { connected?: boolean } | null }} datos
 * Un dato que aún no ha llegado (null) deja su paso sin hacer: la tarjeta no se pinta hasta tenerlos todos.
 */
export function pasosPrimerArranque({ empresa, prefiltro, estado, drive }) {
  return [
    {
      clave: 'empresa',
      titulo: 'Cuenta quién eres',
      hecho: Boolean(empresa?.perfil?.nombre),
      opcional: false,
      destino: ['ajustes', 'empresa'],
      texto:
        'Nombre, NIF, región y zona horaria de la empresa, y lo que puede acreditar. La criba compara cada licitación con este perfil.',
    },
    {
      clave: 'filtros',
      titulo: 'Elige qué licitaciones buscar',
      hecho: prefiltro?.de_ejemplo === false,
      opcional: false,
      destino: ['ajustes', 'fuentes'],
      texto:
        'Los CPV, palabras clave, importes y región que te interesan. Hasta que los guardes, los filtros son un ejemplo.',
    },
    {
      clave: 'ia',
      titulo: 'Conecta la IA',
      hecho: estado?.hermes === 'configurado',
      opcional: false,
      destino: ['ajustes', 'hermes'],
      texto:
        'Hermes criba y analiza con el modelo que elijas. Sin él, el radar descarga y filtra, pero la IA queda esperando.',
    },
    {
      clave: 'drive',
      titulo: 'Conecta Google Drive',
      hecho: drive?.connected === true,
      opcional: true,
      destino: ['ajustes', 'drive'],
      texto: 'Opcional. Sin Drive, la Biblioteca y las carpetas de cada licitación viven en el disco del servidor.',
    },
  ];
}

/** La tarjeta sobra cuando está todo lo obligatorio. */
export function faltaPonerEnMarcha(pasos) {
  return pasos.some((p) => !p.opcional && !p.hecho);
}
