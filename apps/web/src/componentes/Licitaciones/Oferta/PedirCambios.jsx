// «Pedir cambios» sobre una versión ensamblada: lo que quieres que cambie (manda sobre la
// evaluación de Hermes) y qué apartados se rehacen; el resto se copia tal cual en la versión
// siguiente. Por defecto van marcados los que la evaluación deja por debajo de su tramo máximo.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, RIESGO, RADIUS, TIPO, alpha } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { plural } from '../../../lib/formato';
import {
  apartadosMejorablesIniciales,
  enumerar,
  filasApartados,
  leerApartadosMejorar,
  leerIndicaciones,
  motivoNoMejorar,
  textoArriba,
  versionSiguiente,
} from '../../../lib/memoriaFormato';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Aviso, Boton } from '../../ui';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };

function Casillas({ m, elegidos, alternar }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '10px 0 0' }}>
      <legend style={{ ...texto, fontWeight: 600, padding: 0, marginBottom: 4 }}>2. Apartados que Hermes rehace</legend>
      {filasApartados(m).map((a) => (
        <label key={a.apartado} style={{ ...texto, display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
          <input type="checkbox" checked={elegidos.includes(a.apartado)} onChange={() => alternar(a.apartado)} />
          <span style={{ flex: '1 1 auto' }}>
            {a.apartado}. {a.titulo}
          </span>
          {a.nota && (
            <span
              className="tabular-nums"
              style={{ color: a.nota.mejorable ? RIESGO : TINTA_2, fontSize: TIPO.pequeno }}
            >
              {a.nota.texto}
            </span>
          )}
        </label>
      ))}
      <div style={{ ...apagado, marginTop: 2 }}>Los que no marques se copian tal cual de la v{m.version}.</div>
    </fieldset>
  );
}

/**
 * m: la versión de partida; onCerrar: cierra el panel sin crear nada; onAviso: dónde decir «Hermes rehace…», fuera de lo que se vuelve a montar con la versión nueva.
 * inicial: lo precargado ({ indicaciones, apartados }) desde una fuga o desde «Otra ronda con estos motivos» (los apartados con fuga,
 * fallidos o flojos y la cita de cada fuga); sin él, los mejorables de la evaluación.
 */
export default function PedirCambios({ id, m, o, onCambio, onCerrar, onAviso, inicial = null }) {
  const [elegidos, setElegidos] = useState(() => inicial?.apartados ?? apartadosMejorablesIniciales(m));
  const [notas, setNotas] = useState(inicial?.indicaciones ?? '');
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const ind = leerIndicaciones(notas);
  const motivo =
    motivoNoMejorar(m, o, Boolean(ind.indicaciones)) ??
    ind.error ??
    (elegidos.length ? null : 'Marca al menos un apartado.');
  const siguiente = versionSiguiente(o?.memorias ?? []);
  const alternar = (n) => setElegidos((xs) => (xs.includes(n) ? xs.filter((x) => x !== n) : [...xs, n]));
  const enviar = () => {
    const r = leerApartadosMejorar(elegidos, m);
    if (r.error || ind.error) return;
    const hecho = (res) =>
      `Hermes rehace ${r.apartados.length === 1 ? `el apartado ${r.apartados[0]}` : `los apartados ${enumerar(r.apartados)}`} en la v${res?.version ?? siguiente}; el resto se copia de la v${m.version}.`;
    hacer(
      () => licitacionesApi.mejorarMemoria(id, m.version, r.apartados, ind.indicaciones),
      textoArriba(onAviso, hecho),
    );
  };
  return (
    <section
      aria-label={`Pedir cambios sobre la v${m.version}`}
      data-testid="memoria-pedir-cambios"
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: RADIUS,
        border: `1px solid ${alpha(ACCION, 0.45)}`,
        background: alpha(ACCION, 0.05),
      }}
    >
      <label htmlFor={`cambios-${m.id}`} style={{ ...texto, fontWeight: 600, display: 'block', marginBottom: 4 }}>
        1. ¿Qué quieres que cambie?
      </label>
      <textarea
        id={`cambios-${m.id}`}
        data-testid="memoria-pedir-cambios-indicaciones"
        className="input-field"
        rows={5}
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        autoFocus
        placeholder={
          'Escribe como se lo dirías a quien redacta. Por ejemplo:\n· Ana es la responsable del proyecto en todo el texto.\n· Menos condicionales: compromisos firmes con plazo.\n· Dibuja la arquitectura y las pantallas como figuras.'
        }
        style={{ width: '100%', resize: 'vertical' }}
      />
      <div style={apagado}>Opcional si Hermes ya la evaluó; tus indicaciones mandan sobre su evaluación.</div>
      <Casillas m={m} elegidos={elegidos} alternar={alternar} />
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: 10,
          paddingTop: 10,
          borderTop: `1px solid ${BORDE}`,
        }}
      >
        <Boton
          Icono={Sparkles}
          variante="principal"
          disabled={Boolean(motivo)}
          cargando={ocupado}
          onClick={enviar}
          title={
            motivo ??
            'Hermes rehace los apartados marcados con su texto anterior, tus indicaciones y la evaluación, y un crítico ciego puntúa la versión nueva'
          }
        >
          Crear la v{siguiente} ({plural(elegidos.length, 'apartado')} a rehacer)
        </Boton>
        <Boton onClick={onCerrar}>Cancelar</Boton>
        {motivo && <span style={{ ...apagado, flex: '1 1 200px' }}>{motivo}</span>}
      </div>
      {aviso?.texto && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </section>
  );
}
