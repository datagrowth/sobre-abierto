// Ajustes › Acerca de: qué es la aplicación, su licencia y dónde está su código fuente (aviso de
// la AGPL, sección 13). El enlace es APP_SOURCE_URL o, sin ella, el repositorio público.
import { ExternalLink } from 'lucide-react';
import { configInstalacion } from '../../lib/configInstalacion';
import { Tarjeta } from '../ui';

export default function AcercaVista() {
  const { nombre, fuente, version } = configInstalacion();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <Tarjeta
        titulo={nombre}
        subtitulo="Basada en Sobre Abierto, software libre para preparar licitaciones públicas con IA."
        testid="acerca"
      >
        <div className="text-cuerpo text-tinta" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {version && (
            <p data-testid="acerca-version">
              Versión <strong>{version}</strong>
            </p>
          )}
          <p>
            Se distribuye con licencia AGPL-3.0: puedes usarla, estudiarla, modificarla y compartirla. Si la ofreces a
            otras personas por la red con cambios, tienes que darles también el código de esos cambios.
          </p>
          {fuente ? (
            <a
              href={fuente}
              target="_blank"
              rel="noopener noreferrer"
              className="underline inline-flex items-center"
              style={{ gap: 4 }}
              data-testid="acerca-codigo-fuente"
            >
              Código fuente <ExternalLink size={14} aria-hidden />
            </a>
          ) : (
            <p className="text-tinta-2">Esta instalación no indica dónde está su código fuente (APP_SOURCE_URL).</p>
          )}
        </div>
      </Tarjeta>
    </div>
  );
}
