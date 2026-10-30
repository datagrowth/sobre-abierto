// La carpeta única por licitación en Ajustes › Drive: el ensayo en seco (qué se movería a
// Licitaciones/Ofertas/<expediente> · <título> (<id>)/ y desde dónde, sin tocar nada) y, tras
// revisarlo, la migración: copia de las bases, carpetas movidas en Drive y rutas reescritas. Se
// lanza a mano y se puede repetir (lo ya migrado no se toca).
import { useCallback, useEffect, useState } from 'react';
import { FolderTree } from 'lucide-react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { avisoMigracion, dentroDeDestino, resumenEnsayo, tamano } from '../../lib/carpetaUnicaFormato';
import { Aviso, Boton, Dialogo, Tarjeta } from '../ui';

const CADA_MS = 3000;

function Licitacion({ l }) {
  const archivos = l.pasos.reduce((n, p) => n + p.archivos, 0);
  return (
    <details className="border-t border-borde py-2" data-testid={`ensayo-${l.id}`}>
      <summary className="cursor-pointer text-cuerpo text-tinta">
        <span className="font-mono text-leyenda">{l.expediente}</span> · {archivos} archivos · {l.filas} filas
        {l.avisos.length ? ` · ${l.avisos.length} avisos` : ''}
      </summary>
      <p className="m-0 mt-1.5 text-leyenda text-tinta-2">
        Destino: <span className="font-mono">{l.destino}</span>
      </p>
      <ul className="m-0 mt-1.5 pl-5 text-leyenda text-tinta-2">
        {l.pasos.map((p) => (
          <li key={p.de}>
            <span className="font-mono">{p.de}</span> →{' '}
            <span className="font-mono">{dentroDeDestino(`Conocimiento/${l.destino}`, p.a)}</span> ({p.archivos},{' '}
            {tamano(p.bytes)})
          </li>
        ))}
      </ul>
      {l.avisos.map((a) => (
        <div key={a} className="mt-1.5">
          <Aviso tono="aviso">{a}</Aviso>
        </div>
      ))}
    </details>
  );
}

// El estado de la migración; mientras corre, se vuelve a pedir cada pocos segundos.
function useMigracion() {
  const [m, setM] = useState(null);
  const cargar = useCallback(() => licitacionesApi.migracionCarpetaUnica().then(setM, () => setM(null)), []);
  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => {
    if (m?.estado !== 'en_curso') return undefined;
    const t = setTimeout(cargar, CADA_MS);
    return () => clearTimeout(t);
  }, [m, cargar]);
  return { m, setM };
}

function Migrar({ ensayo, onHecho }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState({ ocupado: false, error: null });
  const lanzar = async () => {
    setEstado({ ocupado: true, error: null });
    try {
      onHecho(await licitacionesApi.migrarCarpetaUnica());
      setAbierto(false);
      setEstado({ ocupado: false, error: null });
    } catch (e) {
      setEstado({ ocupado: false, error: e.message });
    }
  };
  return (
    <>
      <div>
        <Boton variante="peligro" onClick={() => setAbierto(true)} testid="carpeta-unica-migrar">
          Migrar a la carpeta única…
        </Boton>
      </div>
      <Dialogo abierto={abierto} titulo="Migrar a la carpeta única" onCerrar={() => setAbierto(false)} ancho={560}>
        <div className="grid gap-3 text-cuerpo text-tinta">
          <p className="m-0">
            Se moverán en Drive {resumenEnsayo(ensayo.totales)}. Antes se guarda una copia de las bases de datos; nada
            se pisa y lo que falle se queda donde estaba.
          </p>
          <Aviso tono="aviso">
            Hazlo lejos de un plazo y sin trabajos de Hermes en marcha (si los hay, no arranca).
          </Aviso>
          {estado.error && <Aviso tono="error">{estado.error}</Aviso>}
          <div className="flex gap-2 justify-end">
            <Boton onClick={() => setAbierto(false)}>Cancelar</Boton>
            <Boton variante="peligro" cargando={estado.ocupado} onClick={lanzar} testid="carpeta-unica-confirmar">
              Migrar ahora
            </Boton>
          </div>
        </div>
      </Dialogo>
    </>
  );
}

export default function CarpetaUnicaVista() {
  const [estado, setEstado] = useState({ kind: 'inicial' });
  const { m, setM } = useMigracion();
  const ensayar = () => {
    setEstado({ kind: 'cargando' });
    licitacionesApi.ensayoCarpetaUnica().then(
      (data) => setEstado({ kind: 'listo', data }),
      (e) => setEstado({ kind: 'error', message: e.message }),
    );
  };
  const e = estado.kind === 'listo' ? estado.data : null;
  const aviso = avisoMigracion(m);
  return (
    <Tarjeta
      titulo="Carpeta única por licitación"
      testid="carpeta-unica"
      subtitulo="Cada licitación del Pipeline en una sola carpeta de Conocimiento: Pliegos, Oferta, Sobres, Presentada y Resolución. Primero, el ensayo: dice qué se movería sin tocar nada."
    >
      <div className="grid gap-3">
        {m && (
          <div data-testid="carpeta-unica-estado">
            <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
          </div>
        )}
        {m?.errores?.map((x) => (
          <Aviso key={x.licitacion} tono="aviso">
            {x.licitacion}: {x.motivo}
          </Aviso>
        ))}
        <div>
          <Boton
            Icono={FolderTree}
            cargando={estado.kind === 'cargando'}
            onClick={ensayar}
            testid="carpeta-unica-ensayar"
          >
            Hacer el ensayo
          </Boton>
        </div>
        {estado.kind === 'error' && <Aviso tono="error">{estado.message}</Aviso>}
        {e?.sin_disco && <Aviso tono="aviso">{e.sin_disco}</Aviso>}
        {e && (
          <p className="m-0 text-cuerpo text-tinta" data-testid="carpeta-unica-resumen">
            {resumenEnsayo(e.totales)}
          </p>
        )}
        {e && e.licitaciones.length > 0 && (
          <div>
            {e.licitaciones.map((l) => (
              <Licitacion key={l.id} l={l} />
            ))}
          </div>
        )}
        {e && e.sin_licitacion.length > 0 && (
          <Aviso tono="aviso">
            Se quedarían donde están, porque no son de ninguna licitación: {e.sin_licitacion.join(', ')}.
          </Aviso>
        )}
        {e && e.licitaciones.length > 0 && m?.estado !== 'en_curso' && (
          <Migrar
            ensayo={e}
            onHecho={(nuevo) => {
              setM(nuevo);
              setEstado({ kind: 'inicial' });
            }}
          />
        )}
      </div>
    </Tarjeta>
  );
}
