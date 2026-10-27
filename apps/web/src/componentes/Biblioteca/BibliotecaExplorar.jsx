// Biblioteca › Explorar: las notas con su tipo, carpeta, en cuántas ofertas se han
// usado y cuándo se revisaron («Revisar» si pasa de 12 meses), filtrables por tipo, sector y
// estado, y el estado del indexador en una línea. Una fila abre la nota; la referencia es Drive.
import { useState } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import {
  filasDeNotas,
  filtrarNotas,
  lineaIndexador,
  recuentos,
  textoUsos,
  TIPOS_NOTA,
} from '../../lib/bibliotecaFormato';
import { fechaCorta } from '../../lib/formato';
import useCarga from '../../hooks/useCarga';
import { Aviso, Campo, Chip, Entrada, Esqueleto, Selector, Tabla } from '../ui';

const ETIQUETA_TIPO = { ...TIPOS_NOTA, sin_tipo: 'Sin tipo' };

async function cargar() {
  const [notas, usos, indice] = await Promise.all([
    bibliotecaApi.vault.notes(),
    bibliotecaApi.usos().catch(() => ({ usos: {} })),
    bibliotecaApi.documents.status().catch(() => null),
  ]);
  return { filas: filasDeNotas(notas.items ?? [], usos.usos ?? {}), indice };
}

function Filtros({ r, f, setF }) {
  const marcar = (t) =>
    setF((x) => ({ ...x, tipos: x.tipos.includes(t) ? x.tipos.filter((y) => y !== t) : [...x.tipos, t] }));
  return (
    <aside aria-label="Filtros de la Biblioteca" className="grid gap-3 content-start min-w-0">
      <fieldset className="border-0 p-0 m-0">
        <legend className="text-tabla font-bold text-tinta mb-1">Tipo</legend>
        {Object.entries(r.tipos).map(([t, n]) => (
          <label key={t} className="flex justify-between gap-2 py-0.5 text-tabla text-tinta cursor-pointer">
            <span className="flex gap-2 items-center">
              <input type="checkbox" checked={f.tipos.includes(t)} onChange={() => marcar(t)} />
              {ETIQUETA_TIPO[t] ?? t}
            </span>
            <small className="text-tinta-2 tabular-nums">{n}</small>
          </label>
        ))}
      </fieldset>
      <Campo etiqueta="Sector">
        <Selector
          value={f.sector}
          onChange={(e) => setF((x) => ({ ...x, sector: e.target.value }))}
          opciones={[{ valor: '', texto: 'Todos los sectores' }, ...r.sectores.map((s) => ({ valor: s, texto: s }))]}
        />
      </Campo>
      <Campo etiqueta="Estado">
        <Selector
          value={f.estado}
          onChange={(e) => setF((x) => ({ ...x, estado: e.target.value }))}
          opciones={[
            { valor: '', texto: 'Todas' },
            { valor: 'al_dia', texto: 'Al día' },
            { valor: 'revisar', texto: `Revisar, más de 12 meses (${r.revisar})` },
          ]}
        />
      </Campo>
    </aside>
  );
}

const COLUMNAS = [
  {
    clave: 'title',
    titulo: 'Nota',
    ordenable: true,
    celda: (n) => (
      <>
        <div className="font-semibold break-words">{n.title}</div>
        <div className="text-leyenda text-tinta-2 font-mono break-all">{n.carpeta || '(raíz)'}</div>
      </>
    ),
  },
  {
    clave: 'tipo',
    titulo: 'Tipo',
    ordenable: true,
    valor: (n) => ETIQUETA_TIPO[n.tipo ?? 'sin_tipo'],
    celda: (n) =>
      n.tipo ? (
        <Chip title={n.tipo_deducido ? 'Deducido de la carpeta: ponlo en el frontmatter («tipo»)' : undefined}>
          {TIPOS_NOTA[n.tipo]}
          {n.tipo_deducido ? '*' : ''}
        </Chip>
      ) : (
        <span className="text-tinta-2">—</span>
      ),
  },
  {
    clave: 'usos',
    titulo: 'Usada en',
    alinear: 'derecha',
    ordenable: true,
    celda: (n) => <span className="tabular-nums whitespace-nowrap">{textoUsos(n.usos)}</span>,
  },
  {
    clave: 'revisada_en',
    titulo: 'Revisada',
    ordenable: true,
    celda: (n) => (
      <span className="whitespace-nowrap">
        {fechaCorta(n.revisada_en ?? n.mtime)} {n.revisar && <Chip tono="riesgo">Revisar</Chip>}
      </span>
    ),
  },
];

export default function BibliotecaExplorar({ onOpenNote }) {
  const carga = useCarga(cargar, []);
  const [f, setF] = useState({ tipos: [], sector: '', estado: '', texto: '' });
  const [orden, setOrden] = useState({ clave: 'usos', sentido: 'desc' });
  if (carga.kind === 'loading') return <Esqueleto lineas={6} />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const { filas, indice } = carga.data;
  const vistas = filtrarNotas(filas, f);
  return (
    <div data-testid="biblioteca-explorar" className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] items-start">
      <Filtros r={recuentos(filas)} f={f} setF={setF} />
      <div className="grid gap-2 min-w-0">
        <Entrada
          value={f.texto}
          onChange={(e) => setF((x) => ({ ...x, texto: e.target.value }))}
          placeholder="Filtrar por título o carpeta"
          aria-label="Filtrar notas"
        />
        <p data-testid="biblioteca-indexador" className="text-leyenda text-tinta-2 m-0">
          {lineaIndexador(indice)} {vistas.length} de {filas.length} notas.
        </p>
        <Tabla
          etiqueta="Notas de la Biblioteca"
          testid="biblioteca-notas"
          columnas={COLUMNAS}
          filas={vistas}
          claveFila={(n) => n.path}
          orden={orden}
          onOrden={setOrden}
          onFila={(n) => onOpenNote(n.path)}
          vacio="Ninguna nota con esos filtros."
        />
      </div>
    </div>
  );
}
