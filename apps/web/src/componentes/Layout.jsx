// Barra lateral blanca y marco de la app. Arriba el logotipo; después el
// trabajo (Pipeline y Oportunidades) y lo que se sabe (Mercado,
// Aprendizaje, Biblioteca, Equipo). No hay pantalla de Inicio: abre el Pipeline. Cada sección muestra cuántas
// cosas esperan a una persona, y el título de la pestaña del navegador también. Al pie, qué hace
// Hermes (lleva a su Actividad y su Consola), si el servidor responde, Ajustes y Cerrar sesión.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChartColumn,
  GraduationCap,
  Inbox,
  Library,
  LogOut,
  Menu,
  Settings,
  SquareKanban,
  Users,
  X,
} from 'lucide-react';
import useEstadoFlujo from '../estado/flujo';
import useEstadoActividad from '../estado/actividad';
import useEstadoHoy from '../estado/hoy';
import useRuta from '../hooks/useRuta';
import { salirCon } from '../hooks/useCambiosSinGuardar';
import useAnchoPantalla from '../hooks/useAnchoPantalla';
import useUsuario from '../hooks/useUsuario';
import { NOMBRE_ROL } from '../lib/usuarioActual';
import PanelDrive from './Paneles/PanelDrive';
import AvisoVersionNueva from './AvisoVersionNueva';
import Logotipo from './comun/Logotipo';
import { configInstalacion } from '../lib/configInstalacion';
import PastillaHermes from './comun/PastillaHermes';
import MisMenciones from './comun/MisMenciones';
import { driveCallbackResult } from '../lib/driveApi';
import { licitacionesApi } from '../lib/licitacionesApi';
import { estadoConexion } from '../lib/alertas';
import { avisosLaterales, ayudaCuenta, totalPendiente, tituloPestana } from '../lib/hoyFormato';
import { avisosDeNavegacion, cuentasDeNavegacion } from '../lib/navegacion';
import { LIENZO, BORDE, TINTA, TINTA_2, OK_TEXTO, IMPIDE, ACCION, RIESGO, VELO } from '../lib/tema';

const GRUPOS = [
  {
    titulo: 'Trabajo',
    secciones: [
      { key: 'pipeline', label: 'Pipeline', Icon: SquareKanban },
      { key: 'oportunidades', label: 'Oportunidades', Icon: Inbox },
    ],
  },
  {
    titulo: 'Saber',
    secciones: [
      { key: 'mercado', label: 'Mercado', Icon: ChartColumn },
      { key: 'aprendizaje', label: 'Aprendizaje', Icon: GraduationCap },
      { key: 'biblioteca', label: 'Biblioteca', Icon: Library },
      { key: 'equipo', label: 'Equipo', Icon: Users },
    ],
  },
];

const SIDEBAR_WIDTH = 232;
const SIDEBAR_COMPACTA = 68;
const SIN_CUENTAS = {};
const ESTADOS_CADA_MS = 60_000;

async function logout() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
}

// El número de una cuenta, en su pastilla.
const ESTILO_CUENTA = {
  minWidth: 20,
  padding: '1px 6px',
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 700,
  textAlign: 'center',
  background: ACCION,
  color: TINTA,
};

