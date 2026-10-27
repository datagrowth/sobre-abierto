// El logo de la instalación (Ajustes › Marca) o, sin él, la marca neutra: el sobre y el nombre de la
// app. Va arriba en la barra lateral, en la cabecera del móvil y en el acceso.
import { configInstalacion } from '../../lib/configInstalacion';

export default function Logotipo({ alto = 24 }) {
  const { nombre, logo } = configInstalacion();
  if (logo) return <img src={logo} alt={nombre} style={{ height: alto, width: 'auto', display: 'block' }} />;
  return (
    <div className="flex items-center" style={{ gap: 8 }}>
      <img src="/marca/sobre-abierto.svg" alt="" style={{ height: alto, width: alto, display: 'block' }} />
      <span
        className="text-tinta"
        style={{ fontSize: Math.round(alto * 0.7), fontWeight: 700, letterSpacing: '-0.01em' }}
      >
        {nombre}
      </span>
    </div>
  );
}
