// Búsqueda de candidatos para un requisito escrito a mano (p. ej. copiado de un pliego).
// La usan la pantalla Equipo (también desde un perfil a incorporar, con sus requisitos ya puestos)
// y el bloque Equipo de una licitación (con sus CPV). Si nadie cumple, lleva a «A incorporar».
import { useState } from 'react';
import { Search } from 'lucide-react';
import { TINTA_2 } from '../../lib/tema';
import { colaboradoresApi } from '../../lib/colaboradoresApi';
import { Aviso, Boton } from '../ui';
import Candidatos from './Candidatos';

const nadieCumple = (r) => r.requisitos.every((q) => ![...q.internos, ...q.externos].some((c) => c.cumple_minimos));

function NadieCumple({ onVerIncorporar }) {
  return (
    <Aviso tono="aviso">
      <span data-testid="buscar-nadie-cumple">
        Nadie lo cumple con seguridad. Si la oferta se compromete a incorporar el perfil, queda en «A incorporar» con su
        fecha límite.
      </span>
      {onVerIncorporar && (
        <span style={{ marginLeft: 8 }}>
          <Boton onClick={onVerIncorporar}>Ver A incorporar</Boton>
        </span>
      )}
    </Aviso>
  );
}

/** perfil: el perfil a incorporar del que se buscan candidatos; cada candidato puede proponerse para él. */
export default function BuscarCandidatos({
  cpvs,
  inicial = '',
  perfil = null,
  onVerIncorporar,
  ejemplo = 'Docente con al menos 150 h impartidas en inteligencia artificial en los 3 últimos años y titulación universitaria',
}) {
  const [texto, setTexto] = useState(inicial ?? '');
  const [estado, setEstado] = useState(null);
  const [aviso, setAviso] = useState(null);
  const buscar = async () => {
    if (texto.trim().length < 3) {
      setEstado({ kind: 'error', message: 'Escribe el requisito (al menos 3 letras).' });
      return;
    }
    setEstado({ kind: 'loading' });
    try {
      setEstado({ kind: 'ready', r: await colaboradoresApi.buscar({ texto: texto.trim(), cpvs }) });
    } catch (e) {
      setEstado({ kind: 'error', message: e.message });
    }
  };
  const proponer =
    perfil &&
    ((c) =>
      colaboradoresApi.cambiarIncorporar(perfil.id, { candidato_id: c.id }).then(
        () => setAviso({ tono: 'info', texto: `${c.nombre} queda como candidato para «${perfil.perfil}».` }),
        (e) => setAviso({ tono: 'error', texto: e.message }),
      ));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="buscar-requisito">
      <textarea
        className="input-field"
        rows={2}
        maxLength={2000}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={ejemplo}
        aria-label="Requisito de medios personales"
        style={{ width: '100%', resize: 'vertical' }}
      />
      <div>
        <Boton variante="principal" Icono={Search} onClick={buscar} disabled={estado?.kind === 'loading'}>
          Buscar
        </Boton>
      </div>
      {estado?.kind === 'error' && <Aviso tono="error">{estado.message}</Aviso>}
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
      {estado?.kind === 'ready' && (
        <>
          {estado.r.aviso && <div style={{ fontSize: 11.5, color: TINTA_2 }}>{estado.r.aviso}</div>}
          {estado.r.requisitos.map((r, i) => (
            <Candidatos key={`${i}-${r.texto}`} resultado={r} onProponer={proponer || undefined} />
          ))}
          {nadieCumple(estado.r) && <NadieCumple onVerIncorporar={onVerIncorporar} />}
        </>
      )}
    </div>
  );
}