// compacta: solo el icono (el nombre queda como etiqueta accesible y al pasar el ratón); el título
// dice qué cuenta el número.
function NavButton({ testKey, label, Icon, active, onClick, cuenta, compacta = false, aviso = null }) {
  const estilo = compacta ? { justifyContent: 'center', position: 'relative' } : {};
  return (
    <button
      type="button"
      className="so-nav-item"
      data-testid={`nav-${testKey}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      aria-label={compacta ? `${label}${cuenta > 0 ? `, ${cuenta} pendientes` : ''}` : undefined}
      title={compacta || cuenta > 0 ? ayudaCuenta(testKey, label, cuenta) : undefined}
      style={estilo}
    >
      <Icon size={compacta ? 18 : 16} strokeWidth={1.5} aria-hidden="true" />
      {!compacta && (
        <span className="flex-1" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span className="truncate">{label}</span>
          {aviso && (
            <span
              className="truncate"
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: active ? TINTA : RIESGO,
                opacity: active ? 0.85 : 1,
              }}
            >
              {aviso}
            </span>
          )}
        </span>
      )}
      {cuenta > 0 && compacta && (
        <span
          aria-hidden="true"
          className="tabular-nums"
          style={{
            position: 'absolute',
            top: 2,
            right: 6,
            minWidth: 16,
            padding: '0 4px',
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 700,
            background: ACCION,
            color: TINTA,
            textAlign: 'center',
          }}
        >
          {cuenta}
        </span>
      )}
      {cuenta > 0 && !compacta && (
        <span aria-label={`${cuenta} pendientes`} className="tabular-nums" style={ESTILO_CUENTA}>
          {cuenta}
        </span>
      )}
    </button>
  );
}

const COLOR_TONO = { ok: OK_TEXTO, aviso: RIESGO, error: IMPIDE };

// «Servidor ✓ · Hermes ✓» con el estado de Licitaciones. En la barra compacta queda el punto con
// el texto como etiqueta: «Sin conexión con el servidor» también se ve ahí.
function ConnectionStatus({ estado, compacta = false }) {
  const connected = useEstadoFlujo((s) => s.connected);
  const isExecuting = useEstadoActividad((s) => s.isExecuting);
  const { tono, texto } = estadoConexion(connected, estado);
  const trabajando = isExecuting && connected;
  return (
    <div
      role="status"
      data-testid="estado-conexion"
      aria-label={compacta ? texto : undefined}
      title={compacta ? texto : undefined}
      className="flex items-center"
      style={{
        gap: 8,
        padding: compacta ? 0 : '0 10px',
        justifyContent: compacta ? 'center' : 'flex-start',
        fontSize: 12,
        color: TINTA_2,
      }}
    >
      <span className="relative flex" style={{ width: 8, height: 8 }}>
        {trabajando && (
          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: ACCION, opacity: 0.5 }} />
        )}
        <span className="relative rounded-full" style={{ width: 8, height: 8, background: COLOR_TONO[tono] }} />
      </span>
      {!compacta && texto}
    </div>
  );
}

// El aviso de la AGPL (sección 13): quien usa la web tiene a mano su código fuente (APP_SOURCE_URL).
function EnlaceCodigoFuente() {
  const { fuente } = configInstalacion();
  if (!fuente) return null;
  return (
    <a
      href={fuente}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="codigo-fuente"
      className="truncate underline"
      style={{ padding: '4px 10px', fontSize: 12, color: TINTA_2 }}
    >
      Código fuente (AGPL)
    </a>
  );
}

// Quién está dentro y con qué permiso, encima de «Cerrar sesión». Sin login no hay nadie que nombrar.
function QuienSoy() {
  const u = useUsuario();
  if (!u) return null;
  return (
    <div data-testid="quien-soy" className="truncate" style={{ padding: '4px 10px', fontSize: 12, color: TINTA_2 }}>
      {u.nombre} · {NOMBRE_ROL[u.rol].toLowerCase()}
    </div>
  );
}

function SidebarContent({ seccion, onSelect, cuentas, avisos = {}, estado = null, compacta = false }) {
  return (
    <div
      className="flex flex-col h-full"
      style={{ padding: compacta ? '18px 8px 12px' : '20px 12px 14px', gap: 16, overflowY: 'auto' }}
    >
      <div
        style={{
          padding: compacta ? 0 : '0 10px',
          display: 'flex',
          justifyContent: compacta ? 'center' : 'flex-start',
        }}
      >
        {compacta ? (
          <span
            aria-label={configInstalacion().nombre}
            style={{ width: 14, height: 14, borderRadius: 3, background: ACCION }}
          />
        ) : (
          <Logotipo />
        )}
      </div>
      <nav className="flex flex-col" style={{ gap: 14 }} aria-label="Secciones">
        {GRUPOS.map((g) => (
          <div key={g.titulo ?? 'inicio'} className="flex flex-col" style={{ gap: 2 }}>
            {g.titulo && !compacta && (
              <div className="label-xs" style={{ padding: '0 10px 4px' }}>
                {g.titulo}
              </div>
            )}
            {g.secciones.map((s) => (
              <NavButton
                key={s.key}
                testKey={s.key}
                label={s.label}
                Icon={s.Icon}
                active={seccion === s.key}
                onClick={() => onSelect(s.key)}
                compacta={compacta}
                cuenta={cuentas[s.key] ?? 0}
                aviso={avisos[s.key] ?? null}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className="flex flex-col" style={{ marginTop: 'auto', gap: 2 }}>
        {!compacta && <PastillaHermes onIr={onSelect} />}
        <ConnectionStatus estado={estado} compacta={compacta} />
        <div style={{ height: 1, background: BORDE, margin: '10px 4px' }} />
        <NavButton
          testKey="ajustes"
          label="Ajustes"
          Icon={Settings}
          active={seccion === 'ajustes'}
          onClick={() => onSelect('ajustes')}
          cuenta={cuentas.ajustes ?? 0}
          compacta={compacta}
        />
        {!compacta && <QuienSoy />}
        {!compacta && <MisMenciones />}
        <NavButton testKey="cerrar-sesion" label="Cerrar sesión" Icon={LogOut} onClick={logout} compacta={compacta} />
        {!compacta && <EnlaceCodigoFuente />}
      </div>
    </div>
  );
}

// Cuentas de pendientes y título de la pestaña, al día con los eventos de la plataforma.
function useCuentas() {
  const { hoy, cargar, avisar } = useEstadoHoy();
  useEffect(() => {
    cargar();
    const iv = setInterval(cargar, 60_000);
    window.addEventListener('plataforma', avisar);
    return () => {
      clearInterval(iv);
      window.removeEventListener('plataforma', avisar);
    };
  }, [cargar, avisar]);
  const cuentas = cuentasDeNavegacion(hoy?.cuentas ?? SIN_CUENTAS);
  const total = totalPendiente(cuentas);
  useEffect(() => {
    document.title = tituloPestana(total, configInstalacion().nombre);
  }, [total]);
  return { cuentas, avisos: avisosDeNavegacion(avisosLaterales(hoy)) };
}

// El estado de Licitaciones (Hermes conectado o en pausa), para el pie. Un fallo deja el último
// leído; sin ninguno, el pie dice solo el servidor.
function useEstadoLicitaciones() {
  const [estado, setEstado] = useState(null);
  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      licitacionesApi.estado().then(
        (e) => {
          if (vivo) setEstado(e);
        },
        () => {},
      );
    cargar();
    const iv = setInterval(cargar, ESTADOS_CADA_MS);
    return () => {
      vivo = false;
      clearInterval(iv);
    };
  }, []);
  return estado;
}

// Menú del móvil: diálogo que se cierra con Esc y devuelve el foco al botón que lo abrió. Al
// cerrarse sigue montado lo que dura su animación de salida.
function MenuMovil({ abierto, onCerrar, children }) {
  const panel = useRef(null);
  const [montado, setMontado] = useState(abierto);
  if (abierto && !montado) setMontado(true);
  useEffect(() => {
    if (!abierto) return undefined;
    const previo = document.activeElement;
    panel.current?.querySelector('button')?.focus();
    const tecla = (e) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('keydown', tecla);
      previo?.focus?.();
    };
  }, [abierto, onCerrar]);
  if (!montado) return null;
  return (
    <>
      <div
        className={`fixed inset-0 z-40 ${abierto ? 'so-fundido' : 'so-fundido-sale'}`}
        style={{ background: VELO }}
        onClick={onCerrar}
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && !abierto) setMontado(false);
        }}
        className={`fixed top-0 bottom-0 left-0 z-50 ${abierto ? 'so-cajon-entra' : 'so-cajon-sale'}`}
        style={{ width: SIDEBAR_WIDTH, maxWidth: '85vw', background: LIENZO, borderRight: `1px solid ${BORDE}` }}
      >
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar menú"
          className="absolute cursor-pointer flex items-center justify-center"
          style={{ top: 12, right: 8, width: 40, height: 40, color: TINTA, background: 'none', border: 'none' }}
        >
          <X size={18} />
        </button>
        {children}
      </aside>
    </>
  );
}

export default function Layout({ children }) {
  const { seccion, ir } = useRuta();
  const [menuOpen, setMenuOpen] = useState(false);
  // Se abre solo al volver de Google para mostrar el resultado y seguir con la carpeta.
  const [driveOpen, setDriveOpen] = useState(Boolean(driveCallbackResult));
  const { isSmall, sidebarCompacta } = useAnchoPantalla();
  const { cuentas, avisos } = useCuentas();
  const estado = useEstadoLicitaciones();

  const cerrarMenu = useCallback(() => setMenuOpen(false), []);
  // Con cambios sin guardar en las comprobaciones, el menú también pregunta antes de salir.
  const select = (key) => {
    setMenuOpen(false);
    salirCon(() => ir(key));
  };
  const sidebar = (
    <SidebarContent seccion={seccion} onSelect={select} cuentas={cuentas} avisos={avisos} estado={estado} />
  );

  return (
    <div className="relative w-full h-full flex overflow-hidden" style={{ background: LIENZO }}>
      {!isSmall && (
        <aside
          className="shrink-0 h-full"
          style={{
            width: sidebarCompacta ? SIDEBAR_COMPACTA : SIDEBAR_WIDTH,
            background: LIENZO,
            borderRight: `1px solid ${BORDE}`,
          }}
        >
          {sidebarCompacta ? (
            <SidebarContent
              seccion={seccion}
              onSelect={select}
              cuentas={cuentas}
              avisos={avisos}
              estado={estado}
              compacta
            />
          ) : (
            sidebar
          )}
        </aside>
      )}
      <div className="flex-1 min-w-0 h-full flex flex-col">
        {isSmall && (
          <header
            className="shrink-0 flex items-center justify-between"
            style={{ height: 56, padding: '0 14px', background: LIENZO, borderBottom: `1px solid ${BORDE}` }}
          >
            <Logotipo alto={20} />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menú"
              className="flex items-center justify-center cursor-pointer"
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                color: TINTA,
                border: `1px solid ${BORDE}`,
                background: 'none',
              }}
            >
              <Menu size={18} />
            </button>
          </header>
        )}
        <AvisoVersionNueva />
        <main className="relative flex-1 min-h-0">{children}</main>
      </div>
      {isSmall && (
        <MenuMovil abierto={menuOpen} onCerrar={cerrarMenu}>
          {sidebar}
        </MenuMovil>
      )}
      {driveOpen && <PanelDrive onClose={() => setDriveOpen(false)} notice={driveCallbackResult} />}
    </div>
  );
}
