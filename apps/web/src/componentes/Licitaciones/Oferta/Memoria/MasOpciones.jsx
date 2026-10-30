// «Más opciones» de la memoria: empezar de cero, evaluar otro documento, borradores antiguos y la memoria de ensayo.
import { useState } from 'react';
import { FilePen, ScanSearch } from 'lucide-react';
import { BORDE } from '../../../../lib/tema';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { fechaHora } from '../../../../lib/formato';
import {
  borradoresSueltos,
  documentoParaEvaluar,
  ofrecerEnsayo,
  pideMotivoAlAceptar,
} from '../../../../lib/memoriaFormato';
import useAccionAviso from '../../../../hooks/useAccionAviso';
import EvaluacionPropuesta, { RevisionIa } from '../../EvaluacionPropuesta';
import { Documentos } from '../../PropuestaRegistro';
import { Subtitulo } from '../../../comun/listas';
import { Aviso, Boton } from '../../../ui';
import Confirmacion from '../../../comun/Confirmacion';
import { apagado, plegador, DESDE_CERO } from './compartido';
import Redactar from './Redactar';

// Aceptar un borrador de memoria con algo marcado pide motivo (400): se pide aquí, con lo que dijo
// el servidor, en vez de dejar el error a secas; lo marcado se ve en «Revisar lo que hizo Hermes».
function BorradorAntiguo({ b, hacer }) {
  const [pide, setPide] = useState(null);
  const decidir = (d, motivo) =>
    hacer(
      async () => {
        try {
          return await licitacionesApi.revisarBorrador(b.id, d, { motivo });
        } catch (e) {
          if (d === 'aceptar' && !motivo && pideMotivoAlAceptar(e)) {
            setPide(e.message);
            return null;
          }
          throw e;
        }
      },
      (r) =>
        r === null
          ? 'Falta el motivo para aceptarlo.'
          : d === 'aceptar'
            ? 'Borrador aceptado.'
            : 'Borrador descartado.',
    );
  return (
    <div style={{ padding: '6px 0', borderTop: `1px solid ${BORDE}` }}>
      <Documentos rutas={[b.ruta]} />
      <div style={apagado}>
        {b.agente} · {fechaHora(b.registrado_en)}
      </div>
      <div style={{ marginTop: 4 }}>
        <RevisionIa estado={b.estado} onDecidir={(d) => decidir(d)} />
      </div>
      {pide && (
        <div data-testid={`borrador-${b.id}-motivo`} style={{ marginTop: 6 }}>
          <Confirmacion
            pregunta="¿Aceptarlo con lo que queda marcado?"
            detalle={`${pide} Lo marcado se ve en «Revisar lo que hizo Hermes».`}
            textoSi="Aceptar con este motivo"
            conMotivo
            onSi={(motivo) => {
              setPide(null);
              decidir('aceptar', motivo);
            }}
            onNo={() => setPide(null)}
          />
        </div>
      )}
    </div>
  );
}

function BorradoresAntiguos({ items, onCambio }) {
  const [aviso, hacer] = useAccionAviso(onCambio);
  if (!items.length) return null;
  return (
    <>
      <Subtitulo>Borradores antiguos (escritos de una vez por Hermes)</Subtitulo>
      {items.map((b) => (
        <BorradorAntiguo key={b.id} b={b} hacer={hacer} />
      ))}
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </>
  );
}

