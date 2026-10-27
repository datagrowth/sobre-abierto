// Pipeline y Oportunidades: las dos pantallas de trabajo de Licitaciones. Las dos
// leen el estado del radar (avisos de ingesta y de Hermes, y la «versión» que sube con los
// eventos) y abren la ficha en su página.
import { RefreshCw, Sparkles } from 'lucide-react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { alertasDeEstado } from '../../lib/alertas';
import { textoIngesta } from '../../lib/licitacionesFormato';
import useAcciones from '../../hooks/useAcciones';
import useEstadoDominio from '../../hooks/useEstadoDominio';
import useRuta from '../../hooks/useRuta';
import PanelDominio from '../comun/PanelDominio';
import { BotonAccion, MensajeAccion } from '../comun/acciones';
import OportunidadesVista from './OportunidadesVista';
import PropuestasVista from './PropuestasVista';
import PipelineVista from './PipelineVista';

const VISTAS_PIPELINE = [
  { key: 'tablero', label: 'Tablero' },
  { key: 'lista', label: 'Lista' },
  { key: 'presentadas', label: 'Presentadas' },
];

function useRadar() {
  const ruta = useRuta();
  const { estado, version, cargarEstado } = useEstadoDominio(licitacionesApi.estado, 'licitacion');
  const acciones = useAcciones(cargarEstado);
  return {
    ruta,
    estado,
    version,
    acciones,
    alertas: alertasDeEstado(estado),
    abrir: (id) => ruta.ir('licitacion', null, id),
    verEstado: () => ruta.ir('ajustes', 'fuentes', 'estado'),
    cribar: () => acciones.ejecutar('cribar', licitacionesApi.cribar, 'Criba enviada a Hermes.'),
  };
}

export function PipelinePanel() {
  const r = useRadar();
  const vista = VISTAS_PIPELINE.some((v) => v.key === r.ruta.vista) ? r.ruta.vista : 'tablero';
  return (
    <PanelDominio
      titulo="Pipeline"
      subtitulo="las ofertas en curso; en cada columna, por fecha de cierre. Presentada, En evaluación y Resuelta se mueven solas con la PLACSP"
      vistas={VISTAS_PIPELINE}
      vista={vista}
      onVista={(v) => r.ruta.irVista(v === 'tablero' ? null : v)}
      alertas={r.alertas}
      onVerEstado={r.verEstado}
    >
      {vista !== 'presentadas' && (
        <PipelineVista
          version={r.version}
          vista={vista}
          estado={r.estado}
          onAbrir={r.abrir}
          onRevisar={() => r.ruta.ir('oportunidades')}
          onIr={r.ruta.ir}
        />
      )}
      {vista === 'presentadas' && (
        <PropuestasVista
          version={r.version}
          inicial={r.ruta.id}
          onElegir={(id) => r.ruta.irVista('presentadas', id)}
          onVerCompetidor={(nif) => r.ruta.ir('mercado', 'competidores', nif)}
          onVerOrganismo={(nif) => r.ruta.ir('mercado', 'organismos', nif)}
        />
      )}
    </PanelDominio>
  );
}

export function OportunidadesPanel() {
  const r = useRadar();
  const ingesta = r.estado ? textoIngesta(r.estado).valor : null;
  const acciones = (
    <>
      <MensajeAccion mensaje={r.acciones.mensaje} />
      <BotonAccion
        clave="sync"
        acciones={r.acciones}
        Icono={RefreshCw}
        onClick={() =>
          r.acciones.ejecutar(
            'sync',
            licitacionesApi.sincronizar,
            'Sincronización pedida: las novedades llegan en unos minutos.',
          )
        }
      >
        Sincronizar
      </BotonAccion>
      <BotonAccion
        clave="cribar"
        acciones={r.acciones}
        Icono={Sparkles}
        title="Agrupa las candidatas sin cribar y se las manda a Hermes ya"
        onClick={r.cribar}
      >
        Cribar ahora
      </BotonAccion>
    </>
  );
  return (
    <PanelDominio
      titulo="Oportunidades"
      subtitulo="las que aún no están en el Pipeline, por fecha de cierre: la más cercana, primero. Lo que descarta Hermes va a Descartadas"
      estado={ingesta}
      acciones={acciones}
      alertas={r.alertas}
      onVerEstado={r.verEstado}
    >
      <OportunidadesVista
        version={r.version}
        pestana={r.ruta.vista}
        onPestana={(p) => r.ruta.irVista(p === 'por_revisar' ? null : p)}
        onAbrir={r.abrir}
        onAjustarFiltros={() => r.ruta.ir('ajustes', 'fuentes')}
      />
    </PanelDominio>
  );
}
