// La cabecera de la ficha: tres preguntas para decidir sin bajar. ¿Podemos? (el veredicto
// de las comprobaciones o el semáforo de requisitos), ¿Merece la pena? (competencia y baja esperadas con los
// cálculos de precios/, con su muestra y su confianza, y la opinión de Hermes) y ¿Llegamos? (el
// plazo peninsular, con la hora de Canarias si la empresa está allí, y el cierre interno). Los índices también se enseñan
// enteros en la pestaña Mercado (IndicesMercado).
import { preguntaLlegamos, preguntaMerece, preguntaPodemos, textoUnLicitador } from '../../lib/fichaFormato';
import { useState } from 'react';
import { porcentaje } from '../../lib/preciosFormato';
import { rutaFicha } from '../../lib/rutas';
import { clases } from '../../lib/uiFormato';
import { BarraRango, Chip, Indicador, LeyendaRango, Tabla } from '../ui';
import DescargarCsv from '../comun/DescargarCsv';
import { licitacionesApi } from '../../lib/licitacionesApi';

const TONOS = {
  ok: 'text-ok',
  riesgo: 'text-riesgo',
  impide: 'text-impide',
  hermes: 'text-tinta',
  neutro: 'text-tinta',
};

function Pregunta({ titulo, r, testid, estado }) {
  return (
    <div
      data-testid={testid}
      data-estado={estado ?? undefined}
      className="grid gap-1 content-start rounded-tarjeta border border-borde bg-lienzo px-4 py-3.5 min-w-0"
    >
      <span className="text-leyenda font-bold tracking-[0.14em] uppercase text-tinta-2">{titulo}</span>
      <span className={clases('text-bloque font-bold leading-snug tabular-nums', TONOS[r.tono] ?? 'text-tinta')}>
        {r.valor}
      </span>
      {r.detalle && <span className="text-tabla text-tinta-2 tabular-nums">{r.detalle}</span>}
    </div>
  );
}

/** f: la ficha; comprobaciones: la de la oferta si la hay; opinion: el texto de la opinión de Hermes. */
export default function TresPreguntas({ f, comprobaciones = null, opinion = null, indices }) {
  const podemos = preguntaPodemos(f, comprobaciones);
  const llegamos = preguntaLlegamos(f, comprobaciones);
  return (
    <div
      className="grid gap-3 mt-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
      data-testid="tres-preguntas"
    >
      <Pregunta titulo="¿Podemos?" r={podemos} testid={podemos.testid} estado={podemos.estado} />
      <Pregunta titulo="¿Merece la pena?" r={preguntaMerece(indices, opinion, f?.encaje)} testid="ficha-merece" />
      <Pregunta titulo="¿Llegamos?" r={llegamos} testid="ficha-indicador-plazo" estado={llegamos.estado} />
    </div>
  );
}

/** El órgano: qué parte de lo adjudicado en tu mercado en 3 años fue al primer adjudicatario. */
function Organo({ c }) {
  if (!c?.primero) return null;
  const quien = c.nombre_primero ?? (c.primero.nif ? 'un mismo adjudicatario' : 'una persona física');
  return (
    <Indicador
      titulo="Órgano"
      valor={porcentaje(c.primero.cuota)}
      testid="indice-organo"
      ayuda={`de lo adjudicado en tu mercado en 3 años (${c.contratos} ${c.contratos === 1 ? 'contrato' : 'contratos'}) fue a ${quien}. ${c.contratos < 4 ? 'Pocos contratos para hablar de concentración.' : `Concentración ${c.nivel}.`}${c.texto ? ` ${c.texto}.` : ''}`}
    />
  );
}

const COLUMNAS_LICITADORES = [
  {
    clave: 'nombre',
    titulo: 'Empresa',
    celda: (l) => <span className="font-bold">{l.nombre ?? (l.persona_fisica ? 'Persona física' : l.nif)}</span>,
  },
  { clave: 'evidencia', titulo: 'Evidencia', celda: (l) => l.evidencia.charAt(0).toUpperCase() + l.evidencia.slice(1) },
  { clave: 'baja_media', titulo: 'Baja media', alinear: 'derecha', celda: (l) => porcentaje(l.baja_media) },
];

