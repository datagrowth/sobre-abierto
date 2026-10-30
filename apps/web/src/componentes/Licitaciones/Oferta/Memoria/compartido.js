// Estilos y ayudas que comparten las piezas de la memoria técnica (Oferta › Memoria).
import { useState } from 'react';
import { TINTA, TINTA_2, TIPO } from '../../../../lib/tema';
import { textoOrigen } from '../../../../lib/memoriaFormato';
import { indicacionDeFuga } from '../../../../lib/fugasFormato';
import { indicacionesDeFugas, motivosPrecargados } from '../../../../lib/apartadosFormato';
import { puedePedirCambios } from '../../../../lib/subidaVersionFormato';

export const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
export const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };
export const plegador = { cursor: 'pointer', ...texto, color: TINTA_2 };

export const TONO_VERSION = {
  en_curso: 'neutro',
  pendiente: 'riesgo',
  aceptada: 'ok',
  descartada: 'neutro',
  fallida: 'impide',
  ensayo: 'neutro',
};

// Se puede pedir otra versión a Hermes: ni de ensayo, ni de otro guion, ni subida entera (sin apartados), y ya con su Word.
export const sePuedePedir = (m) => puedePedirCambios(m) && !m.guion_cambiado;

// A donde lleva una fuga; data-foco, para que las comprobaciones enfoquen el apartado.
export const anclaApartado = (m, n) => `memoria-${m.id}-apartado-${n}`;

// Una copia de «Volver a esta versión» sale de otra sin rehacer nada (una mejora siempre rehace algún apartado).
const esCopia = (o) =>
  typeof o?.version_base === 'number' && !o.subida && !o.indicaciones && !(o.apartados_rehechos ?? []).length;
export const origenDe = (m) =>
  esCopia(m.origen) ? `Copia de la v${m.origen.version_base} («Volver a esta versión»), sin Hermes` : textoOrigen(m);

// Qué panel está abierto bajo la versión: pedir cambios (con lo precargado desde una fuga) o subir el Word.
export function usePaneles() {
  const [pidiendo, setPidiendo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const pedir = (inicial) => {
    setSubiendo(false);
    setPidiendo({ inicial });
  };
  return {
    pidiendo,
    subiendo,
    pedir: () => pedir(null),
    pedirConCita: (h) => pedir({ indicaciones: indicacionDeFuga(h), apartados: [h.apartado] }),
    pedirMotivos: (m) => pedir({ indicaciones: indicacionesDeFugas(m), apartados: motivosPrecargados(m) }),
    subir: () => {
      setPidiendo(null);
      setSubiendo(true);
    },
    cerrarPedir: () => setPidiendo(null),
    cerrarSubir: () => setSubiendo(false),
  };
}

export const COMO_REDACTA = {
  titulo: 'Dossier, estrategia, la memoria entera en un run, un crítico ciego y rondas hasta llegar al umbral',
  aviso: 'Hermes prepara el plan y redacta la memoria entera; un crítico ciego la puntúa. El avance se ve aquí.',
};

export const DESDE_CERO =
  'Hermes vuelve a redactar todos los apartados sin partir de la versión actual. Para retocarla, mejor «Pedir cambios».';
