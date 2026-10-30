// Bandeja de propuestas de la Biblioteca: revisar, editar, aprobar o rechazar las notas que propone Hermes.
import { useState } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import { Check, Pencil, X } from 'lucide-react';
import { origenDePropuesta, TIPOS_NOTA } from '../../lib/bibliotecaFormato';
import useCarga from '../../hooks/useCarga';
import { AreaTexto, Chip, Entrada, Esqueleto, Aviso, Boton } from '../ui';
import { TINTA, TINTA_2, LIENZO, BORDE, RADIUS_PANEL } from '../../lib/tema';
import { vaultErrorState } from './bibliotecaAyudas';
import useEstadoCarga from './useEstadoCarga';
import { Centered, EmptyState, NotConfigured, EngineDown, ErrorLegible } from './bibliotecaUi';

async function fetchInbox() {
  try {
    const res = await bibliotecaApi.inbox.list();
    return { kind: 'ready', items: res.items || [] };
  } catch (err) {
    return vaultErrorState(err);
  }
}

// «Editar antes»: el título y el cuerpo, en su sitio; el origen y la fuente no se tocan.
function EditarAntes({ fileName, onGuardado, onCancelar }) {
  const carga = useCarga(() => bibliotecaApi.inbox.get(fileName), [fileName]);
  const [cambio, setCambio] = useState(null);
  const [error, setError] = useState(null);
  if (carga.kind === 'loading') return <Esqueleto lineas={3} />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const v = cambio ?? { title: carga.data.title, body: carga.data.body };
  const guardar = async () => {
    try {
      await bibliotecaApi.inbox.edit(fileName, v);
      onGuardado();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div data-testid={`editar-propuesta-${fileName}`} style={{ flex: '1 1 100%', display: 'grid', gap: 8 }}>
      <Entrada
        value={v.title}
        onChange={(e) => setCambio({ ...v, title: e.target.value })}
        aria-label="Título de la nota"
        maxLength={200}
      />
      <AreaTexto
        value={v.body}
        onChange={(e) => setCambio({ ...v, body: e.target.value })}
        aria-label="Contenido de la nota"
        rows={12}
      />
      {error && <Aviso tono="error">{error}</Aviso>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton variante="principal" onClick={guardar} disabled={!v.title.trim()}>
          Guardar los cambios
        </Boton>
        <Boton variante="texto" onClick={onCancelar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}

export default function BibliotecaBandeja() {
  const [state, load] = useEstadoCarga(fetchInbox);
  const [busy, setBusy] = useState(null); // { fileName, kind } en proceso
  const [toast, setToast] = useState(null); // { tono, texto, detalle? }
  const [editando, setEditando] = useState(null);

  const act = async (item, kind) => {
    const fileName = item.file || item.filename || item.name || item.path;
    setBusy({ fileName, kind });
    try {
      if (kind === 'approve') await bibliotecaApi.inbox.approve(fileName);
      else await bibliotecaApi.inbox.reject(fileName);
      const hecho = {
        tono: 'info',
        texto: `${kind === 'approve' ? 'Aprobada' : 'Rechazada'}: ${item.title || fileName}`,
      };
      setToast(hecho);
      // Solo se borra a sí mismo: un error posterior se queda hasta que lo lean (y abran el detalle).
      setTimeout(() => setToast((actual) => (actual === hecho ? null : actual)), 3000);
      await load();
    } catch (err) {
      setToast({
        tono: 'error',
        texto: `No se pudo ${kind === 'approve' ? 'aprobar' : 'rechazar'} «${item.title || fileName}».`,
        detalle: err?.message,
      });
    } finally {
      setBusy(null);
    }
  };

  if (state.kind === 'loading')
    return (
      <Centered>
        <span style={{ color: TINTA_2, fontSize: 13 }}>Cargando propuestas…</span>
      </Centered>
    );
  if (state.kind === 'not_configured') return <NotConfigured />;
  if (state.kind === 'engine_down') return <EngineDown />;
  if (state.kind === 'error')
    return (
      <Centered>
        <ErrorLegible
          texto="No se pudieron cargar las propuestas. Prueba de nuevo en unos segundos."
          detalle={state.message}
        />
      </Centered>
    );

  const { items } = state;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12.5, color: TINTA_2, padding: '0 14px' }}>
        Notas que propone Hermes (u otra herramienta) y esperan tu visto bueno (carpeta{' '}
        <code style={{ color: TINTA }}>_Propuestas</code>). Al aprobarlas se guardan junto a su documento de origen.
      </div>
      {toast &&
        (toast.tono === 'error' ? (
          <ErrorLegible texto={toast.texto} detalle={toast.detalle} />
        ) : (
          <Aviso tono={toast.tono}>{toast.texto}</Aviso>
        ))}
      {!items.length ? (
        <EmptyState title="Sin propuestas">
          No hay notas pendientes. Lo que proponga Hermes aparecerá aquí para aprobar o rechazar.
        </EmptyState>
      ) : (
        items.map((it, i) => {
          const fileName = it.file || it.filename || it.name || it.path;
          const enCurso = busy?.fileName === fileName ? busy.kind : null;
          return (
            <div
              key={fileName || i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                padding: '10px 14px',
                background: LIENZO,
                border: `1px solid ${BORDE}`,
                borderRadius: RADIUS_PANEL,
              }}
            >
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  <Chip tono="hermes" punto={false}>
                    {origenDePropuesta(it.frontmatter)}
                  </Chip>
                  {TIPOS_NOTA[it.frontmatter?.tipo] && <Chip>{TIPOS_NOTA[it.frontmatter.tipo]}</Chip>}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: TINTA,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.title || fileName}
                </div>
                {typeof it.frontmatter?.motivo === 'string' && (
                  <div style={{ fontSize: 12, color: TINTA_2, marginTop: 2 }}>{it.frontmatter.motivo}</div>
                )}
                {it.preview && (
                  <div
                    style={{
                      fontSize: 12,
                      color: TINTA_2,
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {it.preview}
                  </div>
                )}
                {typeof it.frontmatter?.fuente === 'string' && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: TINTA_2,
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    De{' '}
                    <a
                      href={bibliotecaApi.documents.rawUrl(it.frontmatter.fuente)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: TINTA }}
                    >
                      {it.frontmatter.fuente}
                    </a>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                <Boton
                  variante="principal"
                  Icono={Check}
                  onClick={() => act(it, 'approve')}
                  cargando={enCurso === 'approve'}
                  disabled={enCurso === 'reject' || editando === fileName}
                >
                  Aprobar
                </Boton>
                <Boton
                  Icono={Pencil}
                  onClick={() => setEditando(fileName)}
                  disabled={Boolean(enCurso)}
                  testid={`editar-antes-${fileName}`}
                >
                  Editar antes
                </Boton>
                <Boton
                  variante="peligro"
                  Icono={X}
                  onClick={() => act(it, 'reject')}
                  cargando={enCurso === 'reject'}
                  disabled={enCurso === 'approve'}
                >
                  Rechazar
                </Boton>
              </div>
              {editando === fileName && (
                <EditarAntes
                  fileName={fileName}
                  onCancelar={() => setEditando(null)}
                  onGuardado={() => {
                    setEditando(null);
                    setToast({ tono: 'info', texto: 'Propuesta corregida: ya puedes aprobarla.' });
                    load();
                  }}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
