// Botón que abre en Drive la carpeta de los pliegos, de la oferta o la principal (la de la oferta
// o, si aún no existe, la de los pliegos) de una licitación. El servidor busca la carpeta al
// pulsar (son varias llamadas a Drive): la pestaña se abre antes de esperar, porque el navegador
// bloquea las que se abren después de una petición. `icono`: el botón cuadrado de la tarjeta
// del Pipeline.
import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { Boton } from '../ui';
import { TINTA, RIESGO } from '../../lib/tema';
import { clases } from '../../lib/uiFormato';

const NOMBRE = { pliegos: 'Pliegos en Drive', oferta: 'Oferta en Drive', principal: 'Carpeta en Drive' };
const AYUDA = {
  pliegos: 'Abre en Drive la carpeta con los pliegos descargados',
  oferta: 'Abre en Drive la carpeta de Salidas con la memoria y los anexos de la oferta',
  principal:
    'Abre en Drive la carpeta de la licitación (con carpeta única, todo: pliegos, oferta, sobres y lo presentado)',
};

// compacto: para la cabecera de la ficha, que no debe crecer. Dice «Drive» para no confundirse
// con la pestaña «Pliegos» de debajo (en móvil no hay title al pasar el ratón).
const CORTO = { pliegos: 'Drive: pliegos', oferta: 'Drive: oferta', principal: 'Carpeta en Drive' };

export default function AbrirEnDrive({ id, carpeta, compacto = false, icono = false, etiqueta, testid }) {
  const [estado, setEstado] = useState({ cargando: false, error: null, url: null });

  const abrir = async () => {
    const pestana = window.open('', '_blank');
    setEstado({ cargando: true, error: null, url: null });
    try {
      const { url } = await licitacionesApi.carpetaDrive(id, carpeta);
      if (pestana) {
        pestana.opener = null;
        pestana.location.href = url;
      }
      // Con las ventanas emergentes bloqueadas queda el enlace para abrirlo a mano.
      setEstado({ cargando: false, error: null, url: pestana ? null : url });
    } catch (e) {
      pestana?.close();
      setEstado({ cargando: false, error: e?.message || 'No se pudo abrir la carpeta en Drive.', url: null });
    }
  };

  if (icono) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          data-testid={testid}
          onClick={abrir}
          aria-label={etiqueta ?? AYUDA[carpeta]}
          title={estado.error ?? AYUDA[carpeta]}
          aria-busy={estado.cargando || undefined}
          className={clases(
            'grid place-items-center w-7 h-7 shrink-0 rounded-control border bg-lienzo text-tinta cursor-pointer hover:bg-superficie-2',
            estado.error ? 'border-riesgo' : 'border-borde hover:border-borde-control',
          )}
        >
          <FolderOpen
            size={15}
            strokeWidth={1.5}
            aria-hidden="true"
            className={estado.cargando ? 'animate-pulse' : undefined}
          />
        </button>
        {estado.url && (
          <a href={estado.url} target="_blank" rel="noreferrer" className="text-leyenda text-tinta underline">
            Abrir
          </a>
        )}
        {estado.error && (
          <span role="status" className="sr-only">
            {estado.error}
          </span>
        )}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Boton Icono={FolderOpen} testid={testid} onClick={abrir} cargando={estado.cargando} title={AYUDA[carpeta]}>
        {compacto ? CORTO[carpeta] : NOMBRE[carpeta]}
      </Boton>
      {estado.url && (
        <a href={estado.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: TINTA }}>
          Abrir la carpeta
        </a>
      )}
      {estado.error && (
        <span role="status" style={{ fontSize: 12, color: RIESGO }}>
          {estado.error}
        </span>
      )}
    </span>
  );
}
