// Piezas de las vistas Competidores y Organismos: el seguimiento a mano con notas y los
// últimos contratos con enlaces entre fichas.
import { useState } from 'react';
import { ExternalLink, Star, StarOff, Save } from 'lucide-react';
import { TINTA_2 } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { euros, urlEnlazable } from '../../lib/formato';
import { porcentaje } from '../../lib/preciosFormato';
import { Aviso, Boton } from '../ui';
import { Bloque } from '../comun/ui';
import { Celda, Enlace, Fila, Tabla } from '../comun/listas';

/** Seguir o dejar de seguir, con notas del equipo. Es una decisión humana: solo aquí. */
export function Seguimiento({ tipo, nif, seguido, onCambio }) {
  const [notas, setNotas] = useState(seguido?.notas ?? '');
  const [error, setError] = useState(null);
  const hacer = async (fn) => {
    setError(null);
    try {
      await fn();
      onCambio();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {seguido && (
        <textarea
          className="input-field"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder="Notas del equipo: por qué lo vigilamos, con quién compite…"
          aria-label="Notas de seguimiento"
          style={{ width: '100%', resize: 'vertical' }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {seguido ? (
          <>
            <Boton Icono={Save} onClick={() => hacer(() => licitacionesApi.seguir(tipo, nif, notas))}>
              Guardar notas
            </Boton>
            <Boton Icono={StarOff} onClick={() => hacer(() => licitacionesApi.dejarDeSeguir(tipo, nif))}>
              Dejar de seguir
            </Boton>
          </>
        ) : (
          <Boton
            Icono={Star}
            onClick={() => hacer(() => licitacionesApi.seguir(tipo, nif, ''))}
            title="Tenerlo en el punto de mira"
          >
            Seguir
          </Boton>
        )}
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}

// Últimas adjudicaciones con enlace a la PLACSP y a la ficha del adjudicatario o del órgano.
// columna: «adjudicatario» (en la ficha de un órgano) u «organo» (en la de un competidor).
export function UltimosContratos({ titulo, filas, columna, onVerOrganismo, onVerCompetidor }) {
  const porAdjudicatario = columna === 'adjudicatario';
  if (!filas.length) return null;
  return (
    <Bloque titulo={titulo}>
      <Tabla
        cabecera={[
          ['Fecha'],
          ['Contrato'],
          [porAdjudicatario ? 'Adjudicatario' : 'Órgano'],
          ['Importe', 'd'],
          ['Baja', 'd'],
          ['Ofertas', 'd'],
          [''],
        ]}
      >
        {filas.map((c) => (
          <Fila key={`${c.licitacion_id}-${c.lote}`}>
            <Celda>{c.fecha ?? '—'}</Celda>
            <Celda largo>{c.titulo || c.expediente}</Celda>
            <Celda largo>
              {porAdjudicatario ? (
                <Enlace
                  onClick={
                    onVerCompetidor && c.adjudicatario_nif ? () => onVerCompetidor(c.adjudicatario_nif) : undefined
                  }
                >
                  {c.adjudicatario_nombre ?? '—'}
                </Enlace>
              ) : (
                <Enlace onClick={onVerOrganismo && c.organo_nif ? () => onVerOrganismo(c.organo_nif) : undefined}>
                  {c.organo}
                </Enlace>
              )}
            </Celda>
            <Celda d>{euros(c.importe)}</Celda>
            <Celda d>{porcentaje(c.baja)}</Celda>
            <Celda d>{c.ofertas ?? '—'}</Celda>
            <Celda>
              {urlEnlazable(c.url) && (
                <a
                  href={urlEnlazable(c.url)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Abrir ${c.expediente} en la PLACSP`}
                  style={{ color: TINTA_2 }}
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </Celda>
          </Fila>
        ))}
      </Tabla>
    </Bloque>
  );
}
