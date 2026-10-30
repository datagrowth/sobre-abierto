// Pantalla de inicio de sesión de la web, con la marca de la instalación.
import { useState } from 'react';
import { LIENZO, BORDE, TINTA, TINTA_2, ACCION, IMPIDE, RIESGO, RADIUS, RADIUS_PANEL, alpha } from '../../lib/tema';
import Logotipo from '../comun/Logotipo';
import { configInstalacion } from '../../lib/configInstalacion';

export default function PantallaAcceso({ onLogin, aviso = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) return onLogin();
      const data = await res.json().catch(() => ({}));
      setError(
        data.error ||
          'No se pudo iniciar sesión. Revisa el correo y la contraseña, o pide a un administrador que la restablezca.',
      );
    } catch {
      setError(
        'No se pudo conectar con el servidor. Comprueba tu red; si sigue igual, avisa a quien administre la instalación.',
      );
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || !username || !password;

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: LIENZO, padding: 16 }}>
      <form
        onSubmit={submit}
        className="flex flex-col"
        style={{
          width: 380,
          maxWidth: '100%',
          padding: '32px 28px 28px',
          gap: 16,
          background: LIENZO,
          border: `1px solid ${BORDE}`,
          borderRadius: RADIUS_PANEL,
        }}
      >
        <Logotipo />
        <div style={{ marginTop: 8 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: TINTA, letterSpacing: '-0.01em' }}>
            {configInstalacion().nombre}
          </h1>
          <p style={{ fontSize: 13, color: TINTA_2, marginTop: 2 }}>Inicia sesión para continuar</p>
        </div>

        <Field label="Email" value={username} onChange={setUsername} autoComplete="username" autoFocus />
        <Field
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        {aviso && !error && (
          <div
            role="status"
            data-testid="aviso-sesion-caducada"
            style={{
              fontSize: 13,
              color: RIESGO,
              padding: '8px 10px',
              borderRadius: RADIUS,
              background: alpha(RIESGO, 0.12),
            }}
          >
            {aviso}
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 13,
              color: IMPIDE,
              padding: '8px 10px',
              borderRadius: RADIUS,
              background: alpha(IMPIDE, 0.12),
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={disabled}
          style={{
            height: 40,
            marginTop: 4,
            fontSize: 14,
            fontWeight: 600,
            borderRadius: RADIUS,
            color: TINTA,
            background: ACCION,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'opacity 0.12s ease',
          }}
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, type = 'text', value, onChange, ...rest }) {
  return (
    <label className="flex flex-col" style={{ gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: TINTA_2 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
        style={{ height: 40, fontSize: 14 }}
        {...rest}
      />
    </label>
  );
}
