// Paso 3: la memoria técnica. Elige qué se ve según el estado: sin memoria (redactarla o subir el Word),
// con memoria única (la versión actual, la de ensayo, el historial y «Más opciones») o con una por lote
// (PorLote). Las piezas están en Memoria/; aquí solo viven el sondeo mientras Hermes trabaja y el aviso
// que sobrevive al cambio de versión.
import { useEffect, useState } from 'react';
import { TINTA_2, BORDE } from '../../../lib/tema';
import { memoriasPorLote, progresoMemoria, sinMemoria, versionesDeLaVista } from '../../../lib/memoriaFormato';
import { Aviso } from '../../ui';
import SubirMemoriaPresentada from './SubirMemoriaPresentada';
import { texto } from './Memoria/compartido';
import VersionActual from './Memoria/VersionActual';
import Historial from './Memoria/Historial';
import Redactar from './Memoria/Redactar';
import SubirPrimera from './Memoria/SubirPrimera';
import MasOpciones from './Memoria/MasOpciones';
import MemoriasPorLote from './Memoria/PorLote';

/** o: la respuesta de /oferta; propuesta: la de /propuesta (null si falló: entonces no hay evaluación completa ni borradores antiguos). */
export default function MemoriaOferta({ f, o, propuesta, onCambio, recargar }) {
  const { actual, ensayo, anteriores } = versionesDeLaVista(o.memorias ?? []);
  // Aquí y no en VersionActual: al llegar la versión nueva se vuelve a montar (key) y lo borraría.
  const [avisoMemoria, setAvisoMemoria] = useState(null);
  const avisoArriba = avisoMemoria && (
    <div data-testid="memoria-aviso" style={{ marginBottom: 10 }}>
      <Aviso tono={avisoMemoria.tono}>{avisoMemoria.texto}</Aviso>
    </div>
  );
  // Con memoria por lote, las versiones vivas de todos los lotes.
  const vivas = o.memoria_lotes?.length
    ? memoriasPorLote(o).flatMap((g) => {
        const v = versionesDeLaVista(g.memorias);
        return [v.actual, v.ensayo];
      })
    : [actual, ensayo];
  const enCurso = vivas.some((m) => m && (progresoMemoria(m).enCurso || m.evaluacion_en_curso || m.lecciones_en_curso));
  // Sondeo mientras Hermes redacta o evalúa: los eventos llegan, pero un run puede tardar minutos.
  useEffect(() => {
    if (!enCurso) return undefined;
    const iv = setInterval(recargar, 15_000);
    return () => clearInterval(iv);
  }, [enCurso, recargar]);
  if (o.memoria_lotes?.length)
    return (
      <MemoriasPorLote
        f={f}
        o={o}
        propuesta={propuesta}
        onCambio={onCambio}
        aviso={avisoArriba}
        onAviso={setAvisoMemoria}
      />
    );
  if (sinMemoria(o.memorias ?? [])) {
    return (
      <>
        {avisoArriba}
        <SubirMemoriaPresentada id={f.id} o={o} onCambio={onCambio} />
        <p style={{ ...texto, color: TINTA_2, margin: '0 0 10px' }}>
          Aún no hay memoria. Con el guion y las decisiones, Hermes prepara el plan, redacta la memoria entera y un
          crítico ciego la puntúa; la plataforma monta el Word con la estructura literal del pliego.
        </p>
        <Redactar f={f} o={o} onCambio={onCambio} principal />
        {o.guion && <SubirPrimera id={f.id} o={o} onCambio={onCambio} onAviso={setAvisoMemoria} />}
      </>
    );
  }
  return (
    <>
      {avisoArriba}
      <SubirMemoriaPresentada id={f.id} o={o} onCambio={onCambio} />
      {actual && (
        <VersionActual
          key={actual.id}
          id={f.id}
          m={actual}
          o={o}
          evaluaciones={propuesta?.evaluaciones ?? []}
          onCambio={onCambio}
          onAviso={setAvisoMemoria}
        />
      )}
      {ensayo && (
        <div style={actual ? { marginTop: 14, paddingTop: 10, borderTop: `1px solid ${BORDE}` } : undefined}>
          <VersionActual
            key={ensayo.id}
            id={f.id}
            m={ensayo}
            o={o}
            evaluaciones={propuesta?.evaluaciones ?? []}
            onCambio={onCambio}
            onAviso={setAvisoMemoria}
          />
        </div>
      )}
      <Historial id={f.id} memorias={anteriores} o={o} actual={actual} onCambio={onCambio} onAviso={setAvisoMemoria} />
      <MasOpciones f={f} o={o} propuesta={propuesta} onCambio={onCambio} />
    </>
  );
}
