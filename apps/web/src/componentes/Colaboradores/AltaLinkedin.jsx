// «Desde LinkedIn»: LinkedIn no deja leer perfiles desde fuera, pero cualquiera puede
// exportar uno a PDF. Ese PDF se sube como un CV y Hermes propone el perfil (con su
// dirección de LinkedIn), que se aprueba en «Por aprobar».
import { useState } from 'react';
import { Link } from 'lucide-react';
import { TINTA_2, TINTA } from '../../lib/tema';
import { Boton } from '../ui';
import SubirCv from './SubirCv';

export default function AltaLinkedin({ onAviso }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto)
    return (
      <Boton Icono={Link} onClick={() => setAbierto(true)} title="Crea el perfil base con el PDF de su LinkedIn">
        Desde LinkedIn
      </Boton>
    );
  return (
    <div
      style={{
        flexBasis: '100%',
        fontSize: 12.5,
        color: TINTA_2,
        lineHeight: 1.6,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <ol style={{ margin: 0, paddingLeft: 18, color: TINTA }}>
        <li>
          Abre su perfil en LinkedIn y pulsa <b>Más → Guardar en PDF</b>.
        </li>
        <li>
          Sube aquí ese PDF: Hermes lo lee y propone el perfil (experiencia, formación, certificaciones, idiomas y su
          LinkedIn).
        </li>
        <li>
          Revísalo y apruébalo en <b>Por aprobar</b>.
        </li>
      </ol>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <SubirCv
          onAviso={(a) => {
            onAviso(a);
            if (a.tono !== 'error') setAbierto(false);
          }}
          title="Sube el PDF exportado de LinkedIn"
        >
          Subir el PDF de LinkedIn
        </SubirCv>
        <Boton onClick={() => setAbierto(false)}>Cancelar</Boton>
      </div>
    </div>
  );
}
