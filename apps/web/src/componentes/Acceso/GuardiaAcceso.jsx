// Puerta de acceso: no monta la app hasta confirmar la sesión; si falta o caduca, muestra el inicio de sesión.
import { useCallback, useEffect, useState } from 'react';
import PantallaAcceso from './PantallaAcceso';
import CambiarContrasena from './CambiarContrasena';
import { fijarUsuario } from '../../lib/usuarioActual';
import { debeVolverAEntrar, EVENTO_SESION_CADUCADA } from '../../lib/sesion';
import { LIENZO, TINTA, TINTA_2 } from '../../lib/tema';
import { configInstalacion } from '../../lib/configInstalacion';
import { Aviso, Boton } from '../ui';

const AVISO_CADUCADA = 'Tu sesión ha caducado: vuelve a entrar.';

// No monta la app (ni abre Socket.io) hasta que el monitor confirma la sesión, y vuelve al
// login si caduca con la app abierta. Sin red no se puede confirmar: se dice y se deja
// reintentar, en vez de entrar a ciegas. Con la contraseña temporal del alta, pide cambiarla
// antes de entrar (la API no responde hasta entonces). Deja la persona en lib/usuarioActual.
export default function GuardiaAcceso({ children }) {
  const [status, setStatus] = useState('checking');
  const [aviso, setAviso] = useState('');

  const consultar = useCallback(() => {
    fetch('/auth/session')
      .then((res) => res.json())
      .then((s) => {
        fijarUsuario(s.usuario ?? null);
        if (s.enabled && !s.authenticated) setStatus('out');
        else setStatus(s.usuario?.debe_cambiarla ? 'cambiar' : 'in');
      })
      .catch(() => setStatus('sin_conexion'));
  }, []);

  const reintentar = () => {
    setStatus('checking');
    consultar();
  };

  useEffect(() => {
    consultar();
  }, [consultar]);

  // Un 401 de la API o un socket rechazado: si /auth/session confirma que la sesión caducó, de
  // vuelta al login con el aviso. Sin confirmarlo no se echa a nadie: un socket que no conecta
  // durante un despliegue no es una sesión perdida.
  useEffect(() => {
    const salir = () => {
      fetch('/auth/session')
        .then((res) => res.json())
        .then((s) => {
          if (debeVolverAEntrar(s)) {
            setAviso(AVISO_CADUCADA);
            setStatus('out');
          }
        })
        .catch(() => {});
    };
    window.addEventListener(EVENTO_SESION_CADUCADA, salir);
    return () => window.removeEventListener(EVENTO_SESION_CADUCADA, salir);
  }, []);

  if (status === 'checking') return null;
  if (status === 'sin_conexion') return <SinConexion onReintentar={reintentar} />;
  if (status === 'out')
    return (
      <PantallaAcceso
        aviso={aviso}
        onLogin={() => {
          setAviso('');
          setStatus('checking');
          consultar();
        }}
      />
    );
  if (status === 'cambiar') return <CambiarContrasena onHecho={() => setStatus('in')} />;
  return children;
}

function SinConexion({ onReintentar }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: LIENZO, padding: 16 }}>
      <div className="flex flex-col" style={{ width: 380, maxWidth: '100%', gap: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: TINTA }}>{configInstalacion().nombre}</h1>
        <Aviso tono="aviso">No se pudo comprobar la sesión: no hay conexión con el servidor.</Aviso>
        <p style={{ fontSize: 13, color: TINTA_2 }}>Revisa tu conexión y vuelve a intentarlo.</p>
        <div>
          <Boton onClick={onReintentar} testid="reintentar-sesion">
            Reintentar
          </Boton>
        </div>
      </div>
    </div>
  );
}
