// Primer acceso con la contraseña temporal que puso un admin: hay que cambiarla antes de entrar.
import { LIENZO, BORDE, TINTA, TINTA_2, RADIUS_PANEL } from '../../lib/tema';
import Logotipo from '../comun/Logotipo';
import FormularioContrasena from './FormularioContrasena';

export default function CambiarContrasena({ onHecho }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: LIENZO, padding: 16 }}>
      <div
        className="flex flex-col"
        style={{
          width: 400,
          maxWidth: '100%',
          padding: '32px 28px 24px',
          gap: 16,
          background: LIENZO,
          border: `1px solid ${BORDE}`,
          borderRadius: RADIUS_PANEL,
        }}
      >
        <Logotipo />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: TINTA, letterSpacing: '-0.01em' }}>Elige tu contraseña</h1>
          <p style={{ fontSize: 13, color: TINTA_2, marginTop: 2 }}>
            Has entrado con una contraseña temporal. Cámbiala por una tuya para seguir.
          </p>
        </div>
        <FormularioContrasena temporal onHecho={onHecho} />
      </div>
    </div>
  );
}
