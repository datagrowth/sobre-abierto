// Lo que dice el pliego y la PLACSP de una licitación, en las pestañas de la ficha:
// Resumen (de qué va, la recomendación de Hermes, datos, lotes, pliegos y notas con el estado),
// Requisitos (por áreas, con el buscador del expediente) y Criterios de valoración (reparto entre
// juicio de valor y fórmulas y la lista por lote). Con lotes de interés se ve solo lo suyo salvo
// «Ver todos los lotes».
import EncajeDesglose from './EncajeDesglose';
import { useState } from 'react';
import { Save, FileText, Search } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, RIESGO, IMPIDE, HERMES, SUPERFICIE_2 } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { urlDocumento } from '../../lib/apiCliente';
import {
  avisoPliegos,
  explicarPrefiltro,
  filtrarExpediente,
  opcionesMover,
  partesResumen,
  preguntaPreparar,
  requisitosALaVista,
  requisitosDeFicha,
  sinMaximoCero,
  textoMaximoLote,
} from '../../lib/licitacionesFormato';
import { filtrarPorLotes, idsInteres, resumenExcluyentes } from '../../lib/expedienteFormato';
import useComprobaciones from '../../hooks/useComprobaciones';
import useComentarios from '../../hooks/useComentarios';
import { euros, plazo, plural, urlEnlazable, IDIOMAS, textoIdiomaTitulo, textoPlazo } from '../../lib/formato';
import { repartoCriterios } from '../../lib/fichaFormato';
import { Bloque } from '../comun/ui';
import { MarcaHermes, Aviso, Boton, Chip } from '../ui';
import Confirmacion from '../comun/Confirmacion';
import FichaGoNoGo from './FichaGoNoGo';
import LotesLicitacion from './LotesLicitacion';
import SubirPliego from './SubirPliego';
import { etiquetaOrigen, subidosSinIndexar } from '../../lib/pliegosFormato';
import { carpetaDeOferta, rutaCarpetaBiblioteca } from '../../lib/bibliotecaCarpeta';
import { rutaA } from '../../lib/rutas';

function Dato({ label, children }) {
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ fontSize: 11.5, color: TINTA_2 }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 13.5, color: TINTA, marginTop: 2 }}>
        {children ?? '—'}
      </div>
    </div>
  );
}

