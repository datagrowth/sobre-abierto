// «Si nos proponen»: lo que el pliego pide solo al propuesto como adjudicatario. No va en
// el checklist de la presentación; aquí se enseña con su cita y, ya presentada la oferta, las comprobaciones
// lo convierte en tareas.
import { TINTA, TINTA_2, TIPO } from '../../../lib/tema';
import { cita } from '../../../lib/ofertaFormato';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const plegable = { marginTop: 10 };
const resumen = { cursor: 'pointer', ...texto, fontWeight: 600 };

// Resumen del plegable: «Si nos proponen (2): Anexo VIII…, Anexo IX…».
function resumenSiNosProponen(docs) {
  const nombres = docs.map((d) => d.nombre).join(', ');
  return `Si nos proponen (${docs.length}): ${nombres}`;
}

export default function SiNosProponen({ docs }) {
  if (!docs?.length) return null;
  return (
    <details data-testid="si-nos-proponen" style={plegable}>
      <summary style={resumen}>{resumenSiNosProponen(docs)}</summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {docs.map((d) => (
          <li key={d.nombre} data-testid="si-nos-proponen-fila" style={texto}>
            <span style={{ fontWeight: 600 }}>{d.nombre}</span>
            {d.modelo && <span style={{ color: TINTA_2 }}> · modelo {d.modelo}</span>}
            <span style={{ color: TINTA_2 }}> · {d.cuando}</span>
            {cita(d) && <span style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}> · {cita(d)}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
