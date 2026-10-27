// Pestaña Oferta: el asistente que pregunta. Hermes pregunta una a una las
// decisiones que faltan, con la cita del pliego y respuestas rápidas que se guardan por código; un
// texto libre lo lee Hermes y lo enseña para confirmarlo. A la derecha, «Lo que hay que decidir»
// (se puede volver a cualquiera y cambiarla, con «Qué cambia» antes) y lo que genera «OK, generar
// los documentos», por sobres. Debajo, en la misma pestaña, el detalle de la oferta (OfertaPestana).
import { useState } from 'react';
import { Check, Send } from 'lucide-react';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import {
  ayudaTexto,
  cambioDeRespuesta,
  conversacion,
  estadoDocumento,
  introduccion,
  preguntaActual,
  progreso,
  textoCitas,
  tonoOpcion,
} from '../../../lib/asistenteFormato';
import { clases } from '../../../lib/uiFormato';
import { nombreLegible } from '../../../lib/revisionSobresFormato';
import { leerFoco } from '../../../lib/rutas';
import useCarga from '../../../hooks/useCarga';
import useGuardarConImpacto from '../../../hooks/useGuardarConImpacto';
import { Aviso, Boton, Chip, Entrada, Esqueleto, Tarjeta } from '../../ui';
import { PanelImpacto } from './QueCambia';
import useComentarios from '../../../hooks/useComentarios';
import Comentarios from '../../comun/Comentarios';

function Burbuja({ quien, children, testid, cita }) {
  const hermes = quien === 'hermes';
  return (
    <div data-testid={testid} className={clases('grid gap-1.5 max-w-[88%] min-w-0', !hermes && 'justify-self-end')}>
      <span
        className={clases('text-leyenda font-bold text-tinta-2 flex items-center gap-1.5', !hermes && 'justify-end')}
      >
        {hermes && <span aria-hidden="true" className="w-2 h-2 rounded-full bg-hermes-punto" />}
        {hermes ? 'Hermes' : 'Tú'}
      </span>
      <div
        className={clases(
          'px-3.5 py-2.5 rounded-2xl text-cuerpo leading-normal text-tinta min-w-0 break-words',
          hermes ? 'bg-hermes-suave rounded-tl-sm' : 'bg-accion-suave rounded-tr-sm',
        )}
      >
        {children}
        {cita && <span className="block mt-1.5 text-leyenda text-tinta-2">{cita}</span>}
      </div>
    </div>
  );
}

function Interpretacion({ m, onConfirmar, onRechazar, ocupado }) {
  return (
    <Burbuja quien="hermes" testid="asistente-interpretacion">
      <span>
        Entiendo: <b>{m.texto}</b>.{m.explicacion ? ` ${m.explicacion}.` : ''} ¿Lo guardo?
      </span>
      <span className="flex gap-1.5 flex-wrap mt-2">
        <Boton
          tamano="pequeno"
          variante="principal"
          escribe
          Icono={Check}
          onClick={onConfirmar}
          cargando={ocupado}
          testid="asistente-confirmar"
        >
          Sí, guárdalo
        </Boton>
        <Boton tamano="pequeno" onClick={onRechazar} disabled={ocupado} testid="asistente-rechazar">
          No, era otra cosa
        </Boton>
      </span>
    </Burbuja>
  );
}

// Lo guardado vale pero conviene mirarlo (un precio anormalmente bajo): se puede cambiar ahí mismo.
function AvisoRespuesta({ m, onCambiar }) {
  return (
    <Burbuja quien="hermes" testid="asistente-aviso">
      <span>{m.texto}</span>
      <span className="flex gap-1.5 flex-wrap mt-2">
        <Boton tamano="pequeno" onClick={() => onCambiar(m.pregunta)} testid="asistente-aviso-cambiar">
          Cambiarlo
        </Boton>
      </span>
    </Burbuja>
  );
}

function Mensaje({ m, acciones }) {
  if (m.tipo === 'interpretacion' && m.estado === 'por_confirmar') return <Interpretacion m={m} {...acciones(m)} />;
  if (m.tipo === 'aviso') return <AvisoRespuesta m={m} onCambiar={acciones(m).onCambiar} />;
  if (m.tipo === 'pregunta')
    return (
      <Burbuja quien="hermes">
        <b>{m.texto}</b>
      </Burbuja>
    );
  if (m.tipo === 'error') return <Aviso tono="error">{m.texto}</Aviso>;
  if (m.tipo === 'guardado' || m.tipo === 'leyendo') return <p className="m-0 text-leyenda text-tinta-2">{m.texto}</p>;
  return <Burbuja quien={m.quien}>{m.texto}</Burbuja>;
}

