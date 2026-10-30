// Preguntar al pliego, en el Resumen de la ficha: una pregunta concreta va a Hermes
// (con prioridad: estás esperando) y vuelve con la cita literal del pliego, comprobada o no, o con
// «el pliego no lo dice». Lo de Hermes va en lavanda. Con la oferta en marcha, una respuesta se pasa
// a las comprobaciones como riesgo; si el pliego no lo dice, se copia el borrador de la consulta al órgano.
import { useState } from 'react';
import { Copy, Send } from 'lucide-react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { consultaAlOrgano, dondeCita, estadoPregunta, sePuedePasar } from '../../lib/preguntasPliegoFormato';
import useCarga from '../../hooks/useCarga';
import { Aviso, Boton, Chip, Entrada, Esqueleto, Tarjeta } from '../ui';

function Respuesta({ p, f, conComprobaciones, onCambio }) {
  const [estado, setEstado] = useState({ ocupado: false, error: null, copiado: false });
  const e = estadoPregunta(p);
  const pasar = async () => {
    setEstado({ ocupado: true, error: null, copiado: false });
    try {
      await licitacionesApi.preguntaAComprobaciones(f.id, p.id, !p.en_comprobaciones);
      onCambio();
      setEstado({ ocupado: false, error: null, copiado: false });
    } catch (err) {
      setEstado({ ocupado: false, error: err.message, copiado: false });
    }
  };
  const copiar = () =>
    navigator.clipboard?.writeText(consultaAlOrgano(p, f)).then(
      () => setEstado((s) => ({ ...s, copiado: true })),
      () => setEstado((s) => ({ ...s, error: 'No se pudo copiar' })),
    );
  return (
    <li data-testid="pregunta-pliego" data-estado={p.estado} className="grid gap-1.5">
      <span className="text-cuerpo font-bold text-tinta">{p.pregunta}</span>
      <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-hermes-suave text-cuerpo text-tinta grid gap-1.5 min-w-0 break-words">
        <span className="flex items-center gap-2 flex-wrap">
          <Chip tono={e.tono} punto={e.tono !== 'hermes'}>
            {e.texto}
          </Chip>
          {p.en_comprobaciones && <Chip tono="neutro">En las comprobaciones</Chip>}
        </span>
        {p.respuesta && <span>{p.respuesta}</span>}
        {p.cita && (
          <blockquote className="m-0 pl-2.5 border-l-2 border-hermes text-tabla text-tinta-2">
            «{p.cita.texto}»
            {dondeCita(p.cita) && <span className="block mt-0.5 text-leyenda">{dondeCita(p.cita)}</span>}
          </blockquote>
        )}
        {sePuedePasar(p) && (
          <span className="flex gap-1.5 flex-wrap">
            {conComprobaciones && (
              <Boton
                tamano="pequeno"
                escribe
                onClick={pasar}
                cargando={estado.ocupado}
                testid="pregunta-pliego-comprobaciones"
              >
                {p.en_comprobaciones ? 'Quitar de las comprobaciones' : 'Pasar a las comprobaciones'}
              </Boton>
            )}
            {!p.dice && (
              <Boton tamano="pequeno" Icono={Copy} onClick={copiar} testid="pregunta-pliego-consulta">
                {estado.copiado ? 'Consulta copiada' : 'Copiar la consulta al órgano'}
              </Boton>
            )}
          </span>
        )}
        {estado.error && <span className="text-leyenda text-impide">{estado.error}</span>}
      </div>
    </li>
  );
}

function Formulario({ id, onEnviada }) {
  const [texto, setTexto] = useState('');
  const [envio, setEnvio] = useState({ ocupado: false, error: null });
  const enviar = async (ev) => {
    ev.preventDefault();
    setEnvio({ ocupado: true, error: null });
    try {
      await licitacionesApi.preguntarPliego(id, texto);
      setTexto('');
      setEnvio({ ocupado: false, error: null });
      onEnviada();
    } catch (err) {
      setEnvio({ ocupado: false, error: err.message });
    }
  };
  return (
    <form onSubmit={enviar} className="grid gap-1.5">
      <div className="flex gap-2 items-center">
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="¿Piden ENS? ¿Se puede subcontratar la formación?"
          aria-label="Pregunta al pliego"
          maxLength={500}
          data-testid="pregunta-pliego-texto"
          invalido={Boolean(envio.error)}
        />
        <Boton
          submit
          escribe
          Icono={Send}
          cargando={envio.ocupado}
          disabled={texto.trim().length < 5}
          testid="pregunta-pliego-enviar"
        >
          Preguntar
        </Boton>
      </div>
      {envio.error && <span className="text-leyenda text-impide">{envio.error}</span>}
    </form>
  );
}

export default function PreguntarPliego({ f, version, conComprobaciones }) {
  const carga = useCarga(() => licitacionesApi.preguntasPliego(f.id), [f.id], version);
  const preguntas = carga.data?.preguntas ?? [];
  return (
    <Tarjeta
      titulo="Preguntar al pliego"
      subtitulo="Hermes busca en los pliegos y responde con la cita literal, o te dice que no lo dicen."
      testid="preguntar-pliego"
    >
      <div className="grid gap-3">
        <Formulario id={f.id} onEnviada={carga.recargar} />
        {carga.kind === 'loading' && <Esqueleto lineas={2} />}
        {carga.kind === 'error' && <Aviso tono="error">No se pudieron leer las preguntas: {carga.message}</Aviso>}
        {preguntas.length > 0 && (
          <ul className="m-0 p-0 list-none grid gap-3">
            {preguntas.map((p) => (
              <Respuesta key={p.id} p={p} f={f} conComprobaciones={conComprobaciones} onCambio={carga.recargar} />
            ))}
          </ul>
        )}
      </div>
    </Tarjeta>
  );
}
