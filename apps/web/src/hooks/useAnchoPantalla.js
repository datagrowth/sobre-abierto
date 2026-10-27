// Hook que da el tamaño de pantalla (estrecha, compacta o escritorio) para adaptar la interfaz.
import { useState, useEffect } from 'react';

// Cortes de la interfaz (el de móvil, < 768 con controles de 44 px, va en index.css):
//  - estrecha (< 900): menú en cajón, pestañas en desplegable y la ficha sustituye a la lista;
//  - compacta (900–1199): barra lateral solo con iconos para que quepan lista y ficha;
//  - escritorio (≥ 1200): barra lateral completa.
const ESTRECHA = 900;
const COMPACTA = 1200;

export default function useAnchoPantalla() {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return {
    width,
    // Lista o ficha, no las dos; también el menú en cajón.
    isSmall: width < ESTRECHA,
    sidebarCompacta: width >= ESTRECHA && width < COMPACTA,
  };
}