// Los topes salen del guion de la oferta (el tramo más alto de cada criterio automático). No se
// casan con los criterios de la ficha: los nombres no coinciden y un emparejamiento a ciegas
// pondría el tope de un criterio en otro.
function TopesGuion({ automaticos = [] }) {
  const conTope = automaticos.filter((a) => a.tope);
  if (!conTope.length) return null;
  return (
    <div data-testid="topes-guion" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDE}` }}>
      <div style={{ fontSize: 12, color: TINTA_2, marginBottom: 6 }}>Topes según el guion de la oferta</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: TINTA, lineHeight: 1.55 }}>
        {conTope.map((a, i) => (
          <li key={`${i}-${a.criterio}`}>
            {a.criterio}: hasta {a.tope} ({a.puntos} pt)
            {a.lotes?.length ? ` · ${a.lotes.length === 1 ? 'lote' : 'lotes'} ${a.lotes.join(', ')}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

// El máximo por lote sale del guion, no del texto del criterio: el pliego a veces no lo fija.
function MaximosPorLote({ maximos }) {
  if (!maximos?.length) return null;
  return (
    <div data-testid="precio-maximo-lote" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDE}` }}>
      <div style={{ fontSize: 12, color: TINTA_2, marginBottom: 6 }}>Precio máximo por lote (del guion)</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: TINTA, lineHeight: 1.55 }}>
        {maximos.map((x, i) => (
          <li key={`${i}-${x.lote}`}>{textoMaximoLote(x)}</li>
        ))}
      </ul>
    </div>
  );
}

function Criterio({ c, deFicha }) {
  return (
    <li style={{ fontSize: 12.5, color: TINTA }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span>
          {sinMaximoCero(c.descripcion)}
          {deFicha ? (c.tipo === 'formula' ? ' · fórmula' : ' · juicio de valor') : ''}
        </span>
        <span className="tabular-nums" style={{ color: TINTA_2 }}>
          {c.peso ?? '—'}
        </span>
      </div>
      {typeof c.peso === 'number' && (
        <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: SUPERFICIE_2 }}>
          <div
            style={{
              width: `${Math.min(100, c.peso)}%`,
              height: 4,
              borderRadius: 2,
              background: c.tipo === 'juicio_valor' ? HERMES : TINTA,
            }}
          />
        </div>
      )}
    </li>
  );
}

// Criterios de la ficha si la hay (con tipo y subcriterios); si no, los de la PLACSP.
function Criterios({ f }) {
  const deFicha = f.go_no_go?.ficha?.aprobada?.datos?.criterios ?? [];
  const criterios = deFicha.length ? deFicha : (f.datos?.criterios ?? []);
  if (!criterios.length)
    return (
      <div style={{ fontSize: 12.5, color: TINTA_2 }}>
        La PLACSP no publica criterios; saldrán en la ficha al leer el pliego.
      </div>
    );
  return (
    <>
      <div style={{ fontSize: 12, color: TINTA_2, marginBottom: 6 }}>
        {deFicha.length ? 'De la ficha (pliego)' : 'De la PLACSP'}
      </div>
      <ul
        data-testid="expediente-criterios"
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {criterios.map((c, i) => (
          <Criterio key={i} c={c} deFicha={deFicha.length > 0} />
        ))}
      </ul>
      <MaximosPorLote maximos={f.oferta?.precios_maximos} />
    </>
  );
}

const TONO_PLIEGO = { descargado: 'ok', error: 'impide' };
// Lo que dice la Biblioteca del documento bajado: si no se lee, la ficha no puede usarlo.
const NO_LEGIBLE = new Set(['error', 'escaneado', 'formato_no_legible']);

// Lo publicado que falta en Drive (o lo citado que no es ningún pliego): sin esto, un anexo con
// criterios o el modelo que hay que rellenar podía faltar sin que nadie lo notara.
function FaltanPliegos({ completitud, f, onCambio }) {
  const [abierto, setAbierto] = useState(null);
  const aviso = avisoPliegos(completitud);
  if (!aviso) return null;
  const faltan = completitud?.faltan ?? [];
  return (
    <div style={{ marginBottom: 10 }} data-testid="faltan-pliegos">
      <Aviso tono="aviso">
        <strong>{aviso.titulo}</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {aviso.lineas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {faltan.map((x, i) => (
          <div
            key={`${i}-${x.nombre}`}
            data-testid={`falta-pliego-${i}`}
            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12.5 }}
          >
            <span>{x.nombre}</span>
            <Boton testid={`subirlo-aqui-${i}`} onClick={() => setAbierto(abierto === i ? null : i)}>
              Subirlo aquí
            </Boton>
            {urlEnlazable(f.url) && (
              <a
                data-testid={`abrir-placsp-${i}`}
                href={urlEnlazable(f.url)}
                target="_blank"
                rel="noreferrer"
                style={{ color: TINTA }}
              >
                Abrir en la PLACSP
              </a>
            )}
          </div>
        ))}
        {abierto !== null && <SubirPliego id={f.id} sinIndexar={subidosSinIndexar(f.pliegos)} onCambio={onCambio} />}
      </Aviso>
    </div>
  );
}

function Pliego({ p, i }) {
  const origen = etiquetaOrigen(p);
  return (
    <div
      data-testid={`pliego-${i}`}
      data-estado={p.estado}
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0', flexWrap: 'wrap' }}
    >
      <FileText size={13} color={TINTA_2} aria-hidden="true" />
      {p.ruta ? (
        <a href={urlDocumento(p.ruta)} target="_blank" rel="noreferrer" style={{ color: TINTA }}>
          {p.nombre}
        </a>
      ) : (
        <span style={{ color: TINTA_2 }}>{p.nombre}</span>
      )}
      <Chip tono={TONO_PLIEGO[p.estado]} punto={false}>
        {p.estado}
      </Chip>
      {origen && (
        <span data-testid={`pliego-origen-${i}`} style={{ fontSize: 12, color: TINTA_2 }}>
          {origen}
        </span>
      )}
      {p.tipo === 'deuc' && (
        <span style={{ fontSize: 12, color: TINTA_2 }}>Petición del DEUC: impórtala en el servicio DEUC</span>
      )}
      {p.error && <span style={{ fontSize: 12, color: IMPIDE }}>{p.error}</span>}
      {NO_LEGIBLE.has(p.estado_indice) && (
        <span style={{ fontSize: 12, color: RIESGO }}>No se puede leer: {p.error_indice}</span>
      )}
      {p.estado_indice === 'sin_indexar' && (
        <span style={{ fontSize: 12, color: TINTA_2 }}>Indexándose en la Biblioteca…</span>
      )}
      {p.estado_indice === 'ok' && p.paginas ? (
        <span style={{ fontSize: 12, color: TINTA_2 }}>{p.paginas} págs.</span>
      ) : null}
    </div>
  );
}

function ListaPliegos({ f, onCambio, pliegos = [], documentos = [], completitud = null }) {
  if (pliegos.length)
    return [
      <FaltanPliegos key="faltan" completitud={completitud} f={f} onCambio={onCambio} />,
      ...pliegos.map((p, i) => <Pliego key={`${i}-${p.nombre}`} p={p} i={i} />),
    ];
  if (!documentos.length) return <div style={{ fontSize: 12.5, color: TINTA_2 }}>Sin documentos publicados.</div>;
  return (
    <div style={{ fontSize: 12.5, color: TINTA_2 }}>
      {documentos.length} documentos en la PLACSP. Se descargan a Drive cuando la oportunidad pasa la criba.
    </div>
  );
}

// La Biblioteca filtrada por la carpeta de los pliegos descargados (sus notas).
function DocumentosDeLaOferta({ carpeta }) {
  return (
    <a
      data-testid="expediente-documentos-oferta"
      href={rutaA(rutaCarpetaBiblioteca(carpeta))}
      title={`Notas de la Biblioteca en ${carpeta}`}
      style={{ fontSize: 12.5, color: TINTA }}
    >
      Documentos de esta oferta
    </a>
  );
}

/**
 * El bloque «Pliegos» con, si hay pliegos descargados, sus notas en la Biblioteca; las carpetas de
 * Drive están en la cabecera de la ficha.
 */
function PliegosExpediente({ f, onCambio }) {
  const carpeta = carpetaDeOferta(f.pliegos);
  const extra = carpeta ? <DocumentosDeLaOferta carpeta={carpeta} /> : null;
  return (
    <Bloque titulo="PLIEGOS" extra={extra}>
      <ListaPliegos
        f={f}
        onCambio={onCambio}
        pliegos={f.pliegos}
        documentos={f.datos?.documentos}
        completitud={f.completitud_pliegos}
      />
      {f.estado !== 'sin_oportunidad' && (
        <SubirPliego id={f.id} sinIndexar={subidosSinIndexar(f.pliegos)} onCambio={onCambio} />
      )}
    </Bloque>
  );
}

// El resumen de la ficha (Hermes, del pliego): de qué va en tres frases, con su fuente aparte.
function DeQueVa({ resumen }) {
  const r = partesResumen(resumen);
  if (!r) return null;
  return (
    <Bloque titulo="DE QUÉ VA">
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: TINTA }}>{r.texto}</p>
      {r.fuente && <div style={{ marginTop: 4, fontSize: 12, color: TINTA_2 }}>Fuente: {r.fuente}</div>}
    </Bloque>
  );
}

function PorQuePrefiltro({ f }) {
  if (!f.motivo_prefiltro) return null;
  return (
    <details data-testid="por-que-prefiltro" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDE}` }}>
      <summary style={{ fontSize: 11.5, color: TINTA_2, cursor: 'pointer' }}>Por qué pasó el prefiltro</summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, color: TINTA, lineHeight: 1.55 }}>
        {explicarPrefiltro(f.motivo_prefiltro, f.cpvs).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

function Datos({ f }) {
  return (
    <Bloque titulo="DATOS">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <Dato label="Presupuesto sin IVA">{euros(f.importe)}</Dato>
        <Dato label="Valor estimado">{euros(f.valor_estimado)}</Dato>
        <Dato label="Lotes">{f.lotes?.length ? plural(f.lotes.length, 'lote') : 'Sin lotes'}</Dato>
        <Dato label="Fin de plazo">{textoPlazo(plazo(f.fecha_limite), true)}</Dato>
        <Dato label="Tipo">{f.tipo}</Dato>
        <Dato label="Procedimiento">{f.procedimiento}</Dato>
        <Dato label="Lugar">{f.lugar}</Dato>
        <Dato label="CPV">{f.cpvs?.join(', ')}</Dato>
        {textoIdiomaTitulo(f.idioma) && <Dato label="Idioma del título">{IDIOMAS[f.idioma]}</Dato>}
      </div>
      <PorQuePrefiltro f={f} />
      {f.fuente === 'agregadas' && (
        <div style={{ fontSize: 12, color: TINTA_2, marginTop: 8 }}>
          Publicada en una plataforma autonómica o local, agregada a la PLACSP.
        </div>
      )}
    </Bloque>
  );
}

function useEscritura(onCambio) {
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const hacer = async (clave, fn, texto) => {
    setOcupado(clave);
    try {
      await fn();
      setAviso({ tono: 'info', texto });
      onCambio();
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setOcupado(null);
    }
  };
  return { aviso, ocupado, hacer };
}

// «Mover a…»: solo los estados distintos al actual (pedir el mismo no es un cambio).
// Pasar a preparación una en rojo o retirada pide la misma confirmación que «Preparar la oferta».
function MoverA({ f, ocupado, hacer }) {
  const opciones = opcionesMover(f.estado);
  const [destino, setDestino] = useState('');
  const [pide, setPide] = useState(null);
  if (!opciones.length) return null;
  const mover = () => hacer('estado', () => licitacionesApi.cambiar(f.id, { estado: destino }), 'Estado guardado.');
  const pedir = () => (destino === 'en_preparacion' && preguntaPreparar(f) ? setPide(preguntaPreparar(f)) : mover());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12.5, color: TINTA_2 }}>
          Mover a…{' '}
          <select
            className="input-field"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            data-testid="mover-a"
            style={{ marginLeft: 4 }}
          >
            <option value="">Elige el estado</option>
            {opciones.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Boton escribe testid="mover-a-guardar" disabled={!destino} cargando={ocupado === 'estado'} onClick={pedir}>
          Mover
        </Boton>
      </div>
      {pide && (
        <Confirmacion
          pregunta={pide}
          textoSi="Preparar la oferta"
          onSi={() => {
            setPide(null);
            mover();
          }}
          onNo={() => setPide(null)}
        />
      )}
    </div>
  );
}

