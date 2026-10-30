// La memoria cuando el pliego pide una por lote: un bloque por lote con su presentada, su versión y su historial.
import { TINTA, TINTA_2, BORDE } from '../../../../lib/tema';
import { fechaHora } from '../../../../lib/formato';
import {
  enumerar,
  memoriasPorLote,
  loteEntregado,
  sinMemoria,
  versionesDeLaVista,
  versionSiguiente,
} from '../../../../lib/memoriaFormato';
import { rutasPresentada } from '../../../../lib/memoriaPresentadaFormato';
import { Chip } from '../../../ui';
import Lecciones from '../Lecciones';
import SubirMemoriaPresentada, { BotonSubirPresentada } from '../SubirMemoriaPresentada';
import { texto, apagado, plegador, DESDE_CERO } from './compartido';
import EnlaceDoc from './EnlaceDoc';
import VersionActual from './VersionActual';
import Historial from './Historial';
import Redactar from './Redactar';
import SubirPrimera from './SubirPrimera';
import MasOpciones from './MasOpciones';

// «Más opciones» de un lote: empezar su memoria desde cero (las de los otros lotes no se tocan).
function MasOpcionesLote({ f, o, lote, onCambio }) {
  return (
    <details
      data-testid={`memoria-lote-${lote}-opciones`}
      style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDE}` }}
    >
      <summary style={plegador}>Más opciones del lote {lote}: empezar desde cero</summary>
      <div style={{ ...apagado, margin: '6px 0' }}>{DESDE_CERO}</div>
      <Redactar f={f} o={o} lote={lote} onCambio={onCambio} />
    </details>
  );
}

// La presentada del lote (la que se entregó): ni se revisa ni se mejora; las sustituidas, en su historial.
function PresentadaDeLote({ id, m, onCambio }) {
  return (
    <div data-testid={`memoria-presentada-lote-${m.lote}`} style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: TINTA }}>Memoria presentada v{m.version}</span>
        <Chip tono="ok" punto={false}>
          Presentada
        </Chip>
        <span style={apagado}>subida {fechaHora(m.pedida_en)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {rutasPresentada(m).map((r) => (
          <EnlaceDoc key={r} ruta={r} />
        ))}
      </div>
      <Lecciones id={id} m={m} onCambio={onCambio} />
    </div>
  );
}

const tituloGrupo = (g) =>
  g.lote
    ? `Memoria del lote ${g.lote}${g.nombre ? ` · ${g.nombre}` : ''}`
    : 'Memoria común (de antes de separarla por lotes)';

// Un lote sin memoria todavía: pedirla a Hermes o subir el Word ya escrito.
function LoteSinMemoria({ f, o, lote, onCambio, onAviso }) {
  return (
    <>
      <p style={{ ...texto, color: TINTA_2, margin: '0 0 6px' }}>Aún no hay memoria de este lote.</p>
      <Redactar f={f} o={o} lote={lote} onCambio={onCambio} principal />
      {o.guion && (
        <SubirPrimera
          id={f.id}
          o={o}
          siguiente={versionSiguiente(o.memorias)}
          lote={lote}
          onCambio={onCambio}
          onAviso={onAviso}
        />
      )}
    </>
  );
}

// Un lote con su memoria: la presentada (si la hay), la versión actual, la de ensayo, su historial y sus opciones.
// La común (g.lote null) solo sale si le quedan versiones: su presentada ya va arriba, en SubirMemoriaPresentada.
function MemoriaDeLote({ f, o, g, evaluaciones, onCambio, onAviso }) {
  const { actual, ensayo, anteriores } = versionesDeLaVista(g.memorias);
  const presentada = g.lote ? (g.memorias.find((m) => m.presentada) ?? null) : null;
  // Ya entregado (su presentada o la común): ni redactar otra ni empezar de cero; solo sustituirla.
  const entregado = g.lote ? loteEntregado(o, g.lote) : false;
  if (!g.lote && !actual && !ensayo && !anteriores.length) return null;
  const clave = g.lote ?? 'comun';
  const comun = { id: f.id, o, evaluaciones, onCambio, onAviso };
  return (
    <section
      data-testid={`memoria-lote-${clave}`}
      aria-label={g.lote ? `Memoria del lote ${g.lote}` : 'Memoria común'}
      style={{ marginTop: 14, paddingTop: 10, borderTop: `2px solid ${BORDE}` }}
    >
      <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: TINTA }}>{tituloGrupo(g)}</h3>
      {presentada && <PresentadaDeLote id={f.id} m={presentada} onCambio={onCambio} />}
      {g.lote && (
        <div style={{ margin: '8px 0' }}>
          <BotonSubirPresentada id={f.id} lote={g.lote} hay={Boolean(presentada)} onCambio={onCambio} />
        </div>
      )}
      {g.lote && !g.memorias.length && !entregado && (
        <LoteSinMemoria f={f} o={o} lote={g.lote} onCambio={onCambio} onAviso={onAviso} />
      )}
      {g.lote && !presentada && entregado && (
        <p data-testid={`memoria-lote-${g.lote}-entregada`} style={{ ...texto, color: TINTA_2, margin: '0 0 6px' }}>
          Entregada con la memoria común presentada: lo presentado no se rehace.
        </p>
      )}
      {actual && <VersionActual key={`${clave}-${actual.id}`} m={actual} {...comun} />}
      {ensayo && (
        <div style={actual ? { marginTop: 14, paddingTop: 10, borderTop: `1px solid ${BORDE}` } : undefined}>
          <VersionActual key={`${clave}-${ensayo.id}`} m={ensayo} {...comun} />
        </div>
      )}
      <Historial id={f.id} memorias={anteriores} o={o} actual={actual} onCambio={onCambio} onAviso={onAviso} />
      {g.lote && g.memorias.length > 0 && !entregado && (
        <MasOpcionesLote f={f} o={o} lote={g.lote} onCambio={onCambio} />
      )}
    </section>
  );
}

// Arriba solo la presentada común (vale para todos los lotes): la de cada lote va en su bloque.
const ofertaComun = (o) => ({ ...o, memorias: (o.memorias ?? []).filter((m) => (m.lote ?? null) === null) });

// El pliego pide una memoria por lote: un bloque por lote y, sin ninguna, un botón que las pide todas.
export default function MemoriasPorLote({ f, o, propuesta, onCambio, aviso, onAviso }) {
  const vacia = sinMemoria(o.memorias ?? []);
  return (
    <>
      {aviso}
      <SubirMemoriaPresentada id={f.id} o={ofertaComun(o)} porLotes onCambio={onCambio} />
      {vacia && (
        <p data-testid="memoria-por-lote-vacia" style={{ ...texto, color: TINTA_2, margin: '0 0 10px' }}>
          El pliego pide una memoria por lote: Hermes redacta una para cada lote ({enumerar(o.memoria_lotes)}).
        </p>
      )}
      {vacia && <Redactar f={f} o={o} onCambio={onCambio} principal />}
      {vacia && (
        <div data-testid="subir-presentada-lotes" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {o.memoria_lotes.map((l) => (
            <BotonSubirPresentada key={l} id={f.id} lote={l} onCambio={onCambio} />
          ))}
        </div>
      )}
      {!vacia &&
        memoriasPorLote(o, f.lotes ?? []).map((g) => (
          <MemoriaDeLote
            key={g.lote ?? 'comun'}
            f={f}
            o={o}
            g={g}
            evaluaciones={propuesta?.evaluaciones ?? []}
            onCambio={onCambio}
            onAviso={onAviso}
          />
        ))}
      <MasOpciones f={f} o={o} propuesta={propuesta} onCambio={onCambio} />
    </>
  );
}