// Una opción que necesita un dato más (el importe de «Otro precio», con qué se acredita un criterio).
function DatoDeOpcion({ opcion, onEnviar, ocupado }) {
  const [valor, setValor] = useState('');
  const importe = opcion.pide === 'importe';
  const enviar = () =>
    onEnviar(importe ? { importe: Number(valor.replace(/\./g, '').replace(',', '.')) } : { evidencia: valor.trim() });
  return (
    <span className="flex gap-1.5 items-center flex-wrap mt-2">
      <Entrada
        aria-label={importe ? 'Importe sin impuestos' : 'Con qué se acredita'}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={importe ? 'Importe sin impuestos' : 'Con qué se acredita'}
        className="max-w-xs"
        inputMode={importe ? 'decimal' : undefined}
      />
      <Boton
        tamano="pequeno"
        variante="principal"
        escribe
        onClick={enviar}
        disabled={!valor.trim()}
        cargando={ocupado}
        testid="asistente-dato-enviar"
      >
        Guardar
      </Boton>
    </span>
  );
}

// Lo que propone Hermes y, en un candidato, si llega a lo que pide el pliego. En un precio o un
// tramo el tono no es «cumple»: no se etiqueta.
function EtiquetaOpcion({ o }) {
  if (o.hermes) return <Chip tono="hermes">Propone Hermes</Chip>;
  if (o.accion?.tipo !== 'persona' || o.tono === 'neutro') return null;
  return <Chip tono={tonoOpcion(o)}>{{ ok: 'Cumple', riesgo: 'Riesgo', impide: 'No llega' }[o.tono]}</Chip>;
}

function Opciones({ p, onElegir, ocupado }) {
  const [pidiendo, setPidiendo] = useState(null);
  return (
    <>
      <span className="flex gap-1.5 flex-wrap mt-2" data-testid="asistente-opciones">
        {p.opciones.map((o) => (
          <span
            key={o.clave}
            className="inline-flex items-center gap-1 max-w-full min-w-0"
            title={o.detalle ?? undefined}
          >
            <Boton
              tamano="pequeno"
              envolver
              escribe={!o.pide && !o.enlace}
              disabled={ocupado}
              testid={`opcion-${o.clave}`}
              onClick={() => (o.pide ? setPidiendo(o) : onElegir(o))}
            >
              {o.texto}
              {o.detalle ? ` · ${o.detalle}` : ''}
            </Boton>
            <EtiquetaOpcion o={o} />
          </span>
        ))}
      </span>
      {pidiendo && (
        <DatoDeOpcion
          key={pidiendo.clave}
          opcion={pidiendo}
          ocupado={ocupado}
          onEnviar={(extra) => onElegir(pidiendo, extra)}
        />
      )}
    </>
  );
}

function PreguntaActual({ p, onElegir, ocupado }) {
  return (
    <Burbuja quien="hermes" testid="asistente-pregunta" cita={textoCitas(p.citas) || null}>
      <b>{p.titulo}.</b> {p.texto}
      {p.estado === 'hecha' && p.respuesta && (
        <span className="block mt-1 text-leyenda text-tinta-2">Ahora: {p.respuesta}</span>
      )}
      <Opciones key={p.clave} p={p} onElegir={onElegir} ocupado={ocupado} />
    </Burbuja>
  );
}

function Escribir({ p, onEnviar, ocupado }) {
  const [texto, setTexto] = useState('');
  if (!p?.libre) return null;
  const enviar = () => {
    if (texto.trim()) onEnviar(texto.trim()).then((ok) => ok && setTexto(''));
  };
  return (
    <div className="grid gap-1">
      <div className="flex gap-2 min-w-0">
        <Entrada
          aria-label="Respuesta para Hermes"
          placeholder="Escribe tu respuesta…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enviar();
          }}
          data-testid="asistente-texto"
        />
        <Boton
          etiqueta="Enviar"
          Icono={Send}
          onClick={enviar}
          disabled={!texto.trim()}
          cargando={ocupado}
          testid="asistente-enviar"
          escribe
        />
      </div>
      <span className="text-leyenda text-tinta-2">{ayudaTexto(p)}</span>
    </div>
  );
}

