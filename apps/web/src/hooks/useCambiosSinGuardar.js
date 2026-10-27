// Cambios sin guardar de los cajones de las comprobaciones: cada formulario dice si tiene algo
// sin guardar y las comprobaciones, que pone el CambiosContext, pregunta antes de que se pierda (otro
// cajón, «← Mi mesa», «Siguiente tarea», cerrar la pestaña). Fuera de las comprobaciones (los pasos
// antiguos) no hay contexto y el hook no hace nada: allí cada paso avisa a su manera.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Lo que dan las comprobaciones: { sucios, marcar(nombre, sucio), pedirSalida(accion, excepto),
 * abrirCajon(destino) }. pedirSalida ejecuta `accion` en el acto si no queda nada sin guardar
 * (fuera de `excepto`, el cajón al que se va) y, si queda, pregunta antes.
 */
export const CambiosContext = createContext(null);

function quitarOPoner(lista, nombre, sucio) {
  if (lista.includes(nombre) === sucio) return lista;
  return sucio ? [...lista, nombre] : lista.filter((n) => n !== nombre);
}

/** Para quien pone el contexto: qué cajones tienen cambios y el aviso del navegador al salir. */
export function useRegistroCambios() {
  const [sucios, setSucios] = useState([]);
  const marcar = useCallback((nombre, sucio) => setSucios((s) => quitarOPoner(s, nombre, Boolean(sucio))), []);
  const hay = sucios.length > 0;
  useEffect(() => {
    if (!hay) return undefined;
    // El navegador pone su propio texto: basta con cancelar el evento.
    const avisar = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [hay]);
  return { sucios, marcar };
}

/** Para cada formulario de un cajón: `nombre` es el del cajón (decisiones, memoria…). */
export function useCambiosSinGuardar(nombre, sucio) {
  const marcar = useContext(CambiosContext)?.marcar;
  useEffect(() => {
    if (!marcar) return undefined;
    marcar(nombre, sucio);
    // Al desmontarse (se descartaron los cambios), ese cajón deja de contar.
    return () => marcar(nombre, false);
  }, [marcar, nombre, sucio]);
}

// La navegación de fuera de las comprobaciones («← Mi mesa», las pestañas de la ficha, el menú lateral) no
// ve su contexto: las comprobaciones montadas dejan aquí su pedirSalida (solo hay una a la vez) y salirCon
// pasa por él. Sin comprobaciones montadas, navega en el acto.
let guardia = null;

/** Para las comprobaciones: registra su pedirSalida mientras esté montada. */
export function useGuardiaSalida(pedirSalida) {
  useEffect(() => {
    guardia = pedirSalida;
    return () => {
      if (guardia === pedirSalida) guardia = null;
    };
  }, [pedirSalida]);
}

/** Si hay unas comprobaciones montadas que pueden tener cambios sin guardar (useRuta la consulta en Atrás/Adelante). */
export const hayGuardia = () => guardia !== null;

/** Ejecuta `accion` (navegar fuera) o, con cambios sin guardar en las comprobaciones, pregunta antes. */
export function salirCon(accion) {
  if (guardia) guardia(accion);
  else accion();
}
