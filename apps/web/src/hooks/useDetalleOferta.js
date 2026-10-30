// El estado del detalle de la oferta (DetalleOferta): qué apartados están abiertos, la pregunta antes
// de dejar cambios sin guardar y los datos que cargan los apartados, la Revisión y el registro.
import { useCallback, useMemo, useState } from 'react';
import { licitacionesApi } from '../lib/licitacionesApi';
import { colaboradoresApi } from '../lib/colaboradoresApi';
import useCarga from './useCarga';
import useEventosLicitacion from './useEventosLicitacion';

// El apartado a la vista, los que ya se abrieron (montados y ocultos) y una clave por apartado que
// sube al descartar sus cambios, para montarlo de nuevo con lo guardado.
export function useCajones() {
  const [s, setS] = useState({ actual: null, campo: null, pedido: 0, abiertos: [], claves: {} });
  const abrir = useCallback(
    (nombre, campo = null) =>
      setS((p) => ({
        ...p,
        actual: nombre,
        campo,
        pedido: p.pedido + 1,
        abiertos: p.abiertos.includes(nombre) ? p.abiertos : [...p.abiertos, nombre],
      })),
    [],
  );
  const cerrar = useCallback(() => setS((p) => ({ ...p, actual: null, campo: null })), []);
  const descartar = useCallback(
    (nombres) =>
      setS((p) => ({
        ...p,
        claves: { ...p.claves, ...Object.fromEntries(nombres.map((n) => [n, (p.claves[n] ?? 0) + 1])) },
      })),
    [],
  );
  return useMemo(() => ({ ...s, abrir, cerrar, descartar }), [s, abrir, cerrar, descartar]);
}

// Antes de dejar atrás cambios sin guardar se pregunta; «Seguir editando» vuelve al primer apartado con cambios.
export function useSalida(sucios, cajones) {
  const [pide, setPide] = useState(null);
  const pedirSalida = useCallback(
    (accion, excepto = null) => {
      const nombres = sucios.filter((n) => n !== excepto);
      if (!nombres.length) {
        accion();
        return;
      }
      setPide({ nombres, accion });
    },
    [sucios],
  );
  const si = () => {
    cajones.descartar(pide.nombres);
    setPide(null);
    pide.accion();
  };
  const no = () => {
    cajones.abrir(pide.nombres[0]);
    setPide(null);
  };
  return { pide, pedirSalida, si, no };
}

// Lo que necesitan los apartados se carga a partir de que se abre el primero; la oferta, también antes
// si se pide (conOferta: el pie del paquete o un precio que se fija en su fila).
export function useDatosDetalle(id, activo, conOferta = false) {
  const [version, setVersion] = useState(0);
  useEventosLicitacion(id, () => setVersion((v) => v + 1));
  const si =
    (fn, cargar = activo) =>
    () =>
      cargar ? fn() : Promise.resolve(null);
  const oferta = useCarga(
    si(() => licitacionesApi.oferta(id), activo || conOferta),
    [id, activo || conOferta],
    version,
  );
  const propuesta = useCarga(
    si(() => licitacionesApi.propuesta(id)),
    [id, activo],
    version,
  );
  const equipo = useCarga(
    si(() => licitacionesApi.equipo(id)),
    [id, activo],
    version,
  );
  const personas = useCarga(
    si(() => colaboradoresApi.personas().then((r) => r.items ?? [])),
    [activo],
  );
  return { oferta, propuesta, equipo, personas, version };
}
