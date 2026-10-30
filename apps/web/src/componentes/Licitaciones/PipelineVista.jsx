// El Pipeline: las ofertas en curso en un tablero de cinco columnas, cada una por
// fecha de cierre, con la tarjeta mínima (expediente, cierre peninsular y, si toca, de Canarias, título
// corto, importe, la carpeta de Drive a un clic y el avatar de quien la lleva) y, al pie, el aviso
// de lo que puede encajar y está por revisar. La vista lista enseña lo mismo con la columna como estado y se exporta a CSV.
// Las tarjetas se arrastran entre columnas (o se mueven con «Mover»): cada movimiento es una acción real (MoverTarjeta).
import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import useUsuario from '../../hooks/useUsuario';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { euros } from '../../lib/formato';
import {
  accionAlSoltar,
  cierreDeTarjeta,
  destinosDe,
  detallePorRevisar,
  filasDelPipeline,
  textoPorRevisar,
  textoResultado,
} from '../../lib/pipelineFormato';
import { clases } from '../../lib/uiFormato';
import { puede } from '../../lib/usuarioActual';
import { Iniciales, Aviso, Boton, Chip, Esqueleto, MarcaHermes, Menu, Tabla, Vacio } from '../ui';
import DescargarCsv from '../comun/DescargarCsv';
import AbrirEnDrive from './AbrirEnDrive';
import MoverTarjeta from './MoverTarjeta';
import PrimerosPasos from './PrimerosPasos';

function usePipeline(version) {
  const [carga, setCarga] = useState({ kind: 'loading' });
  const cargar = useCallback(
    () =>
      licitacionesApi.pipeline().then(
        (data) => setCarga({ kind: 'ready', data }),
        (e) =>
          setCarga((prev) =>
            prev.kind === 'ready' ? { ...prev, fallo: e.message } : { kind: 'error', message: e.message },
          ),
      ),
    [],
  );
  useEffect(() => {
    cargar();
  }, [cargar, version]);
  return { carga, cargar };
}

function Cierre({ t }) {
  if (t.columna === 'resuelta')
    return (
      <Chip
        tono={t.resultado === 'ganada' ? 'ok' : t.resultado === 'perdida' ? 'impide' : 'neutro'}
        testid="tarjeta-resultado"
      >
        {textoResultado(t)}
      </Chip>
    );
  const c = cierreDeTarjeta(t.fecha_limite);
  if (!c) return <span className="text-leyenda text-tinta-2">Sin fecha de cierre</span>;
  return (
    <span className="grid tabular-nums" data-testid="tarjeta-cierre" data-urgente={c.urgente || undefined}>
      <b className={clases('text-tabla font-bold', c.urgente ? 'text-riesgo' : 'text-tinta')}>{c.fecha}</b>
      {c.canarias && <small className="text-leyenda text-tinta-2">{c.canarias}</small>}
    </span>
  );
}

const ETIQUETA_MOVER = {
  registrar: 'A Presentada: registrar la presentación',
  resultado: 'A Resuelta: anotar el resultado',
  deshacer: 'A En preparación: deshacer la presentación',
};

// «Mover» hace lo mismo que arrastrar, para quien usa el teclado o el móvil (ahí no se arrastra).
function MenuMover({ t, destinos, onMover }) {
  if (!destinos.length) return null;
  return (
    <Menu
      etiqueta="Mover"
      Icono={ArrowRightLeft}
      testid={`tarjeta-mover-${t.id}`}
      opciones={destinos.map((d) => ({
        clave: d.clave,
        texto: ETIQUETA_MOVER[d.tipo],
        onElegir: () => onMover({ tarjeta: t, tipo: d.tipo }),
      }))}
    />
  );
}

