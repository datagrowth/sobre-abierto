// Pestaña Revisión: lo generado, revisado antes de firmar. Arriba, el
// estado de la oferta con «Registrar la presentación», que lleva al registro del paquete de aquí
// abajo (apagado si algo impide presentar, como lo frena el servidor). Debajo, qué impide presentar
// con la acción de cada fila (aceptar un riesgo, fijar un precio, suavizar, «Vamos»…), una tarjeta por
// sobre con las comprobaciones de cada documento, lo que Hermes no pudo comprobar, la revisión
// previa de Hermes y el paquete con el kit de firma. Lo que se arregla en un dato abre su apartado
// en la Oferta.
import { Mail, RefreshCw } from 'lucide-react';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { fechaHora } from '../../../lib/formato';
import { cajonDeDestino, filasDeModo, salidaDeDestino } from '../../../lib/comprobacionesFormato';
import { sinSugerenciasEnLoPresentado } from '../../../lib/comprobacionesPresentada';
import {
  ESTADOS,
  ESTADOS_DOCUMENTO,
  destinoDeAccion,
  nombreLegible,
  ordenar,
  resumenCuentas,
  textoLeccionAplicada,
  totalDocumentos,
} from '../../../lib/revisionSobresFormato';
import useComprobaciones from '../../../hooks/useComprobaciones';
import useCarga from '../../../hooks/useCarga';
import { useDatosDetalle } from '../../../hooks/useDetalleOferta';
import { useFocoBloqueo, useFocoPieza } from '../../../hooks/useFocoFilas';
import { ir } from '../../../hooks/useRuta';
import useComentarios from '../../../hooks/useComentarios';
import { Aviso, Boton, Chip, Esqueleto, Tarjeta } from '../../ui';
import Bloqueos from './Bloqueos';
import Comprobado from './Comprobado';
import EstadoOferta from './EstadoOferta';
import PieComprobaciones from './PieComprobaciones';
import RevisionHermes from './Revision/RevisionHermes';

const PIE = 'pie-comprobaciones';

function Comprobacion({ c, onAccion }) {
  const e = c.aceptado ? { texto: 'Aceptado', tono: 'neutro' } : ESTADOS[c.estado];
  return (
    <div
      data-testid={`comprobacion-${c.clave}`}
      data-estado={c.estado}
      className="flex flex-wrap gap-x-3 gap-y-1.5 items-start px-4 py-2.5 border-t border-borde"
    >
      <span className="w-24 shrink-0">
        <Chip tono={e.tono}>{e.texto}</Chip>
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <span className="text-tabla text-tinta">{c.titulo}</span>
        {c.detalle && <div className="text-leyenda text-tinta-2 mt-0.5">{c.detalle}</div>}
      </div>
      {c.accion && (
        <Boton tamano="pequeno" envolver onClick={() => onAccion(c.accion)} testid={`accion-${c.clave}`}>
          {c.accion.texto}
        </Boton>
      )}
    </div>
  );
}

