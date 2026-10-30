// Botón de la interfaz. Un solo «principal» (verde) por vista: la siguiente acción. El
// resto, secundario (contorno), de texto o de peligro. `cargando`: la acción está en marcha; no se
// puede pulsar otra vez y lo dice. `submit`: envía su <form> (por defecto no envía nada).
// `escribe`: guarda algo en el servidor (data-escribe, para que las pruebas lo distingan); con
// permiso de lector sale desactivado y dice por qué (el servidor lo negaría con un 403).
// `envolver`: el texto es largo (una respuesta del asistente) y parte línea en vez de desbordar.
import { Loader2 } from 'lucide-react';
import useUsuario from '../../hooks/useUsuario';
import { clases } from '../../lib/uiFormato';
import { puede, SOLO_VER } from '../../lib/usuarioActual';

const VARIANTES = {
  principal: 'bg-accion border-accion text-tinta font-bold enabled:hover:bg-accion-hover',
  secundario: 'bg-lienzo border-borde-control text-tinta font-medium enabled:hover:bg-superficie-2',
  texto: 'bg-transparent border-transparent text-tinta font-medium underline underline-offset-3 px-1.5',
  peligro: 'bg-lienzo border-impide text-impide font-medium enabled:hover:bg-impide-suave',
};
const TAMANOS = { normal: 'text-tabla px-3.5 py-1.5 min-h-8', pequeno: 'text-tabla px-2.5 py-1 min-h-7' };

export default function Boton({
  children,
  onClick,
  variante = 'secundario',
  tamano = 'normal',
  disabled = false,
  cargando = false,
  title,
  Icono,
  submit = false,
  testid,
  escribe = false,
  etiqueta,
  envolver = false,
}) {
  const usuario = useUsuario();
  const soloVer = escribe && !puede(usuario, 'editor');
  const bloqueado = disabled || cargando || soloVer;
  return (
    <button
      type={submit ? 'submit' : 'button'}
      onClick={onClick}
      disabled={bloqueado}
      title={soloVer ? SOLO_VER : title}
      aria-label={etiqueta}
      aria-busy={cargando || undefined}
      data-testid={testid}
      data-escribe={escribe ? 'true' : undefined}
      data-variante={variante}
      className={clases(
        'inline-flex items-center gap-1.5 border cursor-pointer transition-colors',
        envolver ? 'rounded-control whitespace-normal text-left max-w-full' : 'rounded-full whitespace-nowrap',
        'disabled:cursor-not-allowed',
        (disabled || soloVer) && !cargando && 'opacity-45',
        VARIANTES[variante],
        TAMANOS[tamano],
      )}
    >
      {cargando ? (
        <Loader2 size={14} className="so-girando" aria-hidden="true" />
      ) : (
        Icono && <Icono size={14} strokeWidth={1.5} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