// El título es el botón que abre la ficha y su ::after cubre la tarjeta entera (se pulsa en
// cualquier sitio); el de Drive y «Mover» van por encima, sin anidar un control dentro de otro.
function Tarjeta({ t, onAbrir, mover }) {
  return (
    <div
      data-testid={`tarjeta-${t.id}`}
      title={t.titulo}
      draggable={mover ? true : undefined}
      onDragStart={
        mover
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', t.id);
              mover.alEmpezar(t);
            }
          : undefined
      }
      onDragEnd={mover?.alTerminar}
      className={clases(
        'relative grid gap-1.5 min-w-0 px-3 py-2.5 rounded-tarjeta border border-borde bg-lienzo hover:border-borde-control focus-within:border-tinta',
        mover && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="font-mono text-leyenda font-medium text-tinta break-all">{t.expediente}</span>
        <span className="relative z-[1] inline-flex items-center gap-1">
          {t.responsable && (
            <Iniciales nombre={t.responsable.nombre} tamano="pequeno" testid={`tarjeta-responsable-${t.id}`} />
          )}
          <AbrirEnDrive
            id={t.id}
            carpeta="principal"
            icono
            etiqueta={`Abrir en Drive la carpeta de ${t.expediente}`}
            testid={`tarjeta-drive-${t.id}`}
          />
        </span>
      </div>
      <button
        type="button"
        onClick={() => onAbrir(t.id)}
        data-testid={`tarjeta-abrir-${t.id}`}
        className="text-left p-0 bg-transparent border-0 cursor-pointer text-cuerpo font-medium leading-snug text-tinta after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
      >
        {t.titulo_corto}
      </button>
      <Cierre t={t} />
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-tabla text-tinta-2 tabular-nums">{euros(t.importe)}</span>
        {mover && (
          <span className="relative z-[1]">
            <MenuMover t={t} destinos={mover.destinos(t)} onMover={mover.onMover} />
          </span>
        )}
      </div>
    </div>
  );
}

// Mientras se arrastra, cada columna dice si acepta la tarjeta (borde discontinuo) o por qué no.
function Columna({ c, arrastrada, onAbrir, mover, onSoltar }) {
  const [encima, setEncima] = useState(false);
  const accion = arrastrada ? accionAlSoltar(arrastrada.columna, c.clave) : null;
  const acepta = Boolean(accion?.tipo);
  return (
    <section
      aria-label={c.titulo}
      data-testid={`columna-${c.clave}`}
      data-acepta={arrastrada ? String(acepta) : undefined}
      onDragOver={
        acepta
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setEncima(true);
            }
          : undefined
      }
      onDragLeave={() => setEncima(false)}
      onDrop={
        acepta
          ? (e) => {
              e.preventDefault();
              setEncima(false);
              onSoltar({ tarjeta: arrastrada, tipo: accion.tipo });
            }
          : undefined
      }
      className={clases(
        'grid gap-2 content-start min-w-0 p-2.5 rounded-tarjeta bg-superficie-2 border-2 border-transparent',
        acepta && 'border-dashed border-borde-control',
        acepta && encima && 'border-tinta',
      )}
    >
      <h3 className="m-0 flex justify-between px-1 pt-0.5 pb-1 text-tabla font-bold text-tinta">
        {c.titulo}
        <span className="font-medium text-tinta-2">{c.tarjetas.length}</span>
      </h3>
      {accion?.bloqueo && (
        <p className="m-0 px-1 text-leyenda text-tinta-2" data-testid={`columna-bloqueo-${c.clave}`}>
          {accion.bloqueo}
        </p>
      )}
      {c.tarjetas.map((t) => (
        <Tarjeta key={t.id} t={t} onAbrir={onAbrir} mover={mover} />
      ))}
    </section>
  );
}