/** Notas internas y estado (sustituye a las píldoras «Decisión del equipo»). */
function NotasYEstado({ f, onCambio }) {
  const [notas, setNotas] = useState(f.notas ?? '');
  const { aviso, ocupado, hacer } = useEscritura(onCambio);
  return (
    <Bloque titulo="NOTAS Y ESTADO">
      <div data-testid="notas-y-estado">
        <MoverA f={f} ocupado={ocupado} hacer={hacer} />
        <textarea
          className="input-field"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={3}
          maxLength={5000}
          data-testid="notas"
          placeholder="Notas internas: por qué sí o por qué no, quién se encarga…"
          aria-label="Notas"
          style={{ width: '100%', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <Boton
            Icono={Save}
            escribe
            testid="notas-guardar"
            cargando={ocupado === 'notas'}
            onClick={() => hacer('notas', () => licitacionesApi.cambiar(f.id, { notas }), 'Notas guardadas.')}
          >
            Guardar notas
          </Boton>
        </div>
        {aviso && (
          <div style={{ marginTop: 8 }}>
            <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
          </div>
        )}
      </div>
    </Bloque>
  );
}

function CriteriosBloque({ f }) {
  return (
    <Bloque titulo="CRITERIOS DE ADJUDICACIÓN">
      <Criterios f={f} />
      <TopesGuion automaticos={f.oferta?.automaticos} />
    </Bloque>
  );
}

// Cuántos puntos se reparten por juicio de valor (lavanda) y por fórmula (tinta), con los de la ficha.
function Reparto({ criterios }) {
  const r = repartoCriterios(criterios);
  if (!r || !r.total) return null;
  const tramo = (n, color) => (
    <b style={{ display: 'block', height: '100%', width: `${(n / r.total) * 100}%`, background: color }} />
  );
  return (
    <Bloque titulo="REPARTO DE LOS PUNTOS">
      <div
        data-testid="reparto-criterios"
        role="img"
        aria-label={`${r.juicio} puntos por juicio de valor y ${r.formula} por fórmula`}
        style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2, background: SUPERFICIE_2 }}
      >
        {r.juicio > 0 && tramo(r.juicio, HERMES)}
        {r.formula > 0 && tramo(r.formula, TINTA)}
      </div>
      <div
        className="tabular-nums"
        style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12.5, color: TINTA }}
      >
        <span>
          Juicio de valor (sobre técnico): <b>{r.juicio}</b>
        </span>
        <span>
          Fórmulas (automáticos y precio): <b>{r.formula}</b>
        </span>
      </div>
    </Bloque>
  );
}

