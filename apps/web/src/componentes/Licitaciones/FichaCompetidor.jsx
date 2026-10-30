// Ficha de un competidor: qué gana, dónde, con qué baja, frente a cuántas ofertas, cómo
// evoluciona y dónde coincide con lo que seguimos. Datos de la PLACSP, sin IA; el
// resumen narrativo lo propone Hermes como nota de la Biblioteca, si se pide.
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { TINTA, TINTA_2 } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { porcentaje } from '../../lib/preciosFormato';
import { eurosCortos, nombreONif, ofertasMedias, textoPyme, textoNif } from '../../lib/competenciaFormato';
import { KPI } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Chip } from '../ui';
import { Bloque, EstadoFicha } from '../comun/ui';
import { BarrasAnio, Celda, Enlace, Fila, Subtitulo, Tabla } from '../comun/listas';
import { Seguimiento, UltimosContratos } from './competenciaUi';
import { plural } from '../../lib/formato';

function Cabecera({ f, soloSector, onSoloSector, onVolver }) {
  const pyme = textoPyme(f.pyme);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {onVolver && (
        <Boton Icono={ArrowLeft} onClick={onVolver}>
          Volver
        </Boton>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 16, color: TINTA, margin: 0, lineHeight: 1.35 }}>{f.nombre ?? f.nif}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <Chip>{textoNif(f.nif)}</Chip>
          {pyme && <Chip title={`Proporción de contratos ganados como pyme: ${porcentaje(f.pyme)}`}>{pyme}</Chip>}
          {f.seguido && (
            <Chip tono="ok" punto={false}>
              seguido
            </Chip>
          )}
          {f.nif_estado === 'no_valido' && (
            <Chip tono="riesgo" punto={false} title="El control del NIF no cuadra: no entra en los índices de mercado">
              NIF no válido
            </Chip>
          )}
          {f.provincia && <Chip>{f.provincia}</Chip>}
          <label style={{ fontSize: 12, color: TINTA_2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={soloSector} onChange={(e) => onSoloSector(e.target.checked)} /> Solo tu
            sector sector
          </label>
        </div>
      </div>
    </div>
  );
}

// Alias con que la publican los órganos y, si es una UTE, sus miembros; si no, las UTE en las que entra.
function Identidad({ f, onVerCompetidor }) {
  const alias = (f.alias ?? []).filter((a) => a !== f.nombre);
  const miembros = f.miembros_ute ?? [];
  const utes = f.utes ?? [];
  if (!alias.length && !miembros.length && !utes.length) return null;
  return (
    <div data-testid="competidor-identidad" style={{ fontSize: 12, color: TINTA_2, lineHeight: 1.6 }}>
      {alias.length > 0 && <div>También publicada como: {alias.join(' · ')}</div>}
      {miembros.length > 0 && (
        <div>
          UTE de:{' '}
          {miembros.map((m, i) => (
            <span key={m.nombre}>
              {i > 0 && ' · '}
              {m.nif && onVerCompetidor ? <Enlace onClick={() => onVerCompetidor(m.nif)}>{m.nombre}</Enlace> : m.nombre}
            </span>
          ))}
        </div>
      )}
      {utes.length > 0 && (
        <div>
          Va en {plural(utes.length, 'UTE', 'UTE')}:{' '}
          {utes.map((u, i) => (
            <span key={u}>
              {i > 0 && ' · '}
              {onVerCompetidor ? <Enlace onClick={() => onVerCompetidor(u)}>{textoNif(u)}</Enlace> : textoNif(u)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Cifras({ f }) {
  const p = f.bajas.percentiles;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <KPI
        label="Contratos ganados"
        value={f.resumen.contratos}
        hint={
          f.resumen.organos
            ? plural(f.resumen.organos, 'órgano distinto', 'órganos distintos')
            : 'órganos sin NIF publicado'
        }
      />
      <KPI
        label="Importe adjudicado"
        value={eurosCortos(f.resumen.importe)}
        hint={`medio ${eurosCortos(f.resumen.importe_medio)}`}
      />
      <KPI
        label="Baja mediana"
        value={porcentaje(p.p50)}
        hint={f.bajas.n ? `P25–P75: ${porcentaje(p.p25)} – ${porcentaje(p.p75)} (${f.bajas.n})` : 'sin bajas creíbles'}
      />
      <KPI
        label="Ofertas cuando gana"
        value={ofertasMedias(f.ofertas.media)}
        hint={f.ofertas.n ? `mediana ${f.ofertas.mediana} · ${f.ofertas.n} con dato` : 'sin dato'}
      />
    </div>
  );
}

function Coincidencias({ lista }) {
  if (!lista.length) return null;
  return (
    <Bloque titulo="COINCIDE CON LO QUE SEGUIMOS">
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: TINTA, lineHeight: 1.6 }}>
        {lista.map((c) => (
          <li key={c.id}>
            {c.titulo} <span style={{ color: TINTA_2 }}>· {c.organo}</span>{' '}
            {c.mismo_organo && (
              <Chip tono="ok" punto={false}>
                mismo órgano
              </Chip>
            )}{' '}
            {c.mismo_cpv && <Chip>mismo CPV</Chip>}
          </li>
        ))}
      </ul>
    </Bloque>
  );
}

function Donde({ f, onVerOrganismo }) {
  return (
    <Bloque titulo="DÓNDE GANA">
      <Tabla
        titulo="Órganos"
        vacio="Los órganos de estos contratos no publican su NIF."
        cabecera={[['Órgano'], ['Contratos', 'd'], ['Importe', 'd'], ['Baja mediana', 'd']]}
      >
        {f.organos.map((o) => (
          <Fila key={o.clave}>
            <Celda largo>
              <Enlace onClick={onVerOrganismo && (() => onVerOrganismo(o.clave))} title="Ver la ficha del órgano">
                {nombreONif(o)}
              </Enlace>
            </Celda>
            <Celda d>{o.contratos}</Celda>
            <Celda d>{eurosCortos(o.importe)}</Celda>
            <Celda d>{porcentaje(o.baja_mediana)}</Celda>
          </Fila>
        ))}
      </Tabla>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Tabla titulo="CPV más frecuentes" cabecera={[['CPV'], ['Contratos', 'd']]}>
            {f.cpvs.map((c) => (
              <Fila key={c.cpv}>
                <Celda>{c.cpv}</Celda>
                <Celda d>{c.contratos}</Celda>
              </Fila>
            ))}
          </Tabla>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Tabla titulo="Territorios" cabecera={[['Comunidad'], ['Contratos', 'd'], ['Importe', 'd']]}>
            {f.territorios.map((t) => (
              <Fila key={t.clave}>
                <Celda>{t.nombre}</Celda>
                <Celda d>{t.contratos}</Celda>
                <Celda d>{eurosCortos(t.importe)}</Celda>
              </Fila>
            ))}
          </Tabla>
        </div>
      </div>
    </Bloque>
  );
}

function Evolucion({ f }) {
  return (
    <Bloque titulo="EVOLUCIÓN">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Subtitulo>Contratos por año</Subtitulo>
          <BarrasAnio grupos={f.por_anio} campo="contratos" etiqueta="Contratos ganados por año" />
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Subtitulo>Importe por año</Subtitulo>
          <BarrasAnio grupos={f.por_anio} campo="importe" formato={eurosCortos} etiqueta="Importe ganado por año" />
        </div>
      </div>
      <Subtitulo>Baja mediana por año y ofertas en los contratos que gana</Subtitulo>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Tabla cabecera={[['Año'], ['Baja mediana', 'd']]}>
            {f.por_anio.map((a) => (
              <Fila key={a.clave}>
                <Celda>{a.clave}</Celda>
                <Celda d>{porcentaje(a.baja_mediana)}</Celda>
              </Fila>
            ))}
          </Tabla>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Tabla cabecera={[['Ofertas'], ['Contratos', 'd']]}>
            {f.ofertas.por_tramo.map((t) => (
              <Fila key={t.clave}>
                <Celda>{t.clave}</Celda>
                <Celda d>{t.n}</Celda>
              </Fila>
            ))}
          </Tabla>
        </div>
      </div>
    </Bloque>
  );
}

function Acciones({ f, onCambio }) {
  const [mensaje, setMensaje] = useState(null);
  const resumir = async () => {
    try {
      await licitacionesApi.resumenCompetidor(f.nif);
      setMensaje({
        tono: 'info',
        texto: 'Hermes preparará un resumen y lo dejará como propuesta de nota en la Biblioteca (Competidores).',
      });
    } catch (e) {
      setMensaje({ tono: 'error', texto: e.message });
    }
  };
  return (
    <Bloque titulo="SEGUIMIENTO">
      <Seguimiento
        key={f.seguido?.actualizado_en ?? 'no'}
        tipo="competidor"
        nif={f.nif}
        seguido={f.seguido}
        onCambio={onCambio}
      />
      <div style={{ marginTop: 10 }}>
        <Boton Icono={Sparkles} onClick={resumir} title="Hermes resume estos datos en una nota para la Biblioteca">
          Resumen con Hermes
        </Boton>
      </div>
      {mensaje && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso>
        </div>
      )}
    </Bloque>
  );
}

// «version» sube con los eventos licitacion*: seguir o dejar de seguir refresca la ficha.
export default function FichaCompetidor({ nif, version, onVolver, onCambio, onVerOrganismo, onVerCompetidor }) {
  const [soloSector, setSoloSector] = useState(false);
  const [estado, setEstado] = useState({ kind: 'loading' });
  const cargar = useCallback(
    () =>
      licitacionesApi.competidor(nif, { soloSector }).then(
        (f) => setEstado({ kind: 'ready', f }),
        (e) => setEstado({ kind: 'error', message: e.message }),
      ),
    [nif, soloSector],
  );
  useEffect(() => {
    cargar();
  }, [cargar, version]);
  const tras = () => {
    cargar();
    onCambio?.();
  };

  if (estado.kind !== 'ready') return <EstadoFicha estado={estado} onVolver={onVolver} />;
  const f = estado.f;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Cabecera f={f} soloSector={soloSector} onSoloSector={setSoloSector} onVolver={onVolver} />
      <Identidad f={f} onVerCompetidor={onVerCompetidor} />
      <Aviso>{f.nota}</Aviso>
      <Cifras f={f} />
      <Coincidencias lista={f.coincidencias} />
      <Acciones f={f} onCambio={tras} />
      <Donde f={f} onVerOrganismo={onVerOrganismo} />
      <Evolucion f={f} />
      <UltimosContratos columna="organo" titulo="ÚLTIMOS CONTRATOS" filas={f.ultimos} onVerOrganismo={onVerOrganismo} />
    </div>
  );
}
