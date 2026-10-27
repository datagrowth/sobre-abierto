// Panel de conexión con Google Drive: estado, conexión, elección de la carpeta de conocimiento y desconexión.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import driveApi, { DRIVE_CONNECT_URL } from '../../lib/driveApi';
import {
  TINTA,
  TINTA_2,
  HERMES_PUNTO,
  BORDE,
  LIENZO,
  OK_TEXTO,
  RIESGO,
  IMPIDE,
  RADIUS,
  RADIUS_PANEL,
  FONT_MONO,
  SOMBRA_CAPA,
  VELO,
} from '../../lib/tema';
import { relativeTime } from '../Biblioteca/bibliotecaAyudas';
import { BotonEnlace, Code } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton } from '../ui';
import { estadoCopia } from '../../lib/copiaFormato';

const OK = OK_TEXTO;
const ERR = IMPIDE;
const ROOT = { id: 'root', name: 'Mi unidad' };
const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const Text = ({ children, color = TINTA_2 }) => <div style={{ fontSize: 13, color, lineHeight: 1.6 }}>{children}</div>;

function SetupNeeded({ redirectUri }) {
  return (
    <>
      <Text>
        Para conectar Drive faltan las credenciales de Google en Dokploy (<Code>GDRIVE_CLIENT_ID</Code> y{' '}
        <Code>GDRIVE_CLIENT_SECRET</Code>). Los pasos están en <Code>docs/operacion.md</Code> → Google Drive.
      </Text>
      <Text>URI de redirección autorizada que debes poner en Google Cloud:</Text>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12.5,
          color: TINTA,
          padding: '8px 10px',
          border: `1px solid ${BORDE}`,
          borderRadius: RADIUS,
          wordBreak: 'break-all',
          userSelect: 'all',
        }}
      >
        {redirectUri}
      </div>
    </>
  );
}

function ConnectStep() {
  return (
    <>
      <Text>
        Conecta tu cuenta de Google y elige una carpeta de tu Drive. Hermes sincronizará con ella tus notas, los
        documentos que quieras que lea y lo que genere, y guardará allí una copia de seguridad diaria, salvo que el
        administrador la desactive (<Code>GDRIVE_BACKUP=0</Code> en Dokploy).
      </Text>
      <div>
        <BotonEnlace href={DRIVE_CONNECT_URL} variante="principal">
          Conectar Google Drive
        </BotonEnlace>
      </div>
    </>
  );
}