const COLUMNAS_COMPARABLES = [
  {
    clave: 'titulo',
    titulo: 'Licitación',
    ordenable: true,
    valor: (c) => c.titulo ?? c.licitacion_id,
    celda: (c) => (
      <a href={rutaFicha(c.licitacion_id, 'mercado')} className="text-tinta hover:underline">
        {c.titulo ?? c.licitacion_id}
        {c.lote ? ` · lote ${c.lote}` : ''}
      </a>
    ),
  },
  {
    clave: 'organo',
    titulo: 'Órgano',
    ordenable: true,
    celda: (c) => (
      <span>
        {c.organo ?? '—'}
        {c.mismo_organo && (
          <>
            {' '}
            <Chip tono="ok">mismo órgano</Chip>
          </>
        )}
      </span>
    ),
  },
  { clave: 'fecha', titulo: 'Fecha', ordenable: true },
  { clave: 'ofertas', titulo: 'Ofertas', alinear: 'derecha', ordenable: true, celda: (c) => c.ofertas ?? '—' },
  { clave: 'baja', titulo: 'Baja', alinear: 'derecha', ordenable: true, celda: (c) => porcentaje(c.baja) },
  {
    clave: 'peso',
    titulo: 'Peso',
    alinear: 'derecha',
    ordenable: true,
    celda: (c) => c.peso.toLocaleString('es-ES', { maximumFractionDigits: 2 }),
  },
];

/** Las adjudicaciones con las que se calculan los índices (las de más peso), con enlace a cada una. */
function ComparablesIndice({ indices, id }) {
  const [orden, setOrden] = useState({ clave: 'peso', sentido: 'desc' });
  if (!indices.comparables.length) return null;
  const cuantas =
    indices.comparables.length < indices.n
      ? `las ${indices.comparables.length} de más peso de las ${indices.n}`
      : `las ${indices.n}`;
  return (
    <details className="rounded-tarjeta border border-borde bg-lienzo p-4" data-testid="comparables-indice">
      <summary className="cursor-pointer text-tabla font-bold text-tinta">
        Ver {cuantas} adjudicaciones comparables <small className="font-medium text-tinta-2">· {indices.muestra}</small>
      </summary>
      <div className="mt-3">
        <Tabla
          columnas={COLUMNAS_COMPARABLES}
          filas={indices.comparables}
          claveFila={(c) => `${c.licitacion_id}|${c.lote}`}
          orden={orden}
          onOrden={setOrden}
          etiqueta="Adjudicaciones comparables"
        />
        {id && (
          <div className="mt-3">
            <DescargarCsv pequeno url={licitacionesApi.csv.comparables(id)} testid="comparables-csv" />
          </div>
        )}
      </div>
    </details>
  );
}

/** Los índices enteros, arriba de la pestaña Mercado: competencia, baja con su barra P25-P75, órgano y licitadores probables. id: la licitación, para el CSV de comparables. */
export function IndicesMercado({ indices, id = null }) {
  if (!indices) return null;
  const fuente = `PLACSP${indices.muestra ? `, ${indices.muestra}` : ''}`;
  const unLicitador = indices.unLicitador === null ? null : textoUnLicitador(indices.unLicitador);
  return (
    <div className="grid gap-3" data-testid="indices-mercado">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <Indicador
          titulo="Ofertas esperadas"
          valor={indices.ofertas === null ? '—' : String(indices.ofertas).replace('.', ',')}
          n={indices.n}
          confianza={indices.confianza}
          fuente={fuente}
          testid="indice-ofertas"
          ayuda={[
            unLicitador ?? 'La mediana de ofertas en las adjudicaciones comparables. A más competencia, más baja.',
            indices.acierto.ofertas,
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <Indicador
          titulo="Baja esperada"
          valor={indices.baja}
          rango={indices.rango}
          n={indices.n}
          confianza={indices.confianza}
          fuente={fuente}
          testid="indice-baja"
          ayuda={[indices.textoUmbral, indices.acierto.baja].filter(Boolean).join(' ') || null}
        >
          <BarraRango
            p25={indices.p25}
            p50={indices.p50}
            p75={indices.p75}
            umbral={indices.umbral}
            formato={porcentaje}
            etiqueta={`Baja: P25 ${porcentaje(indices.p25)}, mediana ${porcentaje(indices.p50)}, P75 ${porcentaje(indices.p75)}`}
          />
          <LeyendaRango conUmbral={indices.umbral !== null} />
        </Indicador>
        <Organo c={indices.concentracion} />
      </div>
      {indices.licitadores.length > 0 && (
        <section
          className="rounded-tarjeta border border-borde bg-lienzo p-4 grid gap-2"
          data-testid="licitadores-probables"
        >
          <h4 className="m-0 text-tabla font-bold text-tinta">
            Licitadores probables <small className="font-medium text-tinta-2">adjudicaciones y actas</small>
          </h4>
          <Tabla
            columnas={COLUMNAS_LICITADORES}
            filas={indices.licitadores}
            claveFila={(l) => l.nif}
            etiqueta="Licitadores probables"
          />
        </section>
      )}
      <ComparablesIndice indices={indices} id={id} />
    </div>
  );
}
