// Organismos: qué órganos licitan en nuestro sector, cuánto, con qué baja y cuáles nos
// interesan (puntuación orientativa), o los que seguimos a mano; la ficha de cada uno al lado.
import { useEffect, useRef, useState } from 'react';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { TINTA_2 } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { porcentaje } from '../../lib/preciosFormato';
import { plural } from '../../lib/formato';
import {
  eurosCortos,
  nivelInteres,
  ORDEN_ORGANISMOS,
  origenBanda,
  textoBanda,
  unirPagina,
} from '../../lib/competenciaFormato';
import { Aviso, Boton, Chip } from '../ui';
import { Pildora } from '../comun/ui';
import { FilaLista, ListaYFicha, Periodo, ResultadosLista } from '../comun/listas';
import DescargarCsv from '../comun/DescargarCsv';
import FichaOrganismo from './FichaOrganismo';

const TONO_INTERES = { alto: 'ok', medio: 'riesgo', bajo: 'neutro' };

function textoInteres(i) {
  return `Volumen ${Math.round(i.volumen * 100)} % · recurrencia ${Math.round(i.recurrencia * 100)} % · baja moderada ${Math.round(i.baja * 100)} % (pesos 45/35/20)`;
}

function Item({ o, activa, onClick }) {
  // Las filas del ranking traen lo licitado; las de seguidos, lo adjudicado.
  const deRanking = 'licitaciones' in o;
  return (
    <FilaLista
      activa={activa}
      onClick={onClick}
      titulo={o.nombre ?? o.nif}
      subtitulo={`NIF ${o.nif}${o.notas ? ` · ${o.notas}` : ''}`}
    >
      {o.interes && (
        <Chip tono={TONO_INTERES[nivelInteres(o.interes.puntos)]} punto={false} title={textoInteres(o.interes)}>
          interés {o.interes.puntos}
        </Chip>
      )}
      {deRanking && (
        <Chip>
          {o.licitaciones} licitaciones · {eurosCortos(o.importe_licitado)}
        </Chip>
      )}
      {!deRanking && (
        <Chip>
          {plural(o.contratos, 'adjudicación', 'adjudicaciones')} · {eurosCortos(o.importe)}
        </Chip>
      )}
      {typeof o.baja_media === 'number' && (
        <Chip title="Baja media de sus adjudicaciones">baja {porcentaje(o.baja_media)}</Chip>
      )}
      {o.oportunidades > 0 && (
        <Chip tono="ok" punto={false}>
          {o.oportunidades} que seguimos
        </Chip>
      )}
      {o.seguido && (
        <Chip tono="ok" punto={false}>
          seguido
        </Chip>
      )}
    </FilaLista>
  );
}

// Respuestas que llegan tarde (otros filtros) se ignoran. recarga: tras seguir o dejar de seguir.
// «Ver más» pide la página siguiente (el «siguiente» del servidor) y la añade a la que se ve.
function useLista(filtros, version, recarga) {
  const [resultado, setResultado] = useState({ kind: 'loading' });
  const [mas, setMas] = useState({ cargando: false, error: null });
  const vigente = useRef(0);
  useEffect(() => {
    const peticion = vigente.current + 1;
    vigente.current = peticion;
    const pedida =
      filtros.modo === 'seguidos'
        ? licitacionesApi
            .seguidos('organismo')
            .then((items) => ({ items, total: items.length, ambito: null, siguiente: null }))
        : licitacionesApi.organismos(filtros);
    pedida.then(
      (r) => vigente.current === peticion && setResultado({ kind: 'ready', ...r }),
      (e) => vigente.current === peticion && setResultado({ kind: 'error', message: e.message }),
    );
  }, [filtros, version, recarga]);
  const verMas = () => {
    const peticion = vigente.current;
    setMas({ cargando: true, error: null });
    licitacionesApi.organismos({ ...filtros, desde: resultado.siguiente }).then(
      (r) => {
        if (vigente.current !== peticion) return;
        setMas({ cargando: false, error: null });
        setResultado((prev) => unirPagina(prev, r));
      },
      (e) => vigente.current === peticion && setMas({ cargando: false, error: e.message }),
    );
  };
  return { resultado, verMas, mas };
}

function VerMas({ lista }) {
  if (lista.resultado.kind !== 'ready' || typeof lista.resultado.siguiente !== 'number') return null;
  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {lista.mas.error && <Aviso tono="error">No se pudo cargar la página siguiente: {lista.mas.error}</Aviso>}
      <Boton testid="ver-mas" onClick={lista.verMas} cargando={lista.mas.cargando}>
        Ver más
      </Boton>
    </div>
  );
}

