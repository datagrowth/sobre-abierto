// Mercado › Panorama: lo adjudicado en nuestros CPV en los últimos 24 meses, por
// trimestre; quién gana con nuestra cuota en verde; los órganos que más compran; y la baja y las
// ofertas por tramo. Todo de la PLACSP, por código.
import { useEffect, useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { barrasTrimestres, millones } from '../../lib/mercadoFormato';
import { porcentaje } from '../../lib/preciosFormato';
import { euros } from '../../lib/formato';
import { clases } from '../../lib/uiFormato';
import { Aviso, Esqueleto, Tabla, Tarjeta } from '../ui';

function Trimestres({ p }) {
  const barras = barrasTrimestres(p.trimestres);
  return (
    <Tarjeta titulo="Importe adjudicado por trimestre" subtitulo="M€" testid="panorama-trimestres">
      <div
        className="flex items-end gap-1.5 h-[150px] pt-5"
        role="img"
        aria-label={barras.map((b) => `${b.etiqueta}: ${millones(b.importe)} M€`).join(', ')}
      >
        {barras.map((b, i) => (
          <div key={b.trimestre} className="flex-1 flex flex-col justify-end h-full min-w-0">
            <span className="text-leyenda text-tinta-2 text-center tabular-nums">
              {b.importe ? millones(b.importe) : ''}
            </span>
            {/* El trimestre en curso, más claro: aún no ha acabado. El verde es solo para tu empresa. */}
            <span
              className={clases('block rounded-t-[3px] bg-tinta', i === barras.length - 1 && 'opacity-50')}
              style={{ height: `${Math.max(b.alto, b.importe ? 2 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {barras.map((b) => (
          <span key={b.trimestre} className="flex-1 text-center text-leyenda text-tinta-2 min-w-0 truncate">
            {b.etiqueta}
          </span>
        ))}
      </div>
      <p className="m-0 mt-2 text-leyenda text-tinta-2">
        Fuente: PLACSP, n = {p.n} adjudicaciones de los CPV del perfil ({euros(p.importe)} en total). El último
        trimestre, más claro, aún no ha acabado.
        {p.acuerdos_marco?.lotes > 0 &&
          ` No suma el techo de ${p.acuerdos_marco.lotes} ${p.acuerdos_marco.lotes === 1 ? 'lote' : 'lotes'} de acuerdo marco con varias adjudicatarias (${p.acuerdos_marco.adjudicaciones} adjudicaciones): es lo máximo que se podrá gastar, no lo adjudicado.`}
      </p>
    </Tarjeta>
  );
}

function QuienGana({ p }) {
  const filas =
    p.nuestra_cuota && !p.adjudicatarios.some((a) => a.nosotros)
      ? [...p.adjudicatarios, p.nuestra_cuota]
      : p.adjudicatarios;
  const max = Math.max(0.0001, ...filas.map((f) => f.cuota));
  return (
    <Tarjeta titulo="Quién gana" subtitulo="cuota del importe" testid="panorama-ganadores">
      {filas.length ? (
        <ul className="m-0 p-0 list-none grid gap-2">
          {filas.map((f) => (
            <li
              key={f.nif}
              className={clases('grid items-center gap-2 text-tabla', f.nosotros && 'font-bold')}
              style={{ gridTemplateColumns: 'minmax(0, 1.4fr) 1fr 48px' }}
              data-nosotros={f.nosotros || undefined}
            >
              <span className="truncate" title={f.nombre ?? f.nif}>
                {f.nosotros ? `${f.nombre ?? 'Tu empresa'} (tu empresa)` : (f.nombre ?? 'Persona física')}
              </span>
              <span className="h-2 rounded bg-superficie-2">
                <span
                  className={clases('block h-2 rounded', f.nosotros ? 'bg-accion' : 'bg-tinta')}
                  style={{ width: `${(f.cuota / max) * 100}%` }}
                />
              </span>
              <span className="text-right tabular-nums">{porcentaje(f.cuota)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-tabla text-tinta-2">Sin adjudicaciones en el periodo.</p>
      )}
      <p className="m-0 mt-2 text-leyenda text-tinta-2">Fuente: PLACSP. En verde, tu empresa.</p>
    </Tarjeta>
  );
}

const COLUMNAS_ORGANOS = [
  { clave: 'nombre', titulo: 'Órgano', celda: (o) => o.nombre ?? o.nif },
  { clave: 'contratos', titulo: 'Contratos', alinear: 'derecha' },
  { clave: 'importe', titulo: 'Importe', alinear: 'derecha', celda: (o) => euros(o.importe) },
];

const COLUMNAS_TRAMOS = [
  { clave: 'tramo', titulo: 'Ofertas' },
  { clave: 'adjudicaciones', titulo: 'Adjudicaciones', alinear: 'derecha' },
  { clave: 'baja_mediana', titulo: 'Baja mediana', alinear: 'derecha', celda: (t) => porcentaje(t.baja_mediana) },
];

export default function PanoramaVista() {
  const [carga, setCarga] = useState({ kind: 'loading' });
  useEffect(() => {
    let vivo = true;
    licitacionesApi.panorama().then(
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
  if (carga.kind === 'loading') return <Esqueleto lineas={4} />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const p = carga.data;
  return (
    <div className="grid gap-4" data-testid="panorama">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Trimestres p={p} />
        <QuienGana p={p} />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Tarjeta titulo="Órganos que más compran" testid="panorama-organos">
          <Tabla
            columnas={COLUMNAS_ORGANOS}
            filas={p.organos}
            claveFila={(o) => o.nif}
            etiqueta="Órganos que más compran"
            vacio="Sin adjudicaciones en el periodo."
          />
        </Tarjeta>
        <Tarjeta titulo="Baja y ofertas por tramo" subtitulo="a más ofertas, más baja" testid="panorama-tramos">
          <Tabla
            columnas={COLUMNAS_TRAMOS}
            filas={p.tramos}
            claveFila={(t) => t.tramo}
            etiqueta="Baja por tramo de ofertas"
          />
        </Tarjeta>
      </div>
      <p className="m-0 text-leyenda text-tinta-2">
        Del {p.desde} al {p.hasta}. {p.nota}
      </p>
    </div>
  );
}
