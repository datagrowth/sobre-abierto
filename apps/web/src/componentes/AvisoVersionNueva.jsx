// Banda fija que avisa de que hay una versión nueva tras un despliegue. No recarga sola:
// así no se pierden borradores de formularios; la persona recarga cuando le conviene.
import { useEffect, useState } from 'react';
import { COMPROBAR_CADA_MS, comprobarVersion, EVENTO_VERSION_NUEVA } from '../lib/versionWeb';
import { RIESGO, RIESGO_SUAVE, TINTA, LIENZO } from '../lib/tema';

export default function AvisoVersionNueva() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const mostrar = () => setVisible(true);
    window.addEventListener(EVENTO_VERSION_NUEVA, mostrar);
    // Un fallo de la comprobación no se enseña: el aviso es una ayuda y el siguiente intervalo vuelve a probar.
    const id = setInterval(() => {
      void comprobarVersion();
    }, COMPROBAR_CADA_MS);
    return () => {
      window.removeEventListener(EVENTO_VERSION_NUEVA, mostrar);
      clearInterval(id);
    };
  }, []);
  if (!visible) return null;
  return (
    <div
      role="status"
      data-testid="aviso-version"
      className="shrink-0 flex items-center justify-center flex-wrap"
      style={{
        gap: 12,
        padding: '8px 14px',
        background: RIESGO_SUAVE,
        color: TINTA,
        borderBottom: `1px solid ${RIESGO}`,
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <span>Hay una versión nueva de la plataforma. Recarga para seguir guardando.</span>
      <button
        type="button"
        data-testid="aviso-version-recargar"
        onClick={() => window.location.reload()}
        className="cursor-pointer"
        style={{
          padding: '4px 12px',
          borderRadius: 6,
          border: `1px solid ${TINTA}`,
          background: TINTA,
          color: LIENZO,
          fontWeight: 600,
        }}
      >
        Recargar
      </button>
    </div>
  );
}
