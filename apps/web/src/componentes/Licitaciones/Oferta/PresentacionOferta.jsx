// Pestaña Presentación de una oferta ya presentada (presentada, ganada o perdida): la memoria
// (para subir la que se entregó y compararla), el registro de lo presentado con su resultado y
// puntuaciones cuando llegan, la carpeta de lo presentado en Conocimiento y las propuestas
// anteriores parecidas. Lo que se prepara antes de presentar vive en las comprobaciones.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, RIESGO, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { euros } from '../../../lib/formato';
import { porcentaje } from '../../../lib/preciosFormato';
import { textoCarpetaPresentada } from '../../../lib/licitacionesFormato';
import { loteParaRegistrar } from '../../../lib/presentacionFormato';
import { parecidasFuertes } from '../../../lib/propuestasFormato';
import { ChipResultado, Documentos, FormPresentacion, Presentada } from '../PropuestaRegistro';
import { Subtitulo } from '../../comun/listas';
import useCarga from '../../../hooks/useCarga';
import { Aviso, Boton } from '../../ui';
import { Bloque } from '../../comun/ui';
import AvisoRecarga from '../../comun/AvisoRecarga';
import MemoriaOferta from './MemoriaOferta';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };

function Parecidas({ items }) {
  const fuertes = parecidasFuertes(items);
  if (!fuertes.length) return null;
  return (
    <>
      <Subtitulo>Propuestas anteriores parecidas</Subtitulo>
      {fuertes.map((p) => (
        <div
          key={p.id}
          data-testid={`parecida-${p.licitacion_id ?? p.id}`}
          style={{ padding: '6px 0', borderTop: `1px solid ${BORDE}`, fontSize: TIPO.texto }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: TINTA }}>
            <ChipResultado resultado={p.resultado} />
            <span style={{ fontWeight: 600 }}>{p.titulo}</span>
            {p.lote && <span style={{ color: TINTA_2 }}>lote {p.lote}</span>}
          </div>
          <div style={{ color: TINTA_2, marginTop: 2 }}>
            {p.organo} · {p.presentada_en} · {euros(p.importe_ofertado)} (baja {porcentaje(p.baja_ofertada)})
            {p.puntos_total != null ? ` · ${p.puntos_total} puntos` : ''} · {p.motivos.join(', ')}
          </div>
          {p.carpeta && (
            <div style={{ color: TINTA_2, fontSize: TIPO.pequeno, overflowWrap: 'anywhere' }}>
              Carpeta: Conocimiento/{p.carpeta}/
            </div>
          )}
          <Documentos rutas={p.documentos} />
        </div>
      ))}
    </>
  );
}

function Registro({ f, o, d, onCambio }) {
  const [alta, setAlta] = useState(false);
  return (
    <>
      {d.propuestas.length === 0 && !alta && (
        <div style={{ ...texto, color: TINTA_2 }}>
          Aún no se ha registrado ninguna presentación. La firma y el envío en la PLACSP los hace siempre una persona.
        </div>
      )}
      {d.propuestas.map((p) => (
        <Presentada key={p.id} p={p} onCambio={onCambio} />
      ))}
      {d.carpeta_presentada && (
        <div
          style={{
            fontSize: TIPO.texto,
            color: d.carpeta_presentada.estado === 'error' ? RIESGO : TINTA_2,
            marginTop: 6,
            overflowWrap: 'anywhere',
          }}
        >
          {textoCarpetaPresentada(d.carpeta_presentada)}
        </div>
      )}
      {alta ? (
        <FormPresentacion
          id={f.id}
          candidatos={d.documentos}
          loteInicial={loteParaRegistrar(o?.decisiones ?? null, f.go_no_go?.ambito ?? null)}
          onHecho={() => {
            setAlta(false);
            onCambio();
          }}
          onCancelar={() => setAlta(false)}
        />
      ) : (
        <div style={{ marginTop: 8 }}>
          <Boton Icono={Plus} onClick={() => setAlta(true)} title="Al registrarla, la oportunidad pasa a Presentada">
            Registrar presentación
          </Boton>
        </div>
      )}
    </>
  );
}

/** Cada recurso se carga aparte: si uno falla, solo cae su bloque. */
function Cargado({ carga, children }) {
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  if (carga.kind === 'loading' || carga.data == null)
    return <div style={{ color: TINTA_2, fontSize: TIPO.texto }}>Cargando…</div>;
  return (
    <>
      <AvisoRecarga carga={carga} />
      {children(carga.data)}
    </>
  );
}

/** version sube con los eventos licitacion*: llegan solos el resultado y la memoria subida. */
export default function PresentacionOferta({ f, version, onCambio }) {
  const oferta = useCarga(() => licitacionesApi.oferta(f.id), [f.id], version);
  const propuesta = useCarga(() => licitacionesApi.propuesta(f.id), [f.id], version);
  const tras = () => {
    oferta.recargar();
    propuesta.recargar();
    onCambio();
  };
  return (
    <>
      <Bloque titulo="MEMORIA TÉCNICA">
        <Cargado carga={oferta}>
          {(o) => (
            <MemoriaOferta f={f} o={o} propuesta={propuesta.data ?? null} onCambio={tras} recargar={oferta.recargar} />
          )}
        </Cargado>
      </Bloque>
      <Bloque titulo="PRESENTACIÓN">
        <Cargado carga={propuesta}>
          {(d) => (
            <>
              <Registro f={f} o={oferta.data ?? null} d={d} onCambio={tras} />
              <Parecidas items={d.parecidas} />
            </>
          )}
        </Cargado>
      </Bloque>
    </>
  );
}