// La recomendación de la ficha de Hermes (con los pliegos leídos) o, sin ficha, la de la criba.
function Recomendacion({ f }) {
  const rec = f.go_no_go?.ficha?.aprobada?.datos?.recomendacion;
  const motivo = rec?.motivo ?? f.motivo_ia;
  if (!motivo) return null;
  const decision = { go: 'ir', no_go: 'no ir', revisar: 'revisarla' }[rec?.decision] ?? null;
  return (
    <MarcaHermes
      etiqueta={decision ? `Hermes recomienda ${decision}` : 'Opinión de Hermes en la criba'}
      testid="resumen-recomendacion"
    >
      {motivo}
    </MarcaHermes>
  );
}

/** La pestaña Resumen: de qué va, la recomendación de Hermes, datos, lotes, pliegos y notas con el estado. */
export function ResumenFicha({ f, onCambio }) {
  return (
    <>
      <DeQueVa resumen={f.go_no_go?.ficha?.aprobada?.datos?.resumen} />
      <Recomendacion f={f} />
      <EncajeDesglose encaje={f.encaje} />
      <Datos f={f} />
      {/* Sin los lotes de interés en la key: al guardar, la recarga montaba otro componente y se perdía el aviso de qué rehace Hermes. */}
      <LotesLicitacion
        key={`lotes-${f.id}`}
        id={f.estado !== 'sin_oportunidad' ? f.id : null}
        lotes={f.lotes}
        presentacion={f.go_no_go?.presentacion}
        ambito={f.go_no_go?.ambito}
        onCambio={onCambio}
      />
      <PliegosExpediente f={f} onCambio={onCambio} />
      {f.estado !== 'sin_oportunidad' && <NotasYEstado key={f.id} f={f} onCambio={onCambio} />}
    </>
  );
}