// Por defecto, a nuestra escala; «Toda España» y «Todos los importes» quitan cada filtro.
function Escala({ filtros, poner }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Pildora
        testid="filtro-toda-espana"
        label="Toda España"
        activa={filtros.todaEspana}
        onClick={() => poner({ todaEspana: !filtros.todaEspana })}
      />
      <Pildora
        testid="filtro-todos-importes"
        label="Todos los importes"
        activa={filtros.todosImportes}
        onClick={() => poner({ todosImportes: !filtros.todosImportes })}
      />
    </div>
  );
}

function AmbitoEscala({ resultado }) {
  if (resultado.kind !== 'ready' || !resultado.ambito) return null;
  return (
    <Chip testid="ambito-escala" title={origenBanda(resultado.ambito.banda)}>
      {textoBanda(resultado.ambito)}
    </Chip>
  );
}

function Filtros({ filtros, onCambio, texto, onTexto }) {
  const poner = (cambio) => onCambio({ ...filtros, ...cambio });
  const ranking = filtros.modo === 'ranking';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pildora label="Licitan en tu sector" activa={ranking} onClick={() => poner({ modo: 'ranking' })} />
        <Pildora label="Seguidos" activa={!ranking} onClick={() => poner({ modo: 'seguidos' })} />
      </div>
      {ranking && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Periodo meses={filtros.meses} onCambio={(meses) => poner({ meses })} />
          </div>
          <Escala filtros={filtros} poner={poner} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ORDEN_ORGANISMOS.map((o) => (
              <Pildora
                key={o.key}
                label={o.label}
                activa={filtros.orden === o.key}
                onClick={() => poner({ orden: o.key })}
              />
            ))}
          </div>
          <input
            className="input-field"
            type="search"
            value={texto}
            onChange={(e) => onTexto(e.target.value)}
            placeholder="Buscar por nombre o NIF"
            aria-label="Buscar organismos"
          />
        </>
      )}
    </div>
  );
}

export default function OrganismosVista({ version, inicial, onVerCompetidor }) {
  const { isSmall } = useAnchoPantalla();
  const [filtros, setFiltros] = useState({
    modo: 'ranking',
    meses: 24,
    orden: 'interes',
    texto: '',
    todaEspana: false,
    todosImportes: false,
  });
  const [texto, setTexto] = useState('');
  const [seleccion, setSeleccion] = useState(inicial ?? null);
  const [recarga, setRecarga] = useState(0);
  const lista = useLista(filtros, version, recarga);
  const { resultado } = lista;
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.texto === texto.trim() ? f : { ...f, texto: texto.trim() })), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const columna = (
    <>
      <Filtros filtros={filtros} onCambio={setFiltros} texto={texto} onTexto={setTexto} />
      {filtros.modo === 'ranking' && (
        <div style={{ marginBottom: 10 }}>
          <DescargarCsv pequeno url={licitacionesApi.csv.organismos(filtros)} testid="organismos-csv" />
        </div>
      )}
      {filtros.modo === 'ranking' && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
            fontSize: 11.5,
            color: TINTA_2,
            marginBottom: 6,
          }}
        >
          <AmbitoEscala resultado={resultado} />
          <span>Interés orientativo: volumen licitado en el sector, meses con licitaciones y baja moderada.</span>
        </div>
      )}
      <ResultadosLista
        resultado={resultado}
        vacio={
          filtros.modo === 'seguidos'
            ? 'Aún no sigues a ningún organismo: ábrelo y pulsa «Seguir».'
            : 'Sin licitaciones del sector en este periodo, banda y territorio. Prueba «Toda España» o «Todos los importes».'
        }
        item={(o) => <Item key={o.nif} o={o} activa={seleccion === o.nif} onClick={() => setSeleccion(o.nif)} />}
      />
      <VerMas lista={lista} />
    </>
  );
  const ficha = seleccion ? (
    <FichaOrganismo
      key={seleccion}
      nif={seleccion}
      version={version}
      onVolver={isSmall ? () => setSeleccion(null) : undefined}
      onCambio={() => setRecarga((n) => n + 1)}
      onVerCompetidor={onVerCompetidor}
    />
  ) : null;
  return <ListaYFicha lista={columna} ficha={ficha} vacio="Elige un organismo para ver su ficha." />;
}
