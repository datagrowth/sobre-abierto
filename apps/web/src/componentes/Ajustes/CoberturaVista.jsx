// La auditoría de cobertura de la PLACSP por comunidad: lo que trajo la agregada y los
// perfiles en las semanas contadas, lo apuntado de cada plataforma autonómica y si hace falta una
// fuente directa (más de un 5 % de falta). Debajo, el formulario para apuntar esa cifra.
import { useCallback, useEffect, useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { COMUNIDADES } from '../../lib/formato';
import { VEREDICTOS, cuerpoAnotacion, semanasDelInforme, textoFalta } from '../../lib/coberturaFormato';
import { Aviso, Boton, Campo, Chip, Entrada, Esqueleto, Selector, Tabla, Tarjeta } from '../ui';

const COLUMNAS = [
  { clave: 'nombre', titulo: 'Comunidad' },
  { clave: 'agregadas', titulo: 'Agregada', alinear: 'derecha' },
  { clave: 'perfiles', titulo: 'Perfiles', alinear: 'derecha' },
  {
    clave: 'autonomica',
    titulo: 'Plataforma autonómica',
    alinear: 'derecha',
    celda: (c) => (c.comparadas ? `${c.autonomica} (${c.comparadas} sem.)` : '—'),
  },
  { clave: 'falta', titulo: 'Falta', alinear: 'derecha', celda: (c) => textoFalta(c.falta) },
  {
    clave: 'veredicto',
    titulo: 'Veredicto',
    celda: (c) => <Chip tono={VEREDICTOS[c.veredicto]?.tono}>{VEREDICTOS[c.veredicto]?.texto ?? c.veredicto}</Chip>,
  },
];

function Anotar({ semanas, onHecho }) {
  const [v, setV] = useState({ semana: semanas[0] ?? '', comunidad: '', publicadas: '', fuente: '' });
  const [estado, setEstado] = useState({ ocupado: false, aviso: null });
  const cambiar = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const enviar = async () => {
    const c = cuerpoAnotacion(v);
    if (c.error) {
      setEstado({ ocupado: false, aviso: { tono: 'error', texto: c.error } });
      return;
    }
    setEstado({ ocupado: true, aviso: null });
    try {
      await licitacionesApi.anotarCobertura(c.data);
      setEstado({ ocupado: false, aviso: { tono: 'ok', texto: 'Apuntada.' } });
      onHecho();
    } catch (e) {
      setEstado({ ocupado: false, aviso: { tono: 'error', texto: e.message } });
    }
  };
  return (
    <div
      className="grid gap-x-3 items-end"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
      data-testid="cobertura-anotar"
    >
      <Campo etiqueta="Semana (lunes)">
        <Selector value={v.semana} onChange={cambiar('semana')}>
          {semanas.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Selector>
      </Campo>
      <Campo etiqueta="Comunidad">
        <Selector value={v.comunidad} onChange={cambiar('comunidad')}>
          <option value="">Elige…</option>
          {COMUNIDADES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Selector>
      </Campo>
      <Campo etiqueta="Publicadas esa semana">
        <Entrada inputMode="numeric" value={v.publicadas} onChange={cambiar('publicadas')} />
      </Campo>
      <Campo etiqueta="De dónde sale">
        <Entrada value={v.fuente} onChange={cambiar('fuente')} placeholder="Portal de datos abiertos" />
      </Campo>
      <div className="mb-3">
        <Boton escribe cargando={estado.ocupado} onClick={enviar} testid="cobertura-guardar">
          Apuntar
        </Boton>
      </div>
      {estado.aviso && (
        <div className="col-span-full">
          <Aviso tono={estado.aviso.tono}>{estado.aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}

export default function CoberturaVista() {
  const [carga, setCarga] = useState({ kind: 'loading' });
  const cargar = useCallback(
    () =>
      licitacionesApi.cobertura().then(
        (data) => setCarga({ kind: 'ready', data }),
        (e) => setCarga({ kind: 'error', message: e.message }),
      ),
    [],
  );
  useEffect(() => {
    cargar();
  }, [cargar]);
  return (
    <Tarjeta
      titulo="Auditoría de cobertura por comunidad"
      testid="cobertura"
      subtitulo="Lo de tu sector que trajo la PLACSP cada semana, frente a lo que publicó cada plataforma autonómica. Con más de un 5 % de falta, conviene añadir esa fuente."
    >
      {carga.kind === 'loading' && <Esqueleto lineas={3} />}
      {carga.kind === 'error' && <Aviso tono="error">{carga.message}</Aviso>}
      {carga.kind === 'ready' && (
        <div className="grid gap-4">
          <p className="m-0 text-leyenda text-tinta-2">
            {carga.data.desde
              ? `Semanas del ${carga.data.desde} al ${carga.data.hasta}.`
              : 'Aún no se ha contado ninguna semana: la primera cuenta llega en la siguiente vuelta del radar.'}
          </p>
          {carga.data.comunidades.length > 0 && (
            <Tabla
              columnas={COLUMNAS}
              filas={carga.data.comunidades}
              claveFila={(c) => c.comunidad}
              etiqueta="Cobertura por comunidad"
            />
          )}
          {semanasDelInforme(carga.data).length > 0 && (
            <Anotar semanas={semanasDelInforme(carga.data)} onHecho={cargar} />
          )}
        </div>
      )}
    </Tarjeta>
  );
}
