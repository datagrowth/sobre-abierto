// Ajustes › Avisos. El resumen semanal (lo elige un admin), los avisos por email de
// quien entra (cada uno los suyos) y sus búsquedas guardadas: cada cuánto avisan, cuántas nuevas traen esta semana, pausarlas, borrarlas y
// abrirlas en Oportunidades.
import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import useRuta from '../../hooks/useRuta';
import { dejarPersistente } from '../../hooks/usePersistente';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { misAvisosApi } from '../../lib/accesoApi';
import useUsuario from '../../hooks/useUsuario';
import ResumenSemanal from './ResumenSemanal';
import { deConsulta, FRECUENCIAS, textoBusqueda } from '../../lib/busquedasFormato';
import { Aviso, Boton, Esqueleto, Selector, Tarjeta, Vacio } from '../ui';

function useBusquedas() {
  const [busquedas, setBusquedas] = useState(null);
  const [aviso, setAviso] = useState(null);
  const cargar = useCallback(
    () =>
      licitacionesApi.busquedas(7).then(
        (r) => setBusquedas(r.busquedas),
        (e) => setAviso({ tono: 'error', texto: e.message }),
      ),
    [],
  );
  useEffect(() => {
    cargar();
  }, [cargar]);
  const hacer = (promesa) =>
    promesa.then(
      () => {
        setAviso(null);
        cargar();
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  return { busquedas, aviso, hacer };
}

function Busqueda({ b, hacer, onAbrir }) {
  return (
    <li
      className="flex flex-wrap items-center gap-3 py-2.5 border-t border-borde first:border-t-0"
      data-testid={`busqueda-${b.id}`}
    >
      <span className="grid min-w-0 flex-1">
        <b className="text-cuerpo text-tinta">{b.nombre}</b>
        <span className="text-leyenda text-tinta-2">{textoBusqueda(b)}</span>
      </span>
      <Selector
        aria-label={`Cada cuánto avisa «${b.nombre}»`}
        className="w-auto py-1"
        opciones={FRECUENCIAS.map((f) => ({ valor: f.key, texto: f.label }))}
        value={b.frecuencia}
        onChange={(e) => hacer(licitacionesApi.cambiarBusqueda(b.id, { frecuencia: e.target.value }))}
      />
      <Boton tamano="pequeno" onClick={() => onAbrir(b)}>
        Ver en Oportunidades
      </Boton>
      <Boton
        tamano="pequeno"
        variante="texto"
        onClick={() => hacer(licitacionesApi.cambiarBusqueda(b.id, { activa: !b.activa }))}
      >
        {b.activa ? 'Pausar' : 'Reanudar'}
      </Boton>
      <Boton tamano="pequeno" variante="texto" onClick={() => hacer(licitacionesApi.borrarBusqueda(b.id))}>
        Borrar
      </Boton>
    </li>
  );
}

function BusquedasGuardadas() {
  const { busquedas, aviso, hacer } = useBusquedas();
  const { ir } = useRuta();
  // La lista de Oportunidades lee al montarse lo buscado y sus filtros de la sesión.
  const abrir = (b) => {
    const c = deConsulta(b.consulta);
    dejarPersistente('oportunidades.texto', c.texto);
    dejarPersistente('oportunidades.buscar-en-pliegos', c.pliegos);
    dejarPersistente('oportunidades.filtros.v2', c.filtros);
    ir('oportunidades');
  };
  return (
    <Tarjeta
      titulo="Búsquedas guardadas"
      subtitulo="Solo tuyas. Te avisan de las nuevas que entran en Por revisar y las cumplen."
      testid="busquedas-guardadas"
    >
      {aviso && (
        <div className="mb-3">
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      {!busquedas && !aviso && <Esqueleto lineas={2} />}
      {busquedas?.length === 0 && (
        <Vacio
          Icono={Search}
          titulo="Aún no has guardado ninguna"
          texto="En Oportunidades, busca o ajusta los filtros y pulsa «Guardar búsqueda»."
        />
      )}
      {busquedas?.length > 0 && (
        <ul className="list-none m-0 p-0">
          {busquedas.map((b) => (
            <Busqueda key={b.id} b={b} hacer={hacer} onAbrir={abrir} />
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

const AVISOS = [
  { key: 'urgentes', label: 'Plazo a 48 h con algo que impide presentar o el precio sin decidir' },
  { key: 'resoluciones', label: 'Se resuelve una oferta que presentamos' },
  { key: 'busquedas', label: 'Nuevas de mis búsquedas guardadas' },
  { key: 'caducidades', label: 'Un documento de la carpeta Empresa va a caducar' },
  { key: 'menciones', label: 'Me mencionan en un comentario (llega con los comentarios)' },
];

function TusAvisos() {
  const [prefs, setPrefs] = useState(null);
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    misAvisosApi.leer().then(setPrefs, (e) => setAviso(e.message));
  }, []);
  const cambiar = (k, v) =>
    misAvisosApi.guardar({ [k]: v }).then(
      (p) => {
        setPrefs(p);
        setAviso(null);
      },
      (e) => setAviso(e.message),
    );
  return (
    <Tarjeta titulo="Tus avisos" subtitulo="Solo para ti, por email." testid="mis-avisos">
      {aviso && (
        <div className="mb-3">
          <Aviso tono="error">{aviso}</Aviso>
        </div>
      )}
      {!prefs && !aviso && <Esqueleto lineas={3} />}
      {prefs && (
        <div className="grid gap-1.5">
          {AVISOS.map((a) => (
            <label key={a.key} className="inline-flex items-center gap-2 text-tabla text-tinta cursor-pointer">
              <input
                type="checkbox"
                className="accent-tinta"
                checked={prefs[a.key]}
                onChange={(e) => cambiar(a.key, e.target.checked)}
                data-testid={`aviso-${a.key}`}
              />
              {a.label}
            </label>
          ))}
        </div>
      )}
      <p className="m-0 mt-3 text-leyenda text-tinta-2">Ningún aviso lleva precios, costes ni datos de CV.</p>
    </Tarjeta>
  );
}

export default function AvisosVista() {
  const yo = useUsuario();
  return (
    <div className="grid gap-4" style={{ maxWidth: 1040 }} data-testid="ajustes-avisos">
      <ResumenSemanal />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {yo && !yo.emergencia ? (
          <TusAvisos />
        ) : (
          <Aviso>Los avisos son de cada persona: entra con tu email para elegir los tuyos.</Aviso>
        )}
        <BusquedasGuardadas />
      </div>
    </div>
  );
}
