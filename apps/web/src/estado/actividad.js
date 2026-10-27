// Store con la actividad de la sesión que se está viendo, limitada a los últimos elementos.
import { create } from 'zustand';

// Actividad de la sesión que se está viendo (pestaña «En directo»). Los elementos
// llegan por Socket.io (`activity`) o del historial al elegir la sesión; un mismo
// id se actualiza (llamada en marcha → terminada).
const MAX_ITEMS = 300;

function capped(items) {
  const values = Object.values(items);
  if (values.length <= MAX_ITEMS) return items;
  const keep = values.sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
  return Object.fromEntries(keep.map((item) => [item.id, item]));
}

const useEstadoActividad = create((set, get) => ({
  sessionId: null,
  items: {},
  isExecuting: false,
  // Cuándo llegó el último aviso de inicio de turno (reloj del navegador).
  executingSince: 0,
  instruction: '',
  historyLoading: false,
  historyError: null,

  applyActivity: (item) => {
    if (!item?.id || item.sessionId !== get().sessionId) return;
    set((prev) => ({ items: capped({ ...prev.items, [item.id]: { ...prev.items[item.id], ...item } }) }));
  },

  setExecuting: (sessionId, isExecuting, instruction) => {
    if (sessionId !== get().sessionId) return;
    set((prev) => ({
      isExecuting,
      executingSince: isExecuting && !prev.isExecuting ? Date.now() : prev.executingSince,
      instruction: instruction ?? prev.instruction,
    }));
  },

  loadHistory: async (sessionId) => {
    set({
      sessionId,
      items: {},
      isExecuting: false,
      executingSince: 0,
      instruction: '',
      historyLoading: true,
      historyError: null,
    });
    if (!sessionId) {
      set({ historyLoading: false });
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/activity`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (get().sessionId !== sessionId) return; // se eligió otra sesión mientras cargaba
      // Lo que llegó en vivo durante la carga manda sobre el historial.
      const history = Object.fromEntries((data.activity || []).map((item) => [item.id, item]));
      const lastTurn = (data.activity || []).filter((i) => i.kind === 'turn').pop();
      set((prev) => ({
        items: capped({ ...history, ...prev.items }),
        instruction: prev.instruction || lastTurn?.subject || '',
        historyLoading: false,
      }));
    } catch (error) {
      if (get().sessionId === sessionId) set({ historyLoading: false, historyError: error.message });
    }
  },
}));

export default useEstadoActividad;
