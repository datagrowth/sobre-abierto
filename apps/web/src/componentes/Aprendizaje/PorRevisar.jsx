// Aprendizaje › Por revisar: las lecciones propuestas, cada una con su evidencia a la vista y
// tres acciones (Aceptar, Ajustar el alcance y Descartar; menos de un minuto por lección), el porqué
// de los cambios más grandes de una presentada y las actas que faltan para aprender de la mesa.
import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import {
  ORIGENES,
  opcionesDeAlcance,
  TEMAS,
  textoActaQueFalta,
  textoAlcanceLeccion,
  textoEvidencia,
} from '../../lib/aprendizajeFormato';
import useAccionAviso from '../../hooks/useAccionAviso';
import { Aviso, Boton, Campo, Chip, Entrada, Selector, Tarjeta, Vacio } from '../ui';

const OPCIONES_TEMA = [
  { valor: '', texto: 'Sin tema (toda la memoria)' },
  ...Object.entries(TEMAS).map(([valor, texto]) => ({ valor, texto })),
];

function AjustarAlcance({ l, onGuardar, onCancelar, ocupado }) {
  const opciones = opcionesDeAlcance(l);
  const [alcance, setAlcance] = useState(opciones.some((o) => o.valor === l.alcance) ? l.alcance : 'general');
  const [tema, setTema] = useState(l.tema ?? '');
  const elegida = opciones.find((o) => o.valor === alcance);
  return (
    <div data-testid={`ajustar-${l.id}`} className="grid gap-1 mt-3 sm:grid-cols-2 sm:gap-3">
      <Campo etiqueta="Alcance">
        <Selector value={alcance} onChange={(e) => setAlcance(e.target.value)} opciones={opciones} />
      </Campo>
      <Campo etiqueta="Tema de apartado">
        <Selector value={tema} onChange={(e) => setTema(e.target.value)} opciones={OPCIONES_TEMA} />
      </Campo>
      <div className="flex gap-2 sm:col-span-2">
        <Boton
          variante="principal"
          escribe
          cargando={ocupado}
          testid={`guardar-alcance-${l.id}`}
          onClick={() => onGuardar({ alcance, alcance_valor: elegida?.alcance_valor ?? null, tema: tema || null })}
        >
          Guardar el alcance
        </Boton>
        <Boton variante="texto" onClick={onCancelar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}

export function TarjetaLeccion({ l, onCambio, children }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const [ajustando, setAjustando] = useState(false);
  const decidir = (decision) =>
    hacer(
      () => licitacionesApi.revisarDelLibro(l.id, decision),
      decision === 'aceptar' ? 'Lección aceptada: Hermes la aplicará en las próximas memorias.' : 'Lección descartada.',
    );
  const guardar = (ajuste) =>
    hacer(async () => {
      await licitacionesApi.ajustarAlcance(l.id, ajuste);
      setAjustando(false);
    }, 'Alcance ajustado.');
  const evidencia = textoEvidencia(l);
  return (
    <Tarjeta hermes={l.estado === 'pendiente'} testid={`leccion-${l.id}`}>
      <div className="flex gap-2 flex-wrap">
        <Chip tono="hermes" punto={false}>
          {ORIGENES[l.origen] ?? l.origen}
        </Chip>
        <Chip>Alcance: {textoAlcanceLeccion(l)}</Chip>
        {l.fuerza > 1 && <Chip>Fuerza {l.fuerza}</Chip>}
        {l.estado === 'retirada' && <Chip tono="riesgo">Retirada</Chip>}
      </div>
      <h4 className="text-cuerpo font-bold text-tinta mt-2 mb-1">{l.texto}</h4>
      {l.titulo_licitacion && <p className="text-leyenda text-tinta-2 m-0">{l.titulo_licitacion}</p>}
      {evidencia && (
        <div
          data-testid={`evidencia-${l.id}`}
          className="mt-2 px-3 py-2 rounded-control bg-lienzo border border-borde text-tabla text-tinta break-words"
        >
          {evidencia}
        </div>
      )}
      {children}
      {l.estado === 'pendiente' && !ajustando && (
        <div className="flex gap-2 flex-wrap mt-3">
          <Boton
            variante="principal"
            escribe
            cargando={ocupado}
            onClick={() => decidir('aceptar')}
            testid={`aceptar-${l.id}`}
          >
            Aceptar
          </Boton>
          <Boton onClick={() => setAjustando(true)} testid={`alcance-${l.id}`}>
            Ajustar el alcance
          </Boton>
          <Boton variante="texto" escribe onClick={() => decidir('descartar')} testid={`descartar-${l.id}`}>
            Descartar
          </Boton>
        </div>
      )}
      {ajustando && (
        <AjustarAlcance l={l} ocupado={ocupado} onGuardar={guardar} onCancelar={() => setAjustando(false)} />
      )}
      {aviso && (
        <div className="mt-2">
          <Aviso tono={aviso.tono === 'error' ? 'error' : 'ok'}>{aviso.texto}</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}

function Porque({ p, onCambio }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const [libre, setLibre] = useState('');
  const responder = (respuesta) =>
    hacer(
      () => licitacionesApi.responderPorque(p.licitacion_id, p.comparacion, p.n, respuesta),
      'Respuesta guardada: va a la evidencia de la lección que sale de este cambio y se ve en Comparar.',
    );
  return (
    <Tarjeta hermes testid={`porque-${p.comparacion}-${p.n}`}>
      <div className="flex gap-2 flex-wrap">
        <Chip tono="hermes" punto={false}>
          Hermes pregunta
        </Chip>
        {p.titulo && <Chip>{p.titulo}</Chip>}
      </div>
      <h4 className="text-cuerpo font-bold text-tinta mt-2 mb-1">{p.pregunta}</h4>
      <div className="mt-1 px-3 py-2 rounded-control bg-lienzo border border-borde text-tabla text-tinta break-words">
        {p.antes && (
          <div>
            <span className="text-tinta-2">Hermes: </span>
            {p.antes}
          </div>
        )}
        {p.despues && (
          <div>
            <span className="text-tinta-2">Presentada: </span>
            {p.despues}
          </div>
        )}
      </div>
      <div className="flex gap-2 flex-wrap mt-3">
        {p.opciones.map((o) => (
          <Boton key={o} envolver escribe cargando={ocupado} onClick={() => responder(o)}>
            {o}
          </Boton>
        ))}
      </div>
      <div className="flex gap-2 mt-2 items-start">
        <Entrada
          value={libre}
          onChange={(e) => setLibre(e.target.value)}
          placeholder="Otro motivo"
          aria-label="Otro motivo"
          maxLength={600}
        />
        <Boton disabled={libre.trim().length < 2} escribe onClick={() => responder(libre.trim())}>
          Responder
        </Boton>
      </div>
      {aviso && (
        <div className="mt-2">
          <Aviso tono={aviso.tono === 'error' ? 'error' : 'ok'}>{aviso.texto}</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}

function ActasQueFaltan({ actas, onAbrir }) {
  if (!actas.length) return null;
  return (
    <Tarjeta
      titulo="Resoluciones sin acta"
      subtitulo="Con el acta, Hermes aprende de la valoración de la mesa"
      testid="actas-que-faltan"
    >
      <ul className="grid gap-2 m-0 p-0 list-none">
        {actas.map((a) => (
          <li
            key={a.licitacion_id}
            className="flex gap-3 items-start justify-between flex-wrap border-t border-borde pt-2"
          >
            <div className="min-w-0 flex-1 basis-64">
              <div className="text-tabla font-semibold text-tinta break-words">{a.titulo}</div>
              <div className="text-leyenda text-tinta-2 break-words">{textoActaQueFalta(a)}</div>
            </div>
            <Boton tamano="pequeno" Icono={FolderOpen} onClick={() => onAbrir(a.licitacion_id)}>
              Ver la oferta
            </Boton>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

export default function PorRevisar({ p, onCambio, onAbrir }) {
  const nada = !p.lecciones.length && !p.porques.length && !p.actas.length;
  if (nada)
    return (
      <Vacio
        titulo="Nada por revisar"
        texto="Las lecciones llegan al subir la memoria presentada, al leer un acta y cuando la PLACSP publica el resultado."
        testid="aprendizaje-vacio"
      />
    );
  return (
    <div data-testid="aprendizaje-por-revisar" className="grid gap-3 min-w-0">
      {p.lecciones.map((l) => (
        <TarjetaLeccion key={l.id} l={l} onCambio={onCambio} />
      ))}
      {p.porques.map((x) => (
        <Porque key={`${x.comparacion}-${x.n}`} p={x} onCambio={onCambio} />
      ))}
      <ActasQueFaltan actas={p.actas} onAbrir={onAbrir} />
    </div>
  );
}
