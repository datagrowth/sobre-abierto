// Ajustes en nueve pestañas: Empresa, Marca (nombre, colores y logo de la instalación),
// Usuarios y permisos (las personas y sus roles), Avisos (el resumen semanal y los avisos de cada
// persona), Fuentes y filtros (los filtros, el estado de la ingesta, la auditoría de cobertura y la
// escala de los rankings de competencia), Drive (la conexión, las carpetas de Conocimiento, el ensayo
// de la carpeta única y la carpeta de notas de la Biblioteca), Hermes (lo operativo), Integraciones
// (el calendario de cada persona) y Acerca de (licencia y código fuente).
import { useEffect, useState } from 'react';
import { Cloud } from 'lucide-react';
import { TINTA, TINTA_2 } from '../../lib/tema';
import useRuta from '../../hooks/useRuta';
import useEstadoDominio from '../../hooks/useEstadoDominio';
import { licitacionesApi } from '../../lib/licitacionesApi';
import PanelDominio from '../comun/PanelDominio';
import EmpresaVista from '../comun/EmpresaVista';
import { Bloque } from '../comun/ui';
import { Tarjeta, Boton } from '../ui';
import CarpetaEmpresa from './CarpetaEmpresa';
import CarpetaUnicaVista from './CarpetaUnicaVista';
import CoberturaVista from './CoberturaVista';
import CalidadVista from './CalidadVista';
import UsuariosVista from './UsuariosVista';
import AvisosVista from './AvisosVista';
import IntegracionesVista from './IntegracionesVista';
import AcercaVista from './AcercaVista';
import MarcaVista from './MarcaVista';
import EscalaCompetencia from './EscalaCompetencia';
import PanelDrive from '../Paneles/PanelDrive';
import BibliotecaAjustes from '../Biblioteca/BibliotecaAjustes';
import FiltrosVista from '../Licitaciones/FiltrosVista';
import { CarpetasConocimiento, EstadoFuentes, EstadoHermes } from '../Licitaciones/EstadoVista';

const VISTAS = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'marca', label: 'Marca' },
  { key: 'usuarios', label: 'Usuarios y permisos' },
  { key: 'avisos', label: 'Avisos' },
  { key: 'fuentes', label: 'Fuentes y filtros' },
  { key: 'drive', label: 'Drive' },
  { key: 'hermes', label: 'Hermes' },
  { key: 'integraciones', label: 'Integraciones' },
  { key: 'acerca', label: 'Acerca de' },
];

function Drive({ estado, onRecargar }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 920 }}>
      <Bloque titulo="GOOGLE DRIVE">
        <p style={{ fontSize: 13, color: TINTA, margin: '0 0 6px', lineHeight: 1.55 }}>
          Conexión con Drive, carpeta de la Biblioteca (Conocimiento), carpeta de Salidas y copia de seguridad.
        </p>
        <p style={{ fontSize: 12.5, color: TINTA_2, margin: '0 0 10px' }}>Se abre en una ventana encima de la app.</p>
        <Boton variante="principal" Icono={Cloud} onClick={() => setAbierto(true)}>
          Abrir Google Drive
        </Boton>
      </Bloque>
      <CarpetasConocimiento estado={estado} onRecargar={onRecargar} />
      <CarpetaUnicaVista />
      <BibliotecaAjustes />
      {abierto && <PanelDrive onClose={() => setAbierto(false)} notice={null} />}
    </div>
  );
}

function Fuentes({ estado, onRecargar }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <EstadoFuentes estado={estado} onRecargar={onRecargar} />
      <CoberturaVista />
      <CalidadVista />
      <Tarjeta
        titulo="Prefiltro de entrada"
        subtitulo="El límite exterior: lo que no pasa no entra en Oportunidades. En la lista se afina sin cambiarlo."
        testid="prefiltro"
      >
        <FiltrosVista />
      </Tarjeta>
      <EscalaCompetencia />
    </div>
  );
}

// Direcciones antiguas de filtros, estado y Biblioteca: hay enlaces ya enviados y guardados que las
// usan, así que llevan a su pestaña actual: [sección, vista, id].
const MOVIDAS = {
  'filtros-licitaciones': ['ajustes', 'fuentes', 'filtros'],
  'estado-licitaciones': ['ajustes', 'fuentes', 'estado'],
  biblioteca: ['ajustes', 'drive', null],
};

export default function AjustesPanel() {
  const { vista: pedida, irVista, ir } = useRuta();
  const { estado, cargarEstado } = useEstadoDominio(licitacionesApi.estado, 'licitacion');
  const movida = MOVIDAS[pedida];
  useEffect(() => {
    if (movida) ir(movida[0], movida[1], movida[2], { reemplazar: true });
  }, [movida, ir]);
  const vista = VISTAS.some((v) => v.key === pedida) ? pedida : 'empresa';
  return (
    <PanelDominio
      titulo="Ajustes"
      subtitulo="la empresa, quién entra, los avisos, las fuentes del radar, Drive, Hermes y las integraciones"
      vistas={VISTAS}
      vista={vista}
      onVista={(v) => irVista(v)}
    >
      {vista === 'empresa' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <EmpresaVista />
          <CarpetaEmpresa />
        </div>
      )}
      {vista === 'marca' && <MarcaVista />}
      {vista === 'integraciones' && <IntegracionesVista />}
      {vista === 'acerca' && <AcercaVista />}
      {vista === 'avisos' && <AvisosVista />}
      {vista === 'usuarios' && <UsuariosVista />}
      {vista === 'fuentes' && <Fuentes estado={estado} onRecargar={cargarEstado} />}
      {vista === 'drive' && <Drive estado={estado} onRecargar={cargarEstado} />}
      {vista === 'hermes' && <EstadoHermes estado={estado} />}
    </PanelDominio>
  );
}
