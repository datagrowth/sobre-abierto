// CV por revisar: perfiles leídos de un CV por Hermes, pendientes de aprobar. Arriba, lo que
// cambia en la ficha (la docencia con la página del CV de cada dato); la persona lo revisa y
// corrige si hace falta en el formulario: aprobar crea o actualiza al colaborador.
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, FileText, X } from 'lucide-react';
import { TINTA, TINTA_2 } from '../../lib/tema';
import { colaboradoresApi } from '../../lib/colaboradoresApi';
import { urlDocumento } from '../../lib/apiCliente';
import { TIPOS, diferenciasPersona } from '../../lib/colaboradoresFormulario';
import { fechaHora } from '../../lib/formato';
import { Aviso, Boton, Chip } from '../ui';
import { EstadoFicha } from '../comun/ui';
import { FilaLista, ListaYFicha, ResultadosLista } from '../comun/listas';
import FormularioPersona from './FormularioPersona';
import PropuestaIA from '../comun/PropuestaIA';

function usePropuestas(version) {
  const [resultado, setResultado] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    colaboradoresApi.propuestas().then(
      (items) => vivo && setResultado({ kind: 'ready', items, total: items.length }),
      (e) => vivo && setResultado({ kind: 'error', message: e.message }),
    );
    return () => {
      vivo = false;
    };
  }, [version]);
  return resultado;
}

// Si el CV es de alguien que ya existe, lo que no sale de un CV se conserva de su ficha.
function useInicial(propuesta) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    const base = { ...propuesta.perfil, cv_ruta: propuesta.cv_ruta };
    const previa = propuesta.persona_id
      ? colaboradoresApi.persona(propuesta.persona_id).catch(() => null)
      : Promise.resolve(null);
    previa.then(
      (p) =>
        vivo &&
        setEstado({
          kind: 'ready',
          previa: p,
          inicial: p ? { ...base, tarifa_hora: p.tarifa_hora, notas: p.notas, activo: p.activo } : base,
        }),
    );
    return () => {
      vivo = false;
    };
  }, [propuesta]);
  return estado;
}

function Revision({ propuesta, onHecho, onVolver }) {
  const estado = useInicial(propuesta);
  if (estado.kind !== 'ready') return <EstadoFicha estado={estado} onVolver={onVolver} />;
  const revisar = (decision) => async (persona) => {
    await colaboradoresApi.revisar(propuesta.id, {
      decision,
      version: propuesta.actualizada_en,
      persona: decision === 'aprobar' ? persona : undefined,
    });
    onHecho(decision === 'aprobar' ? 'Aprobado: ya está en Personas.' : 'Rechazado.');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ marginBottom: 8 }}>
          <Boton Icono={ArrowLeft} onClick={onVolver}>
            Volver
          </Boton>
        </div>
        <h2 style={{ fontSize: 16, color: TINTA, margin: 0 }}>{propuesta.perfil.nombre}</h2>
      </div>
      <PropuestaIA
        titulo={propuesta.persona_id ? 'Actualización leída de un CV' : 'Persona nueva leída de un CV'}
        agente={propuesta.agente}
        fecha={propuesta.actualizada_en}
        cambios={diferenciasPersona(estado.previa, propuesta.perfil)}
        nota={
          propuesta.persona_id
            ? 'Arriba, lo que cambia en su ficha. Revisa cada campo contra el CV y corrige abajo antes de aprobar.'
            : 'Revisa cada campo contra el CV y corrige lo que haga falta antes de aprobar.'
        }
      >
        <a
          href={urlDocumento(propuesta.cv_ruta)}
          target="_blank"
          rel="noreferrer"
          style={{ color: TINTA, display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12.5 }}
        >
          <FileText size={13} aria-hidden="true" />
          Ver el CV
        </a>
      </PropuestaIA>
      <FormularioPersona
        key={propuesta.actualizada_en}
        inicial={estado.inicial}
        acciones={[
          { texto: 'Aprobar', variante: 'principal', Icono: Check, fn: revisar('aprobar') },
          { texto: 'Rechazar', Icono: X, sinDatos: true, fn: revisar('rechazar') },
        ]}
      />
    </div>
  );
}

export default function PendientesVista({ version, onRecargar, seleccion: pedida = null, onElegir }) {
  const resultado = usePropuestas(version);
  // La propuesta abierta va en la ruta (los enlaces de «Hoy» la abren directamente).
  const seleccion = pedida === null ? null : Number(pedida);
  const setSeleccion = (id) => onElegir(id === null ? null : String(id));
  const [mensaje, setMensaje] = useState(null);
  const elegida = resultado.kind === 'ready' ? resultado.items.find((p) => p.id === seleccion) : null;
  const hecho = (texto) => {
    setMensaje(texto);
    setSeleccion(null);
    onRecargar();
  };
  const lista = (
    <>
      {mensaje && (
        <div style={{ marginBottom: 10 }}>
          <Aviso>{mensaje}</Aviso>
        </div>
      )}
      <ResultadosLista
        resultado={resultado}
        vacio="No hay perfiles pendientes. Sube un CV en Personas → «Alta desde CV»."
        item={(p) => (
          <FilaLista
            key={p.id}
            activa={seleccion === p.id}
            onClick={() => {
              setSeleccion(p.id);
              setMensaje(null);
            }}
            titulo={p.perfil.nombre}
            subtitulo={p.perfil.rol || p.cv_ruta}
          >
            <Chip>{TIPOS[p.perfil.tipo]}</Chip>
            {p.persona_id && <Chip>actualización</Chip>}
            <span style={{ fontSize: 12, color: TINTA_2 }}>{fechaHora(p.actualizada_en)}</span>
          </FilaLista>
        )}
      />
    </>
  );
  const ficha = elegida ? (
    <Revision
      key={`${elegida.id}-${elegida.actualizada_en}`}
      propuesta={elegida}
      onHecho={hecho}
      onVolver={() => setSeleccion(null)}
    />
  ) : null;
  return <ListaYFicha lista={lista} ficha={ficha} vacio="Elige un perfil para revisarlo." />;
}
