// Ajustes › Integraciones. El calendario de plazos de quien entra: un enlace ICS
// para suscribirse desde Google Calendar u Outlook, que se ve una sola vez al crearlo (Hermes
// guarda solo su huella) y que se revoca o se cambia por otro. La exportación CSV de cada listado
//, con lo de por defecto de su vista (cada vista exporta también con sus filtros). Para un
// admin, los tokens de la API de lectura y el estado del MCP (ApiLectura.jsx).
import { useEffect, useState } from 'react';
import { CalendarPlus, Copy } from 'lucide-react';
import useUsuario from '../../hooks/useUsuario';
import { calendarioApi, urlCalendario } from '../../lib/accesoApi';
import { fechaHora } from '../../lib/formato';
import { licitacionesApi } from '../../lib/licitacionesApi';
import DescargarCsv from '../comun/DescargarCsv';
import { esAdmin } from '../../lib/usuarioActual';
import { Aviso, Boton, Entrada, Esqueleto, Tarjeta } from '../ui';
import { ApiLectura, EstadoMcp } from './ApiLectura';

const EXPORTAR = [
  { clave: 'pipeline', texto: 'Pipeline', url: () => licitacionesApi.csv.pipeline() },
  {
    clave: 'oportunidades',
    texto: 'Oportunidades',
    url: () => licitacionesApi.csv.oportunidades('pestana=por_revisar'),
  },
  { clave: 'presentadas', texto: 'Presentadas', url: () => licitacionesApi.csv.presentadas() },
  { clave: 'competidores', texto: 'Competidores', url: () => licitacionesApi.csv.competidores() },
  { clave: 'organismos', texto: 'Organismos', url: () => licitacionesApi.csv.organismos() },
];

function Exportar() {
  return (
    <Tarjeta
      titulo="Exportar"
      subtitulo="CSV para Excel en español (separador «;» y coma decimal). Desde cada vista se exporta también con sus filtros."
      testid="exportar"
    >
      <div className="flex flex-wrap gap-2">
        {EXPORTAR.map((e) => (
          <DescargarCsv key={e.clave} pequeno url={e.url()} testid={`exportar-${e.clave}`}>
            {e.texto}
          </DescargarCsv>
        ))}
      </div>
    </Tarjeta>
  );
}

function Calendario() {
  const [estado, setEstado] = useState(null);
  const [url, setUrl] = useState(null);
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    calendarioApi.estado().then(setEstado, (e) => setAviso({ tono: 'error', texto: e.message }));
  }, []);
  const crear = () =>
    calendarioApi.crear().then(
      (r) => {
        setEstado(r);
        setUrl(urlCalendario(r, window.location.origin));
        setAviso(null);
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  const revocar = () =>
    calendarioApi.revocar().then(
      (r) => {
        setEstado(r);
        setUrl(null);
        setAviso({ tono: 'ok', texto: 'Enlace revocado: el calendario deja de actualizarse.' });
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  const copiar = () =>
    navigator.clipboard?.writeText(url).then(
      () => setAviso({ tono: 'ok', texto: 'Copiado.' }),
      () => setAviso({ tono: 'aviso', texto: 'No se pudo copiar: selecciónalo y cópialo a mano.' }),
    );
  return (
    <Tarjeta
      titulo="Calendario"
      subtitulo="Las fechas de cierre de las ofertas en preparación, cada una en su hora (Canarias o península)."
      testid="calendario"
    >
      {aviso && (
        <div className="mb-3">
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      {!estado && !aviso && <Esqueleto lineas={2} />}
      {url && (
        <div className="grid gap-2 mb-3">
          <p className="m-0 text-tabla text-tinta">
            Cópialo ahora: por seguridad no se vuelve a enseñar. En Google Calendar, «Otros calendarios › Desde URL».
          </p>
          <div className="flex gap-2">
            <Entrada
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              aria-label="Dirección del calendario"
              className="font-mono text-leyenda"
            />
            <Boton Icono={Copy} onClick={copiar} testid="calendario-copiar">
              Copiar
            </Boton>
          </div>
        </div>
      )}
      {estado?.activo && !url && (
        <p className="m-0 mb-3 text-tabla text-tinta-2">
          Tienes un enlace desde el {fechaHora(estado.creado_en)}
          {estado.ultimo_uso
            ? `; tu calendario lo leyó por última vez el ${fechaHora(estado.ultimo_uso)}`
            : '; aún no lo ha leído ningún calendario'}
          .
        </p>
      )}
      {estado && (
        <div className="flex flex-wrap gap-2">
          <Boton
            variante={!estado.activo ? 'principal' : undefined}
            Icono={CalendarPlus}
            onClick={crear}
            testid="calendario-crear"
          >
            {estado.activo ? 'Revocar y crear otro enlace' : 'Crear el enlace'}
          </Boton>
          {estado.activo && (
            <Boton variante="texto" onClick={revocar} testid="calendario-revocar">
              Revocar
            </Boton>
          )}
        </div>
      )}
      <p className="m-0 mt-3 text-leyenda text-tinta-2">
        Solo lleva título, órgano y plazo, que son públicos. Quien tenga el enlace ve esas fechas: si se comparte sin
        querer, revócalo.
      </p>
    </Tarjeta>
  );
}

export default function IntegracionesVista() {
  const yo = useUsuario();
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', maxWidth: 1040 }}
      data-testid="ajustes-integraciones"
    >
      {yo && !yo.emergencia ? (
        <Calendario />
      ) : (
        <Aviso>El calendario es de cada persona: entra con tu email para tener el tuyo.</Aviso>
      )}
      <Exportar />
      {esAdmin(yo) ? (
        <>
          <ApiLectura />
          <EstadoMcp />
        </>
      ) : (
        <Aviso>Los tokens de la API de lectura y el MCP los gestiona un admin.</Aviso>
      )}
    </div>
  );
}
