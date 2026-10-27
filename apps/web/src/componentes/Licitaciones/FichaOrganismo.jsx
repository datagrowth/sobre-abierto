// Ficha de un órgano de contratación: cuánto licita (en total y en nuestro sector), a
// quién adjudica, con qué baja y frente a cuántas ofertas, y qué oportunidades suyas
// seguimos. Datos de la PLACSP, sin IA.
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { TINTA, TINTA_2 } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { porcentaje } from '../../lib/preciosFormato';
import { etiquetaEstado } from '../../lib/licitacionesFormato';
import { eurosCortos, nombreONif, ofertasMedias, textoNif } from '../../lib/competenciaFormato';
import { KPI } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Chip } from '../ui';
import { Bloque, EstadoFicha } from '../comun/ui';
import { BarrasAnio, Celda, Enlace, Fila, Subtitulo, Tabla } from '../comun/listas';
import { Seguimiento, UltimosContratos } from './competenciaUi';

function Cabecera({ f, soloSector, onSoloSector, onVolver }) {
  const lugar = [f.ciudad, f.dir3 && `DIR3 ${f.dir3}`].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {onVolver && (
        <Boton Icono={ArrowLeft} onClick={onVolver}>
          Volver
        </Boton>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 16, color: TINTA, margin: 0, lineHeight: 1.35 }}>{f.nombre ?? f.nif}</h2>
        {lugar && <div style={{ fontSize: 12, color: TINTA_2, marginTop: 4 }}>{lugar}</div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <Chip>{textoNif(f.nif)}</Chip>
          {f.seguido && (
            <Chip tono="ok" punto={false}>
              seguido
            </Chip>
          )}
          <label style={{ fontSize: 12, color: TINTA_2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={soloSector} onChange={(e) => onSoloSector(e.target.checked)} />{' '}
            Adjudicaciones solo de tu sector
          </label>
        </div>
      </div>
    </div>
  );
}

function Cifras({ f }) {
  const l = f.licitaciones;
  const a = f.adjudicaciones;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <KPI
        label="Licitaciones del sector"
        value={l.del_sector}
        hint={`de ${l.total} en total · ${l.abiertas} abiertas`}
      />
      <KPI label="Importe licitado (sector)" value={eurosCortos(l.importe_sector)} />
      <KPI
        label="Adjudicaciones"
        value={a.contratos}
        hint={`${eurosCortos(a.importe)} · ${a.adjudicatarios} adjudicatarios`}
      />
      <KPI
        label="Baja mediana"
        value={porcentaje(f.bajas.percentiles.p50)}
        hint={`ofertas medias ${ofertasMedias(f.ofertas.media)}`}
      />
      <KPI label="Concentración" value={porcentaje(a.concentracion)} hint="contratos del que más gana" />
    </div>
  );
}

function Adjudicatarios({ f, onVerCompetidor }) {
  return (
    <Bloque titulo="A QUIÉN ADJUDICA">
      <Tabla cabecera={[['Adjudicatario'], ['Contratos', 'd'], ['Importe', 'd'], ['Baja mediana', 'd']]}>
        {f.adjudicatarios.map((g) => (
          <Fila key={g.clave}>
            <Celda largo>
              <Enlace onClick={onVerCompetidor && (() => onVerCompetidor(g.clave))} title="Ver la ficha del competidor">
                {nombreONif(g)}
              </Enlace>
            </Celda>
            <Celda d>{g.contratos}</Celda>
            <Celda d>{eurosCortos(g.importe)}</Celda>
            <Celda d>{porcentaje(g.baja_mediana)}</Celda>
          </Fila>
        ))}
      </Tabla>
    </Bloque>
  );
}

function Evolucion({ f }) {
  const licitaciones = f.licitaciones.por_anio.map((x) => ({ clave: x.anio, licitaciones: x.licitaciones }));
  return (
    <Bloque titulo="EVOLUCIÓN">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Subtitulo>Licitaciones del sector por año</Subtitulo>
          <BarrasAnio grupos={licitaciones} campo="licitaciones" etiqueta="Licitaciones del sector por año" />
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Subtitulo>Importe adjudicado por año</Subtitulo>
          <BarrasAnio grupos={f.por_anio} campo="importe" formato={eurosCortos} etiqueta="Importe adjudicado por año" />
        </div>
      </div>
      <Subtitulo>Baja mediana por año</Subtitulo>
      <Tabla cabecera={[['Año'], ['Adjudicaciones', 'd'], ['Baja mediana', 'd']]}>
        {f.por_anio.map((a) => (
          <Fila key={a.clave}>
            <Celda>{a.clave}</Celda>
            <Celda d>{a.contratos}</Celda>
            <Celda d>{porcentaje(a.baja_mediana)}</Celda>
          </Fila>
        ))}
      </Tabla>
    </Bloque>
  );
}

function Nuestras({ lista }) {
  if (!lista.length) return null;
  return (
    <Bloque titulo="OPORTUNIDADES QUE SEGUIMOS DE ESTE ÓRGANO">
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: TINTA, lineHeight: 1.6 }}>
        {lista.map((o) => (
          <li key={o.id}>
            {o.titulo} <Chip>{etiquetaEstado(o.estado)}</Chip>
          </li>
        ))}
      </ul>
    </Bloque>
  );
}

export default function FichaOrganismo({ nif, version, onVolver, onCambio, onVerCompetidor }) {
  const [soloSector, setSoloSector] = useState(false);
  const [estado, setEstado] = useState({ kind: 'loading' });
  const cargar = useCallback(
    () =>
      licitacionesApi.organismo(nif, { soloSector }).then(
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
      <Aviso>{f.nota}</Aviso>
      <Cifras f={f} />
      <Nuestras lista={f.oportunidades} />
      <Bloque titulo="SEGUIMIENTO">
        <Seguimiento
          key={f.seguido?.actualizado_en ?? 'no'}
          tipo="organismo"
          nif={f.nif}
          seguido={f.seguido}
          onCambio={tras}
        />
      </Bloque>
      <Adjudicatarios f={f} onVerCompetidor={onVerCompetidor} />
      <Evolucion f={f} />
      <UltimosContratos
        columna="adjudicatario"
        titulo="ÚLTIMAS ADJUDICACIONES"
        filas={f.ultimas}
        onVerCompetidor={onVerCompetidor}
      />
    </div>
  );
}
