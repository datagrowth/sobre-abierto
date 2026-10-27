// El resumen de la plataforma para la barra lateral (cuentas de lo pendiente, título de la
// pestaña). Se recarga con los eventos de la plataforma (agrupados) y cada minuto.
import { create } from 'zustand';
import { plataformaApi } from '../lib/plataformaApi';

const ESPERA_EVENTOS_MS = 1500;
let temporizador = null;

const useEstadoHoy = create((set, get) => ({
  hoy: null,
  error: null,
  cargar: async () => {
    try {
      const hoy = await plataformaApi.hoy();
      set({ hoy, error: null });
    } catch (e) {
      set({ error: e.message });
    }
  },
  // Muchos eventos seguidos (una criba de 40) piden una sola recarga.
  avisar: () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => get().cargar(), ESPERA_EVENTOS_MS);
  },
}));

export default useEstadoHoy;
