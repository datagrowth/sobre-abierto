// Oportunidades: lo que puede encajar y aún no está en el Pipeline, para decidir
// Aplicar (pasa al Pipeline, En preparación) o Descartar con motivo. Por fecha de cierre, la más
// cercana primero; lo que descartó Hermes va a Descartadas, apagado y con su motivo, y se puede
// aplicar igual. A la izquierda, los filtros del prefiltro a la vista: empiezan como en Ajustes ›
// Fuentes y filtros y se afinan aquí sin tocar la ingesta. Una fila abre la ficha en su página.
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { COMUNIDADES, euros } from '../../lib/formato';
import { cierreDeTarjeta } from '../../lib/pipelineFormato';
import { errorDeProceso } from '../../lib/listaFormato';
import { resumenEncaje } from '../../lib/encajeFormato';
import {
  AJUSTA_TUS_CPV,
  IDIOMAS,
  OPINIONES,
  PESTANAS_OPORTUNIDADES,
  PESTANA_INICIAL,
  TIPOS_CONTRATO,
  anadirEtiqueta,
  conPagina,
  consultaRevision,
  filtrosIniciales,
  etiquetaCpv,
  leerImporte,
  plazoQueManda,
  textoEnPliego,
  textoImporte,
  textoOpinion,
  textoPieOportunidades,
  unirPaginas,
} from '../../lib/oportunidadesFormato';
import usePersistente from '../../hooks/usePersistente';
import { ir } from '../../hooks/useRuta';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { Aviso, Boton, Chip, Dialogo, Entrada, Esqueleto, Pestanas, Tabla, Vacio } from '../ui';
import DescarteTipificado from './DescarteTipificado';
import GuardarBusqueda from './GuardarBusqueda';
import DescargarCsv from '../comun/DescargarCsv';

function useFiltros() {
  const [filtros, setFiltros] = usePersistente('oportunidades.filtros.v2', null);
  // Si el prefiltro no se puede leer, la lista sale igual, sin filtros.
  const [prefiltro, setPrefiltro] = useState({ leido: false, datos: null });
  useEffect(() => {
    let vivo = true;
    licitacionesApi.filtros().then(
      (datos) => {
        if (vivo) setPrefiltro({ leido: true, datos });
      },
      () => {
        if (vivo) setPrefiltro({ leido: true, datos: null });
      },
    );
    return () => {
      vivo = false;
    };
  }, []);
  // Sin filtros guardados en esta sesión, los del prefiltro en cuanto llegan.
  const vigentes = filtros ?? filtrosIniciales(prefiltro.datos);
  const cambiar = (k, v) => setFiltros({ ...vigentes, [k]: v });
  return {
    filtros: vigentes,
    cambiar,
    restablecer: () => setFiltros(null),
    listos: filtros !== null || prefiltro.leido,
    deEjemplo: prefiltro.datos?.de_ejemplo === true,
  };
}

// Las páginas vistas se recargan juntas (un evento o Aplicar no devuelven a las 50 primeras);
// otra pestaña, búsqueda o filtro vuelven a la primera.
function useRevision(consulta, version, activa) {
  const [carga, setCarga] = useState({ kind: 'loading' });
  const paginas = useRef(1);
  const anterior = useRef(null);
  const pedir = useCallback(
    (n) => {
      if (!activa) return Promise.resolve();
      const pedidas = Array.from({ length: n }, (_, i) => licitacionesApi.revision(conPagina(consulta, i + 1)));
      return Promise.all(pedidas).then(
        (ps) => {
          paginas.current = n;
          setCarga({ kind: 'ready', data: unirPaginas(ps) });
        },
        (e) => setCarga({ kind: 'error', message: e.message }),
      );
    },
    [consulta, activa],
  );
  useEffect(() => {
    const n = anterior.current === pedir ? paginas.current : 1;
    anterior.current = pedir;
    pedir(n);
  }, [pedir, version]);
  const cargar = useCallback(() => pedir(paginas.current), [pedir]);
  const verMas = useCallback(() => pedir(paginas.current + 1), [pedir]);
  return { carga, cargar, verMas };
}

const OPCIONES_COMUNIDAD = COMUNIDADES.map(([key, label]) => ({ key, label }));

