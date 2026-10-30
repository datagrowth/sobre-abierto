// Aprendizaje: qué mejoramos en cada oferta, por qué, dónde se aplicó después y si
// sirvió. Por revisar (lecciones, porqués y actas que faltan, con la última comparación y el efecto
// al lado), Libro, Comparar y Efecto. La vista va en la ruta: #/aprendizaje/libro.
import { licitacionesApi } from '../../lib/licitacionesApi';
import { cuentaPorRevisar } from '../../lib/aprendizajeFormato';
import useCarga from '../../hooks/useCarga';
import useEstadoDominio from '../../hooks/useEstadoDominio';
import useRuta from '../../hooks/useRuta';
import PanelDominio from '../comun/PanelDominio';
import { Aviso, Esqueleto, Tarjeta } from '../ui';
import Comparar from './Comparar';
import { GraficoEfecto, UltimaComparacion } from './Graficos';
import Libro from './Libro';
import PorRevisar from './PorRevisar';

function vistasDe(d) {
  return [
    { key: 'por-revisar', label: 'Por revisar', cuenta: d ? cuentaPorRevisar(d.por_revisar) : undefined },
    { key: 'libro', label: 'Libro', cuenta: d?.libro.length },
    { key: 'comparar', label: 'Comparar' },
    { key: 'efecto', label: 'Efecto' },
  ];
}

function Efecto({ efecto }) {
  return (
    <div data-testid="aprendizaje-efecto" className="grid gap-3 lg:grid-cols-2 items-start">
      <GraficoEfecto efecto={efecto} />
      <Tarjeta titulo="Tasa de éxito por trimestre" subtitulo="ganadas sobre resueltas" testid="tasa-trimestre">
        {efecto.trimestres.length === 0 ? (
          <p className="text-tabla text-tinta-2 m-0">Aún no hay ofertas resueltas.</p>
        ) : (
          <table className="w-full text-tabla text-tinta tabular-nums">
            <thead>
              <tr className="text-leyenda text-tinta-2">
                <th className="text-left font-bold py-1">Trimestre</th>
                <th className="text-right font-bold">Ganadas</th>
                <th className="text-right font-bold">Perdidas</th>
                <th className="text-right font-bold">Éxito</th>
              </tr>
            </thead>
            <tbody>
              {efecto.trimestres.map((t) => (
                <tr key={t.trimestre} className="border-t border-borde">
                  <td className="py-1">{t.trimestre.replace('-T', ' · T')}</td>
                  <td className="text-right">{t.ganadas}</td>
                  <td className="text-right">{t.perdidas}</td>
                  <td className="text-right">{t.tasa} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  );
}

export default function AprendizajePanel() {
  const ruta = useRuta();
  const { version } = useEstadoDominio(licitacionesApi.estado, 'licitacion');
  const carga = useCarga(() => licitacionesApi.aprendizaje(), [], version);
  const d = carga.kind === 'ready' ? carga.data : null;
  const vistas = vistasDe(d);
  const vista = vistas.some((v) => v.key === ruta.vista) ? ruta.vista : 'por-revisar';
  const abrir = (id) => ruta.ir('licitacion', null, id);
  return (
    <PanelDominio
      titulo="Aprendizaje"
      subtitulo="qué mejoramos en cada oferta, por qué, dónde se aplicó después y si sirvió"
      vistas={vistas}
      vista={vista}
      onVista={(v) => ruta.irVista(v)}
    >
      {carga.kind === 'loading' && <Esqueleto lineas={6} />}
      {carga.kind === 'error' && <Aviso tono="error">{carga.message}</Aviso>}
      {d && vista === 'por-revisar' && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
          <PorRevisar p={d.por_revisar} onCambio={carga.recargar} onAbrir={abrir} />
          <div className="grid gap-3 min-w-0">
            <UltimaComparacion c={d.comparaciones[0]} />
            <GraficoEfecto efecto={d.efecto} testid="efecto-resumen" />
          </div>
        </div>
      )}
      {d && vista === 'libro' && <Libro libro={d.libro} onCambio={carga.recargar} />}
      {d && vista === 'comparar' && <Comparar comparaciones={d.comparaciones} />}
      {d && vista === 'efecto' && <Efecto efecto={d.efecto} />}
    </PanelDominio>
  );
}
