// Acciones de cabecera de un dominio (Sincronizar, Cribar ahora): cada botón muestra que
// está en marcha y el resultado sale como mensaje que se borra solo, en rojo si falla.
import { IMPIDE, TINTA_2, TIPO } from '../../lib/tema';
import { Boton } from '../ui';

export function MensajeAccion({ mensaje }) {
  if (!mensaje) return null;
  return (
    <span
      role={mensaje.tono === 'error' ? 'alert' : 'status'}
      style={{ fontSize: TIPO.texto, color: mensaje.tono === 'error' ? IMPIDE : TINTA_2 }}
    >
      {mensaje.texto}
    </span>
  );
}

export function BotonAccion({ clave, acciones, Icono, children, title, onClick }) {
  return (
    <Boton
      Icono={Icono}
      title={title}
      cargando={acciones.enMarcha === clave}
      disabled={acciones.enMarcha !== null && acciones.enMarcha !== clave}
      onClick={onClick}
    >
      {children}
    </Boton>
  );
}
