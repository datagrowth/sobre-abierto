// Calidad del dato (Ajustes › Fuentes): lo que las comprobaciones por código dejan fuera de los
// índices, los pliegos que no se pueden leer, cuánto aciertan los índices (prueba hacia atrás) y las
// actas de expedientes ajenos leídas.
import { useEffect, useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { filasAcierto, textoActasMercado } from '../../lib/calidadFormato';
import { plural } from '../../lib/formato';
import { Aviso, Esqueleto, Tabla, Tarjeta } from '../ui';

const COLUMNAS_REGLAS = [
  { clave: 'texto', titulo: 'Comprobación' },
  { clave: 'n', titulo: 'Casos', alinear: 'derecha' },
  {
    clave: 'ejemplos',
    titulo: 'Ejemplos',
    celda: (r) => r.ejemplos.map((e) => e.titulo ?? e.licitacion_id).join(' · ') || '—',
  },
];

const COLUMNAS_ACIERTO = [
  { clave: 'indice', titulo: 'Índice' },
  { clave: 'mes', titulo: 'Mes' },
  { clave: 'n', titulo: 'n', alinear: 'derecha' },
  { clave: 'error', titulo: 'Se desvía de media', alinear: 'derecha' },
  { clave: 'cobertura', titulo: 'Dentro del rango P25-P75', alinear: 'derecha' },
];

function textoPliegos(p) {
  if (!p.n) return 'Todos los pliegos de lo que seguimos se pueden leer.';
  return `${plural(p.n, 'licitación tiene', 'licitaciones tienen')} pliegos que no se pueden leer: ${p.ejemplos.map((e) => e.titulo ?? e.licitacion_id).join(' · ')}.`;
}

function Contenido({ d }) {
  const acierto = filasAcierto(d.acierto.historial);
  return (
    <div className="grid gap-4">
      <p className="m-0 text-cuerpo text-tinta" data-testid="calidad-fuera">
        {plural(d.fuera_de_indices, 'adjudicación queda fuera', 'adjudicaciones quedan fuera')} de los índices por una
        incidencia. Un NIF no válido no la deja fuera: solo no cuenta a la empresa como licitadora.
      </p>
      <Tabla
        columnas={COLUMNAS_REGLAS}
        filas={d.incidencias}
        claveFila={(r) => r.regla}
        etiqueta="Incidencias de calidad"
      />
      <div>
        <h4 className="m-0 mb-2 text-tabla font-bold text-tinta">
          Acierto de los índices <small className="font-medium text-tinta-2">prueba hacia atrás, 12 meses</small>
        </h4>
        {acierto.length ? (
          <Tabla
            columnas={COLUMNAS_ACIERTO}
            filas={acierto}
            claveFila={(f) => f.clave}
            etiqueta="Acierto de los índices"
          />
        ) : (
          <p className="m-0 text-leyenda text-tinta-2">
            La primera prueba se hace de madrugada el primer día de cada mes.
          </p>
        )}
      </div>
      <p className="m-0 text-cuerpo text-tinta" data-testid="calidad-pliegos">
        {textoPliegos(d.pliegos_ilegibles)}
      </p>
      <p className="m-0 text-cuerpo text-tinta" data-testid="calidad-actas">
        Actas de expedientes ajenos: {textoActasMercado(d.actas_mercado)}.
      </p>
    </div>
  );
}

export default function CalidadVista() {
  const [carga, setCarga] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    licitacionesApi.calidad().then(
      (data) => {
        if (vivo) setCarga({ kind: 'ready', data });
      },
      (e) => {
        if (vivo) setCarga({ kind: 'error', message: e.message });
      },
    );
    return () => {
      vivo = false;
    };
  }, []);
  return (
    <Tarjeta
      titulo="Calidad del dato"
      testid="calidad"
      subtitulo="Comprobaciones por código de lo que publica la PLACSP. Lo que no las pasa no entra en los índices de mercado."
    >
      {carga.kind === 'loading' && <Esqueleto lineas={3} />}
      {carga.kind === 'error' && <Aviso tono="error">{carga.message}</Aviso>}
      {carga.kind === 'ready' && <Contenido d={carga.data} />}
    </Tarjeta>
  );
}
