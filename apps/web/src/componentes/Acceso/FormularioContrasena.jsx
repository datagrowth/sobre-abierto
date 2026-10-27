// Cambiar la contraseña propia: la actual (o la temporal del alta) y la nueva dos veces. Las demás
// sesiones de esa persona se cierran; la de este navegador sigue.
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { cambiarContrasena } from '../../lib/accesoApi';
import { fijarUsuario, MIN_CONTRASENA, problemaContrasena } from '../../lib/usuarioActual';
import { Aviso, Boton, Campo, Entrada } from '../ui';

export default function FormularioContrasena({ temporal = false, onHecho }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    const problema = problemaContrasena(nueva, repetida);
    if (problema) return setError(problema);
    setGuardando(true);
    setError('');
    try {
      const r = await cambiarContrasena(actual, nueva);
      fijarUsuario(r.usuario);
      setActual('');
      setNueva('');
      setRepetida('');
      setHecho(true);
      onHecho?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={enviar} data-testid="formulario-contrasena">
      <Campo etiqueta={temporal ? 'Contraseña temporal' : 'Contraseña actual'}>
        <Entrada
          type="password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Campo>
      <Campo etiqueta="Contraseña nueva" ayuda={`Al menos ${MIN_CONTRASENA} caracteres. Una frase que recuerdes vale.`}>
        <Entrada
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoComplete="new-password"
          required
        />
      </Campo>
      <Campo etiqueta="Repite la nueva">
        <Entrada
          type="password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          autoComplete="new-password"
          required
        />
      </Campo>
      {error && (
        <div className="mb-3">
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
      {hecho && !temporal && (
        <div className="mb-3">
          <Aviso tono="ok">Contraseña cambiada. Tus otras sesiones se han cerrado.</Aviso>
        </div>
      )}
      <Boton
        submit
        variante="principal"
        Icono={KeyRound}
        cargando={guardando}
        disabled={!actual || !nueva || !repetida}
        testid="contrasena-guardar"
      >
        Cambiar la contraseña
      </Boton>
    </form>
  );
}
