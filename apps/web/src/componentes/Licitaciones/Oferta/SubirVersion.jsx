// «Subir mi Word»: el Word retocado a mano (o un PDF) y lo que has mejorado. Pasa a ser la
// versión siguiente (se guarda tal cual y Hermes la evalúa); de tu nota y de los cambios
// Hermes saca lecciones que tú aceptas o descartas (Lecciones.jsx). Sin los títulos del guion
// se guarda entera (sin «Pedir cambios»); presentada la oferta o vencido el plazo, se sugiere
// subirla como presentada (SubirMemoriaPresentada.jsx).
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, RADIUS, TIPO, alpha } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { textoArriba, textoSubida } from '../../../lib/memoriaFormato';
import { abrirPresentada, ACEPTA_SUBIDA, sugerirPresentada } from '../../../lib/subidaVersionFormato';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Aviso, Boton } from '../../ui';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };

function SugerirPresentada({ id, lote }) {
  return (
    <div style={{ ...texto, marginBottom: 10 }}>
      ¿Es la que presentaste?{' '}
      <button
        type="button"
        onClick={() => abrirPresentada(id, lote)}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          color: TINTA,
          fontWeight: 600,
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        Súbela como presentada
      </button>
    </div>
  );
}

// onAviso: dónde decir «Subida como vN…», fuera de lo que se vuelve a montar con la versión nueva.
// lote: de qué lote es el Word si el pliego pide una memoria por lote (null: la común).
export function PanelSubida({ id, o = null, siguiente, onCambio, onCerrar, onAviso, lote = null }) {
  const entrada = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [notas, setNotas] = useState('');
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const delLote = lote ? ` del lote ${lote}` : '';
  const subir = () =>
    hacer(() => licitacionesApi.subirMemoria(id, archivo, notas.trim(), lote), textoArriba(onAviso, textoSubida));
  return (
    <section
      aria-label="Subir mi Word"
      data-testid="memoria-panel-subida"
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: RADIUS,
        border: `1px solid ${alpha(ACCION, 0.45)}`,
        background: alpha(ACCION, 0.05),
      }}
    >
      {sugerirPresentada(o) && <SugerirPresentada id={id} lote={lote} />}
      <div style={{ ...texto, fontWeight: 600, marginBottom: 4 }}>1. El Word retocado (.docx) o un PDF</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={entrada}
          type="file"
          accept={ACEPTA_SUBIDA}
          hidden
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          aria-label="Word o PDF de la memoria editada"
        />
        <Boton Icono={Upload} onClick={() => entrada.current?.click()}>
          {archivo ? 'Cambiar archivo' : 'Elegir archivo'}
        </Boton>
        <span style={{ ...texto, wordBreak: 'break-all' }}>
          {archivo?.name ?? (
            <span style={apagado}>
              Ninguno elegido. Con los títulos de los apartados del guion se reparte por apartados; sin ellos se guarda
              entera.
            </span>
          )}
        </span>
      </div>
      <label
        htmlFor={`notas-subida-${id}`}
        style={{ ...texto, fontWeight: 600, display: 'block', margin: '12px 0 4px' }}
      >
        2. ¿Qué has mejorado y por qué?
      </label>
      <textarea
        id={`notas-subida-${id}`}
        className="input-field"
        rows={4}
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        placeholder={
          'Para que Hermes aprenda. Por ejemplo:\n· He quitado los condicionales: la mesa puntúa compromisos firmes.\n· El calendario, en tabla: se lee mejor que en prosa.\n· Ana es la responsable en todos los apartados.'
        }
        style={{ width: '100%', resize: 'vertical' }}
      />
      <div style={apagado}>
        Opcional, pero cuanto más concreto, mejores lecciones. Hermes también compara tu Word con su versión anterior.
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: 10,
          paddingTop: 10,
          borderTop: `1px solid ${BORDE}`,
        }}
      >
        <Boton
          Icono={Upload}
          variante="principal"
          disabled={!archivo}
          cargando={ocupado}
          onClick={subir}
          testid="memoria-subir-confirmar"
          title={
            archivo
              ? `Será la v${siguiente}${delLote}: se guarda tal cual y Hermes la evalúa`
              : 'Elige primero el Word o el PDF'
          }
        >
          Subir como v{siguiente}
          {delLote}
        </Boton>
        <Boton onClick={onCerrar}>Cancelar</Boton>
      </div>
      <div style={{ ...apagado, marginTop: 6 }}>
        Si después pides cambios, Hermes parte del texto de este Word: las imágenes y el formato hechos a mano no pasan
        a la versión que monte la plataforma.
      </div>
      {aviso?.texto && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </section>
  );
}

/** El botón que abre el panel (onAbrir) o, sin dónde ponerlo aparte, el botón y el panel juntos. */
function SubirVersion({ id, o = null, siguiente, onCambio, onAbrir = null, abierto = false, onAviso, lote = null }) {
  const [propio, setPropio] = useState(false);
  const boton = (
    <Boton
      Icono={Upload}
      disabled={abierto}
      onClick={() => (onAbrir ? onAbrir() : setPropio(true))}
      title={`Sube el Word (o el PDF) que has retocado: será la v${siguiente}`}
    >
      Subir mi Word
    </Boton>
  );
  if (onAbrir || !propio) return boton;
  return (
    <div style={{ flexBasis: '100%' }}>
      <PanelSubida
        id={id}
        o={o}
        siguiente={siguiente}
        lote={lote}
        onCambio={onCambio}
        onCerrar={() => setPropio(false)}
        onAviso={onAviso}
      />
    </div>
  );
}
