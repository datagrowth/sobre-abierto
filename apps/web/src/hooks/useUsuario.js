// La persona que usa la web (lib/usuarioActual.js) para los componentes: se repintan cuando cambia.
import { useSyncExternalStore } from 'react';
import { suscribirUsuario, usuarioActual } from '../lib/usuarioActual';

export default function useUsuario() {
  return useSyncExternalStore(suscribirUsuario, usuarioActual);
}
