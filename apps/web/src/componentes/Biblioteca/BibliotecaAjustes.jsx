// Ajustes de la Biblioteca: muestra y cambia la ruta de la bóveda y el estado del motor.
import { useEffect, useState, useCallback } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import { TINTA_2, OK_TEXTO, IMPIDE, FONT_MONO, TINTA } from '../../lib/tema';
import { Aviso, Boton } from '../ui';
import { Bloque } from '../comun/ui';
import { engineDown } from './bibliotecaAyudas';
import { Centered, EngineDown, Code, ErrorLegible } from './bibliotecaUi';

function settingsError(e) {
  return engineDown(e) ? 'engine' : e.message || 'Error';
}

export default function BibliotecaAjustes() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [vaultInput, setVaultInput] = useState('');
  const [checkMsg, setCheckMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // Ajustes guardados → formulario. El estado solo cambia al llegar la respuesta.
  const applySettings = useCallback((data) => {
    setS(data);
    setErr(null);
    setVaultInput(data.vault_path || '');
  }, []);
  const load = useCallback(
    () => bibliotecaApi.settings.get().then(applySettings, (e) => setErr(settingsError(e))),
    [applySettings],
  );
  useEffect(() => {
    let alive = true;
    bibliotecaApi.settings.get().then(
      (data) => {
        if (alive) applySettings(data);
      },
      (e) => {
        if (alive) setErr(settingsError(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [applySettings]);

  // Los errores no se borran solos: hay que poder leerlos (y abrir el detalle) sin prisa.
  const flash = (texto, detalle) => {
    const aviso = { texto, detalle };
    setToast(aviso);
    if (!detalle) setTimeout(() => setToast((actual) => (actual === aviso ? null : actual)), 3500);
  };
  const fallo = (accion) => (e) => flash(`No se pudo ${accion}.`, e?.message || 'Error');

  const checkVault = async () => {
    setCheckMsg('comprobando…');
    try {
      const r = await bibliotecaApi.settings.check(vaultInput.trim());
      setCheckMsg(r.ok ? `✓ válida · ${r.markdown_count ?? '?'} notas` : `✕ ${r.message || 'no válida'}`);
    } catch (e) {
      setCheckMsg(`✕ ${e.message}`);
    }
  };
  const saveVault = async () => {
    setBusy(true);
    try {
      await bibliotecaApi.settings.saveVault(vaultInput.trim());
      flash('Carpeta de notas guardada');
      await load();
    } catch (e) {
      fallo('guardar la carpeta de notas')(e);
    } finally {
      setBusy(false);
    }
  };
  const clearVault = async () => {
    setBusy(true);
    try {
      await bibliotecaApi.settings.clearVault();
      flash('Carpeta de notas desvinculada');
      setVaultInput('');
      await load();
    } catch (e) {
      fallo('desvincular la carpeta de notas')(e);
    } finally {
      setBusy(false);
    }
  };
  const createVaultFolder = async () => {
    const target = vaultInput.trim() || s.suggested_vault_path || '';
    if (!target) return;
    setBusy(true);
    try {
      const r = await bibliotecaApi.settings.createVault(target);
      setVaultInput(r.vault_path);
      setCheckMsg(null);
      flash(r.created ? `Carpeta creada y configurada · ${r.vault_path}` : `Carpeta configurada · ${r.vault_path}`);
      await load();
    } catch (e) {
      fallo('crear la carpeta')(e);
    } finally {
      setBusy(false);
    }
  };
  if (err === 'engine') return <EngineDown />;
  if (err)
    return (
      <Centered>
        <ErrorLegible
          texto="No se pudieron cargar los ajustes de la Biblioteca. Prueba de nuevo en unos segundos."
          detalle={err}
        />
      </Centered>
    );
  if (!s)
    return (
      <Centered>
        <span style={{ color: TINTA_2, fontSize: 13 }}>Cargando ajustes…</span>
      </Centered>
    );

  const vs = s.vault_path_status || {};
  const readOnly = !s.editable;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
      {toast &&
        (toast.detalle ? <ErrorLegible texto={toast.texto} detalle={toast.detalle} /> : <Aviso>{toast.texto}</Aviso>)}
      {readOnly && (
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>
          Modo servidor: los ajustes los gestiona el administrador (solo lectura).
        </div>
      )}

      <Bloque titulo="CARPETA DE NOTAS">
        <div style={{ fontSize: 12.5, color: TINTA_2, lineHeight: 1.6, marginBottom: 10 }}>
          Carpeta de notas markdown que la Biblioteca de Conocimiento analiza: cualquier carpeta con tus archivos{' '}
          <Code>.md</Code>.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            className="input-field"
            value={vaultInput}
            disabled={readOnly}
            placeholder="/ruta/a/tus/notas"
            aria-label="Ruta de la carpeta de notas"
            onChange={(e) => setVaultInput(e.target.value)}
            style={{ flex: 1, minWidth: 0, padding: '7px 10px', fontFamily: FONT_MONO }}
          />
          <Boton onClick={checkVault} disabled={readOnly || !vaultInput.trim()}>
            Comprobar
          </Boton>
          <Boton variante="principal" onClick={saveVault} disabled={readOnly || busy || !vaultInput.trim()}>
            Guardar
          </Boton>
        </div>
        {checkMsg && (
          <div
            style={{
              fontSize: 12,
              color: checkMsg.startsWith('✓') ? OK_TEXTO : checkMsg.startsWith('✕') ? IMPIDE : TINTA_2,
              marginBottom: 8,
            }}
          >
            {checkMsg}
          </div>
        )}
        {/* Crear carpeta (opt-in): para quien empieza de cero o escribió una ruta que no existe */}
        {!readOnly && (
          <div
            style={{
              fontSize: 12,
              color: TINTA_2,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              marginBottom: 8,
            }}
          >
            <span>¿Aún no tienes carpeta de notas?</span>
            <Boton onClick={createVaultFolder} disabled={busy}>
              Crear carpeta
            </Boton>
            <span>
              se creará vacía en{' '}
              <Code>{vaultInput.trim() || s.suggested_vault_path || '~/Documents/Biblioteca de Conocimiento'}</Code>
            </span>
          </div>
        )}
        <div style={{ fontSize: 12, color: TINTA_2, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>
            Estado:{' '}
            {vs.ok ? (
              <span style={{ color: OK_TEXTO }}>✓ {vs.markdown_count ?? 0} notas</span>
            ) : (
              <span style={{ color: TINTA }}>sin configurar</span>
            )}
          </span>
          {s.vault_path_set && (
            <Boton variante="peligro" onClick={clearVault} disabled={readOnly || busy}>
              Desvincular
            </Boton>
          )}
        </div>
      </Bloque>
    </div>
  );
}
