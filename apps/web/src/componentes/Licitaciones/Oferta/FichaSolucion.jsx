// Ficha de solución de una memoria: los parámetros de diseño que propone Hermes tras la
// estrategia (calendario, arquitectura, modelos, umbrales, dedicaciones, soporte…). Hermes no
// sabe cuáles podemos cumplir: aquí quien lleva la oferta los acepta o edita, y al aprobar
// empieza la redacción. Si nadie la revisa en 24 h, se redacta con lo propuesto y la ficha queda
// marcada como no revisada. Aprobada o vencida, se ve plegada con lo que se usó. Lo que impide
// aprobar se dice en pantalla, no solo en el «title» del botón: un botón deshabilitado no recibe
// el foco y en el móvil un «title» no se ve.
import { useState } from 'react';
import { Check, ClipboardCheck, Trash2, Undo2 } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, RIESGO, OK_TEXTO, RADIUS, TIPO, alpha } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { fechaHora } from '../../../lib/formato';
import {
  alternarCompromiso,
  compromisoQuitado,
  esCompromisoFicha,
  gruposFicha,
  leerRevisionFicha,
  MAX_VALOR_CAMPO,
  notasCampoFicha,
  textoEstadoFicha,
  textoEurosCompromiso,
} from '../../../lib/progresoMemoriaFormato';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Aviso, Boton, Chip } from '../../ui';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };

function Campos({ ficha, valores, onCambiar, soloLectura }) {
  return gruposFicha(ficha).map((g) => (
    <fieldset key={g.grupo} style={{ border: 'none', padding: 0, margin: '10px 0 0' }}>
      <legend style={{ ...texto, fontWeight: 600, padding: 0, marginBottom: 4 }}>{g.grupo}</legend>
      {g.campos.map((c) => {
        const id = `ficha-${c.clave}`;
        const cambiado = soloLectura
          ? ficha.editados.includes(c.clave)
          : (valores[c.clave] ?? c.valor).trim() !== c.valor;
        const notas = notasCampoFicha(c);
        const valor = valores[c.clave] ?? c.valor;
        const compromiso = esCompromisoFicha(c);
        const quitado = compromiso && compromisoQuitado(valor);
        const euros = textoEurosCompromiso(c);
        return (
          <div
            key={c.clave}
            style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '3px 0' }}
          >
            <label htmlFor={id} style={{ ...texto, color: TINTA_2, flex: '1 1 220px' }}>
              {c.etiqueta}
            </label>
            {soloLectura ? (
              <span id={id} style={{ ...texto, flex: '2 1 280px' }}>
                {c.valor}
              </span>
            ) : (
              <input
                id={id}
                className="input-field"
                value={valor}
                maxLength={MAX_VALOR_CAMPO}
                aria-describedby={notas.length ? `${id}-notas` : undefined}
                onChange={(e) => onCambiar(c.clave, e.target.value)}
                style={{ flex: '2 1 280px', minWidth: 0 }}
              />
            )}
            {compromiso && !soloLectura && (
              <Boton
                Icono={quitado ? Undo2 : Trash2}
                onClick={() => onCambiar(c.clave, alternarCompromiso(valor))}
                title={quitado ? 'La memoria lo comprometerá' : 'La memoria no lo comprometerá'}
              >
                {quitado ? 'Mantener' : 'Quitar'}
              </Boton>
            )}
            {quitado && <Chip>Quitado: no se redacta</Chip>}
            {cambiado && !quitado && (
              <Chip tono="ok" punto={false} title={`Hermes proponía «${c.propuesto}»`}>
                Cambiado
              </Chip>
            )}
            {euros && !quitado && (
              <Chip title="Horas propuestas × precio por hora de la configuración. Solo lo ves tú: no llega a la memoria, que va sin precios">
                {euros}
              </Chip>
            )}
            {c.caro && !quitado && (
              <Chip tono="riesgo" punto={false}>
                Coste alto
              </Chip>
            )}
            {c.alerta && !c.caro && !quitado && (
              <Chip tono="riesgo" punto={false}>
                Comprobar
              </Chip>
            )}
            {soloLectura && ficha.no_revisados.includes(c.clave) && (
              <Chip tono="riesgo" punto={false}>
                Sin revisar
              </Chip>
            )}
            {notas.length > 0 && (
              <div id={`${id}-notas`} style={{ ...apagado, flexBasis: '100%' }}>
                {notas.join(' ')}
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  ));
}

function Pendiente({ id, m, ficha, onCambio }) {
  const [valores, setValores] = useState({});
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const r = leerRevisionFicha(ficha, valores);
  const aprobar = () => {
    if (r.error) return;
    hacer(
      () => licitacionesApi.revisarFichaSolucion(id, m.version, r.cuerpo),
      'Ficha aprobada: Hermes empieza a redactar con estos valores.',
    );
  };
  return (
    <section
      aria-label="Ficha de solución"
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: RADIUS,
        border: `1px solid ${alpha(ACCION, 0.45)}`,
        background: alpha(ACCION, 0.05),
      }}
    >
      <div style={{ ...texto, fontWeight: 600 }}>Ficha de solución: revisa lo que la memoria va a comprometer</div>
      <div style={{ ...apagado, marginTop: 2 }}>
        {textoEstadoFicha(ficha, fechaHora)} Cambia lo que no podamos cumplir; lo demás se acepta tal cual. Los
        compromisos añadidos cuestan dinero al ejecutar el contrato: mantenlos solo si compensan los puntos; si no,
        suavízalos (a petición, menos frecuencia, digital) o quítalos. En los campos con varias partes, sepáralas con «
        · »; si cambias el inicio, el resto del calendario se desplaza lo mismo.
      </div>
      <Campos ficha={ficha} valores={valores} onCambiar={(clave, v) => setValores((xs) => ({ ...xs, [clave]: v }))} />
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
          Icono={Check}
          variante="principal"
          escribe
          disabled={Boolean(r.error)}
          cargando={ocupado}
          onClick={aprobar}
          title={r.error ?? 'Queda con tu nombre y la hora, y Hermes empieza a redactar'}
        >
          Aprobar y redactar
        </Boton>
        {r.error && (
          <div role="status" aria-live="polite" style={{ ...texto, color: RIESGO, flexBasis: '100%' }}>
            {r.error}
          </div>
        )}
      </div>
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </section>
  );
}

/** La ficha de solución de una memoria (nada si no la tiene). */
export default function FichaSolucion({ id, m, onCambio }) {
  const ficha = m.progreso?.ficha;
  if (!ficha) return null;
  if (ficha.estado === 'pendiente' && m.progreso.fase === 'ficha')
    return <Pendiente key={m.id} id={id} m={m} ficha={ficha} onCambio={onCambio} />;
  const color = ficha.estado === 'aprobada' ? OK_TEXTO : RIESGO;
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ ...texto, color: TINTA_2, cursor: 'pointer' }}>
        <ClipboardCheck size={14} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6, color }} />
        Ficha de solución: {textoEstadoFicha(ficha, fechaHora)}
      </summary>
      <Campos ficha={ficha} valores={{}} soloLectura />
    </details>
  );
}