function Paso({ p, actual, onElegir }) {
  const hecha = p.estado === 'hecha';
  return (
    <button
      type="button"
      onClick={() => onElegir(p.clave)}
      data-testid={`decidir-${p.clave}`}
      data-estado={hecha ? 'hecha' : actual ? 'ahora' : 'pendiente'}
      className={clases(
        'grid grid-cols-[20px_minmax(0,1fr)] gap-2 py-1.5 text-left text-tabla bg-transparent border-0 cursor-pointer text-tinta',
        actual && 'font-bold',
      )}
    >
      <span
        aria-hidden="true"
        className={clases(
          'w-4 h-4 mt-0.5 rounded-full border-[1.5px] grid place-items-center',
          hecha ? 'bg-accion border-accion' : actual ? 'border-hermes-punto bg-hermes-suave' : 'border-borde-control',
        )}
      >
        {hecha && <Check size={11} strokeWidth={2.4} />}
      </span>
      <span>
        {p.titulo}
        {p.respuesta && <small className="block text-leyenda font-normal text-tinta-2">{p.respuesta}</small>}
      </span>
    </button>
  );
}

function LoQueHayQueDecidir({ datos, actual, onElegir }) {
  const pr = progreso(datos);
  return (
    <Tarjeta
      titulo="Lo que hay que decidir"
      extra={<span className="text-leyenda text-tinta-2 tabular-nums">{pr.texto}</span>}
      testid="asistente-decidir"
    >
      <div className="h-1.5 rounded bg-superficie-2 overflow-hidden mb-2" aria-hidden="true">
        <b className="block h-full bg-tinta" style={{ width: `${pr.porcentaje}%` }} />
      </div>
      <div className="grid">
        {datos.preguntas.map((p) => (
          <Paso key={p.clave} p={p} actual={actual?.clave === p.clave} onElegir={onElegir} />
        ))}
      </div>
    </Tarjeta>
  );
}

function AlPulsarOk({ plan, onGenerar, ocupado, mensaje }) {
  return (
    <Tarjeta titulo="Al pulsar OK, Hermes genera" testid="asistente-sobres">
      <div className="grid gap-2">
        {plan.sobres.map((s) => (
          <div key={s.archivo} className="border border-borde rounded-control px-3 py-2.5 grid gap-1.5">
            <b className="text-tabla">{s.archivo}</b>
            {s.documentos.map((d) => (
              <div key={d.clave} className="flex justify-between items-center gap-2 text-tabla">
                <span className="min-w-0">
                  {nombreLegible(d.nombre)}
                  {d.lote ? ` · lote ${d.lote}` : ''}
                </span>
                <Chip tono={estadoDocumento(d).tono}>{estadoDocumento(d).texto}</Chip>
              </div>
            ))}
          </div>
        ))}
        {!plan.sobres.length && (
          <p className="m-0 text-tabla text-tinta-2">El guion no pide documentos que genere la plataforma.</p>
        )}
        <div>
          <Boton
            variante="principal"
            escribe
            onClick={onGenerar}
            disabled={!plan.listo}
            cargando={ocupado}
            testid="asistente-generar"
          >
            OK, generar los documentos
          </Boton>
        </div>
        <p className="m-0 text-leyenda text-tinta-2">
          {plan.listo
            ? 'Están todas las decisiones.'
            : `Se activa cuando estén todas las decisiones (faltan ${plan.pendientes}).`}
          {plan.pedida_en ? ' Ya se pidieron una vez: volver a pulsarlo pide solo lo que falte.' : ''}
        </p>
        {mensaje && <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso>}
      </div>
    </Tarjeta>
  );
}

