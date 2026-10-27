// Componente raíz de la web: abre el socket y muestra la sección activa dentro del diseño general.
import { lazy, Suspense, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import Layout from './componentes/Layout';
import { OportunidadesPanel, PipelinePanel } from './componentes/Licitaciones/RadarPaneles';
import { CabeceraPanel } from './componentes/comun/PanelDominio';
import { Boton, Esqueleto } from './componentes/ui';
import NoEncontrada from './componentes/comun/NoEncontrada';
import { rutaDesconocida } from './lib/rutas';
import useConexionServidor from './hooks/useConexionServidor';
import useRuta from './hooks/useRuta';

// Cada sección se descarga al abrirla: así la primera carga no trae el código de todas. El
// Pipeline y Oportunidades van en el bundle inicial porque son la portada.
const VistaEnVivo = lazy(() => import('./componentes/EnVivo/VistaEnVivo'));
const PanelBiblioteca = lazy(() => import('./componentes/Biblioteca/PanelBiblioteca'));
const PanelHermes = lazy(() => import('./componentes/Paneles/PanelHermes'));
const SelectorSesion = lazy(() => import('./componentes/Paneles/SelectorSesion'));
const LicitacionPagina = lazy(() => import('./componentes/Licitaciones/LicitacionPagina'));
const MercadoPanel = lazy(() => import('./componentes/Mercado/MercadoPanel'));
const AprendizajePanel = lazy(() => import('./componentes/Aprendizaje/AprendizajePanel'));
const ColaboradoresPanel = lazy(() => import('./componentes/Colaboradores/ColaboradoresPanel'));
const AjustesPanel = lazy(() => import('./componentes/Ajustes/AjustesPanel'));
const Catalogo = lazy(() => import('./componentes/Diseno/Catalogo'));

const ESPERA_SECCION = (
  <div style={{ padding: '20px 24px' }}>
    <Esqueleto lineas={6} />
  </div>
);

// Actividad de Hermes: el selector de sesión vive aquí, que es donde sirve. La Consola (el
// dashboard de Hermes) cuelga de aquí: es operación, no trabajo diario.
function ActividadPanel({ onConsola }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '20px 24px 0' }}>
      <CabeceraPanel titulo="Actividad de Hermes" subtitulo="lo que hace Hermes en cada sesión, en directo">
        <div style={{ width: 420, maxWidth: '100%' }}>
          <SelectorSesion />
        </div>
        <Boton Icono={SquareTerminal} onClick={onConsola} testid="ir-consola">
          Consola
        </Boton>
      </CabeceraPanel>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VistaEnVivo />
      </div>
    </div>
  );
}

function App() {
  useConexionServidor();
  const { seccion, ir } = useRuta();
  // Una sección que no existe no redirige al Pipeline en silencio: es una 404 con la marca.
  const noEncontrada = rutaDesconocida(window.location.hash);
  // La consola de Hermes se monta la primera vez que se abre y ya no se desmonta.
  const [consolaAbierta, setConsolaAbierta] = useState(false);
  if (seccion === 'consola' && !consolaAbierta) setConsolaAbierta(true);

  return (
    <Layout>
      <div className="w-full h-full flex flex-col overflow-hidden">
        <Suspense fallback={ESPERA_SECCION}>
          {noEncontrada && <NoEncontrada direccion={window.location.hash} onInicio={() => ir('pipeline')} />}
          {!noEncontrada && seccion === 'pipeline' && <PipelinePanel />}
          {seccion === 'oportunidades' && <OportunidadesPanel />}
          {seccion === 'licitacion' && <LicitacionPagina />}
          {seccion === 'mercado' && <MercadoPanel />}
          {seccion === 'aprendizaje' && <AprendizajePanel />}
          {seccion === 'equipo' && <ColaboradoresPanel />}
          {seccion === 'biblioteca' && <PanelBiblioteca />}
          {seccion === 'actividad' && <ActividadPanel onConsola={() => ir('consola')} />}
          {seccion === 'ajustes' && <AjustesPanel />}
          {seccion === 'diseno' && <Catalogo />}
        </Suspense>
        <Suspense fallback={seccion === 'consola' ? ESPERA_SECCION : null}>
          {consolaAbierta && <PanelHermes visible={seccion === 'consola'} />}
        </Suspense>
      </div>
    </Layout>
  );
}

export default App;
