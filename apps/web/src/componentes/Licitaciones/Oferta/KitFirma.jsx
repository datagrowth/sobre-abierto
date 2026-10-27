// El kit de firma del paquete vigente: las carpetas por lote y sobre con sus archivos
// en el orden de subida, firmar todo de una vez con AutoFirma, VALORES_A_TECLEAR.md al lado, el
// enlace a la PLACSP y «Abrir en Drive» una sola vez. Firmar y subir lo hace una persona.
import { TINTA, TINTA_2, TIPO } from '../../../lib/tema';
import { FIRMA_POR_LOTES, kitDeFirma } from '../../../lib/kitFirmaFormato';
import AbrirEnDrive from '../AbrirEnDrive';
import { urlEnlazable } from '../../../lib/formato';

const enlace = { color: TINTA, fontSize: TIPO.texto };

function Carpeta({ c }) {
  return (
    <li data-testid="kit-firma-carpeta" style={{ marginBottom: 6 }}>
      <div style={{ fontWeight: 600, color: TINTA, overflowWrap: 'anywhere' }}>{c.ruta}</div>
      <ol style={{ margin: '2px 0 0', paddingLeft: 20, color: TINTA }}>
        {c.archivos.map((a) => (
          <li key={a.archivo} data-testid="kit-firma-archivo" style={{ overflowWrap: 'anywhere' }}>
            {a.archivo}
          </li>
        ))}
      </ol>
      {c.firma && <div style={{ color: TINTA_2, fontSize: TIPO.pequeno }}>Firma del sobre: {c.firma}</div>}
    </li>
  );
}

/** f: la ficha (id y url de la PLACSP); vigente: el paquete vigente con su manifiesto. */
export default function KitFirma({ f, vigente }) {
  const k = kitDeFirma(vigente);
  if (!k) return null;
  return (
    <div data-testid="kit-firma" style={{ fontSize: TIPO.texto, color: TINTA, marginBottom: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Kit de firma · v{k.version}</div>
      <div data-testid="kit-firma-autofirma" style={{ color: TINTA_2, marginBottom: 6 }}>
        {FIRMA_POR_LOTES}
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {k.carpetas.map((c) => (
          <Carpeta key={c.ruta} c={c} />
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <a data-testid="kit-firma-valores" href={k.valores} target="_blank" rel="noreferrer" style={enlace}>
          VALORES_A_TECLEAR.md
        </a>
        <a data-testid="kit-firma-instrucciones" href={k.instrucciones} target="_blank" rel="noreferrer" style={enlace}>
          INSTRUCCIONES.md
        </a>
        {urlEnlazable(f.url) && (
          <a data-testid="kit-firma-placsp" href={urlEnlazable(f.url)} target="_blank" rel="noreferrer" style={enlace}>
            Abrir en la PLACSP
          </a>
        )}
        <span data-testid="kit-firma-drive">
          <AbrirEnDrive id={f.id} carpeta="oferta" />
        </span>
      </div>
    </div>
  );
}