// Evaluar cualquier otro documento (p. ej. una memoria escrita a mano o de otra oferta). Las
// evaluaciones de las versiones de la memoria ya se ven en su evaluación orientativa.
function EvaluarOtro({ id, d, inicial, deMemorias, onCambio }) {
  const [elegido, setElegido] = useState(inicial.elegido);
  const [otro, setOtro] = useState(inicial.otro);
  const [aviso, hacer] = useAccionAviso(onCambio);
  const documento = otro.trim() || elegido;
  const motivo = !d.ficha_aprobada
    ? 'Esta licitación aún no tiene ficha: Hermes evalúa con sus criterios.'
    : documento
      ? null
      : 'Elige un documento o escribe su ruta.';
  return (
    <>
      <Subtitulo>Evaluar otro documento con Hermes</Subtitulo>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {d.documentos.length > 0 && (
          <select
            className="input-field"
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
            aria-label="Documento a evaluar"
            style={{ maxWidth: '100%' }}
          >
            <option value="">Elige un documento…</option>
            {d.documentos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <input
          className="input-field"
          value={otro}
          onChange={(e) => setOtro(e.target.value)}
          placeholder="u otra ruta: Salidas/… o Conocimiento/…"
          aria-label="Otra ruta"
          style={{ flex: '1 1 240px' }}
        />
        <Boton
          Icono={ScanSearch}
          disabled={Boolean(motivo)}
          title={motivo ?? 'Puntúa criterio a criterio y dice qué quitar, cambiar y reforzar'}
          onClick={() =>
            hacer(
              () => licitacionesApi.evaluar(id, documento),
              'Hermes leerá el documento y dejará aquí su evaluación.',
            )
          }
        >
          Evaluar
        </Boton>
      </div>
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      {d.evaluaciones
        .filter((e) => !deMemorias.has(e.id))
        .map((e) => (
          <EvaluacionPropuesta
            key={e.id}
            evaluacion={e}
            onRevisar={(decision) =>
              hacer(
                () => licitacionesApi.revisarEvaluacion(e.id, decision),
                decision === 'aceptar' ? 'Evaluación aceptada.' : 'Evaluación descartada.',
              )
            }
          />
        ))}
    </>
  );
}

// Discreto: solo con el plazo vencido, para medir la memoria de Hermes contra la presentada.
function Ensayo({ f, o, onCambio }) {
  const [aviso, hacer] = useAccionAviso(onCambio);
  if (!ofrecerEnsayo(o, f.fecha_limite)) return null;
  const pedir = () => {
    if (
      !window.confirm(
        'La memoria de ensayo se redacta con plan y crítico para compararla con la presentada. No cambia lo presentado ni la memoria dada por buena, y sus archivos llevan «-ensayo». ¿Pedirla?',
      )
    )
      return;
    hacer(() => licitacionesApi.memoriaEnsayo(f.id), 'Hermes redacta la memoria de ensayo; el avance se ve arriba.');
  };
  return (
    <>
      <Subtitulo>Memoria de ensayo</Subtitulo>
      <div style={{ ...apagado, marginBottom: 6 }}>
        El plazo venció: puedes pedir una memoria de ensayo para compararla con la presentada. No se presenta ni se da
        por buena.
      </div>
      <Boton Icono={FilePen} onClick={pedir} title="Una memoria de ensayo, con sufijo «-ensayo» en Salidas">
        Memoria de ensayo
      </Boton>
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </>
  );
}

// Con memoria por lote, empezar desde cero va en las opciones de cada lote (MasOpcionesLote).
export default function MasOpciones({ f, o, propuesta, onCambio }) {
  const sueltos = borradoresSueltos(propuesta?.borradores ?? [], o.memorias);
  const inicial = documentoParaEvaluar([], propuesta?.documentos ?? []);
  const deMemorias = new Set(o.memorias.map((m) => m.evaluacion?.id).filter((x) => x != null));
  const desdeCero = !o.memoria_lotes?.length;
  return (
    <details style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDE}` }}>
      <summary style={plegador}>
        Más opciones: {desdeCero ? 'empezar desde cero, ' : ''}evaluar otro documento
        {sueltos.length ? ', borradores antiguos' : ''}
        {ofrecerEnsayo(o, f.fecha_limite) ? ', memoria de ensayo' : ''}
      </summary>
      {desdeCero && <Subtitulo>Empezar una memoria desde cero</Subtitulo>}
      {desdeCero && <div style={{ ...apagado, marginBottom: 6 }}>{DESDE_CERO}</div>}
      {desdeCero && <Redactar f={f} o={o} onCambio={onCambio} />}
      {propuesta && (
        <EvaluarOtro
          key={propuesta.documentos.join('|')}
          id={f.id}
          d={propuesta}
          inicial={inicial}
          deMemorias={deMemorias}
          onCambio={onCambio}
        />
      )}
      <BorradoresAntiguos items={sueltos} onCambio={onCambio} />
      <Ensayo f={f} o={o} onCambio={onCambio} />
    </details>
  );
}
