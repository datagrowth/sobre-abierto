// Puesta en marcha de una instalación nueva: en el Pipeline vacío, la lista de lo que falta (perfil de
// la empresa, filtros, IA y, opcional, Drive). Cada paso lleva a su pestaña de Ajustes; no duplica nada.
// Solo la ve un admin, que es quien puede hacerlos, y se esconde sola cuando está todo lo obligatorio.
import { useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import useUsuario from '../../hooks/useUsuario';
import driveApi from '../../lib/driveApi';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { plataformaApi } from '../../lib/plataformaApi';
import { faltaPonerEnMarcha, pasosPrimerArranque } from '../../lib/primerosPasos';
import { esAdmin } from '../../lib/usuarioActual';
import { Boton, Chip } from '../ui';
import { Bloque } from '../comun/ui';

/** Los tres datos que no vienen con el estado del radar; null mientras llegan (o si falla la lectura). */
function useDatosDePuestaEnMarcha(activo) {
  const [datos, setDatos] = useState({ empresa: null, prefiltro: null, drive: null });
  useEffect(() => {
    if (!activo) return undefined;
    let vivo = true;
    const poner = (campo) => (valor) => {
      if (vivo) setDatos((d) => ({ ...d, [campo]: valor }));
    };
    plataformaApi.empresa().then(poner('empresa'), () => {});
    licitacionesApi.filtros().then(poner('prefiltro'), () => {});
    driveApi.status().then(
      ({ data }) => poner('drive')(data),
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, [activo]);
  return datos;
}

/** `estado`: el del radar (GET /api/licitaciones/estado); `onIr(seccion, vista)`: navega a Ajustes. */
export default function PrimerosPasos({ estado, onIr }) {
  const usuario = useUsuario();
  const admin = esAdmin(usuario);
  const datos = useDatosDePuestaEnMarcha(admin);
  if (!admin || !estado || !datos.empresa || !datos.prefiltro) return null;
  const pasos = pasosPrimerArranque({ ...datos, estado });
  if (!faltaPonerEnMarcha(pasos)) return null;
  return (
    <div data-testid="primeros-pasos">
      <Bloque titulo="PRIMEROS PASOS">
        <p className="m-0 mb-2 text-tabla text-tinta-2">
          Para que el radar trabaje para tu empresa faltan estos pasos. Cada uno se hace en Ajustes.
        </p>
        <ol className="m-0 p-0 grid gap-2 list-none">
          {pasos.map((p) => (
            <li key={p.clave} data-testid={`paso-${p.clave}`} data-hecho={p.hecho} className="flex items-start gap-2.5">
              <span className="mt-0.5 text-tinta-2" aria-hidden="true">
                {p.hecho ? <Check size={16} /> : <Circle size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <strong className="text-cuerpo">{p.titulo}</strong>
                {p.opcional && (
                  <>
                    {' '}
                    <Chip>opcional</Chip>
                  </>
                )}
                <span className="sr-only">{p.hecho ? ' (hecho)' : ' (pendiente)'}</span>
                <p className="m-0 text-tabla text-tinta-2">{p.texto}</p>
              </div>
              {!p.hecho && (
                <Boton tamano="pequeno" onClick={() => onIr(...p.destino)}>
                  Abrir
                </Boton>
              )}
            </li>
          ))}
        </ol>
      </Bloque>
    </div>
  );
}
