// Aprendizaje › Comparar: por oferta, la memoria final de Hermes frente a la presentada, con
// el resumen por tipo de cambio y, al abrirla, cada cambio con su tipo y quién lo etiquetó.
import { porquesRespondidos, resumenComparacion, TIPOS_CAMBIO } from '../../lib/aprendizajeFormato';
import { fechaCorta } from '../../lib/formato';
import { Chip, Tarjeta, Vacio } from '../ui';
import { BarraComparacion } from './Graficos';

const ACCION = { anadido: 'Añadido', quitado: 'Quitado', modificado: 'Modificado', movido: 'Movido' };

function Cambio({ k, porque }) {
  return (
    <li className="border-t border-borde pt-2">
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-leyenda text-tinta-2 tabular-nums">{k.n}.</span>
        <Chip>{ACCION[k.accion] ?? k.accion}</Chip>
        {k.apartado && (
          <span className="text-leyenda text-tinta-2">
            apartado {k.apartado}
            {k.apartado_titulo ? ` · ${k.apartado_titulo}` : ''}
          </span>
        )}
        {k.tipo && (
          <Chip tono={k.por === 'hermes' ? 'hermes' : undefined} punto={false}>
            {(TIPOS_CAMBIO[k.tipo] ?? k.tipo).replace(/^de /, '')}
          </Chip>
        )}
      </div>
      {k.antes && (
        <p className="text-tabla text-tinta-2 m-0 mt-1 break-words line-through decoration-tinta-2/40">{k.antes}</p>
      )}
      {k.despues && <p className="text-tabla text-tinta m-0 mt-1 break-words">{k.despues}</p>}
      {porque && <p className="text-leyenda text-tinta-2 m-0 mt-1 break-words">Por qué, según el equipo: {porque}</p>}
    </li>
  );
}

export default function Comparar({ comparaciones }) {
  if (!comparaciones.length)
    return (
      <Vacio
        titulo="Sin comparaciones"
        texto="Al subir la memoria presentada de una oferta, se compara con la última de Hermes y sale aquí."
        testid="comparar-vacio"
      />
    );
  return (
    <div data-testid="aprendizaje-comparar" className="grid gap-3">
      {comparaciones.map((c) => (
        <Tarjeta
          key={c.id}
          titulo={c.titulo ?? c.licitacion_id}
          subtitulo={`v${c.version_hermes} de Hermes frente a la presentada v${c.version_presentada}${c.lote ? ` · lote ${c.lote}` : ''} · ${fechaCorta(c.creada_en)}`}
          testid={`comparacion-${c.id}`}
        >
          <p className="text-tabla text-tinta m-0 tabular-nums">{resumenComparacion(c.resumen)}</p>
          <BarraComparacion resumen={c.resumen} />
          {!c.por_apartado && (
            <p className="text-leyenda text-tinta-2 m-0">
              La presentada no lleva los títulos del guion: se compara el texto entero.
            </p>
          )}
          {c.cambios.length > 0 && (
            <details className="mt-2">
              <summary className="text-tabla text-tinta cursor-pointer">Ver los {c.cambios.length} cambios</summary>
              <ol className="grid gap-2 mt-2 p-0 list-none">
                {c.cambios.map((k) => (
                  <Cambio key={k.n} k={k} porque={porquesRespondidos(c)[k.n]} />
                ))}
              </ol>
            </details>
          )}
        </Tarjeta>
      ))}
    </div>
  );
}
