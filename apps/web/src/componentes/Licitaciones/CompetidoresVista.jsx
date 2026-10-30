// Competidores: quién gana en nuestro sector («en el punto de mira») o los que seguimos
// a mano, y la ficha de cada uno al lado.
import { useEffect, useRef, useState } from 'react';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { TINTA_2 } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { porcentaje } from '../../lib/preciosFormato';
import {
  eurosCortos,
  ORDEN_COMPETIDORES,
  origenBanda,
  textoBanda,
  textoCoincidencias,
  textoPyme,
  textoNif,
  unirPagina,
} from '../../lib/competenciaFormato';
import { Aviso, Boton, Chip } from '../ui';
import { Pildora } from '../comun/ui';
import { FilaLista, ListaYFicha, Periodo, ResultadosLista } from '../comun/listas';
import FichaCompetidor from './FichaCompetidor';
import DescargarCsv from '../comun/DescargarCsv';
import { plural } from '../../lib/formato';

function Item({ c, activa, onClick }) {
  const coincide = textoCoincidencias(c.coincidencias);
  const pyme = textoPyme(c.pyme);
  return (
    <FilaLista
      activa={activa}
      onClick={onClick}
      titulo={c.nombre ?? c.nif}
      subtitulo={`${textoNif(c.nif)}${c.notas ? ` · ${c.notas}` : ''}`}
    >
      <span className="tabular-nums" style={{ fontSize: 12, color: 'inherit' }}>
        {eurosCortos(c.importe)}
      </span>
      <Chip>{plural(c.contratos, 'contrato')}</Chip>
      {typeof c.baja_media === 'number' && (
        <Chip title="Baja media de sus adjudicaciones">baja {porcentaje(c.baja_media)}</Chip>
      )}
      {pyme && <Chip>{pyme}</Chip>}
      {coincide && (
        <Chip tono="ok" punto={false} title={coincide}>
          coincide {c.coincidencias.total}
        </Chip>
      )}
      {c.seguido && (
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
            .seguidos('competidor')
            .then((items) => ({ items, total: items.length, ambito: null, siguiente: null }))
        : licitacionesApi.competidores(filtros);
    pedida.then(
      (r) => vigente.current === peticion && setResultado({ kind: 'ready', ...r }),
      (e) => vigente.current === peticion && setResultado({ kind: 'error', message: e.message }),
    );
  }, [filtros, version, recarga]);
  const verMas = () => {
    const peticion = vigente.current;
    setMas({ cargando: true, error: null });
    licitacionesApi.competidores({ ...filtros, desde: resultado.siguiente }).then(
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
        <Pildora label="En el punto de mira" activa={ranking} onClick={() => poner({ modo: 'ranking' })} />
        <Pildora label="Seguidos" activa={!ranking} onClick={() => poner({ modo: 'seguidos' })} />
      </div>
      {ranking && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Periodo meses={filtros.meses} onCambio={(meses) => poner({ meses })} />
          </div>
          <Escala filtros={filtros} poner={poner} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ORDEN_COMPETIDORES.map((o) => (
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
            aria-label="Buscar competidores"
          />
        </>
      )}
    </div>
  );
}

function Ambito({ resultado }) {
  if (resultado.kind !== 'ready' || !resultado.ambito) return null;
  const { cpvs, meses } = resultado.ambito;
  const periodo = meses ? `los últimos ${meses} meses` : 'todo el histórico';
  return (
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
      <span>
        Ganadores en {cpvs.length ? `CPV ${cpvs.join(', ')}` : 'todos los CPV'} en {periodo}.
      </span>
    </div>
  );
}

export default function CompetidoresVista({ version, inicial, onVerOrganismo }) {
  const { isSmall } = useAnchoPantalla();
  const [filtros, setFiltros] = useState({
    modo: 'ranking',
    meses: 24,
    orden: 'importe',
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
          <DescargarCsv pequeno url={licitacionesApi.csv.competidores(filtros)} testid="competidores-csv" />
        </div>
      )}
      <Ambito resultado={resultado} />
      <ResultadosLista
        resultado={resultado}
        vacio={
          filtros.modo === 'seguidos'
            ? 'Aún no sigues a ningún competidor: ábrelo y pulsa «Seguir».'
            : 'Sin adjudicaciones en este periodo, sector, banda y territorio. Prueba «Toda España» o «Todos los importes», o carga el histórico en Ajustes › Fuentes y filtros.'
        }
        item={(c) => <Item key={c.nif} c={c} activa={seleccion === c.nif} onClick={() => setSeleccion(c.nif)} />}
      />
      <VerMas lista={lista} />
    </>
  );
  const ficha = seleccion ? (
    <FichaCompetidor
      key={seleccion}
      nif={seleccion}
      version={version}
      onVolver={isSmall ? () => setSeleccion(null) : undefined}
      onCambio={() => setRecarga((n) => n + 1)}
      onVerOrganismo={onVerOrganismo}
      onVerCompetidor={setSeleccion}
    />
  ) : null;
  return <ListaYFicha lista={columna} ficha={ficha} vacio="Elige un competidor para ver su ficha." />;
}
