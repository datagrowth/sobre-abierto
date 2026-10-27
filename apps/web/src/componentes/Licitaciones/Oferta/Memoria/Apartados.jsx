// Una fila de la tabla de apartados de una versión: su estado, lo que puede subir y su texto, que se lee aquí.
import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { TINTA_2, BORDE, RIESGO, IMPIDE, RADIUS, TIPO } from '../../../../lib/tema';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { estadoApartado as reintentoApartado } from '../../../../lib/apartadosFormato';
import useCarga from '../../../../hooks/useCarga';
import { Aviso, Boton, Chip } from '../../../ui';
import { texto, apagado, anclaApartado } from './compartido';

const TONO_APARTADO = {
  recibido: 'ok',
  redactando: 'neutro',
  en_cola: 'neutro',
  rechazado: 'riesgo',
  fallido: 'impide',
  pendiente: 'neutro',
};

// Sin puntos: la autoevaluación de Hermes infla 6-8 y su nota no se enseña en ninguna pantalla.
const TITULO_PUEDE_SUBIR = 'La evaluación orientativa ve margen de mejora en este apartado';

// «Ver texto»: lo redactado del apartado, leído aquí mismo (sin descargar el Word ni salir de las comprobaciones).
function TextoApartado({ id, m, n }) {
  const carga = useCarga(() => licitacionesApi.apartadoTexto(id, m.version, n), [id, m.version, n]);
  if (carga.kind === 'error')
    return (
      <div style={{ marginTop: 6 }}>
        <Aviso tono="error">{carga.message}</Aviso>
      </div>
    );
  if (carga.kind === 'loading')
    return (
      <div role="status" style={{ ...apagado, marginTop: 6 }}>
        Cargando el texto…
      </div>
    );
  const t = carga.data;
  return (
    <div
      data-testid={`texto-apartado-${n}`}
      style={{
        marginTop: 6,
        padding: 10,
        borderRadius: RADIUS,
        border: `1px solid ${BORDE}`,
        maxHeight: 420,
        overflowY: 'auto',
      }}
    >
      {t.ronda > 0 && <div style={{ ...apagado, marginBottom: 4 }}>Ronda {t.ronda}</div>}
      <div style={{ ...texto, whiteSpace: 'pre-wrap' }}>{t.texto ?? 'Aún no hay texto de este apartado.'}</div>
    </div>
  );
}

// Un rechazo del revisor es un reintento de Hermes (gris); solo el fallo va en rojo.
function ChipApartado({ a, reintento }) {
  if (reintento)
    return (
      <Chip tono={reintento.tono === 'peligro' ? 'impide' : 'neutro'} punto={false}>
        {reintento.texto}
      </Chip>
    );
  const sinNovedad = a.chip.clave === 'recibido' && !a.avisos?.length;
  return sinNovedad ? null : (
    <Chip tono={TONO_APARTADO[a.chip.clave]} punto={false}>
      {a.chip.texto}
    </Chip>
  );
}

export default function FilaApartado({ id, m, a, valorable }) {
  const [leyendo, setLeyendo] = useState(false);
  const reintento = reintentoApartado(a);
  const error = reintento ? reintento.detalle : a.error;
  return (
    <li
      id={anclaApartado(m, a.apartado)}
      data-foco={`apartado.${a.apartado}`}
      data-testid="memoria-apartado"
      tabIndex={-1}
      style={{ ...texto, padding: '6px 0', borderTop: `1px solid ${BORDE}` }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 220px', fontWeight: 600 }}>
          {a.apartado}. {a.titulo}
        </span>
        {valorable && a.puntos != null && (
          <span className="tabular-nums" style={{ color: TINTA_2, fontSize: TIPO.pequeno }}>
            {a.puntos} pt
          </span>
        )}
        {/* De la autoevaluación solo queda lo accionable: qué apartado puede subir, sin su nota. */}
        {a.nota?.mejorable && (
          <span
            data-testid={`apartado-puede-subir-${a.apartado}`}
            title={TITULO_PUEDE_SUBIR}
            style={{ color: RIESGO, fontSize: TIPO.pequeno }}
          >
            Puede subir
          </span>
        )}
        <ChipApartado a={a} reintento={reintento} />
        {a.estado === 'recibido' && (
          <Boton Icono={BookOpen} testid={`ver-texto-${a.apartado}`} onClick={() => setLeyendo((x) => !x)}>
            {leyendo ? 'Ocultar texto' : 'Ver texto'}
          </Boton>
        )}
      </div>
      {error && <div style={{ color: reintento?.tono === 'neutro' ? TINTA_2 : IMPIDE, marginTop: 2 }}>{error}</div>}
      {a.avisos?.map((v) => (
        <div key={v} style={{ color: RIESGO, marginTop: 2 }}>
          {v}
        </div>
      ))}
      {leyendo && <TextoApartado id={id} m={m} n={a.apartado} />}
    </li>
  );
}
