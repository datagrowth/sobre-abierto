// «Exportar CSV» de un listado: un enlace de descarga con el aspecto de un botón
// secundario. El servidor arma el CSV entero (todas las páginas) con los mismos filtros que la
// vista, para Excel en español.
import { Download } from 'lucide-react';
import { clases } from '../../lib/uiFormato';

export default function DescargarCsv({ url, children = 'Exportar CSV', testid, pequeno = false }) {
  return (
    <a
      href={url}
      download
      data-testid={testid}
      className={clases(
        'inline-flex items-center gap-1.5 rounded-full border border-borde-control bg-lienzo text-tinta font-medium no-underline whitespace-nowrap hover:bg-superficie-2 text-tabla',
        pequeno ? 'px-2.5 py-1 min-h-7' : 'px-3.5 py-1.5 min-h-8',
      )}
    >
      <Download size={14} strokeWidth={1.5} aria-hidden="true" />
      {children}
    </a>
  );
}
