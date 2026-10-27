// Lo que propone o hace Hermes, marcado en lavanda: una etiqueta («Propuesto por Hermes») o, con
// `children`, la caja que lo envuelve. El lavanda nunca es texto: va de fondo y de punto.
import { Sparkles } from 'lucide-react';

export default function MarcaHermes({ etiqueta = 'Propuesto por Hermes', detalle, testid, children }) {
  const cabeza = (
    <span className="inline-flex items-center gap-1.5 text-leyenda font-bold text-tinta">
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-hermes-punto shadow-[0_0_0_3px] shadow-hermes" />
      {etiqueta}
      {detalle && <span className="font-medium text-tinta-2">· {detalle}</span>}
    </span>
  );
  if (!children) {
    return (
      <span
        data-testid={testid}
        className="inline-flex items-center gap-1.5 rounded-full bg-hermes-suave px-2.5 py-0.5"
      >
        <Sparkles size={12} strokeWidth={1.5} aria-hidden="true" className="text-tinta" />
        {cabeza}
      </span>
    );
  }
  return (
    <section data-testid={testid} className="rounded-tarjeta border border-hermes bg-hermes-suave p-4 grid gap-2">
      {cabeza}
      <div className="text-cuerpo text-tinta">{children}</div>
    </section>
  );
}
