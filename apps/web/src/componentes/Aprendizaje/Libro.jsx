// Aprendizaje › Libro: las lecciones aceptadas (y las retiradas, al final), filtrables por
// tema, origen, fuerza y texto, cada una con dónde se aplicó y qué dijo el crítico. Una aceptada se
// retira con su motivo.
import { useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { filtrarLibro, ORIGENES, TEMAS, textoUso } from '../../lib/aprendizajeFormato';
import useAccionAviso from '../../hooks/useAccionAviso';
import { Aviso, Boton, Campo, Entrada, Selector, Vacio } from '../ui';
import { TarjetaLeccion } from './PorRevisar';

const conTodos = (texto, mapa) => [
  { valor: '', texto },
  ...Object.entries(mapa).map(([valor, t]) => ({ valor, texto: t })),
];
const FUERZAS = [
  { valor: '', texto: 'Cualquier fuerza' },
  { valor: '2', texto: 'De 2 ofertas o más' },
  { valor: '3', texto: 'De 3 ofertas o más' },
];

function Retirar({ l, onCambio }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (l.estado !== 'aceptada')
    return l.retirada_motivo ? (
      <p className="text-leyenda text-tinta-2 mt-2 mb-0">Retirada: {l.retirada_motivo}</p>
    ) : null;
  return (
    <div className="mt-2">
      {!abierto && (
        <Boton variante="texto" tamano="pequeno" onClick={() => setAbierto(true)} testid={`retirar-${l.id}`}>
          Retirar
        </Boton>
      )}
      {abierto && (
        <div className="flex gap-2 items-start flex-wrap">
          <Entrada
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por qué deja de valer"
            aria-label="Por qué se retira"
            maxLength={500}
            className="flex-1 basis-56"
          />
          <Boton
            escribe
            cargando={ocupado}
            disabled={motivo.trim().length < 5}
            onClick={() =>
              hacer(() => licitacionesApi.retirarLeccion(l.id, motivo.trim()), 'Lección retirada: ya no se aplica.')
            }
          >
            Retirar
          </Boton>
          <Boton variante="texto" onClick={() => setAbierto(false)}>
            Cancelar
          </Boton>
        </div>
      )}
      {aviso && (
        <div className="mt-2">
          <Aviso tono={aviso.tono === 'error' ? 'error' : 'ok'}>{aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}

export default function Libro({ libro, onCambio }) {
  const [f, setF] = useState({ tema: '', origen: '', fuerza: '', texto: '' });
  const poner = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const vistas = filtrarLibro(libro, { ...f, fuerza: Number(f.fuerza) || 0 });
  if (!libro.length)
    return (
      <Vacio
        titulo="El libro está vacío"
        texto="Las lecciones que aceptes en Por revisar se guardan aquí y Hermes las aplica al redactar."
        testid="libro-vacio"
      />
    );
  return (
    <div data-testid="aprendizaje-libro" className="grid gap-3">
      <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo etiqueta="Tema">
          <Selector value={f.tema} onChange={poner('tema')} opciones={conTodos('Todos los temas', TEMAS)} />
        </Campo>
        <Campo etiqueta="Origen">
          <Selector value={f.origen} onChange={poner('origen')} opciones={conTodos('Todos los orígenes', ORIGENES)} />
        </Campo>
        <Campo etiqueta="Fuerza">
          <Selector value={f.fuerza} onChange={poner('fuerza')} opciones={FUERZAS} />
        </Campo>
        <Campo etiqueta="Buscar">
          <Entrada value={f.texto} onChange={poner('texto')} placeholder="Órgano o palabra" />
        </Campo>
      </div>
      <p className="text-leyenda text-tinta-2 m-0 tabular-nums">
        {vistas.length} de {libro.length} lecciones
      </p>
      <div className="grid gap-3 lg:grid-cols-2 items-start">
        {vistas.map((l) => (
          <TarjetaLeccion key={l.id} l={l} onCambio={onCambio}>
            <p className="text-leyenda text-tinta-2 mt-2 mb-0" data-testid={`uso-${l.id}`}>
              {textoUso(l.uso)}
            </p>
            <Retirar l={l} onCambio={onCambio} />
          </TarjetaLeccion>
        ))}
      </div>
    </div>
  );
}
