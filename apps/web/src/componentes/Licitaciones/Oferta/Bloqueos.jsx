// «Qué impide presentar»: las filas abiertas agrupadas por categoría, en el orden fijo de las
// comprobaciones (bloqueosAbiertos). Cada problema sale una vez, con su clave. Con compromisos caros en
// la memoria, arriba va su total y «Suavizar todos»: una sola ronda de memoria
// con los apartados y las instrucciones de todas las filas, en vez de una ronda por fila.
import { useState } from 'react';
import { TINTA, TINTA_2, LIENZO, BORDE, RADIUS_PANEL, RIESGO } from '../../../lib/tema';
import {
  agruparPorCategoria,
  esFilaCompromiso,
  memoriaDeVersion,
  pedidosSuavizarTodos,
  puedeSuavizar,
  recuentoBloqueos,
  textoCompromisosAnadidos,
  textoRondaSuavizar,
} from '../../../lib/comprobacionesFormato';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { motivoNoMejorar, progresoMemoria } from '../../../lib/memoriaFormato';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Aviso, Boton } from '../../ui';
import Confirmacion from '../../comun/Confirmacion';
import FilaBloqueo from './FilaBloqueo';

// Las filas que se pueden suavizar ahora (memoria no presentada y sin otra ronda en marcha) y sus rondas.
function rondasParaSuavizar(filas, oferta) {
  const enCurso = (oferta?.memorias ?? []).some((m) => progresoMemoria(m).enCurso);
  const listas = filas.filter((b) => puedeSuavizar(b, memoriaDeVersion(oferta, b.coste?.memoria_version), enCurso));
  const pedidos = pedidosSuavizarTodos(listas);
  const motivo =
    pedidos.map((p) => motivoNoMejorar(memoriaDeVersion(oferta, p.version), oferta, true)).find(Boolean) ?? null;
  return { sueltas: listas.filter(esFilaCompromiso).length, pedidos, motivo };
}

function DetalleTodos({ pedidos }) {
  return pedidos.map((p) => (
    <div key={p.version} data-testid="suavizar-todos-detalle" style={{ marginTop: 4 }}>
      {pedidos.length > 1 ? `Memoria v${p.version}: ` : ''}
      {textoRondaSuavizar(p.apartados)}
      <blockquote
        style={{
          margin: '4px 0 0',
          paddingLeft: 8,
          borderLeft: `2px solid ${BORDE}`,
          color: TINTA,
          whiteSpace: 'pre-line',
        }}
      >
        {p.indicaciones}
      </blockquote>
    </div>
  ));
}

// Una ronda por versión de memoria (una sola, salvo memorias por lote), una detrás de otra.
function SuavizarTodos({ filas, idLicitacion, oferta, recargar }) {
  const [pide, setPide] = useState(false);
  const [aviso, hacer, ocupado] = useAccionAviso(recargar);
  const r = rondasParaSuavizar(filas, oferta);
  if (r.sueltas < 2 || !r.pedidos.length)
    return aviso?.tono === 'error' ? <Aviso tono="error">{aviso.texto}</Aviso> : null;
  const pedir = () => {
    setPide(false);
    hacer(async () => {
      for (const p of r.pedidos)
        await licitacionesApi.mejorarMemoria(idLicitacion, p.version, p.apartados, p.indicaciones);
    }, 'Hermes rehace la memoria con la formulación barata de todos los compromisos.');
  };
  if (pide)
    return (
      <Confirmacion
        pregunta={`¿Suavizar los ${r.sueltas} compromisos caros?`}
        detalle={<DetalleTodos pedidos={r.pedidos} />}
        textoSi="Suavizar todos"
        onSi={pedir}
        onNo={() => setPide(false)}
      />
    );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <Boton
        escribe
        testid="bloqueos-suavizar-todos"
        cargando={ocupado}
        disabled={Boolean(r.motivo)}
        title={r.motivo ?? undefined}
        onClick={() => setPide(true)}
      >
        Suavizar todos
      </Boton>
      {r.motivo && <span style={{ fontSize: 12, color: TINTA_2 }}>{r.motivo}</span>}
      {aviso?.tono === 'error' && <Aviso tono="error">{aviso.texto}</Aviso>}
    </div>
  );
}

function Compromisos({ filas, idLicitacion, oferta, recargar, soloLectura }) {
  const texto = textoCompromisosAnadidos(filas);
  if (!texto) return null;
  return (
    <div
      data-testid="bloqueos-compromisos"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}
    >
      <span data-testid="bloqueos-compromisos-total" style={{ fontSize: 12.5, color: RIESGO, fontWeight: 600 }}>
        {texto}
      </span>
      {!soloLectura && oferta && (
        <SuavizarTodos filas={filas} idLicitacion={idLicitacion} oferta={oferta} recargar={recargar} />
      )}
    </div>
  );
}

/** filas: las abiertas del modo; el resto de props pasa a cada FilaBloqueo. */
export default function Bloqueos({ filas, resaltada = null, ...fila }) {
  return (
    <section
      aria-label="Qué impide presentar"
      data-testid="bloqueos"
      style={{
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: TINTA }}>Qué impide presentar</h3>
        {filas.length > 0 && (
          <span data-testid="bloqueos-recuento" style={{ fontSize: 12.5, color: TINTA_2 }}>
            {recuentoBloqueos(filas)}
          </span>
        )}
      </div>
      <Compromisos filas={filas} {...fila} />
      {filas.length === 0 && (
        <div data-testid="bloqueos-vacio" style={{ fontSize: 13, color: TINTA_2 }}>
          Nada impide presentar.
        </div>
      )}
      {agruparPorCategoria(filas).map((g) => (
        <div key={g.categoria} data-testid={`bloqueos-categoria-${g.categoria}`} style={{ marginTop: 8 }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 12, color: TINTA_2, fontWeight: 600 }}>{g.etiqueta}</h4>
          <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.filas.map((b) => (
              <FilaBloqueo key={b.clave} b={b} resaltada={resaltada === b.clave} {...fila} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
