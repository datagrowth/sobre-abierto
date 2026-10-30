// Documentos de lo que se presenta: una tarjeta por archivo electrónico y,
// dentro, por lote, sacadas del guion vigente. Cada documento dice su tipo (lo rellena Hermes,
// certificado de empresa, certificado que no tenemos, lo genera Hermes) y su estado, que no se
// elige: lo da la verificación de las comprobaciones. La persona abre, acepta un borrador sin evidencia
// exigida o dice que no aplica, con motivo; un certificado o una declaración se pueden reutilizar de la
// carpeta Empresa o de una oferta anterior (ReutilizarDocumento). Hermes nunca firma ni presenta.
import { useEffect, useState } from 'react';
import { Check, PenLine, Pencil, Save } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, RIESGO, OK_TEXTO, IMPIDE, RADIUS, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { nuloSi404 } from '../../../lib/apiCliente';
import { enlaceDocumento } from '../../../lib/propuestasFormato';
import { estadoAnexo, leerCambioDocumento } from '../../../lib/documentosOfertaFormato';
import {
  aceptableDeUnaVez,
  cambioConArchivo,
  estadoVerificado,
  lotesDeAmbito,
  tarjetasPorSobre,
  textoOtrosLotes,
  textoVerificados,
  tipoDocumento,
} from '../../../lib/documentosVista';
import AvisoRecarga from '../../comun/AvisoRecarga';
import Confirmacion from '../../comun/Confirmacion';
import useCarga from '../../../hooks/useCarga';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Subtitulo } from '../../comun/listas';
import { Aviso, Boton, Campo, Chip } from '../../ui';
import HojaDatosOferta from './HojaDatosOferta';
import ReutilizarDocumento from './ReutilizarDocumento';
import RelanzarTrabajo from '../RelanzarTrabajo';
import TarjetaDeuc from './TarjetaDeuc';
import { ModeloOriginal, TarjetaAMano, VistaPreviaAnexo } from './Revision/VistaAnexo';

const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };
const COLOR_ESTADO = {
  verificado: OK_TEXTO,
  bloqueado: IMPIDE,
  borrador: TINTA_2,
  no_aplica: TINTA_2,
  pendiente: RIESGO,
};
const TONO_TIPO = { no_tenemos: 'impide', certificado: 'neutro', rellena_hermes: 'neutro', genera_hermes: 'neutro' };

function Abrir({ d }) {
  const rutas = [d.ruta, d.ruta_pdf].filter(Boolean);
  return rutas.map((r) => (
    <a
      key={r}
      href={enlaceDocumento(r)}
      target="_blank"
      rel="noreferrer"
      title={r}
      data-testid="documento-abrir"
      style={{ fontSize: TIPO.texto, color: TINTA, overflowWrap: 'anywhere' }}
    >
      Abrir {r.split('/').at(-1)}
    </a>
  ));
}

// La fila del anexo según su modelo: el DEUC (lo prepara el código), un PDF a mano (el modelo y los
// valores para copiar), uno que no se puede rellenar (el motivo y el modelo) o «Rellenar con Hermes».
function Anexo({ id, d, onCambio }) {
  const a = estadoAnexo(d);
  if (!a) return null;
  if (d.tipo === 'deuc') return <TarjetaDeuc id={id} d={d} deuc={a.deuc} onCambio={onCambio} />;
  if (a.modelo?.tipo === 'a_mano') return <TarjetaAMano id={id} d={d} a={a} />;
  if (!a.rellenable) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {a.motivo && <div style={apagado}>{a.motivo}</div>}
        <ModeloOriginal modelo={a.modelo} />
      </div>
    );
  }
  return <Rellenable id={id} d={d} a={a} onCambio={onCambio} />;
}

function Rellenable({ id, d, a, onCambio }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div>
        <Boton
          Icono={PenLine}
          escribe
          testid="documento-rellenar"
          disabled={Boolean(a.enCurso)}
          cargando={ocupado}
          title={
            a.enCurso
              ? 'Ya está en marcha'
              : 'Hermes rellena el modelo con la hoja de datos; queda como borrador para revisar y firmar'
          }
          onClick={() =>
            hacer(
              () => licitacionesApi.rellenarAnexo(id, d.clave),
              'Hermes rellena el modelo; quedará como borrador para revisar.',
            )
          }
        >
          Rellenar con Hermes
        </Boton>
      </div>
      {a.enCurso && (
        <div role="status" style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
          {a.enCurso} <RelanzarTrabajo id={id} tipo="anexo" onHecho={onCambio} />
        </div>
      )}
      {a.avisos.map((v) => (
        <div key={v} style={{ fontSize: TIPO.pequeno, color: RIESGO }}>
          {v}
        </div>
      ))}
      {aviso && (
        <div
          style={{ fontSize: TIPO.pequeno, color: aviso.tono === 'error' ? RIESGO : TINTA_2 }}
          role={aviso.tono === 'error' ? 'alert' : 'status'}
        >
          {aviso.texto}
        </div>
      )}
      {d.ruta ? <VistaPreviaAnexo d={d} /> : <ModeloOriginal modelo={a.modelo} />}
    </div>
  );
}