function Grupo({ titulo, children }) {
  return (
    <fieldset className="grid gap-1 border-0 p-0 m-0">
      <legend className="text-leyenda font-bold text-tinta mb-1.5 p-0">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Casillas({ opciones, valores, onChange, cuentas }) {
  const alternar = (k) => onChange(valores.includes(k) ? valores.filter((x) => x !== k) : [...valores, k]);
  return opciones.map((o) => (
    <label
      key={o.key}
      className="flex justify-between items-center gap-1.5 py-0.5 text-tabla text-tinta cursor-pointer"
    >
      <span className="inline-flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={valores.includes(o.key)}
          onChange={() => alternar(o.key)}
          className="accent-tinta"
        />
        {o.label}
      </span>
      {cuentas && <small className="text-leyenda text-tinta-2 tabular-nums">{cuentas[o.key] ?? 0}</small>}
    </label>
  ));
}

// Las descripciones oficiales de los prefijos CPV a la vista; si no llegan, la etiqueta es el prefijo.
function useDescripcionesCpv(prefijos) {
  const [descripciones, setDescripciones] = useState({});
  const clave = prefijos.join(',');
  useEffect(() => {
    if (!clave) return undefined;
    let vivo = true;
    licitacionesApi.cpv(clave.split(',')).then(
      (r) => {
        if (vivo) setDescripciones(Object.fromEntries(r.cpv.map((c) => [c.prefijo, c.descripcion])));
      },
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, [clave]);
  return descripciones;
}

// Lo que ofrece el vocabulario CPV para lo escrito; una respuesta vieja no pisa a la nueva.
function useSugerenciasCpv(texto) {
  const [respuesta, setRespuesta] = useState({ q: '', cpv: [] });
  const q = texto.trim();
  useEffect(() => {
    if (!q) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      licitacionesApi.buscarCpv(q).then(
        (r) => {
          if (vivo) setRespuesta({ q, cpv: r.cpv });
        },
        () => {
          if (vivo) setRespuesta({ q, cpv: [] });
        },
      );
    }, 150);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);
  // Mientras llega la nueva se ve la anterior, sin parpadeo al teclear.
  return q && respuesta.q ? respuesta.cpv : [];
}

function ListaEtiquetas({ lista, onChange, nombre, etiqueta }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {lista.map((x) => (
        <Chip key={x} title={etiqueta(x).titulo}>
          <span>{etiqueta(x).texto}</span>
          <button
            type="button"
            aria-label={`Quitar «${x}» de ${nombre}`}
            onClick={() => onChange(lista.filter((y) => y !== x))}
            className="inline-flex bg-transparent border-0 p-0 text-tinta-2 cursor-pointer"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </Chip>
      ))}
    </div>
  );
}

function Etiquetas({ lista, onChange, nombre, etiqueta = (x) => ({ texto: x, titulo: undefined }) }) {
  const [texto, setTexto] = useState('');
  const anadir = () => {
    onChange(anadirEtiqueta(lista, texto));
    setTexto('');
  };
  return (
    <div className="grid gap-1.5">
      <ListaEtiquetas lista={lista} onChange={onChange} nombre={nombre} etiqueta={etiqueta} />
      <Entrada
        aria-label={`Añadir a ${nombre}`}
        placeholder="Añadir y pulsar Intro"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            anadir();
          }
        }}
        className="py-1.5 text-tabla"
      />
    </div>
  );
}

