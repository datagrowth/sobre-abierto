// Texto de la copia de seguridad a Drive (status.copia de /api/drive/status), sin React y con tests.
import { fechaHora } from './formato.js';

const PLATAFORMA = {
  diaria: 'cada día',
  semanal: 'una vez por semana',
  no: 'no se copian',
};

// La copia del día sale poco después de su hora; con más de un día y dos horas sin copia
// nueva, algo falla (p. ej. Drive lleno) aunque la copia siga activa.
const ATRASO_MS = 26 * 3_600_000;

/**
 * Estado ('activa' | 'atrasada' | 'desactivada' | 'desconocida') y líneas de texto para el
 * panel de Drive; la primera es el titular.
 */
export function estadoCopia(copia, ahora = Date.now()) {
  if (!copia) {
    return {
      estado: 'desconocida',
      lineas: ['Copia de seguridad: drive-sync aún no ha informado (se ve tras su próxima vuelta).'],
    };
  }
  if (!copia.activa) return desactivada(copia);
  const lineas = [
    `Copia de seguridad a Drive activa: cada día desde las ${copia.hora ?? '?'}:00, se conservan ${copia.conservarDias ?? '?'} días.`,
    copia.ultima ? `Última copia: ${fechaHora(copia.ultima)}.` : 'Aún no se ha hecho ninguna copia.',
  ];
  const modo = PLATAFORMA[copia.plataforma] || copia.plataforma;
  const ultimaPlataforma =
    copia.plataforma !== 'no' && copia.ultimaPlataforma ? ` (última: ${fechaHora(copia.ultimaPlataforma)})` : '';
  lineas.push(`Bases de datos de la plataforma: ${modo}${ultimaPlataforma}.`);
  if (!atrasada(copia.ultima, ahora)) return { estado: 'activa', lineas };
  const aviso = `La copia de seguridad no se hace desde el ${fechaHora(copia.ultima)}: revisa los logs de drive-sync (¿Drive lleno?).`;
  return { estado: 'atrasada', lineas: [aviso, ...lineas] };
}

function atrasada(ultima, ahora) {
  const t = Date.parse(ultima ?? '');
  return !Number.isNaN(t) && ahora - t > ATRASO_MS;
}

// Desactivarla no borra lo que ya hay en Drive, que es justo lo que ocupa espacio.
function desactivada(copia) {
  const lineas = [
    `Copia de seguridad a Drive desactivada (${copia.motivo || 'sin motivo'}).`,
    'Los datos del servidor dependen de la copia del VPS.',
  ];
  if (copia.ultima) {
    lineas.push(`Última copia: ${fechaHora(copia.ultima)}; sigue en Drive → Copias de seguridad hasta que la borres.`);
  }
  return { estado: 'desactivada', lineas };
}
