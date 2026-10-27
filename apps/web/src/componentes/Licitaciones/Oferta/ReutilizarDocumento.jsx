// En la tarjeta de un documento sin preparar: usar el certificado vigente de la carpeta
// Empresa o reutilizar el que entregamos en una oferta anterior. El servidor lo copia a Salidas de
// la oferta sin pisar nada y deja la fila en borrador: la persona lo abre y lo da por bueno.
import { useState } from 'react';
import { Check, Copy, History } from 'lucide-react';
import { TINTA_2, IMPIDE, RIESGO, TIPO } from '../../../lib/tema';
import { carpetaEmpresaApi } from '../../../lib/carpetaEmpresaApi';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { nuloSi404 } from '../../../lib/apiCliente';
import useCarga from '../../../hooks/useCarga';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Boton } from '../../ui';

// Lo que da el pliego con su modelo, la memoria, la oferta económica y el DEUC son de esta oferta.
const SIN_REUTILIZAR = new Set(['memoria', 'oferta_economica', 'deuc']);
const pequeno = { fontSize: TIPO.pequeno };

const reutilizable = (d) => d.estado === 'pendiente' && !d.ruta && !d.origen?.modelo && !SIN_REUTILIZAR.has(d.tipo);
// Un certificado copiado se revisa uno a uno: «Aceptar el borrador» no sale para los de acreditación.
const copiaPorRevisar = (d) =>
  d.estado === 'borrador' && d.tipo === 'acreditacion' && (d.nota ?? '').startsWith('Copiado de');
const fechaEs = (iso) => iso.split('-').reverse().join('/');
const nombreArchivo = (ruta) => ruta.split('/').at(-1);

function textoEmpresa(doc) {
  return `Usar el de la carpeta Empresa (${doc.caduca_en ? `vigente hasta ${fechaEs(doc.caduca_en)}` : 'sin fecha de caducidad'})`;
}

function Empresa({ r, hacer, ocupado }) {
  if (!r.tipo_empresa) return null;
  const valido = r.empresa.find((x) => x.estado !== 'caducado');
  if (valido) {
    return (
      <Boton
        Icono={Copy}
        escribe
        testid="reutilizar-empresa"
        cargando={ocupado}
        title={valido.nombre}
        onClick={() => hacer('empresa', valido.ruta, 'Copiado de la carpeta Empresa: ábrelo y dalo por bueno.')}
      >
        {textoEmpresa(valido)}
      </Boton>
    );
  }
  const caducado = r.empresa[0];
  if (caducado)
    return (
      <div data-testid="reutilizar-caducado" style={{ ...pequeno, color: IMPIDE }}>
        El de la carpeta Empresa caducó el {fechaEs(caducado.caduca_en)}: sube uno vigente en Ajustes › Empresa.
      </div>
    );
  return (
    <div style={{ ...pequeno, color: TINTA_2 }}>
      No hay ninguno en la carpeta Empresa: súbelo en Ajustes › Empresa y podrás usarlo aquí.
    </div>
  );
}

function Anteriores({ lista, hacer, ocupado }) {
  const [abierta, setAbierta] = useState(false);
  if (!lista.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div>
        <Boton Icono={History} testid="reutilizar-anterior" onClick={() => setAbierta((v) => !v)}>
          Reutilizar el de una oferta anterior
        </Boton>
      </div>
      {abierta &&
        lista.map((a) => (
          <div key={a.ruta} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Boton
              escribe
              testid="reutilizar-anterior-opcion"
              cargando={ocupado}
              title={a.ruta}
              onClick={() =>
                hacer('oferta', a.ruta, 'Copiado de la oferta anterior: ábrelo y revísalo antes de darlo por bueno.')
              }
            >
              {nombreArchivo(a.ruta)}
            </Boton>
            <span style={{ ...pequeno, color: TINTA_2, overflowWrap: 'anywhere' }}>de «{a.titulo}»</span>
          </div>
        ))}
    </div>
  );
}

function Candidatos({ id, d, onCambio }) {
  const carga = useCarga(() => nuloSi404(carpetaEmpresaApi.reutilizables(id, d.clave)), [id, d.clave]);
  const [aviso, accion, ocupado] = useAccionAviso(onCambio);
  if (carga.kind !== 'ready' || !carga.data) return null;
  const r = carga.data;
  if (!r.tipo_empresa && !r.anteriores.length) return null;
  const hacer = (origen, ruta, texto) => accion(() => carpetaEmpresaApi.reutilizar(id, d.clave, origen, ruta), texto);
  return (
    <div data-testid={`reutilizar-${d.clave}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Empresa r={r} hacer={hacer} ocupado={ocupado} />
      <Anteriores lista={r.anteriores} hacer={hacer} ocupado={ocupado} />
      {aviso && (
        <div
          role={aviso.tono === 'error' ? 'alert' : 'status'}
          style={{ ...pequeno, color: aviso.tono === 'error' ? RIESGO : TINTA_2 }}
        >
          {aviso.texto}
        </div>
      )}
    </div>
  );
}

function DarPorBueno({ id, d, onCambio }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <Boton
        Icono={Check}
        variante="principal"
        escribe
        testid="reutilizar-aceptar"
        cargando={ocupado}
        title="Ya lo has abierto y es el que pide el pliego"
        onClick={() =>
          hacer(
            () => licitacionesApi.cambiarDocumentoOferta(id, d.clave, { estado: 'preparado' }),
            `«${d.nombre}»: dado por bueno.`,
          )
        }
      >
        Revisado: dar por bueno
      </Boton>
      {aviso?.tono === 'error' && (
        <span role="alert" style={{ ...pequeno, color: RIESGO }}>
          {aviso.texto}
        </span>
      )}
    </div>
  );
}

/** Los botones de reutilizar de la tarjeta de un documento; nada si no se puede reutilizar. */
export default function ReutilizarDocumento({ id, d, onCambio }) {
  if (copiaPorRevisar(d)) return <DarPorBueno id={id} d={d} onCambio={onCambio} />;
  if (!reutilizable(d)) return null;
  return <Candidatos id={id} d={d} onCambio={onCambio} />;
}