// Con un archivo propio, el documento queda preparado: es la comprobación que hoy se puede hacer (el archivo existe).
function EditarDocumento({ id, d, onHecho, onCancelar }) {
  const [campos, setCampos] = useState({ ruta: d.ruta ?? '', nota: d.nota ?? '' });
  const [error, setError] = useState(null);
  const poner = (k) => (e) => setCampos((c) => ({ ...c, [k]: e.target.value }));
  const guardar = async (e) => {
    e.preventDefault();
    const r = leerCambioDocumento(campos, d);
    if (r.error) return setError(r.error);
    try {
      await licitacionesApi.cambiarDocumentoOferta(id, d.clave, cambioConArchivo(r.body, d));
      onHecho();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form onSubmit={guardar} style={{ padding: '4px 0 8px' }}>
      <Campo
        label={`Ruta en Drive de «${d.nombre}»`}
        ayuda="«Salidas/…» o «Conocimiento/…»; vacía para quitarla. Con tu archivo, el documento queda preparado."
      >
        <input className="input-field" value={campos.ruta} onChange={poner('ruta')} style={{ width: '100%' }} />
      </Campo>
      <Campo label="Nota">
        <textarea
          className="input-field"
          rows={2}
          maxLength={1000}
          value={campos.nota}
          onChange={poner('nota')}
          style={{ width: '100%' }}
        />
      </Campo>
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton Icono={Save} variante="principal" escribe testid="documento-guardar" onClick={guardar}>
          Guardar
        </Boton>
        <Boton onClick={onCancelar}>Cancelar</Boton>
      </div>
      {error && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
    </form>
  );
}

function Acciones({ id, d, onCambio, onEditar }) {
  const [pide, setPide] = useState(false);
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const cambiar = (body, texto) => hacer(() => licitacionesApi.cambiarDocumentoOferta(id, d.clave, body), texto);
  const noAplica = (motivo) => {
    setPide(false);
    cambiar({ estado: 'no_aplica', nota: motivo }, `«${d.nombre}»: no aplica.`);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Abrir d={d} />
        {aceptableDeUnaVez(d) && (
          <Boton
            Icono={Check}
            variante="principal"
            escribe
            testid="documento-aceptar"
            cargando={ocupado}
            onClick={() => cambiar({ estado: 'preparado' }, `«${d.nombre}»: aceptado.`)}
          >
            Aceptar el borrador
          </Boton>
        )}
        {d.estado === 'no_aplica' ? (
          <Boton
            escribe
            testid="documento-vuelve"
            cargando={ocupado}
            onClick={() => cambiar({ estado: 'pendiente' }, `«${d.nombre}»: vuelve a contar.`)}
          >
            Sí aplica
          </Boton>
        ) : (
          !pide && (
            <Boton escribe testid="documento-no-aplica" onClick={() => setPide(true)}>
              No aplica, con motivo
            </Boton>
          )
        )}
        <button
          type="button"
          onClick={onEditar}
          data-testid="documento-editar"
          style={{
            background: 'none',
            border: 'none',
            padding: '2px 0',
            color: TINTA_2,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: TIPO.pequeno,
            display: 'inline-flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <Pencil size={11} aria-hidden="true" />
          Ruta y nota
        </button>
      </div>
      {pide && (
        <Confirmacion
          pregunta={`¿«${d.nombre}» no aplica a esta oferta?`}
          detalle="Deja de contar en lo que se presenta. Di por qué, para quien lo revise después."
          textoSi="No aplica"
          conMotivo
          onSi={noAplica}
          onNo={() => setPide(false)}
        />
      )}
      {aviso?.tono === 'error' && (
        <div role="alert" style={{ fontSize: TIPO.pequeno, color: RIESGO }}>
          {aviso.texto}
        </div>
      )}
    </div>
  );
}

function TarjetaDocumento({ id, d, bloqueos, onCambio }) {
  const [editando, setEditando] = useState(false);
  const tipo = tipoDocumento(d, bloqueos);
  const estado = estadoVerificado(d, bloqueos);
  return (
    <article
      data-testid={`documento-${d.clave}`}
      data-estado={estado.clave}
      data-tipo={tipo.clave}
      style={{
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
        <span
          style={{ fontWeight: 600, color: TINTA, fontSize: TIPO.texto, overflowWrap: 'anywhere', flex: '1 1 220px' }}
        >
          {d.nombre}
        </span>
        <Chip tono={TONO_TIPO[tipo.clave]} punto={false}>
          {tipo.texto}
        </Chip>
        {d.obligatorio === false && <Chip>Opcional</Chip>}
      </div>
      <div
        data-testid="documento-estado"
        style={{ fontSize: TIPO.texto, color: COLOR_ESTADO[estado.clave] ?? TINTA_2, overflowWrap: 'anywhere' }}
      >
        {estado.texto}
      </div>
      {(d.avisos ?? []).map((v) => (
        <div key={v} style={{ fontSize: TIPO.pequeno, color: RIESGO }}>
          {v}
        </div>
      ))}
      <Anexo id={id} d={d} onCambio={onCambio} />
      <ReutilizarDocumento id={id} d={d} onCambio={onCambio} />
      <Acciones id={id} d={d} onCambio={onCambio} onEditar={() => setEditando((v) => !v)} />
      {editando && (
        <EditarDocumento
          id={id}
          d={d}
          onHecho={() => {
            setEditando(false);
            onCambio();
          }}
          onCancelar={() => setEditando(false)}
        />
      )}
    </article>
  );
}

function OtrosLotes({ id, otros, bloqueos, onCambio }) {
  const texto = textoOtrosLotes(otros);
  if (!texto) return null;
  return (
    <details data-testid="documentos-otros-lotes" style={{ marginTop: 6 }}>
      <summary style={{ cursor: 'pointer', fontSize: TIPO.texto, color: TINTA_2 }}>
        {texto} <span style={{ color: TINTA_2 }}>(no cuentan: no vamos a esos lotes)</span>
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        {otros.map((d) => (
          <TarjetaDocumento key={d.clave} id={id} d={d} bloqueos={bloqueos} onCambio={onCambio} />
        ))}
      </div>
    </details>
  );
}

function TarjetaSobre({ id, t, lotes, bloqueos, onCambio }) {
  const recuento = textoVerificados(
    t.grupos.flatMap((g) => g.documentos),
    bloqueos,
  );
  return (
    <section
      data-testid="documentos-sobre"
      aria-label={t.archivo}
      style={{ border: `1px solid ${BORDE}`, borderRadius: RADIUS, padding: 10, marginBottom: 10, minWidth: 0 }}
    >
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}
      >
        <h4 style={{ margin: 0, fontSize: TIPO.base, color: TINTA, overflowWrap: 'anywhere' }}>{t.archivo}</h4>
        {recuento && <span style={apagado}>{recuento}</span>}
      </div>
      {t.grupos.map((g) => (
        <div
          key={g.lote ?? 'comun'}
          data-testid={`documentos-lote-${g.lote ?? 'comun'}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}
        >
          {(g.lote || lotes.length > 1) && (
            <Subtitulo>{g.lote ? `Lote ${g.lote}` : 'Comunes a todos los lotes'}</Subtitulo>
          )}
          {g.documentos.map((d) => (
            <TarjetaDocumento key={d.clave} id={id} d={d} bloqueos={bloqueos} onCambio={onCambio} />
          ))}
        </div>
      ))}
      <OtrosLotes id={id} otros={t.otros} bloqueos={bloqueos} onCambio={onCambio} />
    </section>
  );
}

// Mientras Hermes rellena un anexo se recarga cada 15 s (los eventos llegan, pero un run tarda).
function useSondeo(activo, recargar) {
  useEffect(() => {
    if (!activo) return undefined;
    const iv = setInterval(recargar, 15_000);
    return () => clearInterval(iv);
  }, [activo, recargar]);
}

function Documentos({ f, version, bloqueos, recargarComprobaciones }) {
  const carga = useCarga(() => nuloSi404(licitacionesApi.documentosOferta(f.id)), [f.id], version);
  const datos = carga.kind === 'ready' ? carga.data : null;
  useSondeo(Boolean(datos?.documentos?.some((d) => d.anexo?.en_curso)), carga.recargar);
  if (carga.kind === 'error')
    return (
      <div style={{ marginBottom: 8 }}>
        <Aviso tono="error">{carga.message}</Aviso>
      </div>
    );
  if (carga.kind === 'loading') return <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>Cargando…</div>;
  // 404: un servidor que aún no tiene el checklist.
  if (!datos) return null;
  const lotes = lotesDeAmbito(f);
  // Un cambio cambia también la verificación: las comprobaciones se recargan con el documento.
  const tras = () => {
    carga.recargar();
    recargarComprobaciones?.();
  };
  return (
    <section aria-label="Documentos de la oferta" data-testid="documentos" style={{ marginBottom: 8 }}>
      {/* Una recarga fallida (también la del sondeo de 15 s) conserva los datos: sin el aviso parecían al día. */}
      <AvisoRecarga carga={carga} />
      {!datos.documentos?.length && (
        <div data-testid="documentos-sin-guion" style={{ fontSize: TIPO.texto, color: TINTA_2, marginBottom: 8 }}>
          Aún no hay guion: Hermes lo saca del pliego.
        </div>
      )}
      {tarjetasPorSobre(datos.documentos ?? [], lotes).map((t) => (
        <TarjetaSobre key={t.archivo} id={f.id} t={t} lotes={lotes} bloqueos={bloqueos} onCambio={tras} />
      ))}
      <HojaDatosOferta f={f} version={version} lotes={lotes} />
    </section>
  );
}

/**
 * comprobaciones: la que ya tiene cargada las comprobaciones (sus bloqueos dan el estado de cada documento). Con
 * un servidor sin checklist (404) no se enseña nada.
 */
export default function ChecklistOferta({ f, version, comprobaciones, recargarComprobaciones }) {
  return (
    <Documentos
      f={f}
      version={version}
      bloqueos={comprobaciones?.bloqueos ?? []}
      recargarComprobaciones={recargarComprobaciones}
    />
  );
}
