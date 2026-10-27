// Un apartado rehecho frente al de la versión de la que sale: lo quitado tachado y lo
// puesto subrayado, palabra a palabra, para leer solo lo que cambió y no el apartado entero.
// «Aceptar el cambio» no escribe nada: el texto nuevo ya está en la versión y entra al darla por
// buena. «Mantener el anterior» vuelve a poner el de la base y monta la versión sin IA (0 runs).
import { useState } from 'react';
import { BORDE, IMPIDE, TINTA_2, RADIUS, OK_TEXTO, TINTA, TIPO, alpha } from '../../../lib/tema';
import { diffPalabras, sinCambios } from '../../../lib/diffPalabras';
import { memoriaCambiosApi } from '../../../lib/memoriaCambiosApi';
import useCarga from '../../../hooks/useCarga';
import { Aviso, Boton } from '../../ui';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 };
const apagado = { fontSize: TIPO.texto, color: TINTA_2 };
const quita = { color: IMPIDE, background: alpha(IMPIDE, 0.12), textDecoration: 'line-through' };
const pone = { color: OK_TEXTO, background: alpha(OK_TEXTO, 0.12), textDecoration: 'underline' };

function Trozos({ trozos }) {
  return (
    <p style={texto}>
      {trozos.map((t, i) => {
        // El índice basta: los trozos no se reordenan, se vuelven a calcular enteros.
        if (t.tipo === 'quita')
          return (
            <del key={i} data-tipo="quita" style={quita}>
              {t.texto}
            </del>
          );
        if (t.tipo === 'pone')
          return (
            <ins key={i} data-tipo="pone" style={pone}>
              {t.texto}
            </ins>
          );
        return <span key={i}>{t.texto}</span>;
      })}
    </p>
  );
}

function Comparacion({ d }) {
  const r = diffPalabras(d.antes, d.despues);
  if (r.error) return <Aviso tono="aviso">{r.error}</Aviso>;
  if (sinCambios(r.data)) return <div style={apagado}>El texto quedó igual que en la versión anterior.</div>;
  return <Trozos trozos={r.data} />;
}

function Acciones({ n, puedeMantener, decision, ocupado, onAceptar, onMantener }) {
  if (decision === 'aceptado')
    return (
      <div data-testid={`cambio-aceptado-${n}`} style={{ ...apagado, color: OK_TEXTO }}>
        ✓ Cambio aceptado: entra al dar por buena la versión.
      </div>
    );
  if (decision === 'mantenido')
    return (
      <div data-testid={`anterior-mantenido-${n}`} style={{ ...apagado, color: OK_TEXTO }}>
        ✓ Vuelve el texto anterior. La versión se ha montado de nuevo sin Hermes.
      </div>
    );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Boton variante="principal" testid={`aceptar-cambio-${n}`} disabled={ocupado} onClick={onAceptar}>
        Aceptar el cambio
      </Boton>
      <Boton
        escribe
        testid={`mantener-anterior-${n}`}
        cargando={ocupado}
        disabled={!puedeMantener}
        onClick={onMantener}
        title={
          puedeMantener
            ? 'Vuelve a poner el texto anterior, sin Hermes (0 runs)'
            : 'Espera a que la versión esté montada'
        }
      >
        Mantener el anterior
      </Boton>
    </div>
  );
}

/**
 * id, version: la licitación y la versión nueva; n y titulo: el apartado. puedeMantener: la versión
 * está montada y sin dar por buena (el servidor rechaza lo demás). onCambio: tras mantener.
 */
export default function DiffApartado({ id, version, n, titulo, puedeMantener = true, onCambio }) {
  const d = useCarga(() => memoriaCambiosApi.diff(id, version, n), [id, version, n]);
  const [decision, setDecision] = useState(null);
  const [estado, setEstado] = useState({ ocupado: false, error: null });
  const mantener = async () => {
    setEstado({ ocupado: true, error: null });
    try {
      await memoriaCambiosApi.mantener(id, version, n);
      setDecision('mantenido');
      setEstado({ ocupado: false, error: null });
      onCambio?.();
    } catch (e) {
      setEstado({ ocupado: false, error: e.message });
    }
  };
  return (
    <section
      data-testid={`diff-apartado-${n}`}
      aria-label={`Cambios del apartado ${n}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        borderRadius: RADIUS,
        border: `1px solid ${BORDE}`,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>
        Apartado {n}
        {titulo ? ` · ${titulo}` : ''}
      </div>
      {d.kind === 'error' && <Aviso tono="error">{d.message}</Aviso>}
      {d.kind !== 'error' && !d.data && <div style={apagado}>Cargando el cambio…</div>}
      {d.data && decision !== 'mantenido' && <Comparacion d={d.data} />}
      {d.data && (
        <Acciones
          n={n}
          puedeMantener={puedeMantener}
          decision={decision}
          ocupado={estado.ocupado}
          onAceptar={() => setDecision('aceptado')}
          onMantener={mantener}
        />
      )}
      {estado.error && <Aviso tono="error">{estado.error}</Aviso>}
    </section>
  );
}
