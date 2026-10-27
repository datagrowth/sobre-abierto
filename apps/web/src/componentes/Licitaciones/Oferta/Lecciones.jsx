// Lo que Hermes aprende de una versión retocada a mano: tu nota, y las lecciones que propone
// (generales o solo de esta licitación) para aceptar o descartar. Las aceptadas entran en la
// redacción de las próximas memorias.
import { Check, X } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { textoAlcance, textoLeccionesEnCurso } from '../../../lib/memoriaFormato';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Subtitulo } from '../../comun/listas';
import { Aviso, Boton, Chip } from '../../ui';
import RelanzarTrabajo from '../RelanzarTrabajo';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };

function Leccion({ l, onDecidir }) {
  return (
    <li style={{ ...texto, padding: '8px 0', borderTop: `1px solid ${BORDE}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip tono={l.alcance === 'general' ? 'neutro' : 'riesgo'} punto={false}>
          {textoAlcance(l)}
        </Chip>
        {l.estado === 'aceptada' && (
          <Chip tono="ok" punto={false}>
            Aceptada: Hermes la aplica
          </Chip>
        )}
      </div>
      <div style={{ marginTop: 4 }}>{l.texto}</div>
      {l.evidencias?.[0]?.texto && (
        <div style={{ ...apagado, marginTop: 2, fontStyle: 'italic' }}>{l.evidencias[0].texto}</div>
      )}
      {l.estado === 'pendiente' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Boton
            Icono={Check}
            onClick={() => onDecidir(l.id, 'aceptar')}
            title="Hermes la tendrá en cuenta al redactar las próximas memorias"
          >
            Aceptar
          </Boton>
          <Boton Icono={X} onClick={() => onDecidir(l.id, 'descartar')} title="No es una lección útil: se olvida">
            Descartar
          </Boton>
        </div>
      )}
    </li>
  );
}

/** m: una versión subida a mano (con notas_subida, lecciones y lecciones_en_curso). */
export default function Lecciones({ id, m, onCambio }) {
  const [aviso, hacer] = useAccionAviso(onCambio);
  const decidir = (leccion, decision) =>
    hacer(
      () => licitacionesApi.revisarLeccion(id, leccion, decision),
      decision === 'aceptar' ? 'Lección aceptada: Hermes la aplicará.' : 'Lección descartada.',
    );
  const enCurso = textoLeccionesEnCurso(m);
  if (!m.notas_subida && !enCurso && !m.lecciones?.length) return null;
  return (
    <section aria-label="Lo que Hermes aprende de tus cambios" style={{ marginTop: 10 }}>
      <Subtitulo>Lo que Hermes aprende de tus cambios</Subtitulo>
      {m.notas_subida && (
        <blockquote
          style={{
            ...texto,
            color: TINTA_2,
            margin: '0 0 6px',
            paddingLeft: 10,
            borderLeft: `2px solid ${BORDE}`,
            whiteSpace: 'pre-wrap',
          }}
        >
          {m.notas_subida}
        </blockquote>
      )}
      {enCurso && (
        <div role="status" style={{ ...texto, color: TINTA_2 }}>
          {enCurso} <RelanzarTrabajo id={id} tipo="lecciones" onHecho={onCambio} />
        </div>
      )}
      {m.lecciones?.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {m.lecciones.map((l) => (
            <Leccion key={l.id} l={l} onDecidir={decidir} />
          ))}
        </ul>
      )}
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </section>
  );
}
