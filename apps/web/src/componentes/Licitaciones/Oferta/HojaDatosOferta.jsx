// Hoja de datos para los formularios de la PLACSP y los anexos que se rellenan a mano: cada
// dato (empresa, licitación, oferta, criterios automáticos) con su botón de copiar. Lo que
// falta sale en aviso: se completa en Ajustes › Empresa o en las decisiones de la oferta.
// Se carga al abrirla: la mayoría de las veces no hace falta. Dentro de las comprobaciones, cada valor que
// sale de una decisión lleva «cambiar», que abre el cajón Decisiones en ese campo.
import { useContext, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { TINTA, TINTA_2, RIESGO, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { gruposHojaDatos, textoFaltasHoja } from '../../../lib/documentosOfertaFormato';
import { destinoDeCampoHoja } from '../../../lib/documentosVista';
import { CambiosContext } from '../../../hooks/useCambiosSinGuardar';
import AvisoRecarga from '../../comun/AvisoRecarga';
import useCarga from '../../../hooks/useCarga';
import { Celda, Fila, Tabla } from '../../comun/listas';
import { Aviso, Boton, Chip } from '../../ui';

function Copiar({ c }) {
  const [estado, setEstado] = useState(null);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(c.valor);
      setEstado('ok');
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS) se dice: el dato sigue a la vista para copiarlo a mano.
      setEstado('error');
    }
    setTimeout(() => setEstado(null), 2500);
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Boton Icono={estado === 'ok' ? Check : Copy} onClick={copiar} title={`Copiar «${c.etiqueta}»`}>
        Copiar
      </Boton>
      <span role="status" style={{ fontSize: TIPO.pequeno, color: estado === 'error' ? RIESGO : TINTA_2 }}>
        {estado === 'ok' ? 'Copiado' : estado === 'error' ? 'No se pudo copiar: selecciónalo a mano' : ''}
      </span>
    </span>
  );
}

// Sin los cajones de las comprobaciones no hay adónde llevar el cambio: no sale.
function Cambiar({ c, lotes }) {
  const abrirCajon = useContext(CambiosContext)?.abrirCajon;
  const destino = destinoDeCampoHoja(c, lotes);
  if (!abrirCajon || !destino) return null;
  const donde = c.grupo.replace(/^Oferta · /, '').toLowerCase();
  return (
    <>
      {' · '}
      <button
        type="button"
        data-testid="hoja-cambiar"
        data-destino={destino}
        onClick={() => abrirCajon(destino)}
        aria-label={`Cambiar «${c.etiqueta}»${donde && donde !== 'oferta' ? ` (${donde})` : ''} en Decisiones`}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: TINTA_2,
          textDecoration: 'underline',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        cambiar
      </button>
    </>
  );
}

function Contenido({ f, version, lotes }) {
  const carga = useCarga(() => licitacionesApi.hojaDatos(f.id), [f.id], version);
  if (carga.kind === 'loading') return <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>Cargando…</div>;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const campos = carga.data?.campos ?? [];
  const faltas = textoFaltasHoja(campos);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
      <AvisoRecarga carga={carga} />
      {faltas && <Aviso tono="aviso">{faltas} Complétalo en Ajustes › Empresa o en las decisiones de la oferta.</Aviso>}
      {(carga.data?.avisos ?? []).map((v) => (
        <Aviso key={v} tono="aviso">
          {v}
        </Aviso>
      ))}
      {gruposHojaDatos(campos).map((g) => (
        <Tabla key={g.grupo} titulo={g.titulo} cabecera={[['Dato'], ['Valor'], ['']]}>
          {g.campos.map((c) => (
            <Fila key={c.etiqueta}>
              <Celda>{c.etiqueta}</Celda>
              <Celda largo>
                {c.valor ? (
                  <span style={{ color: TINTA, userSelect: 'all' }}>{c.valor}</span>
                ) : (
                  <Chip tono="riesgo" punto={false}>
                    Falta
                  </Chip>
                )}
                <Cambiar c={c} lotes={lotes} />
              </Celda>
              <Celda>{c.valor ? <Copiar c={c} /> : null}</Celda>
            </Fila>
          ))}
        </Tabla>
      ))}
    </div>
  );
}

/** lotes: los del ámbito (la oferta de un solo lote no lleva su lote en la hoja). */
export default function HojaDatosOferta({ f, version, lotes = [] }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <details data-testid="hoja-datos" onToggle={(e) => setAbierta(e.currentTarget.open)} style={{ marginTop: 4 }}>
      <summary style={{ cursor: 'pointer', fontSize: TIPO.texto, color: TINTA, fontWeight: 600 }}>
        Hoja de datos para los formularios{' '}
        <span style={{ color: TINTA_2, fontWeight: 400 }}>(NIF, representante, importes…, con botón de copiar)</span>
      </summary>
      {abierta && <Contenido f={f} version={version} lotes={lotes} />}
    </details>
  );
}