// Responder: guarda y recarga; con una respuesta ya dada, «Qué cambia» antes de guardarla.
function useResponder(id, recargar, datos) {
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [pendiente, setPendiente] = useState(null);
  const enviar = async (cuerpo) => {
    setOcupado(true);
    setError(null);
    try {
      await licitacionesApi.responderOferta(id, { version: datos?.version ?? null, ...cuerpo });
      recargar();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  };
  const impacto = useGuardarConImpacto(id, {
    cambio: pendiente?.cambio ?? null,
    guardar: async () => {
      if (!(await enviar(pendiente.cuerpo))) throw new Error(error ?? 'No se guardó.');
      setPendiente(null);
    },
  });
  const elegir = (p, o, extra = {}) => {
    const cuerpo = { pregunta: p.clave, opcion: o.clave, ...extra };
    const cambio = cambioDeRespuesta(p, o.accion);
    if (!cambio) return enviar(cuerpo);
    setPendiente({ cuerpo, cambio });
    return impacto.iniciar(cambio);
  };
  return { error, ocupado: ocupado || impacto.ocupado, enviar, elegir, impacto, pendiente };
}

function Conversacion({ datos, hilo, p, r, onEnlace, onElegir }) {
  const acciones = (m) => ({
    ocupado: r.ocupado,
    onCambiar: onElegir,
    onConfirmar: () => r.enviar({ pregunta: m.pregunta, interpretacion: m.id }),
    onRechazar: () => r.enviar({ pregunta: m.pregunta, interpretacion: m.id, rechazar: true }),
  });
  return (
    <Tarjeta testid="asistente-chat" className="grid gap-3.5 grid-cols-[minmax(0,1fr)]">
      <Burbuja quien="hermes">{introduccion(datos)}</Burbuja>
      {datos.avisos.map((a) => (
        <Aviso key={a} tono="aviso">
          {a}
        </Aviso>
      ))}
      {conversacion(hilo.mensajes).map((m) => (
        <Mensaje key={m.clave} m={m} acciones={acciones} />
      ))}
      {p ? (
        <PreguntaActual
          p={p}
          ocupado={r.ocupado}
          onElegir={(o, extra) => (o.enlace ? onEnlace(o.enlace) : r.elegir(p, o, extra))}
        />
      ) : (
        <Burbuja quien="hermes">
          Están todas las decisiones. Pulsa «OK, generar los documentos» y pásate después por Revisión.
        </Burbuja>
      )}
      {r.pendiente && (
        <PanelImpacto
          g={r.impacto}
          conMarcar
          soloApartados
          id={datos.id}
          cambio={r.pendiente.cambio}
          textoRehacer="Guardar la respuesta"
        />
      )}
      {r.error && <Aviso tono="error">{r.error}</Aviso>}
      <Escribir
        key={p?.clave ?? 'listo'}
        p={p}
        ocupado={r.ocupado}
        onEnviar={(texto) => r.enviar({ pregunta: p.clave, texto })}
      />
    </Tarjeta>
  );
}

// Lo que el equipo se dice de la oferta, aparte de lo que se le responde a Hermes.
function HiloEquipo({ id }) {
  const comentarios = useComentarios(id);
  return (
    <Tarjeta testid="hilo-equipo" className="grid gap-2">
      <h3 className="m-0 text-tabla font-bold text-tinta">Comentarios del equipo</h3>
      <Comentarios
        hilo={comentarios.de('oferta')}
        onPublicar={(t) => comentarios.publicar('oferta', '', t)}
        onResolver={comentarios.resolver}
        testid="comentarios-oferta"
        abierto
      />
    </Tarjeta>
  );
}

export default function AsistenteOferta({ f, version, irA }) {
  const carga = useCarga(
    () =>
      Promise.all([
        licitacionesApi.preguntasOferta(f.id),
        licitacionesApi.hiloOferta(f.id),
        licitacionesApi.planGenerar(f.id),
      ]),
    [f.id],
    version,
  );
  const [elegida, setElegida] = useState(null);
  const [generando, setGenerando] = useState({ ocupado: false, mensaje: null });
  const datos = carga.kind === 'ready' ? carga.data[0] : null;
  const r = useResponder(f.id, carga.recargar, datos);
  if (carga.kind === 'loading') return <Esqueleto lineas={5} />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const [, hilo, plan] = carga.data;
  const p = preguntaActual(datos.preguntas, elegida);
  const generar = async () => {
    setGenerando({ ocupado: true, mensaje: null });
    try {
      await licitacionesApi.generarDocumentos(f.id);
      setGenerando({
        ocupado: false,
        mensaje: {
          tono: 'info',
          texto:
            'Pedido: Hermes deja los documentos en la carpeta de la licitación. Pásate por Revisión antes de firmar.',
        },
      });
      carga.recargar();
    } catch (e) {
      setGenerando({ ocupado: false, mensaje: { tono: 'error', texto: e.message } });
    }
  };
  return (
    <div data-testid="asistente-oferta" className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
      {/* Una opción con enlace («comprobaciones#bloqueo=precio:1») se resuelve en su fila de la Revisión. */}
      <Conversacion
        datos={datos}
        hilo={hilo}
        p={p}
        r={r}
        onEnlace={(enlace) => {
          const { bloqueo, testid } = leerFoco(`${f.id}/${enlace}`);
          irA('revision', { bloqueo, testid });
        }}
        onElegir={setElegida}
      />
      <div className="grid gap-3">
        <LoQueHayQueDecidir datos={datos} actual={p} onElegir={setElegida} />
        <AlPulsarOk plan={plan} onGenerar={generar} ocupado={generando.ocupado} mensaje={generando.mensaje} />
        <HiloEquipo id={f.id} />
      </div>
    </div>
  );
}