function SyncState({ sync }) {
  if (!sync) return <Text color={TINTA_2}>Primera sincronización en curso…</Text>;
  if (sync.failed?.length) {
    const reasons = sync.errors || {};
    return (
      <div>
        <Text color={ERR}>Última vuelta {relativeTime(sync.at)} con errores. Se reintenta sola en unos minutos.</Text>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: TINTA_2, lineHeight: 1.6 }}>
          {sync.failed.map((name) => (
            <li key={name}>
              <span style={{ color: TINTA }}>{name}</span>:{' '}
              {reasons[name] || (
                <>
                  detalle en los logs de <Code>drive-sync</Code>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <Text color={OK}>✓ Sincronizado {relativeTime(sync.at)}</Text>;
}

// Desactivada no es un error (se elige con GDRIVE_BACKUP): se dice claro, sin rojo.
const COLOR_COPIA = { activa: OK, atrasada: RIESGO, desactivada: TINTA, desconocida: TINTA_2 };

function BackupState({ copia }) {
  const { estado, lineas } = estadoCopia(copia);
  const [titulo, ...resto] = lineas;
  return (
    <div>
      <Text color={COLOR_COPIA[estado]}>{titulo}</Text>
      {resto.map((linea) => (
        <Text key={linea} color={TINTA_2}>
          {linea}
        </Text>
      ))}
    </div>
  );
}

function Connected({ status, onChangeFolder, onDisconnect, busy }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Text>
        Cuenta: <span style={{ color: TINTA }}>{status.account || 'conectada'}</span>
      </Text>
      <Text>
        Carpeta: <span style={{ color: TINTA }}>{status.folder.path || status.folder.name}</span>
      </Text>
      <Text color={TINTA_2}>Dentro están Notas, Documentos y Salidas, sincronizadas cada pocos minutos.</Text>
      <SyncState sync={status.sync} />
      <BackupState copia={status.copia} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <Boton onClick={onChangeFolder} disabled={busy}>
          Cambiar carpeta
        </Boton>
        {confirming ? (
          <Boton variante="peligro" onClick={onDisconnect} cargando={busy}>
            Sí, desconectar
          </Boton>
        ) : (
          <Boton variante="peligro" onClick={() => setConfirming(true)} disabled={busy}>
            Desconectar
          </Boton>
        )}
      </div>
      {confirming && (
        <Text color={TINTA_2}>Se deja de sincronizar. No se borra nada ni en Drive ni en el servidor.</Text>
      )}
    </>
  );
}

function FolderPicker({ onPicked, onCancel }) {
  const [trail, setTrail] = useState([ROOT]);
  const [folders, setFolders] = useState(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const current = trail[trail.length - 1];
  const path = trail
    .slice(1)
    .map((f) => f.name)
    .join('/');

  useEffect(() => {
    let alive = true;
    driveApi.folders(current.id).then(({ data, error: err }) => {
      if (!alive) return;
      setFolders(data || []);
      setError(err);
    });
    return () => {
      alive = false;
    };
  }, [current.id]);

  const open = (folder) => {
    setFolders(null);
    setTrail((t) => [...t, folder]);
  };
  const goTo = (index) => {
    setFolders(null);
    setTrail((t) => t.slice(0, index + 1));
  };

  const create = async () => {
    setBusy(true);
    const { data, error: err } = await driveApi.createFolder(current.id, newName.trim());
    setBusy(false);
    if (err) return setError(err);
    setNewName('');
    open(data);
  };

  const pick = async () => {
    setBusy(true);
    const { error: err } = await driveApi.selectFolder(current.id, path);
    setBusy(false);
    if (err) return setError(err);
    onPicked();
  };

  return (
    <>
      <Text>
        Elige la carpeta de Drive que usará Hermes. Lo que ya haya en ella y en el servidor se junta; no se borra nada.
      </Text>
      <Breadcrumb trail={trail} onGoTo={goTo} />
      <FolderList folders={folders} onOpen={open} />
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input-field"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nueva carpeta aquí (p. ej. Hermes)"
          aria-label="Nombre de la carpeta nueva"
          style={{ flex: 1, minWidth: 0, padding: '7px 10px' }}
        />
        <Boton onClick={create} disabled={busy || !newName.trim()}>
          Crear
        </Boton>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Boton variante="principal" onClick={pick} disabled={busy || current.id === 'root'}>
          {current.id === 'root' ? 'Entra en una carpeta para usarla' : `Usar «${current.name}»`}
        </Boton>
        {onCancel && (
          <Boton onClick={onCancel} disabled={busy}>
            Cancelar
          </Boton>
        )}
      </div>
    </>
  );
}

function Breadcrumb({ trail, onGoTo }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 12.5, color: TINTA_2 }}>
      {trail.map((f, i) => (
        <span key={f.id}>
          {i > 0 && ' / '}
          <button
            type="button"
            onClick={() => onGoTo(i)}
            disabled={i === trail.length - 1}
            style={{
              color: i === trail.length - 1 ? TINTA : HERMES_PUNTO,
              cursor: i === trail.length - 1 ? 'default' : 'pointer',
              background: 'none',
            }}
          >
            {f.name}
          </button>
        </span>
      ))}
    </div>
  );
}

function FolderList({ folders, onOpen }) {
  const box = { maxHeight: 240, overflowY: 'auto', border: `1px solid ${BORDE}`, borderRadius: RADIUS };
  if (!folders)
    return (
      <div style={{ ...box, padding: 10 }}>
        <Text color={TINTA_2}>Cargando carpetas…</Text>
      </div>
    );
  if (!folders.length)
    return (
      <div style={{ ...box, padding: 10 }}>
        <Text color={TINTA_2}>Aquí no hay carpetas.</Text>
      </div>
    );
  return (
    <div style={box}>
      {folders.map((f) => (
        <button
          type="button"
          key={f.id}
          onClick={() => onOpen(f)}
          className="w-full text-left cursor-pointer"
          style={{
            display: 'block',
            padding: '8px 12px',
            fontSize: 13,
            color: TINTA,
            background: 'transparent',
            borderBottom: `1px solid ${BORDE}`,
          }}
        >
          <span style={{ color: TINTA_2, marginRight: 8 }}>▸</span>
          {f.name}
        </button>
      ))}
    </div>
  );
}

function DriveBody({ status, reload }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!status.configured) return <SetupNeeded redirectUri={status.redirectUri} />;
  if (!status.connected) return <ConnectStep />;
  if (!status.folder || picking) {
    const done = () => {
      setPicking(false);
      reload();
    };
    return <FolderPicker onPicked={done} onCancel={status.folder ? () => setPicking(false) : null} />;
  }

  const disconnect = async () => {
    setBusy(true);
    const { error: err } = await driveApi.disconnect();
    setBusy(false);
    setError(err);
    if (!err) reload();
  };
  return (
    <>
      <Connected status={status} busy={busy} onChangeFolder={() => setPicking(true)} onDisconnect={disconnect} />
      {error && <Aviso tono="error">{error}</Aviso>}
    </>
  );
}

/**
 * Comportamiento de diálogo modal: foco dentro al abrir, Tab y Mayús+Tab sin salir,
 * Esc cierra y, al cerrar, el foco vuelve a quien lo abrió (si no, se perdería en <body>).
 */
function useDialogoModal(ref, onClose) {
  useEffect(() => {
    const previo = document.activeElement;
    ref.current?.focus();
    return () => {
      if (previo instanceof HTMLElement && document.contains(previo)) previo.focus({ preventScroll: true });
    };
  }, [ref]);

  return (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const enfocables = [...ref.current.querySelectorAll(ENFOCABLES)];
    if (!enfocables.length) {
      e.preventDefault();
      return;
    }
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;
    if (e.shiftKey && (activo === primero || activo === ref.current)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };
}

export default function PanelDrive({ onClose, notice }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const dialogo = useRef(null);
  const tituloId = useId();
  const onKeyDown = useDialogoModal(dialogo, onClose);

  useEffect(() => {
    let alive = true;
    driveApi.status().then(({ data, error: err }) => {
      if (!alive) return;
      setStatus(data);
      setError(err);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <>
      <div className="fixed inset-0 z-[60] so-fundido" style={{ background: VELO }} onClick={onClose} />
      <div className="fixed left-0 right-0 z-[61] flex justify-center pointer-events-none" style={{ top: 72 }}>
        <div
          ref={dialogo}
          role="dialog"
          aria-modal="true"
          aria-labelledby={tituloId}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="flex flex-col pointer-events-auto so-baja"
          style={{
            outline: 'none',
            width: 520,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 96px)',
            overflowY: 'auto',
            gap: 12,
            padding: '18px 20px',
            background: LIENZO,
            border: `1px solid ${BORDE}`,
            borderRadius: RADIUS_PANEL,
            boxShadow: SOMBRA_CAPA,
          }}
        >
          <div className="flex items-center justify-between">
            <h2 id={tituloId} style={{ fontSize: 16, fontWeight: 600, color: TINTA, margin: 0 }}>
              Google Drive
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar Google Drive"
              title="Cerrar (Esc)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                color: TINTA_2,
                background: 'transparent',
                border: 'none',
                borderRadius: RADIUS,
                cursor: 'pointer',
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {notice && <Aviso tono={notice.ok ? 'info' : 'error'}>{notice.message}</Aviso>}
          {error && <Aviso tono="error">{error}</Aviso>}
          {!status && !error && <Text color={TINTA_2}>Cargando…</Text>}
          {status && <DriveBody status={status} reload={reload} />}
        </div>
      </div>
    </>
  );
}
