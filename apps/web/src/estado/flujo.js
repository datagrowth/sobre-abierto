// Store del estado general de la web: conexión con el servidor y sesiones de Hermes.
import { create } from 'zustand';
import { sortSessionsByActivity } from '../lib/sesionesHermes';
import useEstadoActividad from './actividad';

// Estado general: conexión y sesiones de Hermes (la sección va en la ruta). La
// actividad de la sesión elegida vive en activityStore.
const useEstadoFlujo = create((set, get) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),

  sessions: [],
  sessionsLoading: false,
  sessionsError: null,
  selectedSessionId: null,

  // Sin sesión elegida, se elige la más reciente y se carga su actividad.
  setSessions: (sessions = []) => {
    const sorted = sortSessionsByActivity(sessions);
    set({ sessions: sorted });
    if (!get().selectedSessionId && sorted[0]?.id) get().selectSession(sorted[0].id);
  },

  loadSessions: async () => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ sessionsLoading: false });
      get().setSessions(data.sessions || []);
    } catch (error) {
      set({ sessionsLoading: false, sessionsError: error.message || 'No se pudieron cargar las sesiones' });
    }
  },

  selectSession: (sessionId) => {
    if (!sessionId || sessionId === get().selectedSessionId) return;
    set({ selectedSessionId: sessionId });
    useEstadoActividad.getState().loadHistory(sessionId);
  },

  // Actividad nueva en una sesión: sube en la lista de recientes.
  touchSession: (sessionId, at) =>
    set((prev) => ({
      sessions: sortSessionsByActivity(
        prev.sessions.map((session) =>
          session.id === sessionId && at > (session.lastActiveMs || 0) ? { ...session, last_active: at } : session,
        ),
      ),
    })),
}));

export default useEstadoFlujo;