// Lo que el equipo aprendió en otras ofertas y se pasó a la redacción de esta memoria.
function LeccionesAplicadas({ lecciones }) {
  if (!lecciones?.length) return null;
  return (
    <details data-testid="lecciones-aplicadas" className="px-4 py-2.5 border-t border-borde">
      <summary className="text-tabla text-tinta cursor-pointer">Lecciones aplicadas ({lecciones.length})</summary>
      <ul className="mt-1.5 grid gap-1.5">
        {lecciones.map((l) => (
          <li key={l.id} className="text-tabla text-tinta">
            {l.texto}
            <div className={`text-leyenda ${l.cumplida === false ? 'text-riesgo' : 'text-tinta-2'}`}>
              {textoLeccionAplicada(l)}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Documento({ d, onAccion }) {
  return (
    <div data-testid={`revision-doc-${d.clave}`}>
      <div className="flex justify-between items-center gap-3 px-4 pt-3 pb-1.5">
        <span className="text-tabla font-semibold text-tinta min-w-0 break-words">
          {nombreLegible(d.nombre)}
          {d.lote ? ` · lote ${d.lote}` : ''}
        </span>
        <Chip tono={d.estado === 'preparado' ? 'ok' : 'neutro'}>{ESTADOS_DOCUMENTO[d.estado] ?? d.estado}</Chip>
      </div>
      {ordenar(d.comprobaciones).map((c) => (
        <Comprobacion key={c.clave} c={c} onAccion={onAccion} />
      ))}
      <LeccionesAplicadas lecciones={d.lecciones} />
    </div>
  );
}

function Sobre({ s, onAccion }) {
  return (
    <Tarjeta sinRelleno testid="revision-sobre">
      <div className="flex gap-2 items-center px-4 pt-3 pb-2 text-cuerpo font-bold text-tinta">
        <Mail size={16} strokeWidth={1.5} aria-hidden="true" />
        {s.archivo}
      </div>
      {ordenar(s.comprobaciones).map((c) => (
        <Comprobacion key={c.clave} c={c} onAccion={onAccion} />
      ))}
      {s.documentos.map((d) => (
        <Documento key={d.clave} d={d} onAccion={onAccion} />
      ))}
      <div className="h-2" />
    </Tarjeta>
  );
}

function Resumen({ r, onRecargar, onRegistrar }) {
  return (
    <div data-testid="revision-veredicto" className="flex flex-wrap gap-3 items-center justify-between">
      <span className="text-leyenda text-tinta-2">
        Revisados {totalDocumentos(r)} documentos · {resumenCuentas(r.cuentas)} · {fechaHora(r.calculada_en)}
      </span>
      <div className="flex gap-2 flex-wrap">
        <Boton Icono={RefreshCw} onClick={onRecargar} testid="revision-recargar">
          Volver a revisar
        </Boton>
        <Boton
          variante="principal"
          disabled={!r.puede_registrar}
          onClick={onRegistrar}
          testid="revision-registrar"
          title={r.puede_registrar ? undefined : 'Algo impide presentar: resuélvelo antes de registrar'}
        >
          Registrar la presentación
        </Boton>
      </div>
    </div>
  );
}

function Sobres({ carga, onAccion }) {
  if (carga.kind === 'loading') return <Esqueleto lineas={6} />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const r = carga.data;
  return (
    <>
      {r.generales.length > 0 && (
        <Tarjeta sinRelleno testid="revision-generales">
          <div className="px-4 pt-3 pb-2 text-cuerpo font-bold text-tinta">Antes de los sobres</div>
          {ordenar(r.generales).map((c) => (
            <Comprobacion key={c.clave} c={c} onAccion={onAccion} />
          ))}
          <div className="h-2" />
        </Tarjeta>
      )}
      {r.sobres.map((s) => (
        <Sobre key={s.archivo} s={s} onAccion={onAccion} />
      ))}
    </>
  );
}

// Un dato se arregla en su apartado de la Oferta (con el foco en el campo) o fuera (Ajustes › Empresa, los requisitos).
function abrirDestino(destino, irA) {
  const c = cajonDeDestino(destino);
  if (c) {
    irA('oferta', { cajon: c.nombre, campo: c.campo });
    return;
  }
  const salida = salidaDeDestino(destino);
  if (salida === 'ajustes') ir('ajustes');
  else if (salida === 'expediente') irA('requisitos');
}

function Contenido({ f, c, comprobaciones, oferta, carga, foco, irA, onCambio }) {
  const { abiertas, noComprobadas } = filasDeModo(c, 'completa');
  const { resaltada, resuelta } = useFocoBloqueo(foco?.bloqueo, abiertas.concat(noComprobadas), c);
  useFocoPieza(foco?.testid ?? null, Boolean(oferta.data));
  const recargar = () => {
    comprobaciones.recargar();
    oferta.recargar();
    carga.recargar();
    onCambio?.();
  };
  const comentarios = useComentarios(f.id);
  const fila = {
    idLicitacion: f.id,
    resaltada,
    onAbrirCajon: (destino) => abrirDestino(destino, irA),
    recargar,
    oferta: oferta.data ?? null,
    pliegos: f.pliegos ?? [],
    comentarios,
  };
  // Una comprobación con fila de la oferta lleva a esa fila; «Pedir cambios», a la memoria en la Oferta.
  const alAccion = (accion) => {
    const d = destinoDeAccion(accion);
    if (d?.cajon) irA('oferta', d);
    else if (d) irA('revision', d);
  };
  const r = carga.kind === 'ready' ? carga.data : null;
  return (
    <div data-testid="revision-oferta" className="grid gap-3 min-w-0">
      {comprobaciones.aviso && (
        <div data-testid="comprobaciones-aviso" className="text-leyenda text-tinta-2">
          {comprobaciones.aviso}
        </div>
      )}
      <EstadoOferta
        f={f}
        c={c}
        modo="completa"
        extra={r && <Resumen r={r} onRecargar={recargar} onRegistrar={() => irA('revision', { testid: PIE })} />}
      />
      {resuelta && <Aviso>Eso ya está resuelto.</Aviso>}
      <Bloqueos filas={sinSugerenciasEnLoPresentado(abiertas, oferta.data ?? null)} {...fila} />
      <Sobres carga={carga} onAccion={alAccion} />
      <Comprobado comprobado={c.comprobado} noComprobadas={noComprobadas} {...fila} />
      <RevisionHermes id={f.id} onCambio={recargar} />
      {oferta.data && <PieComprobaciones f={f} o={oferta.data} c={c} onCambio={recargar} />}
    </div>
  );
}

/** foco: { bloqueo | testid } de la ruta (#/…/comprobaciones#bloqueo=…, la cabecera, la Mesa) o de una comprobación. */
export default function RevisionOferta({ f, foco = null, version, irA, onCambio }) {
  const comprobaciones = useComprobaciones(f.id);
  const { oferta } = useDatosDetalle(f.id, false, true);
  const carga = useCarga(() => licitacionesApi.revisionSobres(f.id), [f.id], version);
  if (comprobaciones.kind === 'error') return <Aviso tono="error">{comprobaciones.message}</Aviso>;
  if (!comprobaciones.data) return <Esqueleto lineas={6} />;
  return (
    <Contenido
      f={f}
      c={comprobaciones.data}
      comprobaciones={comprobaciones}
      oferta={oferta}
      carga={carga}
      foco={foco}
      irA={irA}
      onCambio={onCambio}
    />
  );
}
