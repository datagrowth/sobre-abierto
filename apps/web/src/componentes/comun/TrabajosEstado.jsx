// Ajustes › Hermes para operar la cola de IA: trabajos por oferta con su título, fallos
// de los últimos 7 días con la causa en palabras y lo que lleva horas en cola sin salir, con
// «Cancelar» (a las 48 h se cancela solo). Se refresca cada 30 s mientras está a la vista.
import { useEffect, useState } from 'react';
import { XCircle } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, IMPIDE, RIESGO } from '../../lib/tema';
import { plataformaApi } from '../../lib/plataformaApi';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { fechaHora } from '../../lib/formato';
import { causaFallo, nombreTipoTrabajo } from '../../lib/licitacionesFormato';
import useCarga from '../../hooks/useCarga';
import { SectionCard } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton } from '../ui';
import Confirmacion from './Confirmacion';

const REFRESCO_MS = 30_000;
const celda = { padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' };
const numero = { ...celda, textAlign: 'right' };

// Solo Licitaciones sabe poner título a sus recursos; los demás se ven por su clave. /titulos
// acepta 50 ids: van primero los de la tabla por oferta.
const MAX_TITULOS = 50;
function idsDeLicitaciones(d) {
  const filas = [...(d?.por_oferta ?? []), ...(d?.fallos_recientes ?? []), ...(d?.sin_salir ?? [])];
  return [...new Set(filas.filter((f) => f.dominio === 'licitaciones' && f.recurso).map((f) => f.recurso))].slice(
    0,
    MAX_TITULOS,
  );
}

function useTitulos(ids) {
  const clave = ids.join(',');
  const t = useCarga(() => (ids.length ? licitacionesApi.titulos(ids) : Promise.resolve({})), [clave]);
  return t.kind === 'ready' ? t.data : {};
}

const tituloDe = (titulos, f) => (f.recurso ? (titulos[f.recurso] ?? f.recurso) : '—');

function PorOferta({ filas, titulos }) {
  if (!filas.length)
    return (
      <div style={{ fontSize: 12.5, color: TINTA_2 }}>
        Ninguna oferta con trabajos en marcha, en cola o fallidos esta semana.
      </div>
    );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        data-testid="trabajos-por-oferta"
        style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}
      >
        <thead>
          <tr style={{ color: TINTA_2 }}>
            {['Oferta', 'En marcha', 'En cola', 'Fallos (7 d)'].map((t, i) => (
              <th key={t} scope="col" style={i ? numero : celda}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr
              key={`${f.dominio}-${f.recurso}`}
              data-testid="trabajos-oferta-fila"
              style={{ borderTop: `1px solid ${BORDE}` }}
            >
              <td style={{ ...celda, whiteSpace: 'normal' }}>{tituloDe(titulos, f)}</td>
              <td className="tabular-nums" style={numero}>
                {f.en_marcha}
              </td>
              <td className="tabular-nums" style={numero}>
                {f.pendientes}
              </td>
              <td className="tabular-nums" style={{ ...numero, color: f.fallidos ? RIESGO : TINTA }}>
                {f.fallidos}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fallos({ filas, titulos }) {
  if (!filas.length) return <div style={{ fontSize: 12.5, color: TINTA_2 }}>Ningún fallo en los últimos 7 días.</div>;
  return (
    <ul data-testid="trabajos-fallos" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {filas.map((f) => (
        <li
          key={f.id}
          data-testid="trabajos-fallo"
          style={{ padding: '6px 0', borderTop: `1px solid ${BORDE}`, fontSize: 12.5, lineHeight: 1.5 }}
        >
          <div style={{ color: TINTA }}>
            {nombreTipoTrabajo(f.tipo)} · {tituloDe(titulos, f)}
          </div>
          <div style={{ color: IMPIDE }}>
            {causaFallo(f.codigo)} <span style={{ color: TINTA_2 }}>· {fechaHora(f.en)}</span>
          </div>
          {f.error && (
            <details style={{ color: TINTA_2 }}>
              <summary style={{ cursor: 'pointer' }}>Mensaje de Hermes</summary>
              <div style={{ overflowWrap: 'anywhere' }}>{f.error}</div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function FilaSinSalir({ t, titulo, onCancelado }) {
  const [preguntando, setPreguntando] = useState(false);
  const [error, setError] = useState(null);
  const cancelar = async () => {
    setPreguntando(false);
    try {
      await plataformaApi.cancelarTrabajo(t.id);
      onCancelado();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <li
      data-testid="trabajos-sin-salir-fila"
      style={{ padding: '6px 0', borderTop: `1px solid ${BORDE}`, fontSize: 12.5, lineHeight: 1.5 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: TINTA }}>
            {nombreTipoTrabajo(t.tipo)} · {titulo}
          </div>
          <div style={{ color: TINTA_2 }}>
            En cola desde el {fechaHora(t.creado_en)} · se cancela solo el {fechaHora(t.zombi_en)}
          </div>
        </div>
        {!preguntando && (
          <Boton Icono={XCircle} variante="peligro" testid="trabajos-cancelar" onClick={() => setPreguntando(true)}>
            Cancelar
          </Boton>
        )}
      </div>
      {preguntando && (
        <div style={{ marginTop: 6 }}>
          <Confirmacion
            pregunta="¿Cancelar este trabajo?"
            detalle="Sale de la cola sin gastar un run. Si hace falta, se puede volver a pedir desde la oferta."
            textoSi="Cancelar el trabajo"
            textoNo="No, dejarlo"
            destructiva
            onSi={cancelar}
            onNo={() => setPreguntando(false)}
          />
        </div>
      )}
      {error && <Aviso tono="error">{error}</Aviso>}
    </li>
  );
}

function SinSalir({ filas, titulos, onCancelado }) {
  if (!filas.length) return null;
  return (
    <SectionCard title="EN COLA SIN SALIR" right="más de 6 h sin lanzarse" style={{ flexBasis: '100%' }}>
      <div style={{ fontSize: 12.5, color: TINTA_2 }}>
        No han salido ni una vez: suele ser un perfil de Hermes apagado o un tope alcanzado. A las 48 h se cancelan
        solos.
      </div>
      <ul data-testid="trabajos-sin-salir" style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
        {filas.map((t) => (
          <FilaSinSalir key={t.id} t={t} titulo={tituloDe(titulos, t)} onCancelado={onCancelado} />
        ))}
      </ul>
    </SectionCard>
  );
}

const textoEstados = (e) =>
  Object.entries(e ?? {})
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ') || 'nada';

export default function TrabajosEstado() {
  const c = useCarga(() => plataformaApi.trabajosEstado(), []);
  const { recargar } = c;
  useEffect(() => {
    const t = setInterval(recargar, REFRESCO_MS);
    return () => clearInterval(t);
  }, [recargar]);
  const titulos = useTitulos(idsDeLicitaciones(c.data));
  if (c.kind === 'loading')
    return (
      <SectionCard title="TRABAJOS DE IA" style={{ flexBasis: '100%' }}>
        <div style={{ color: TINTA_2, fontSize: 12.5 }}>Cargando…</div>
      </SectionCard>
    );
  if (c.kind === 'error') return <Aviso tono="error">No se pudo leer la cola de IA: {c.message}</Aviso>;
  const d = c.data;
  return (
    <div data-testid="trabajos-estado" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionCard
        title="TRABAJOS DE IA POR OFERTA"
        right={`7 días: ${textoEstados(d.por_estado_7_dias)}`}
        style={{ flexBasis: '100%' }}
      >
        <PorOferta filas={d.por_oferta} titulos={titulos} />
      </SectionCard>
      <SectionCard
        title="FALLOS DE LOS ÚLTIMOS 7 DÍAS"
        right={d.fallos_recientes.length ? `los ${d.fallos_recientes.length} últimos` : null}
        style={{ flexBasis: '100%' }}
      >
        <Fallos filas={d.fallos_recientes} titulos={titulos} />
      </SectionCard>
      <SinSalir filas={d.sin_salir} titulos={titulos} onCancelado={recargar} />
    </div>
  );
}
