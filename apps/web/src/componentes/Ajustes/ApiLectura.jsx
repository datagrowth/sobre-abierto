// Ajustes › Integraciones, solo admin: los tokens de la API de lectura para BI, uno
// por integración (el token se ve una sola vez, al crearlo; Hermes guarda su huella), y el estado
// del MCP de los agentes. El servidor es quien autoriza: un editor recibiría un 403.
import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { plataformaApi } from '../../lib/plataformaApi';
import { fechaHora } from '../../lib/formato';
import { Aviso, Boton, Campo, Chip, Entrada, Tabla, Tarjeta } from '../ui';

const RECURSOS = 'pipeline, presentadas, indices y lecciones';

function useTokens() {
  const [tokens, setTokens] = useState(null);
  const [aviso, setAviso] = useState(null);
  const cargar = useCallback(
    () =>
      plataformaApi.tokensApi().then(
        (r) => setTokens(r.tokens),
        (e) => setAviso({ tono: 'error', texto: e.message }),
      ),
    [],
  );
  useEffect(() => {
    cargar();
  }, [cargar]);
  return { tokens, aviso, setAviso, cargar };
}

function TokenNuevo({ token, onCopiado }) {
  const copiar = () =>
    navigator.clipboard?.writeText(token).then(
      () => onCopiado({ tono: 'ok', texto: 'Copiado.' }),
      () => onCopiado({ tono: 'aviso', texto: 'No se pudo copiar: selecciónalo y cópialo a mano.' }),
    );
  return (
    <div className="grid gap-2 mb-3" data-testid="token-nuevo">
      <p className="m-0 text-tabla text-tinta">Cópialo ahora: por seguridad no se vuelve a enseñar.</p>
      <div className="flex gap-2">
        <Entrada
          readOnly
          value={token}
          onFocus={(e) => e.target.select()}
          aria-label="Token de la API"
          className="font-mono text-leyenda"
        />
        <Boton Icono={Copy} onClick={copiar} testid="token-copiar">
          Copiar
        </Boton>
      </div>
      <p className="m-0 text-leyenda text-tinta-2">
        En Power BI: Obtener datos › Web › Avanzada, con la dirección{' '}
        <code>{window.location.origin}/api/v1/pipeline</code> y la cabecera
        <code> Authorization</code> con el valor <code>Bearer</code> y el token. Hay {RECURSOS}; cada respuesta trae
        «siguiente» para la página que sigue.
      </p>
    </div>
  );
}

export function ApiLectura() {
  const t = useTokens();
  const [nombre, setNombre] = useState('');
  const [nuevo, setNuevo] = useState(null);
  const crear = (e) => {
    e.preventDefault();
    plataformaApi.crearTokenApi(nombre.trim()).then(
      (r) => {
        setNuevo(r.token);
        setNombre('');
        t.setAviso(null);
        t.cargar();
      },
      (err) => t.setAviso({ tono: 'error', texto: err.message }),
    );
  };
  const revocar = (x) =>
    plataformaApi.revocarTokenApi(x.id).then(
      () => {
        t.setAviso({ tono: 'ok', texto: `Revocado «${x.nombre}»: deja de leer al momento.` });
        t.cargar();
      },
      (err) => t.setAviso({ tono: 'error', texto: err.message }),
    );
  const columnas = [
    { clave: 'nombre', titulo: 'Token' },
    { clave: 'creado_en', titulo: 'Creado', celda: (x) => fechaHora(x.creado_en) },
    { clave: 'ultimo_uso', titulo: 'Último uso', celda: (x) => (x.ultimo_uso ? fechaHora(x.ultimo_uso) : 'Aún no') },
    {
      clave: 'revocar',
      titulo: <span className="sr-only">Revocar</span>,
      celda: (x) => (
        <Boton tamano="pequeno" variante="texto" onClick={() => revocar(x)} testid={`token-revocar-${x.id}`}>
          Revocar
        </Boton>
      ),
    },
  ];
  return (
    <Tarjeta
      titulo="API de lectura"
      subtitulo={`Para Power BI u otra herramienta de BI: solo lectura, un token por integración (${RECURSOS}).`}
      testid="api-lectura"
    >
      {t.aviso && (
        <div className="mb-3">
          <Aviso tono={t.aviso.tono}>{t.aviso.texto}</Aviso>
        </div>
      )}
      {nuevo && <TokenNuevo token={nuevo} onCopiado={t.setAviso} />}
      <form onSubmit={crear} className="flex flex-wrap gap-2 items-end mb-3">
        <div className="flex-1 min-w-48">
          <Campo etiqueta="Para qué es">
            <Entrada
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={60}
              placeholder="p. ej. Power BI"
              data-testid="token-nombre"
            />
          </Campo>
        </div>
        <div className="mb-3">
          <Boton submit Icono={KeyRound} disabled={nombre.trim().length < 2} testid="token-crear">
            Crear token
          </Boton>
        </div>
      </form>
      {t.tokens &&
        (t.tokens.length ? (
          <Tabla
            columnas={columnas}
            filas={t.tokens}
            claveFila={(x) => x.id}
            etiqueta="Tokens de la API"
            testid="tokens-api"
          />
        ) : (
          <p className="m-0 text-tabla text-tinta-2">Aún no hay ningún token.</p>
        ))}
    </Tarjeta>
  );
}

export function EstadoMcp() {
  const [e, setE] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    plataformaApi.estadoMcp().then(setE, (err) => setError(err.message));
  }, []);
  return (
    <Tarjeta
      titulo="MCP"
      extra={e && <Chip tono={e.agentes ? 'ok' : 'neutro'}>{e.agentes ? 'Activo' : 'Sin agentes'}</Chip>}
      testid="estado-mcp"
    >
      {error && <Aviso tono="error">{error}</Aviso>}
      {e && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-tabla">
          <dt className="text-tinta-2">Agentes con acceso</dt>
          <dd className="m-0 text-tinta">{e.agentes}</dd>
          <dt className="text-tinta-2">Última llamada</dt>
          <dd className="m-0 text-tinta">{e.ultima_llamada ? fechaHora(e.ultima_llamada) : 'Ninguna'}</dd>
          <dt className="text-tinta-2">Llamadas en 24 h</dt>
          <dd className="m-0 text-tinta">{e.llamadas_24h}</dd>
        </dl>
      )}
      <p className="m-0 mt-3 text-leyenda text-tinta-2">
        Las herramientas de Licitaciones, Biblioteca y Equipo para Hermes y otros agentes. La clave de cada agente está
        en su registro y se cambia allí (docs/operacion.md).
      </p>
    </Tarjeta>
  );
}
