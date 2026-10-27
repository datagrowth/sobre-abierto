// El botón que pide a Hermes redactar la memoria (o la de un lote) y lo que falta para poder.
import { FilePen } from 'lucide-react';
import { TINTA_2 } from '../../../../lib/tema';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { faltaParaRedactar, lineaFalta, progresoMemoria, versionSiguiente } from '../../../../lib/memoriaFormato';
import useAccionAviso from '../../../../hooks/useAccionAviso';
import { Aviso, Boton } from '../../../ui';
import { texto, apagado, COMO_REDACTA } from './compartido';

// lote: la memoria de ese lote; null, todas (con memoria por lote, una para cada lote sin la suya).
function textoRedactar(o, lote, memorias) {
  const siguiente = `v${versionSiguiente(o.memorias)}`;
  if (lote)
    return memorias.length ? `Empezar desde cero (lote ${lote}, ${siguiente})` : `Redactar la memoria del lote ${lote}`;
  if (o.memoria_lotes?.length) return 'Redactar las memorias (una por lote)';
  return memorias.length ? `Empezar desde cero (${siguiente})` : 'Redactar la memoria';
}

const testidRedactar = (o, lote) =>
  lote ? `redactar-memoria-lote-${lote}` : o.memoria_lotes?.length ? 'redactar-memorias-lote' : 'redactar-memoria';

export default function Redactar({ f, o, onCambio, principal = false, lote = null }) {
  const [aviso, hacer] = useAccionAviso(onCambio);
  const falta = faltaParaRedactar(o, f.lotes ?? []);
  const memorias = lote ? o.memorias.filter((m) => m.lote === lote) : o.memorias;
  const enCurso = memorias.some((m) => progresoMemoria(m).enCurso);
  const motivo = !o.salidas_configurado
    ? 'Falta configurar en el servidor la carpeta Salidas, donde se deja la memoria.'
    : enCurso
      ? 'Hay una memoria redactándose.'
      : null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Boton
          Icono={FilePen}
          variante={principal ? 'principal' : undefined}
          testid={testidRedactar(o, lote)}
          disabled={falta.length > 0 || Boolean(motivo)}
          title={motivo ?? COMO_REDACTA.titulo}
          onClick={() => hacer(() => licitacionesApi.redactarMemoria(f.id, lote), COMO_REDACTA.aviso)}
        >
          {textoRedactar(o, lote, memorias)}
        </Boton>
      </div>
      {motivo && <div style={{ ...apagado, marginTop: 4 }}>{motivo}</div>}
      {falta.length > 0 && (
        <ul
          aria-label="Para redactar falta"
          data-testid="memoria-falta"
          style={{ margin: '6px 0 0', paddingLeft: 18, ...texto, color: TINTA_2 }}
        >
          {falta.map((x) => (
            <li key={x}>{lineaFalta(x)}</li>
          ))}
        </ul>
      )}
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}
