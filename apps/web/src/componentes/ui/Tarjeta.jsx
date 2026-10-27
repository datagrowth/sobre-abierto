// Tarjeta: borde fino y radio de 12 px, sin sombra (la sombra es solo de lo que flota). `hermes`:
// lo propuesto por Hermes (lavanda suave). Con `titulo`, cabecera de bloque y lo de `extra` a la derecha.
import { clases } from '../../lib/uiFormato';

export default function Tarjeta({
  titulo,
  subtitulo,
  extra,
  hermes = false,
  sinRelleno = false,
  as: Etiqueta = 'section',
  testid,
  className,
  children,
}) {
  return (
    <Etiqueta
      data-testid={testid}
      className={clases(
        'rounded-tarjeta border min-w-0',
        hermes ? 'bg-hermes-suave border-hermes' : 'bg-lienzo border-borde',
        !sinRelleno && 'p-4',
        className,
      )}
    >
      {(titulo || extra) && (
        <div className={clases('flex items-start gap-3 flex-wrap', sinRelleno ? 'px-4 pt-4' : '', 'mb-3')}>
          <div className="min-w-0 flex-1">
            {titulo && <h3 className="text-cuerpo font-bold text-tinta m-0">{titulo}</h3>}
            {subtitulo && <p className="text-leyenda text-tinta-2 m-0 mt-0.5">{subtitulo}</p>}
          </div>
          {extra && <div className="flex items-center gap-2 flex-wrap">{extra}</div>}
        </div>
      )}
      {children}
    </Etiqueta>
  );
}
