// Punto de entrada de la web: carga las fuentes y los estilos y monta la app tras la puerta de acceso.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fuentes de la marca servidas por la propia app (sin CDN).
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';
import App from './App.jsx';
import GuardiaAcceso from './componentes/Acceso/GuardiaAcceso.jsx';
import { cargarConfigInstalacion } from './lib/configInstalacion.js';

// Tras un despliegue, una pestaña abierta pide secciones de la web anterior que ya no están: se
// recarga para coger la nueva. Solo una vez por minuto, para no entrar en bucle si falta de verdad.
window.addEventListener('vite:preloadError', (evento) => {
  const CLAVE = 'recarga-por-version';
  const ultima = Number(sessionStorage.getItem(CLAVE) ?? 0);
  if (Date.now() - ultima < 60_000) return;
  evento.preventDefault();
  sessionStorage.setItem(CLAVE, String(Date.now()));
  window.location.reload();
});

// La marca y la zona de la instalación antes de pintar nada: sin ellas, la neutra.
cargarConfigInstalacion().then(() =>
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <GuardiaAcceso>
        <App />
      </GuardiaAcceso>
    </StrictMode>,
  ),
);
