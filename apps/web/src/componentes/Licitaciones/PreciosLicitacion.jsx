// Escenarios de oferta de la ficha (Mercado): para cada baja (las del histórico y la que escribe la
// persona), el importe, en cuántas adjudicaciones parecidas se ganó con esa baja o menos y si sería
// anormal con el umbral del pliego o el art. 85. Las cifras del mercado (baja y ofertas esperadas,
// comparables) no van aquí: son las de los índices, arriba, para no enseñar dos muestras.
import { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, alpha } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { euros } from '../../lib/formato';
import {
  ETIQUETAS_PERCENTIL,
  cabeceraEscenarios,
  eurosPorUnidad,
  leerBaja,
  leerOfertas,
  porcentaje,
  textoProporcion,
  textoUmbral,
} from '../../lib/preciosFormato';
import { Aviso, Boton, Chip } from '../ui';
import { Bloque } from '../comun/ui';

const celda = { padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap' };
const numero = { ...celda, textAlign: 'right' };

function Subtitulo({ children }) {
  return (
    <h4
      style={{
        fontSize: 11.5,
        color: TINTA_2,
        fontWeight: 600,
        letterSpacing: '0.06em',
        margin: '14px 0 6px',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </h4>
  );
}

function Tabla({ titulo, cabecera, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}>
        {titulo && (
          <caption style={{ textAlign: 'left', fontSize: 11.5, color: TINTA_2, paddingBottom: 4 }}>{titulo}</caption>
        )}
        <thead>
          <tr style={{ color: TINTA_2 }}>
            {cabecera.map(([t, alinear]) => (
              <th key={t} scope="col" style={alinear === 'd' ? numero : celda}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function FilaEscenario({ f, n, unidad }) {
  return (
    <tr
      data-testid={`escenario-${f.etiqueta}`}
      style={{
        borderTop: `1px solid ${BORDE}`,
        background: f.etiqueta === 'propuesta' ? alpha(ACCION, 0.06) : 'transparent',
      }}
    >
      <th scope="row" style={{ ...celda, fontWeight: f.etiqueta === 'propuesta' ? 700 : 500 }}>
        {ETIQUETAS_PERCENTIL[f.etiqueta] ?? f.etiqueta}
      </th>
      <td className="tabular-nums" style={numero}>
        {porcentaje(f.baja)}
      </td>
      <td className="tabular-nums" style={numero}>
        {euros(f.importe)}
      </td>
      {unidad && (
        <td className="tabular-nums" style={numero}>
          {eurosPorUnidad(f.importe_unidad)}
        </td>
      )}
      <td className="tabular-nums" style={numero}>
        {textoProporcion(f.ganadas_con_menos, n)}
      </td>
      <td style={celda}>
        {f.anormal ? (
          <Chip tono="impide" punto={false}>
            posible anormal
          </Chip>
        ) : (
          <Chip tono="ok" punto={false}>
            normal
          </Chip>
        )}
      </td>
    </tr>
  );
}

function Formulario({ inicial, onCalcular }) {
  const [baja, setBaja] = useState(inicial.baja);
  const [ofertas, setOfertas] = useState(inicial.ofertas);
  const [mismoOrgano, setMismoOrgano] = useState(inicial.mismoOrgano);
  const [error, setError] = useState(null);
  const enviar = (e) => {
    e.preventDefault();
    const b = leerBaja(baja);
    const o = leerOfertas(ofertas);
    if (Number.isNaN(b)) return setError('La baja va de 0 a 95 (en %).');
    if (Number.isNaN(o)) return setError('Las ofertas esperadas son un número entero de 1 a 500.');
    setError(null);
    onCalcular({ baja, ofertas, mismoOrgano, bajas: b === null ? [] : [b], ofertasNum: o });
  };
  return (
    <form
      onSubmit={enviar}
      style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}
    >
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Tu baja (%)
        <input
          className="input-field"
          inputMode="decimal"
          value={baja}
          onChange={(e) => setBaja(e.target.value)}
          placeholder="p. ej. 12,5"
          style={{ display: 'block', width: 110, marginTop: 3 }}
        />
      </label>
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Ofertas esperadas
        <input
          className="input-field"
          inputMode="numeric"
          value={ofertas}
          onChange={(e) => setOfertas(e.target.value)}
          placeholder="mediana"
          style={{ display: 'block', width: 110, marginTop: 3 }}
        />
      </label>
      <label style={{ fontSize: 12, color: TINTA_2, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
        <input type="checkbox" checked={mismoOrgano} onChange={(e) => setMismoOrgano(e.target.checked)} /> Solo este
        órgano
      </label>
      <Boton Icono={Calculator} submit>
        Calcular
      </Boton>
      {error && (
        <div style={{ flexBasis: '100%' }}>
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
    </form>
  );
}

function Escenarios({ e, n, formulario }) {
  return (
    <>
      <Subtitulo>Escenarios de oferta</Subtitulo>
      {formulario}
      {e ? (
        <>
          <div data-testid="escenarios-precios" data-regla={e.regla}>
            <Tabla cabecera={cabeceraEscenarios(e)}>
              {e.filas.map((f) => (
                <FilaEscenario key={`${f.etiqueta}-${f.baja}`} f={f} n={n} unidad={e.unidad} />
              ))}
            </Tabla>
          </div>
          <div
            data-testid="umbral-escenarios"
            style={{ fontSize: 11.5, color: TINTA_2, marginTop: 6, lineHeight: 1.5 }}
          >
            {textoUmbral(e)} «Ganada con baja ≤» es en cuántas adjudicaciones parecidas el ganador ofertó esa baja o
            menos.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>
          Sin presupuesto o sin adjudicaciones parecidas no se pueden calcular escenarios.
        </div>
      )}
    </>
  );
}

const SIN_OPCIONES = { baja: '', ofertas: '', mismoOrgano: false, bajas: [], ofertasNum: null, lote: null };

// Las bajas del histórico son por lote: con lotes de interés se calcula para uno de ellos.
function LoteCalculado({ lote, interes = [], onElegir }) {
  if (!lote && !interes.length) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: 12.5,
        color: TINTA,
        marginBottom: 8,
      }}
    >
      {lote ? (
        <span>
          Para el <strong>lote {lote.id}</strong>
          {lote.nombre ? ` (${lote.nombre})` : ''} · {euros(lote.importe)}
        </span>
      ) : (
        <span>Para el contrato entero</span>
      )}
      {interes.length > 1 && (
        <label style={{ fontSize: 12, color: TINTA_2 }}>
          Lote de interés{' '}
          <select className="input-field" value={lote?.id ?? ''} onChange={(e) => onElegir(e.target.value)}>
            {interes.map((id) => (
              <option key={id} value={id}>
                Lote {id}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// Respuestas que llegan tarde (otra licitación u otras opciones) se ignoran.
function usePrecios(id, opciones, version) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    licitacionesApi
      .precios(id, {
        bajas: opciones.bajas,
        ofertas: opciones.ofertasNum,
        mismoOrgano: opciones.mismoOrgano,
        lote: opciones.lote,
      })
      .then(
        (datos) => vivo && setEstado({ kind: 'ready', datos }),
        (e) => vivo && setEstado({ kind: 'error', message: e.message }),
      );
    return () => {
      vivo = false;
    };
  }, [id, opciones, version]);
  return estado;
}

// «version» sube con los eventos licitacion*: el histórico puede haber crecido.
export default function PreciosLicitacion({ id, version }) {
  const [opciones, setOpciones] = useState(SIN_OPCIONES);
  const estado = usePrecios(id, opciones, version);

  if (estado.kind === 'loading')
    return (
      <Bloque titulo="ESCENARIOS DE OFERTA">
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>Calculando…</div>
      </Bloque>
    );
  if (estado.kind === 'error')
    return (
      <Bloque titulo="ESCENARIOS DE OFERTA">
        <Aviso tono="error">{estado.message}</Aviso>
      </Bloque>
    );
  const { estadistica, escenarios, nota, lote, lotes_interes: interes } = estado.datos;
  const cambiar = (o) => setOpciones((previas) => ({ ...previas, ...o }));
  return (
    <Bloque titulo="ESCENARIOS DE OFERTA">
      <LoteCalculado lote={lote} interes={interes} onElegir={(l) => cambiar({ lote: l })} />
      <Escenarios
        e={escenarios}
        n={estadistica.n}
        formulario={<Formulario inicial={opciones} onCalcular={cambiar} />}
      />
      <div style={{ fontSize: 11, color: TINTA_2, marginTop: 10, lineHeight: 1.5 }}>{nota}</div>
    </Bloque>
  );
}