function Tablero({ columnas, onAbrir, onMover }) {
  const usuario = useUsuario();
  const [arrastrada, setArrastrada] = useState(null);
  // Quien solo puede ver no mueve nada (el servidor lo negaría).
  const mover = puede(usuario, 'editor')
    ? {
        alEmpezar: setArrastrada,
        alTerminar: () => setArrastrada(null),
        onMover,
        destinos: (t) => destinosDe(t.columna, columnas),
      }
    : null;
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid gap-2.5 items-start" style={{ gridTemplateColumns: 'repeat(5, minmax(200px, 1fr))' }}>
        {columnas.map((c) => (
          <Columna
            key={c.clave}
            c={c}
            arrastrada={arrastrada}
            onAbrir={onAbrir}
            mover={mover}
            onSoltar={(m) => {
              setArrastrada(null);
              onMover(m);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PorRevisar({ aviso, onRevisar, onAbrir }) {
  if (!aviso?.total) return null;
  return (
    <div
      data-testid="pipeline-por-revisar"
      className="rounded-tarjeta border border-hermes bg-hermes-suave p-4 grid gap-3"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MarcaHermes etiqueta={textoPorRevisar(aviso.total)} />
        <Boton variante="principal" onClick={onRevisar} testid="pipeline-revisar">
          Revisarlas
        </Boton>
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {aviso.proximas.map((o) => {
          const c = cierreDeTarjeta(o.fecha_limite);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onAbrir(o.id)}
              className="grid gap-1 content-start text-left rounded-control bg-lienzo border-0 px-3 py-2.5 cursor-pointer text-tabla hover:outline hover:outline-1 hover:outline-borde-control"
            >
              <span className="text-tinta-2">{c ? c.fecha : 'Sin fecha de cierre'}</span>
              <b className="text-tabla font-medium text-tinta">{o.titulo_corto}</b>
              <span className="text-tinta-2">{detallePorRevisar(o)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const COLUMNAS_LISTA = [
  { clave: 'estado', titulo: 'Estado', ordenable: true },
  {
    clave: 'expediente',
    titulo: 'Expediente',
    ordenable: true,
    celda: (f) => <span className="font-mono text-leyenda">{f.expediente}</span>,
  },
  { clave: 'titulo_corto', titulo: 'Título', ordenable: true },
  {
    clave: 'fecha_limite',
    titulo: 'Cierre',
    ordenable: true,
    celda: (f) => (f.columna === 'resuelta' ? textoResultado(f) : (cierreDeTarjeta(f.fecha_limite)?.fecha ?? '—')),
  },
  { clave: 'importe', titulo: 'Importe', ordenable: true, alinear: 'derecha', celda: (f) => euros(f.importe) },
];

/** vista: «tablero» o «lista». */
export default function PipelineVista({ version, vista = 'tablero', estado = null, onAbrir, onRevisar, onIr }) {
  const { carga, cargar } = usePipeline(version);
  const [orden, setOrden] = useState(null);
  const [movimiento, setMovimiento] = useState(null);
  if (carga.kind === 'loading') return <Esqueleto lineas={4} etiqueta="Cargando el Pipeline…" />;
  if (carga.kind === 'error') return <Aviso tono="error">No se pudo cargar el Pipeline: {carga.message}</Aviso>;
  const p = carga.data;
  const total = p.columnas.reduce((n, c) => n + c.tarjetas.length, 0);
  return (
    <div data-testid="pipeline" className="grid gap-4 content-start">
      {carga.fallo && (
        <Aviso tono="aviso">No se pudo actualizar: {carga.fallo}. Lo de arriba es lo último leído.</Aviso>
      )}
      {total === 0 && onIr && <PrimerosPasos estado={estado} onIr={onIr} />}
      {total === 0 && (
        <Vacio
          titulo="Ninguna oferta en curso"
          texto="Las que apliques desde Oportunidades aparecen aquí, en «En preparación»."
        />
      )}
      {total > 0 && vista === 'tablero' && <Tablero columnas={p.columnas} onAbrir={onAbrir} onMover={setMovimiento} />}
      <MoverTarjeta movimiento={movimiento} onHecho={cargar} onCerrar={() => setMovimiento(null)} />
      {total > 0 && vista === 'lista' && (
        <>
          <div>
            <DescargarCsv url={licitacionesApi.csv.pipeline()} testid="pipeline-csv" />
          </div>
          <Tabla
            columnas={COLUMNAS_LISTA}
            filas={filasDelPipeline(p)}
            orden={orden}
            onOrden={setOrden}
            onFila={(f) => onAbrir(f.id)}
            etiqueta="Ofertas en curso"
            testid="pipeline-lista"
          />
        </>
      )}
      <PorRevisar aviso={p.por_revisar} onRevisar={onRevisar} onAbrir={onAbrir} />
    </div>
  );
}
