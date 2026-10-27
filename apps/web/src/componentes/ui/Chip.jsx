// Chip de la interfaz: un estado (con su punto: Impide, Riesgo, Cumple…), una categoría
// (neutro, sin punto) o algo de Hermes (lavanda suave). El color va siempre con su palabra.
// `punto`: fuerza o quita el punto; por defecto lo llevan los tonos de estado y no el neutro.
import { clases } from '../../lib/uiFormato';

const TONOS = {
  neutro: 'bg-superficie-2 text-tinta-2',
  ok: 'bg-accion-suave text-ok',
  decidido: 'bg-accion-suave text-tinta',
  impide: 'bg-impide-suave text-impide',
  riesgo: 'bg-riesgo-suave text-riesgo',
  hermes: 'bg-hermes-suave text-tinta',
};

export default function Chip({ children, tono = 'neutro', punto, title, testid, urgencia, className }) {
  const conPunto = punto ?? tono !== 'neutro';
  return (
    <span
      title={title}
      data-testid={testid}
      data-urgencia={urgencia}
      data-tono={tono}
      className={clases(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-leyenda font-medium whitespace-nowrap',
        TONOS[tono] ?? TONOS.neutro,
        className,
      )}
    >
      {conPunto && (
        <span
          aria-hidden="true"
          className={clases('w-1.5 h-1.5 rounded-[2px] shrink-0', tono === 'hermes' ? 'bg-hermes-punto' : 'bg-current')}
        />
      )}
      {children}
    </span>
  );
}
