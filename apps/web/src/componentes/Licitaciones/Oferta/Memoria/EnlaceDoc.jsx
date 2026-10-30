// El enlace a un documento de la memoria: el Word se descarga, el PDF y el texto se abren.
import { FileText } from 'lucide-react';
import { TINTA, BORDE_CONTROL, RADIUS } from '../../../../lib/tema';
import { enlaceDocumento } from '../../../../lib/propuestasFormato';

const NOMBRE_DOC = { '.docx': 'Descargar Word', '.pdf': 'PDF', '.md': 'Texto' };

// El Word se descarga (se edita fuera y vuelve con «Subir mi Word»); el PDF y el texto se abren.
export default function EnlaceDoc({ ruta }) {
  const ext = (ruta.match(/\.[a-z]+$/i)?.[0] ?? '').toLowerCase();
  const word = ext === '.docx';
  return (
    <a
      href={enlaceDocumento(ruta)}
      {...(word ? { download: '' } : { target: '_blank', rel: 'noreferrer' })}
      data-testid={word ? 'memoria-descargar-word' : undefined}
      title={ruta}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        minHeight: 32,
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: RADIUS,
        border: `1px solid ${BORDE_CONTROL}`,
        color: TINTA,
        textDecoration: 'none',
      }}
    >
      <FileText size={14} aria-hidden="true" />
      {NOMBRE_DOC[ext] ?? 'Abrir'}
    </a>
  );
}