// Se escribe el código o una palabra y se elige de la lista; Intro sin elegir añade lo escrito
// si son cifras, como antes.
function BuscadorCpv({ lista, onChange, etiqueta }) {
  const [texto, setTexto] = useState('');
  const [activa, setActiva] = useState(-1);
  const sugerencias = useSugerenciasCpv(texto);
  const anadir = (prefijo) => {
    onChange(anadirEtiqueta(lista, prefijo));
    setTexto('');
    setActiva(-1);
  };
  const mover = (d) => setActiva((i) => Math.max(-1, Math.min(sugerencias.length - 1, i + d)));
  const alPulsar = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mover(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mover(-1);
    } else if (e.key === 'Escape') {
      setTexto('');
      setActiva(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      anadir(sugerencias[activa]?.prefijo ?? texto);
    }
  };
  const abierta = texto.trim() !== '' && sugerencias.length > 0;
  return (
    <div className="grid gap-1.5">
      <ListaEtiquetas lista={lista} onChange={onChange} nombre="los prefijos CPV" etiqueta={etiqueta} />
      <div className="relative">
        <Entrada
          role="combobox"
          aria-expanded={abierta}
          aria-controls="sugerencias-cpv"
          aria-autocomplete="list"
          aria-label="Buscar un CPV"
          aria-activedescendant={activa >= 0 ? `cpv-${sugerencias[activa]?.codigo}` : undefined}
          placeholder="Código o palabra, p. ej. 72 o formación"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setActiva(-1);
          }}
          onKeyDown={alPulsar}
          onBlur={() => setActiva(-1)}
          className="py-1.5 text-tabla"
        />
        {abierta && (
          <ul
            id="sugerencias-cpv"
            role="listbox"
            aria-label="CPV"
            className="absolute z-20 left-0 right-0 mt-1 max-h-[260px] overflow-y-auto list-none m-0 p-0 bg-lienzo border border-borde-control rounded-control shadow-md"
          >
            {sugerencias.map((s, i) => (
              <li
                key={s.codigo}
                id={`cpv-${s.codigo}`}
                role="option"
                aria-selected={i === activa}
                onMouseDown={(e) => {
                  e.preventDefault();
                  anadir(s.prefijo);
                }}
                onMouseMove={() => setActiva(i)}
                className={`px-2.5 py-1.5 text-tabla cursor-pointer ${i === activa ? 'bg-accion-suave' : ''} ${lista.includes(s.prefijo) ? 'text-tinta-2' : 'text-tinta'}`}
                style={{ paddingLeft: `${10 + (s.nivel - 2) * 8}px` }}
              >
                <span className="tabular-nums font-bold">{s.prefijo}</span> · {s.descripcion}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Se escribe libre y se lee al salir del campo; quien lo usa le pone `key` con el valor para que
// empiece de nuevo si cambia por fuera (al volver a los filtros del prefiltro).
function Importe({ valor, onChange, etiqueta }) {
  const [texto, setTexto] = useState(textoImporte(valor));
  return (
    <Entrada
      aria-label={etiqueta}
      inputMode="decimal"
      placeholder={etiqueta.includes('mín') ? 'Mín. €' : 'Máx. €'}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => onChange(leerImporte(texto))}
      className="py-1.5 text-tabla tabular-nums"
    />
  );
}

function Filtros({ f, pestana, opiniones }) {
  const { filtros, cambiar, restablecer } = f;
  const cpv = useDescripcionesCpv(filtros.cpv);
  return (
    <div aria-label="Filtros" role="group" className="grid gap-4 content-start text-tabla">
      {pestana === 'por_revisar' && (
        <Grupo titulo="Opinión de Hermes">
          <Casillas
            opciones={OPINIONES}
            valores={filtros.opinion}
            onChange={(v) => cambiar('opinion', v)}
            cuentas={opiniones}
          />
        </Grupo>
      )}
      <Grupo titulo="Comunidad autónoma">
        <div className="max-h-[220px] overflow-y-auto pr-1" data-testid="filtro-comunidades">
          <Casillas
            opciones={OPCIONES_COMUNIDAD}
            valores={filtros.comunidades}
            onChange={(v) => cambiar('comunidades', v)}
          />
        </div>
        <small className="text-leyenda text-tinta-2">
          {filtros.comunidades.length ? `${filtros.comunidades.length} marcadas` : 'Ninguna marcada: todas.'}
        </small>
      </Grupo>
      <Grupo titulo="Importe por lote">
        <div className="grid grid-cols-2 gap-1.5">
          <Importe
            key={`min-${filtros.importe_min}`}
            valor={filtros.importe_min}
            onChange={(v) => cambiar('importe_min', v)}
            etiqueta="Importe mínimo"
          />
          <Importe
            key={`max-${filtros.importe_max}`}
            valor={filtros.importe_max}
            onChange={(v) => cambiar('importe_max', v)}
            etiqueta="Importe máximo"
          />
        </div>
      </Grupo>
      <Grupo titulo="Prefijos CPV">
        <BuscadorCpv
          lista={filtros.cpv}
          onChange={(v) =>
            cambiar(
              'cpv',
              v.filter((x) => /^\d{2,8}$/.test(x)),
            )
          }
          etiqueta={(x) => etiquetaCpv(x, cpv[x])}
        />
      </Grupo>
      <Grupo titulo="Palabras clave en el título">
        <Etiquetas lista={filtros.palabras} onChange={(v) => cambiar('palabras', v)} nombre="las palabras clave" />
      </Grupo>
      <Grupo titulo="Palabras que descartan">
        <Etiquetas
          lista={filtros.excluir}
          onChange={(v) => cambiar('excluir', v)}
          nombre="las palabras que descartan"
        />
      </Grupo>
      <Grupo titulo="Tipo de contrato">
        <Casillas opciones={TIPOS_CONTRATO} valores={filtros.tipos} onChange={(v) => cambiar('tipos', v)} />
      </Grupo>
      <Grupo titulo="Descartar las escritas en">
        <Casillas opciones={IDIOMAS} valores={filtros.idiomas} onChange={(v) => cambiar('idiomas', v)} />
      </Grupo>
      <p className="m-0 text-leyenda text-tinta-2">
        Empiezan como el prefiltro de Ajustes › Fuentes y filtros; aquí se afinan sin cambiarlo.
      </p>
      <div>
        <Boton variante="texto" tamano="pequeno" onClick={restablecer} testid="filtros-restablecer">
          Volver a los del prefiltro
        </Boton>
      </div>
    </div>
  );
}

function Cierre({ fila }) {
  const plazo = plazoQueManda(fila);
  const c = cierreDeTarjeta(plazo.fecha);
  if (!c) return <span className="text-tinta-2">—</span>;
  return (
    <span className="grid tabular-nums whitespace-nowrap">
      {plazo.solicitud && <small className="text-leyenda text-tinta-2">Solicitud de participación</small>}
      <span className={c.urgente ? 'text-riesgo font-bold' : undefined}>{c.fecha}</span>
      {c.canarias && <small className="text-leyenda text-tinta-2">{c.canarias}</small>}
    </span>
  );
}

// El número con su desglose en el título (el orden sigue por plazo hasta que la calibración llegue a 0,75).
function Encaje({ fila }) {
  const e = fila.encaje;
  if (!e || e.valor === null)
    return (
      <span className="text-tinta-2" title="Faltan datos para el encaje">
        —
      </span>
    );
  return (
    <span className="grid justify-items-end tabular-nums" title={resumenEncaje(e)} data-testid={`encaje-${fila.id}`}>
      <b>{e.valor}</b>
      {!e.elegible && <small className="text-leyenda text-impide">no elegible</small>}
    </span>
  );
}

function Hermes({ fila }) {
  const error = errorDeProceso(fila.error_proceso ? { codigo: fila.error_proceso } : null);
  if (error)
    return (
      <Chip tono="riesgo" testid={`error-${fila.id}`}>
        {error.texto}
      </Chip>
    );
  return (
    <span className="grid gap-0.5 justify-items-start">
      <Chip tono={fila.opinion === 'descartar' ? 'neutro' : 'hermes'} testid={`opinion-${fila.id}`}>
        {textoOpinion(fila.opinion)}
      </Chip>
      {fila.motivo && (
        <small className="text-leyenda text-tinta-2 max-w-[220px] truncate" title={fila.motivo}>
          {fila.motivo}
        </small>
      )}
    </span>
  );
}

function Acciones({ fila, pestana, onAplicar, onDescartar, ocupada }) {
  const parar = (e) => e.stopPropagation();
  return (
    <span className="flex gap-1 justify-end" onClick={parar} onKeyDown={parar} role="presentation">
      <Boton tamano="pequeno" escribe cargando={ocupada} testid={`aplicar-${fila.id}`} onClick={() => onAplicar(fila)}>
        Aplicar
      </Boton>
      {pestana !== 'descartadas' && (
        <Boton tamano="pequeno" variante="texto" testid={`descartar-${fila.id}`} onClick={() => onDescartar(fila)}>
          Descartar
        </Boton>
      )}
    </span>
  );
}

function columnas(pestana, accion) {
  return [
    { clave: 'fecha_limite', titulo: 'Cierre', celda: (f) => <Cierre fila={f} />, ancho: 150 },
    {
      clave: 'expediente',
      titulo: 'Expediente',
      celda: (f) => <span className="font-mono text-leyenda break-all">{f.expediente}</span>,
      ancho: 140,
    },
    {
      clave: 'titulo',
      titulo: 'Licitación',
      celda: (f) => (
        <span className="grid">
          <span className="font-medium text-cuerpo" title={f.titulo}>
            {f.titulo_corto}
          </span>
          <span className="text-leyenda text-tinta-2">{[f.organo, f.procedimiento].filter(Boolean).join(' · ')}</span>
          {f.renovacion_de && (
            <span className="mt-0.5">
              <Chip tono="ok" testid={`renovacion-${f.id}`} title="La pediste en Mercado › Vencimientos">
                renovación que seguías
              </Chip>
            </span>
          )}
          {f.en_pliego && (
            <span data-testid={`en-pliego-${f.id}`} className="text-leyenda text-tinta mt-0.5">
              {textoEnPliego(f.en_pliego)}
            </span>
          )}
        </span>
      ),
    },
    { clave: 'importe', titulo: 'Importe', alinear: 'derecha', celda: (f) => euros(f.importe), ancho: 110 },
    { clave: 'encaje', titulo: 'Encaje', alinear: 'derecha', celda: (f) => <Encaje fila={f} />, ancho: 80 },
    { clave: 'opinion', titulo: 'Hermes', celda: (f) => <Hermes fila={f} />, ancho: 200 },
    {
      clave: 'acciones',
      titulo: <span className="sr-only">Acciones</span>,
      nitida: true,
      celda: (f) => <Acciones fila={f} pestana={pestana} {...accion} ocupada={accion.aplicando === f.id} />,
      ancho: 170,
    },
  ];
}

function useAplicar(alAplicar) {
  const [aplicando, setAplicando] = useState(null);
  const [aviso, setAviso] = useState(null);
  const onAplicar = async (fila) => {
    setAplicando(fila.id);
    try {
      await licitacionesApi.cambiar(fila.id, { estado: 'en_preparacion' });
      setAviso({ tono: 'ok', texto: `«${fila.titulo_corto}» está en el Pipeline, en preparación.`, id: fila.id });
      alAplicar();
    } catch (e) {
      setAviso({ tono: 'error', texto: `No se pudo aplicar «${fila.titulo_corto}»: ${e.message}` });
    } finally {
      setAplicando(null);
    }
  };
  return { aplicando, aviso, onAplicar };
}

/** pestana: la de la ruta; onPestana, onAbrir(id): navegar. */
export default function OportunidadesVista({ version, pestana: pedida, onPestana, onAbrir, onAjustarFiltros }) {
  const pestana = PESTANAS_OPORTUNIDADES.some((p) => p.key === pedida) ? pedida : PESTANA_INICIAL;
  const { isSmall } = useAnchoPantalla();
  const f = useFiltros();
  // Se recuerda en la sesión: así se abre una búsqueda guardada desde Ajustes › Avisos.
  const [texto, setTexto] = usePersistente('oportunidades.texto', '');
  const [busqueda, setBusqueda] = useState(texto);
  const [guardando, setGuardando] = useState(false);
  const [enPliegos, setEnPliegos] = usePersistente('oportunidades.buscar-en-pliegos', false);
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const { carga, cargar, verMas } = useRevision(
    consultaRevision({ pestana, texto: busqueda, pliegos: enPliegos, filtros: f.filtros }),
    version,
    f.listos,
  );
  const [descartando, setDescartando] = useState(null);
  const aplicar = useAplicar(cargar);
  const datos = carga.kind === 'ready' ? carga.data : null;
  const vistas = PESTANAS_OPORTUNIDADES.map((p) => ({ ...p, cuenta: datos?.cuentas?.[p.key] ?? 0 }));
  const filtros = <Filtros f={f} pestana={pestana} opiniones={datos?.opiniones} />;
  return (
    <div data-testid="lista-oportunidades" className="grid gap-3 content-start">
      <div className="grid gap-1.5">
        <Entrada
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por título, órgano o expediente"
          aria-label="Buscar oportunidades"
          className="rounded-full px-4"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-4">
          <label className="inline-flex items-center gap-1.5 text-leyenda text-tinta-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enPliegos}
              onChange={(e) => setEnPliegos(e.target.checked)}
              className="accent-tinta"
              data-testid="buscar-en-pliegos"
            />
            Buscar también en los pliegos descargados
          </label>
          <span className="inline-flex flex-wrap gap-2">
            <DescargarCsv
              pequeno
              url={licitacionesApi.csv.oportunidades(
                consultaRevision({ pestana, texto: busqueda, pliegos: enPliegos, filtros: f.filtros }),
              )}
              testid="oportunidades-csv"
            />
            <Boton tamano="pequeno" onClick={() => setGuardando(true)} testid="guardar-busqueda">
              Guardar búsqueda
            </Boton>
          </span>
        </div>
      </div>
      <GuardarBusqueda
        abierto={guardando}
        onCerrar={() => setGuardando(false)}
        texto={busqueda}
        pliegos={enPliegos}
        filtros={f.filtros}
      />
      {f.deEjemplo && (
        <Aviso tono="aviso" testid="oportunidades-filtros-de-ejemplo">
          {AJUSTA_TUS_CPV}{' '}
          {onAjustarFiltros && (
            <Boton variante="texto" tamano="pequeno" onClick={onAjustarFiltros}>
              Ir a Fuentes y filtros
            </Boton>
          )}
        </Aviso>
      )}
      <Pestanas
        vistas={vistas}
        vista={pestana}
        onVista={onPestana}
        etiqueta="Pestañas de Oportunidades"
        prefijo="oportunidades-pestana"
      />
      {datos?.orden === 'encaje' && (
        <p data-testid="orden-encaje" className="m-0 text-leyenda text-tinta-2">
          Ordenadas por encaje: la calibración dice que ordena como decidís. Sin ella, por fecha de cierre.
        </p>
      )}
      {aplicar.aviso && (
        <Aviso tono={aplicar.aviso.tono}>
          {aplicar.aviso.texto}{' '}
          {aplicar.aviso.id && (
            <Boton variante="texto" tamano="pequeno" onClick={() => onAbrir(aplicar.aviso.id)}>
              Abrir la ficha
            </Boton>
          )}
        </Aviso>
      )}
      <div
        className="grid gap-5 items-start"
        style={{ gridTemplateColumns: isSmall ? 'minmax(0, 1fr)' : '216px minmax(0, 1fr)' }}
      >
        {isSmall ? (
          <details className="text-tabla">
            <summary className="cursor-pointer font-bold text-tinta">Filtros</summary>
            <div className="mt-3">{filtros}</div>
          </details>
        ) : (
          filtros
        )}
        <div className="grid gap-1.5 min-w-0">
          {carga.kind === 'loading' && <Esqueleto lineas={5} etiqueta="Cargando oportunidades…" />}
          {carga.kind === 'error' && <Aviso tono="error">{carga.message}</Aviso>}
          {datos && datos.total === 0 && (
            <Vacio
              titulo="Aún no hay oportunidades aquí"
              texto="Con estos filtros no queda ninguna. Quita algún filtro o ajusta tus CPV, importes y regiones en Ajustes: las nuevas llegan solas cada pocos minutos y las criba Hermes."
              accion={
                <Boton onClick={() => ir('ajustes', 'fuentes')} testid="oportunidades-ajustar-fuentes">
                  Ajustar fuentes y filtros
                </Boton>
              }
            />
          )}
          {datos && datos.total > 0 && (
            <>
              <Tabla
                columnas={columnas(pestana, { ...aplicar, onDescartar: setDescartando })}
                filas={datos.items}
                apagada={(x) => x.apagada}
                onFila={(x) => onAbrir(x.id)}
                etiqueta={`Oportunidades: ${PESTANAS_OPORTUNIDADES.find((p) => p.key === pestana).label}`}
                testid="tabla-oportunidades"
              />
              <div className="flex flex-wrap items-center gap-3">
                <p data-testid="lista-pie" className="m-0 text-leyenda text-tinta-2">
                  {textoPieOportunidades(datos.items.length, datos.total)}
                </p>
                {datos.items.length < datos.total && (
                  <Boton tamano="pequeno" onClick={verMas} testid="lista-ver-mas">
                    Ver {Math.min(50, datos.total - datos.items.length)} más
                  </Boton>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <Dialogo
        abierto={descartando !== null}
        titulo={`Descartar «${descartando?.titulo_corto ?? ''}»`}
        onCerrar={() => setDescartando(null)}
        ancho={560}
      >
        {descartando && (
          <DescarteTipificado
            id={descartando.id}
            testid="oportunidades-descarte"
            onCancelar={() => setDescartando(null)}
            onHecho={() => {
              setDescartando(null);
              cargar();
            }}
          />
        )}
      </Dialogo>
    </div>
  );
}
