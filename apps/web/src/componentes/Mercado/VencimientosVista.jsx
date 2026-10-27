// Mercado › Vencimientos: contratos de nuestro mercado que acaban en los próximos 12
// meses, con su adjudicatario, el fin estimado, cuándo se espera la nueva licitación y con qué
// confianza, y «Avisarme cuando salga»: la nueva entra en Oportunidades como «renovación que seguías».
import { useCallback, useEffect, useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { mesAnio, TEXTO_CONFIANZA_SALIDA, TONO_CONFIANZA, textoProrrogas, textoSalida } from '../../lib/mercadoFormato';
import { euros } from '../../lib/formato';
import { Aviso, Boton, Chip, Esqueleto, Tabla, Tarjeta } from '../ui';

function columnas(onAvisar, ocupado, onVerLicitacion) {
  return [
    {
      clave: 'titulo',
      titulo: 'Contrato',
      celda: (v) => (
        <span className="grid">
          <button
            type="button"
            className="text-left font-medium text-cuerpo text-tinta bg-transparent border-0 p-0 cursor-pointer hover:underline"
            onClick={() => onVerLicitacion(v.licitacion_id)}
            title={v.titulo}
          >
            {v.titulo}
            {v.lote ? ` · lote ${v.lote}` : ''}
          </button>
          <span className="text-leyenda text-tinta-2">{[v.organo, euros(v.importe)].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    {
      clave: 'adjudicatario',
      titulo: 'Adjudicatario actual',
      celda: (v) => v.adjudicatario ?? (v.adjudicatario_nif ? 'Persona física' : '—'),
    },
    {
      clave: 'fin_estimado',
      titulo: 'Fin estimado',
      celda: (v) => (
        <span className="grid tabular-nums">
          {mesAnio(v.fin_estimado)}
          <small className="text-leyenda text-tinta-2">{textoProrrogas(v)}</small>
        </span>
      ),
    },
    {
      clave: 'salida_esperada',
      titulo: 'Salida esperada',
      celda: (v) => (
        <span className="tabular-nums" title={textoSalida(v)}>
          {mesAnio(v.salida_esperada)}
        </span>
      ),
    },
    {
      clave: 'confianza',
      titulo: 'Confianza',
      celda: (v) => (
        <Chip tono={TONO_CONFIANZA[v.confianza]} title={textoSalida(v)}>
          {TEXTO_CONFIANZA_SALIDA[v.confianza]}
        </Chip>
      ),
    },
    {
      clave: 'avisar',
      titulo: <span className="sr-only">Aviso</span>,
      nitida: true,
      ancho: 130,
      celda: (v) => (
        <Boton
          tamano="pequeno"
          escribe
          variante={v.avisar ? 'texto' : undefined}
          cargando={ocupado === `${v.licitacion_id}|${v.lote}`}
          testid={`avisar-${v.licitacion_id}-${v.lote || 'contrato'}`}
          onClick={() => onAvisar(v)}
        >
          {v.avisar ? 'Avisando' : 'Avisarme'}
        </Boton>
      ),
    },
  ];
}

export default function VencimientosVista({ onVerLicitacion }) {
  const [carga, setCarga] = useState({ kind: 'loading' });
  const [ocupado, setOcupado] = useState(null);
  const [aviso, setAviso] = useState(null);
  const cargar = useCallback(
    () =>
      licitacionesApi.vencimientos().then(
        (data) => setCarga({ kind: 'ready', data }),
        (e) => setCarga({ kind: 'error', message: e.message }),
      ),
    [],
  );
  useEffect(() => {
    cargar();
  }, [cargar]);
  const avisar = async (v) => {
    setOcupado(`${v.licitacion_id}|${v.lote}`);
    try {
      await licitacionesApi.avisarRenovacion({ licitacion_id: v.licitacion_id, lote: v.lote }, !v.avisar);
      setAviso({
        tono: 'ok',
        texto: v.avisar
          ? 'Ya no te avisamos de este contrato.'
          : 'Cuando el órgano publique la nueva licitación, entrará en Oportunidades como «renovación que seguías».',
      });
      await cargar();
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setOcupado(null);
    }
  };
  return (
    <Tarjeta
      titulo="Contratos que vencen"
      subtitulo="los de tus CPV que acaban en los próximos 12 meses"
      testid="vencimientos"
    >
      {aviso && (
        <div className="mb-3">
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      {carga.kind === 'loading' && <Esqueleto lineas={4} />}
      {carga.kind === 'error' && <Aviso tono="error">{carga.message}</Aviso>}
      {carga.kind === 'ready' && (
        <Tabla
          columnas={columnas(avisar, ocupado, onVerLicitacion)}
          filas={carga.data.items}
          claveFila={(v) => `${v.licitacion_id}|${v.lote}`}
          etiqueta="Contratos que vencen"
          vacio="Ningún contrato de tu mercado acaba en los próximos 12 meses."
        />
      )}
    </Tarjeta>
  );
}
