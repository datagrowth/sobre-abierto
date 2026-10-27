// Formulario de un colaborador: alta, edición y revisión de un perfil leído de un CV.
// Los errores de forma se avisan antes de enviar; el servidor vuelve a validarlo todo.
import { useState } from 'react';
import { TIPOS, formularioAPersona, personaAFormulario } from '../../lib/colaboradoresFormulario';
import { SectionCard } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Campo } from '../ui';

const ancho = { width: '100%' };

function Fila({ children }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>;
}

function Opciones({ valor, onChange, opciones, label }) {
  return (
    <select className="input-field" value={valor} onChange={onChange} aria-label={label} style={ancho}>
      {Object.entries(opciones).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

// Constructores de controles ligados al estado del formulario.
function controles(v, set) {
  return {
    input: (k, extra = {}) => <input className="input-field" value={v[k]} onChange={set(k)} style={ancho} {...extra} />,
    area: (k, filas = 2) => (
      <textarea
        className="input-field"
        rows={filas}
        value={v[k]}
        onChange={set(k)}
        style={{ ...ancho, resize: 'vertical' }}
      />
    ),
  };
}

function DatosPersona({ v, set }) {
  const { input } = controles(v, set);
  return (
    <SectionCard title="PERSONA">
      <Fila>
        <div style={{ flex: '2 1 220px' }}>
          <Campo label="Nombre">{input('nombre', { autoComplete: 'off' })}</Campo>
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <Campo label="Tipo">
            <Opciones label="Tipo" valor={v.tipo} onChange={set('tipo')} opciones={TIPOS} />
          </Campo>
        </div>
      </Fila>
      <Fila>
        <div style={{ flex: '2 1 220px' }}>
          <Campo label="Rol" ayuda="Jefe de proyecto, científica de datos…">
            {input('rol')}
          </Campo>
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <Campo label="Años de experiencia">{input('anios_experiencia', { inputMode: 'numeric' })}</Campo>
        </div>
      </Fila>
      <Campo label="Tarifa" ayuda="€/hora, opcional. La disponibilidad no se escribe: sale de sus ofertas y contratos">
        {input('tarifa_hora', { inputMode: 'decimal' })}
      </Campo>
      <Campo label="LinkedIn" ayuda="Dirección del perfil: linkedin.com/in/…">
        {input('linkedin', { inputMode: 'url', autoComplete: 'off', placeholder: 'https://www.linkedin.com/in/…' })}
      </Campo>
    </SectionCard>
  );
}

function Acredita({ v, set }) {
  const { input, area } = controles(v, set);
  return (
    <SectionCard title="LO QUE ACREDITA">
      <Campo label="Titulaciones" ayuda="Una por línea, con nivel y rama: «Grado en Ingeniería Informática»">
        {area('titulaciones', 3)}
      </Campo>
      <Campo label="Certificaciones" ayuda="Separadas por comas: PMP, ITIL 4, AWS Solutions Architect">
        {input('certificaciones')}
      </Campo>
      <Campo label="Tecnologías y habilidades" ayuda="Separadas por comas: Python, Power BI, Scrum">
        {input('tecnologias')}
      </Campo>
      <Campo label="Idiomas" ayuda="Con nivel A1–C2 o nativo: Inglés C1, Francés B2">
        {input('idiomas')}
      </Campo>
      <Campo label="Horas de docencia" ayuda="Una materia por línea: «IA generativa · 160 h · 2024-2026 · CV, pág. 3»">
        {area('docencia', 3)}
      </Campo>
      <Fila>
        <div style={{ flex: '1 1 200px' }}>
          <Campo label="Sectores" ayuda="Sanidad, administración pública…">
            {input('sectores')}
          </Campo>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <Campo label="CPV con experiencia" ayuda="Prefijos: 72, 7331">
            {input('cpv', { inputMode: 'numeric' })}
          </Campo>
        </div>
      </Fila>
    </SectionCard>
  );
}

function CvYNotas({ v, set }) {
  const { input, area } = controles(v, set);
  return (
    <SectionCard title="CV Y NOTAS">
      <Campo label="CV en la Biblioteca" ayuda="Ruta dentro de Colaboradores/">
        {input('cv_ruta')}
      </Campo>
      <Campo label="Notas">{area('notas', 3)}</Campo>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
        <input
          type="checkbox"
          checked={v.activo}
          onChange={(e) => set('activo')({ target: { value: e.target.checked } })}
        />{' '}
        Activo (sale en las búsquedas)
      </label>
    </SectionCard>
  );
}

/**
 * inicial: el colaborador (o el perfil propuesto) con el que se abre. onGuardar recibe el
 * colaborador ya convertido y devuelve una promesa; si falla, se muestra su mensaje.
 */
export default function FormularioPersona({ inicial, onGuardar, onCancelar, acciones }) {
  const [v, setV] = useState(() => personaAFormulario(inicial));
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV((prev) => ({ ...prev, [k]: e.target.value }));
  // sinDatos: acciones como «Rechazar», que no necesitan un formulario válido.
  const enviar = async (a) => {
    const { persona, errores } = formularioAPersona(v);
    if (errores.length && !a.sinDatos) {
      setError(errores.join(' '));
      return;
    }
    setError(null);
    try {
      await a.fn(persona);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DatosPersona v={v} set={set} />
      <Acredita v={v} set={set} />
      <CvYNotas v={v} set={set} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(acciones ?? [{ texto: 'Guardar', variante: 'principal', fn: onGuardar }]).map((a) => (
          <Boton key={a.texto} variante={a.variante} Icono={a.Icono} onClick={() => enviar(a)}>
            {a.texto}
          </Boton>
        ))}
        {onCancelar && <Boton onClick={onCancelar}>Cancelar</Boton>}
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}
