// El paquete de presentación, al pie de las comprobaciones. Lo que se sube a la sede ya ordenado en
// Salidas/…/PRESENTACION/v<n>/ (carpeta por lote y sobre, archivos numerados, índice del
// sobre, valores a teclear e instrucciones). Con bloqueos se genera igual, marcado «NO
// PRESENTABLE TODAVÍA». Nada se firma ni se presenta: lo hace una persona. Las comprobaciones
// ya son filas de las comprobaciones: aquí no se repiten, y el registro se apaga con lo que impide
// presentar (`impiden`). El pie enseña el kit de firma (con «Abrir en Drive», una sola vez) y
// «Regenerar» queda en «Más»: lo normal es que lo regenere la cadena.
import { useCallback, useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { TINTA, TINTA_2, RIESGO, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { estadoPaquete, resumenPaquete, textoCopiaPaquete } from '../../../lib/presentacionFormato';
import { Subtitulo } from '../../comun/listas';
import { Aviso, Boton, Chip } from '../../ui';
import KitFirma from './KitFirma';
import RegistroPaquete from './RegistroPaquete';

export default function PaqueteOferta({ f, o, onCambio, impiden = [] }) {
  const [estado, setEstado] = useState({ datos: null, error: null, ocupado: false, aviso: null });
  const cargar = useCallback(async () => {
    try {
      setEstado((s) => ({ ...s, datos: null, error: null }));
      const datos = await licitacionesApi.paqueteOferta(f.id);
      setEstado((s) => ({ ...s, datos }));
    } catch (e) {
      setEstado((s) => ({ ...s, error: e.message }));
    }
  }, [f.id]);
  const version = o?.paquete?.version ?? 0;
  useEffect(() => {
    void cargar();
  }, [cargar, version]);
  const generar = async () => {
    setEstado((s) => ({ ...s, ocupado: true, aviso: null }));
    try {
      const r = await licitacionesApi.generarPaquete(f.id);
      setEstado((s) => ({
        ...s,
        ocupado: false,
        aviso: {
          tono: r.bloqueos ? 'aviso' : 'info',
          texto: `Paquete v${r.version} en ${r.ruta}${r.bloqueos ? ': NO PRESENTABLE TODAVÍA, resuelve los bloqueos.' : '.'}`,
        },
      }));
      onCambio();
    } catch (e) {
      setEstado((s) => ({ ...s, ocupado: false, aviso: { tono: 'error', texto: e.message } }));
    }
  };
  const p = o?.paquete ?? null;
  const clave = estadoPaquete(p);
  const botonGenerar = (
    <span data-testid="paquete-generar">
      <Boton
        Icono={PackageCheck}
        testid="paquete-generar-boton"
        variante={!p ? 'principal' : undefined}
        cargando={estado.ocupado}
        onClick={generar}
        title="Copia en Salidas, en una versión nueva, lo que se sube a la sede: carpeta por lote y sobre, archivos numerados, índice, valores a teclear e instrucciones"
      >
        {p ? `Regenerar (v${p.version + 1})` : 'Preparar paquete de presentación'}
      </Boton>
    </span>
  );
  return (
    <div data-testid="paquete-oferta" style={{ marginBottom: 12 }}>
      <Subtitulo>Paquete de presentación</Subtitulo>
      {p && (
        <div
          style={{
            fontSize: TIPO.texto,
            color: TINTA,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 6,
          }}
        >
          <span>{resumenPaquete(p)}</span>
          {clave === 'desfasado' && (
            <Chip tono="riesgo" punto={false}>
              Desfasado
            </Chip>
          )}
          <span style={{ color: TINTA_2, fontSize: TIPO.pequeno, overflowWrap: 'anywhere' }}>{p.ruta}/</span>
        </div>
      )}
      {estado.datos?.vigente && <KitFirma f={f} vigente={estado.datos.vigente} />}
      {p ? (
        <details data-testid="paquete-mas" style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: TIPO.texto, color: TINTA_2 }}>Más</summary>
          <div style={{ marginTop: 6 }}>{botonGenerar}</div>
        </details>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          {botonGenerar}
        </div>
      )}
      {textoCopiaPaquete(p) && (
        <div
          style={{
            fontSize: TIPO.pequeno,
            color: p.copia.estado === 'error' ? RIESGO : TINTA_2,
            marginBottom: 6,
            overflowWrap: 'anywhere',
          }}
        >
          {textoCopiaPaquete(p)}
        </div>
      )}
      {p && estado.datos && (
        <div style={{ marginBottom: 8 }}>
          <RegistroPaquete
            key={p.version}
            id={f.id}
            version={p.version}
            registro={estado.datos.registro ?? []}
            impiden={impiden}
            onHecho={onCambio}
          />
        </div>
      )}
      {estado.aviso && (
        <div style={{ marginBottom: 8 }}>
          <Aviso tono={estado.aviso.tono}>{estado.aviso.texto}</Aviso>
        </div>
      )}
      {estado.error && <Aviso tono="error">{estado.error}</Aviso>}
    </div>
  );
}