/** La pestaña Criterios de valoración: el reparto de los puntos y los criterios de los lotes de interés. */
export function CriteriosFicha({ f }) {
  const vista = criteriosDeLotes(f, idsInteres(f), false);
  return (
    <>
      <Reparto criterios={vista.go_no_go?.ficha?.aprobada?.datos?.criterios ?? []} />
      <CriteriosBloque f={vista} />
    </>
  );
}

function Buscador({ texto, setTexto, cuentas }) {
  const total = cuentas ? cuentas.requisitos + cuentas.criterios + cuentas.pliegos : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Search size={14} color={TINTA_2} aria-hidden="true" />
        <input
          className="input-field"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={100}
          aria-label="Buscar en el expediente"
          placeholder="Buscar en el expediente (requisitos, criterios, pliegos)"
          data-testid="expediente-buscar"
          style={{ flex: 1 }}
        />
      </label>
      {cuentas && (
        <div data-testid="expediente-resultados" style={{ fontSize: 12, color: TINTA_2 }}>
          {total
            ? `${plural(cuentas.requisitos, 'requisito')} · ${plural(cuentas.criterios, 'criterio')} · ${plural(cuentas.pliegos, 'pliego')}`
            : 'Nada en el expediente dice eso.'}
        </div>
      )}
    </div>
  );
}

// Los requisitos de la vista (PLACSP y ficha), como los enseña la ficha.
const requisitosDe = (f) =>
  requisitosALaVista(f.go_no_go?.requisitos ?? [], requisitosDeFicha(f.go_no_go?.ficha?.aprobada, f.citas_requisitos))
    .lista;

