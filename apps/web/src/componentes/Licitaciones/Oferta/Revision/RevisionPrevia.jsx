// Tarjeta «revisión previa» de la bandeja de revisión: lo que Hermes revisó del
// paquete antes del envío y las propuestas que dejó en las filas de las comprobaciones, con sus citas. Nada
// está aplicado: «Ir a la fila» lleva a la fila, donde una persona la aplica o la descarta.
import { BORDE, TINTA_2, TINTA, TIPO } from '../../../../lib/tema';
import { revisionApi } from '../../../../lib/revisionApi';
import { versionDeRevisionPrevia } from '../../../../lib/revisionFormato';
import { rutaComprobaciones } from '../../../../lib/rutas';
import { bloqueo as testidBloqueo } from '../../../../lib/idsPrueba';
import useCarga from '../../../../hooks/useCarga';
import { Aviso, Boton } from '../../../ui';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { ...texto, color: TINTA_2 };

const QUE_PROPONE = {
  desmarcar_criterio: 'Desmarcar un criterio',
  asignar_persona: 'Asignar a una persona',
  vincular_documento: 'Vincular un documento',
  consulta_organo: 'Consulta al órgano',
  borrador_anexo_xiv: 'Borrador del Anexo XIV',
};

// Dentro de las comprobaciones la fila ya está pintada: se lleva el foco; si no, se abren las comprobaciones en ella.
function irALaFila(id, clave) {
  const el = document.querySelector(`[data-testid="${CSS.escape(testidBloqueo(clave))}"]`);
  if (!el) {
    window.location.hash = rutaComprobaciones(id, clave);
    return;
  }
  el.scrollIntoView({ block: 'center' });
  el.focus?.();
}

function Cita({ c }) {
  const pagina = c.pagina === null || c.pagina === undefined ? '' : `, pág. ${c.pagina}`;
  return (
    <li style={apagado}>
      «{c.texto}» ({c.documento}
      {pagina})
    </li>
  );
}

function Propuesta({ id, p, onAbrir }) {
  const ir = () => {
    onAbrir?.();
    irALaFila(id, p.clave);
  };
  return (
    <li
      data-testid={`revision-previa-propuesta-${p.clave}`}
      style={{ padding: '6px 0', borderTop: `1px solid ${BORDE}`, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={texto}>
        <strong>{p.titulo ?? p.clave}</strong>
        {p.tipo && <span style={apagado}> · {QUE_PROPONE[p.tipo] ?? p.tipo}</span>}
      </div>
      {p.resumen && <div style={texto}>{p.resumen}</div>}
      {p.citas?.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {p.citas.map((c, i) => (
            <Cita key={`${c.documento}-${i}`} c={c} />
          ))}
        </ul>
      )}
      <div>
        <Boton testid={`revision-previa-ir-${p.clave}`} onClick={ir}>
          Ir a la fila
        </Boton>
      </div>
    </li>
  );
}

export default function RevisionPrevia({ id, tarjeta, onAbrir }) {
  // La de esta tarjeta: la última puede ser la de un paquete más nuevo aún sin terminar.
  const version = versionDeRevisionPrevia(tarjeta.clave);
  const c = useCarga(() => revisionApi.revisionPrevia(id, version), [id, version, tarjeta.huella]);
  const revision = c.data?.revision ?? null;
  const propuestas = c.data?.propuestas ?? [];
  return (
    <div data-testid="revision-previa" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>{tarjeta.titulo}</div>
      <div data-testid="revision-previa-resumen" style={apagado}>
        {revision?.resumen ?? tarjeta.resumen}
      </div>
      {revision?.ruta_md && <div style={apagado}>Informe en Salidas: {revision.ruta_md}</div>}
      {c.kind === 'error' && <Aviso tono="error">{c.message}</Aviso>}
      {c.data && propuestas.length === 0 && <div style={apagado}>Hermes no propuso cómo resolver ningún bloqueo.</div>}
      {propuestas.length > 0 && (
        <ul data-testid="revision-previa-propuestas" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {propuestas.map((p) => (
            <Propuesta key={p.clave} id={id} p={p} onAbrir={onAbrir} />
          ))}
        </ul>
      )}
      <div>
        <Boton testid={`abrir-${tarjeta.clave}`} onClick={onAbrir}>
          Marcar como vista
        </Boton>
      </div>
    </div>
  );
}
