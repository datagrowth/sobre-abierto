// Mercado: Panorama de nuestro mercado, competidores, organismos, vencimientos con
// «Avisarme cuando salga» y «Qué nos falta». Saltar de una ficha a otra (adjudicatario, órgano,
// licitación) también queda en la ruta.
import { licitacionesApi } from '../../lib/licitacionesApi';
import useEstadoDominio from '../../hooks/useEstadoDominio';
import useRuta from '../../hooks/useRuta';
import PanelDominio from '../comun/PanelDominio';
import CompetidoresVista from '../Licitaciones/CompetidoresVista';
import OrganismosVista from '../Licitaciones/OrganismosVista';
import BarrerasVista from '../Licitaciones/BarrerasVista';
import PanoramaVista from './PanoramaVista';
import VencimientosVista from './VencimientosVista';

const VISTAS = [
  { key: 'panorama', label: 'Panorama' },
  { key: 'competidores', label: 'Competidores' },
  { key: 'organismos', label: 'Organismos' },
  { key: 'vencimientos', label: 'Vencimientos' },
  { key: 'que-nos-falta', label: 'Qué nos falta' },
];

export default function MercadoPanel() {
  const ruta = useRuta();
  const { version } = useEstadoDominio(licitacionesApi.estado, 'licitacion');
  const vista = VISTAS.some((v) => v.key === ruta.vista) ? ruta.vista : 'panorama';
  const verCompetidor = (nif) => ruta.ir('mercado', 'competidores', nif);
  const verOrganismo = (nif) => ruta.ir('mercado', 'organismos', nif);
  const verLicitacion = (id) => ruta.ir('licitacion', null, id);
  return (
    <PanelDominio
      titulo="Mercado"
      subtitulo="quién compra, quién gana, qué vence y qué nos falta para presentarnos"
      vistas={VISTAS}
      vista={vista}
      onVista={(v) => ruta.irVista(v)}
    >
      {vista === 'panorama' && <PanoramaVista />}
      {vista === 'competidores' && (
        <CompetidoresVista key={ruta.id ?? 'lista'} version={version} inicial={ruta.id} onVerOrganismo={verOrganismo} />
      )}
      {vista === 'organismos' && (
        <OrganismosVista key={ruta.id ?? 'lista'} version={version} inicial={ruta.id} onVerCompetidor={verCompetidor} />
      )}
      {vista === 'vencimientos' && <VencimientosVista onVerLicitacion={verLicitacion} />}
      {vista === 'que-nos-falta' && <BarrerasVista version={version} onVerOportunidad={verLicitacion} />}
    </PanelDominio>
  );
}
