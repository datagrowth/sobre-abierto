// El avatar de una persona: sus iniciales en un círculo. Lleva el nombre como texto accesible
// (title y aria-label) salvo que vaya junto al nombre escrito (decorativo).
import { iniciales } from '../../lib/usuarioActual';
import { clases } from '../../lib/uiFormato';

const TAMANO = { pequeno: 22, normal: 26 };

export default function Iniciales({ nombre, tamano = 'normal', decorativo = false, testid, className }) {
  const px = TAMANO[tamano] ?? TAMANO.normal;
  return (
    <span
      data-testid={testid}
      title={decorativo ? undefined : nombre}
      aria-label={decorativo ? undefined : nombre}
      aria-hidden={decorativo || undefined}
      role={decorativo ? undefined : 'img'}
      className={clases(
        'inline-flex items-center justify-center shrink-0 rounded-full bg-accion-suave text-tinta text-leyenda font-bold',
        className,
      )}
      style={{ width: px, height: px }}
    >
      {iniciales(nombre)}
    </span>
  );
}
