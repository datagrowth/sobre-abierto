// Las personas activas del equipo (id, nombre y rol, sin email) para elegir responsable o
// mencionar. Se piden una vez por carga de la página: cambian poco y las comparten varias vistas.
import { useEffect, useState } from 'react';
import { plataformaApi } from '../lib/plataformaApi';

let pedida = null;
const pedir = () =>
  (pedida ??= plataformaApi.companeros().then(
    (r) => r.companeros,
    (e) => {
      pedida = null;
      throw e;
    },
  ));

export default function useCompaneros() {
  const [companeros, setCompaneros] = useState([]);
  useEffect(() => {
    let vivo = true;
    pedir().then(
      (c) => {
        if (vivo) setCompaneros(c);
      },
      () => undefined,
    );
    return () => {
      vivo = false;
    };
  }, []);
  return companeros;
}
