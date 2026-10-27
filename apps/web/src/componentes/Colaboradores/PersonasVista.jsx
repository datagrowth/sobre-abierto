// Lista de colaboradores con filtros (tipo, texto, inactivos) y la ficha al lado. Alta a
// mano o desde un CV: se sube a Colaboradores/ y Hermes propone el perfil para aprobarlo.
import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { TINTA_2, TINTA } from '../../lib/tema';
import { colaboradoresApi } from '../../lib/colaboradoresApi';
import { DISPONIBILIDADES, TIPOS, resumenDocencia } from '../../lib/colaboradoresFormulario';
import { fechaCorta, plural } from '../../lib/formato';
import { personaDeRuta } from '../../lib/rutas';
import useRuta from '../../hooks/useRuta';
import { Aviso, Boton, Chip } from '../ui';
import { Pildora } from '../comun/ui';
import { FilaLista, ListaYFicha, ResultadosLista } from '../comun/listas';
import FichaPersona from './FichaPersona';
import FormularioPersona from './FormularioPersona';
import SubirCv from './SubirCv';
import AltaLinkedin from './AltaLinkedin';

const FILTROS_TIPO = [
  { key: '', label: 'Todos' },
  { key: 'interno', label: 'Equipo' },
  { key: 'externo', label: 'Externos' },
];

const TONO_DISPONIBILIDAD = { disponible: 'ok', parcial: 'riesgo', no_disponible: 'neutro' };

// La disponibilidad sale de sus ofertas y contratos: «Parcial · 2 ofertas en curso», «Hasta el 15 nov».
function ChipDisponibilidad({ d }) {
  const texto =
    d.estado === 'no_disponible' && d.hasta ? `Hasta el ${fechaCorta(d.hasta)}` : DISPONIBILIDADES[d.estado];
  return (
    <Chip tono={TONO_DISPONIBILIDAD[d.estado]} title={d.motivo || undefined} testid="persona-disponibilidad">
      {texto}
    </Chip>
  );
}

// El CV: cuándo se leyó y si es antiguo (más de 12 meses) o hay uno nuevo por revisar.
function ChipCv({ cv }) {
  if (cv.nuevo)
    return (
      <Chip tono="hermes" testid="persona-cv-nuevo">
        CV nuevo por revisar
      </Chip>
    );
  if (cv.antiguo)
    return (
      <Chip tono="riesgo" testid="persona-cv-antiguo">
        CV de hace más de 12 meses
      </Chip>
    );
  return null;
}

function Item({ p, activa, onClick }) {
  const docencia = resumenDocencia(p.docencia);
  return (
    <FilaLista
      activa={activa}
      onClick={onClick}
      titulo={p.nombre}
      subtitulo={`${p.rol || 'Sin rol'} · ${TIPOS[p.tipo].toLowerCase()}${docencia ? ` · ${docencia}` : ''}`}
    >
      <ChipDisponibilidad d={p.disponibilidad} />
      {p.anios_experiencia !== null && <Chip>{p.anios_experiencia} años</Chip>}
      {p.certificaciones.length > 0 && (
        <Chip title={p.certificaciones.join(', ')}>
          {plural(p.certificaciones.length, 'certificación', 'certificaciones')}
        </Chip>
      )}
      <ChipCv cv={p.cv} />
      {!p.activo && <Chip>inactivo</Chip>}
    </FilaLista>
  );
}

// Respuestas que llegan tarde (otros filtros) se ignoran.
function useLista(filtros, version) {
  const [resultado, setResultado] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    colaboradoresApi.personas(filtros).then(
      (r) => vivo && setResultado({ kind: 'ready', items: r.items, total: r.items.length }),
      (e) => vivo && setResultado({ kind: 'error', message: e.message }),
    );
    return () => {
      vivo = false;
    };
  }, [filtros, version]);
  return resultado;
}

function Filtros({ filtros, onCambio, texto, onTexto }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTROS_TIPO.map((t) => (
          <Pildora
            key={t.key}
            label={t.label}
            activa={filtros.tipo === t.key}
            onClick={() => onCambio({ ...filtros, tipo: t.key })}
          />
        ))}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: TINTA, marginLeft: 6 }}>
          <input
            type="checkbox"
            checked={filtros.inactivos}
            onChange={(e) => onCambio({ ...filtros, inactivos: e.target.checked })}
          />{' '}
          Ver inactivos
        </label>
      </div>
      <input
        className="input-field"
        type="search"
        value={texto}
        onChange={(e) => onTexto(e.target.value)}
        placeholder="Buscar por nombre, rol, titulación, certificación o tecnología"
        aria-label="Buscar colaboradores"
      />
    </div>
  );
}

function Ficha({ seleccion, version, onCrear, onCerrar, onRecargar }) {
  if (seleccion === 'nueva') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 16, color: TINTA, fontWeight: 600 }}>Nueva persona</div>
        <FormularioPersona inicial={null} onGuardar={onCrear} onCancelar={onCerrar} />
      </div>
    );
  }
  return (
    <FichaPersona
      key={seleccion}
      id={seleccion}
      version={version}
      onVolver={onCerrar}
      onCambio={onRecargar}
      onBorrada={() => {
        onCerrar();
        onRecargar();
      }}
    />
  );
}

export default function PersonasVista({ version, onRecargar }) {
  const [filtros, setFiltros] = useState({ tipo: '', texto: '', inactivos: false });
  const [texto, setTexto] = useState('');
  // «#/equipo/<id>#campo=…» (la matriz de equipo de la oferta) abre la ficha de esa persona.
  const deRuta = personaDeRuta(useRuta());
  const [seleccion, setSeleccion] = useState(deRuta);
  const [vista, setVista] = useState(deRuta);
  if (vista !== deRuta) {
    setVista(deRuta);
    if (deRuta !== null) setSeleccion(deRuta);
  }
  const [aviso, setAviso] = useState(null);
  const resultado = useLista(filtros, version);
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.texto === texto.trim() ? f : { ...f, texto: texto.trim() })), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const crear = async (persona) => {
    const p = await colaboradoresApi.crear(persona);
    setSeleccion(p.id);
    onRecargar();
  };
  const lista = (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Boton variante="principal" Icono={UserPlus} onClick={() => setSeleccion('nueva')}>
          Nueva persona
        </Boton>
        <SubirCv onAviso={setAviso} title="Sube el CV a Colaboradores/ y Hermes propone el perfil">
          Alta desde CV
        </SubirCv>
        <AltaLinkedin onAviso={setAviso} />
      </div>
      {aviso && (
        <div style={{ marginBottom: 10 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      <Filtros filtros={filtros} onCambio={setFiltros} texto={texto} onTexto={setTexto} />
      <ResultadosLista
        resultado={resultado}
        vacio="Aún no hay colaboradores: da de alta a alguien o sube su CV."
        item={(p) => <Item key={p.id} p={p} activa={seleccion === p.id} onClick={() => setSeleccion(p.id)} />}
      />
    </>
  );
  const ficha = seleccion ? (
    <Ficha
      seleccion={seleccion}
      version={version}
      onCrear={crear}
      onCerrar={() => setSeleccion(null)}
      onRecargar={onRecargar}
    />
  ) : null;
  return (
    <ListaYFicha
      lista={lista}
      ficha={ficha}
      vacio={<span style={{ color: TINTA_2 }}>Elige a alguien para ver su ficha.</span>}
    />
  );
}