// Los criterios del bloque de criterios (de la ficha o de la PLACSP) y lo del guion por lote.
function criteriosDeLotes(f, lotes, todos) {
  const de = (items) => filtrarPorLotes(items ?? [], lotes, todos);
  const aprobada = f.go_no_go?.ficha?.aprobada;
  const ficha = aprobada?.datos
    ? {
        ...f.go_no_go.ficha,
        aprobada: { ...aprobada, datos: { ...aprobada.datos, criterios: de(aprobada.datos.criterios) } },
      }
    : f.go_no_go?.ficha;
  const oferta = f.oferta && {
    ...f.oferta,
    automaticos: de(f.oferta.automaticos),
    precios_maximos: de(f.oferta.precios_maximos),
  };
  return {
    ...f,
    go_no_go: f.go_no_go && { ...f.go_no_go, ficha },
    datos: { ...(f.datos ?? {}), criterios: de(f.datos?.criterios) },
    oferta,
  };
}

// «3 excluyentes por confirmar: …», cada uno a su fila de las comprobaciones si casa con una; sin pareja, sin enlace.
function Excluyentes({ f, bloqueos }) {
  const { n, items } = resumenExcluyentes(filtrarPorLotes(requisitosDe(f), idsInteres(f)), bloqueos, f.id);
  if (!n) return null;
  return (
    <div data-testid="expediente-excluyentes" style={{ fontSize: 13, color: TINTA, lineHeight: 1.55 }}>
      <b style={{ color: RIESGO }}>{plural(n, 'excluyente')} por confirmar:</b>{' '}
      {items.map((x, i) => (
        <span key={`${i}-${x.etiqueta}`}>
          {i > 0 && ', '}
          {x.ruta ? (
            <a href={x.ruta} data-testid={`expediente-excluyente-${i}`} style={{ color: TINTA }}>
              {x.etiqueta}
            </a>
          ) : (
            <span data-testid={`expediente-excluyente-${i}`}>{x.etiqueta}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// Con lotes de interés y algo de otros lotes, se puede ver el contrato entero.
function VerTodos({ f, lotes, todos, setTodos }) {
  const ocultos = requisitosDe(f).length - filtrarPorLotes(requisitosDe(f), lotes).length;
  if (!lotes.length || !ocultos) return null;
  const texto = todos
    ? 'Ver solo los lotes de interés'
    : `Ver todos los lotes (${plural(ocultos, 'requisito')} de otros lotes)`;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: TINTA_2 }}>
      <span>
        {todos
          ? 'Todos los lotes del contrato.'
          : `Solo ${lotes.length === 1 ? 'el lote' : 'los lotes'} de interés: ${lotes.join(', ')}.`}
      </span>
      <Boton testid="expediente-todos" onClick={() => setTodos(!todos)}>
        {texto}
      </Boton>
    </div>
  );
}

/**
 * La pestaña Requisitos: por áreas, con solo lo de los lotes de interés salvo «Ver todos los
 * lotes» y los excluyentes por confirmar arriba (cada uno a su fila de las comprobaciones). Al buscar se
 * enseñan los requisitos, criterios y pliegos que lo contienen.
 */
export function RequisitosFicha({ f, onCambio }) {
  const [texto, setTexto] = useState('');
  const [todos, setTodos] = useState(false);
  const comprobaciones = useComprobaciones(f.id);
  const comentarios = useComentarios(f.id);
  const lotes = idsInteres(f);
  const { f: vista, filtrada, cuentas } = filtrarExpediente(criteriosDeLotes(f, lotes, todos), texto);
  return (
    <div data-testid="expediente" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Excluyentes f={f} bloqueos={comprobaciones.data?.bloqueos ?? []} />
      <VerTodos f={f} lotes={lotes} todos={todos} setTodos={setTodos} />
      <Buscador texto={texto} setTexto={setTexto} cuentas={cuentas} />
      {filtrada && <CriteriosBloque f={vista} />}
      {vista.go_no_go && (
        <FichaGoNoGo
          ficha={vista}
          onCambio={onCambio}
          sinCriterios
          lotes={lotes}
          mostrarTodos={todos}
          comentarios={comentarios}
        />
      )}
      {filtrada && <PliegosExpediente f={vista} onCambio={onCambio} />}
    </div>
  );
}
