// Catálogo de componentes de la interfaz en #/diseno, fuera del menú, para quien desarrolla:
// cada componente de componentes/ui con sus variantes y datos de ejemplo. Un componente nuevo
// de ui se añade aquí con sus variantes.
import { useState } from 'react';
import { FolderOpen, Inbox, Save } from 'lucide-react';
import { euros } from '../../lib/formato';
import { porcentaje } from '../../lib/preciosFormato';
import {
  Iniciales,
  Aviso,
  BarraRango,
  Boton,
  Cajon,
  Campo,
  Chip,
  Dialogo,
  Entrada,
  Esqueleto,
  Indicador,
  LeyendaRango,
  MarcaHermes,
  Menu,
  Pestanas,
  Selector,
  Tabla,
  Tarjeta,
  Vacio,
} from '../ui';

const FILAS = [
  {
    id: 'a',
    expediente: '2026/0412',
    titulo: 'Formación en IA para personal técnico',
    cierre: '2026-11-04',
    importe: 48000,
  },
  { id: 'b', expediente: 'SC-118/26', titulo: 'Cuadro de mando de movilidad', cierre: '2026-10-29', importe: 118450 },
  { id: 'c', expediente: 'EXP-77', titulo: 'Gobierno del dato del cabildo', cierre: null, importe: 31103 },
];

function Muestra({ titulo, children }) {
  return (
    <section className="grid gap-3">
      <h2 className="m-0 text-leyenda font-bold tracking-[0.14em] uppercase text-tinta-2">{titulo}</h2>
      {children}
    </section>
  );
}

const Fila = ({ children }) => <div className="flex flex-wrap gap-2 items-center">{children}</div>;

function Botones() {
  return (
    <Muestra titulo="Botones">
      <Fila>
        <Boton variante="principal" Icono={Save}>
          Guardar (uno por vista)
        </Boton>
        <Boton>Secundario</Boton>
        <Boton variante="texto">De texto</Boton>
        <Boton variante="peligro">Descartar</Boton>
        <Boton cargando>Guardando</Boton>
        <Boton disabled>Desactivado</Boton>
        <Boton tamano="pequeno" Icono={FolderOpen}>
          Pequeño
        </Boton>
      </Fila>
    </Muestra>
  );
}

function Chips() {
  return (
    <Muestra titulo="Chips y avatares">
      <Fila>
        <Chip tono="impide">Impide</Chip>
        <Chip tono="riesgo">Riesgo</Chip>
        <Chip tono="ok">Cumple</Chip>
        <Chip tono="decidido">Decidido</Chip>
        <Chip tono="hermes">Propuesto por Hermes</Chip>
        <Chip>Servicios</Chip>
      </Fila>
      <Fila>
        <Iniciales nombre="Elisa Martín" />
        <Iniciales nombre="Paco Ejemplo" tamano="pequeno" />
        <span className="inline-flex items-center gap-1.5 text-tabla text-tinta">
          <Iniciales nombre="Elisa Martín" decorativo />
          Elisa Martín
        </span>
      </Fila>
    </Muestra>
  );
}

function Campos() {
  return (
    <Muestra titulo="Campos">
      <div className="grid gap-x-4 sm:grid-cols-2 max-w-3xl">
        <Campo etiqueta="Importe mínimo" ayuda="En € sin IVA, por lote.">
          <Entrada inputMode="numeric" defaultValue="15.000" />
        </Campo>
        <Campo etiqueta="Comunidad autónoma">
          <Selector
            opciones={[
              { valor: '', texto: 'Todas' },
              { valor: 'ES70', texto: 'Canarias' },
            ]}
            defaultValue=""
          />
        </Campo>
        <Campo etiqueta="Expediente" error="No es un expediente de la PLACSP.">
          <Entrada invalido defaultValue="123" />
        </Campo>
      </div>
    </Muestra>
  );
}

function Tablas() {
  const [orden, setOrden] = useState({ clave: 'cierre', sentido: 'asc' });
  const [sel, setSel] = useState('b');
  const columnas = [
    {
      clave: 'expediente',
      titulo: 'Expediente',
      ordenable: true,
      celda: (f) => <span className="font-mono text-leyenda">{f.expediente}</span>,
    },
    { clave: 'titulo', titulo: 'Título', ordenable: true },
    { clave: 'cierre', titulo: 'Cierre', ordenable: true, celda: (f) => f.cierre ?? '—' },
    { clave: 'importe', titulo: 'Importe', ordenable: true, alinear: 'derecha', celda: (f) => euros(f.importe) },
  ];
  return (
    <Muestra titulo="Tabla (compacta, con orden, selección y una fila apagada)">
      <Tabla
        columnas={columnas}
        filas={FILAS}
        orden={orden}
        onOrden={setOrden}
        seleccionada={sel}
        onFila={(f) => setSel(f.id)}
        apagada={(f) => f.id === 'c'}
        etiqueta="Ejemplo"
      />
    </Muestra>
  );
}

function Indicadores() {
  return (
    <Muestra titulo="Indicadores">
      <div className="grid gap-3 md:grid-cols-3">
        <Indicador
          titulo="Ofertas esperadas"
          valor="3"
          unidad="ofertas"
          rango="2-5"
          n={41}
          confianza="alta"
          fuente="PLACSP, 2021-2026, n = 41 · CPV 4 dígitos"
        />
        <Indicador
          titulo="Baja esperada"
          valor={porcentaje(0.12)}
          rango={`${porcentaje(0.06)}-${porcentaje(0.19)}`}
          n={23}
          confianza="media"
          fuente="PLACSP, 2021-2026, n = 23"
        >
          <BarraRango
            p25={0.06}
            p50={0.12}
            p75={0.19}
            nuestro={0.09}
            umbral={0.25}
            formato={porcentaje}
            etiqueta="Baja: P25 6 %, mediana 12 %, P75 19 %, tu empresa 9 %, umbral 25 %"
          />
          <LeyendaRango conNuestro conUmbral />
        </Indicador>
        <Indicador titulo="P(un solo licitador)" valor="1 de cada 4" n={7} confianza="baja" fuente="PLACSP, n = 7" />
      </div>
    </Muestra>
  );
}

function Tarjetas() {
  return (
    <Muestra titulo="Tarjetas y Hermes">
      <div className="grid gap-3 md:grid-cols-2">
        <Tarjeta
          titulo="Solvencia técnica"
          subtitulo="3 requisitos · 1 sin comprobar"
          extra={<Chip tono="riesgo">Riesgo</Chip>}
        >
          <p className="m-0 text-cuerpo text-tinta">
            Tres trabajos similares en los últimos tres años por al menos 30.000 €.
          </p>
        </Tarjeta>
        <MarcaHermes detalle="hace 2 h">
          Precio del lote 2: 41.500 € (baja del 9 %), por debajo del umbral de anormalidad.
        </MarcaHermes>
      </div>
      <Fila>
        <MarcaHermes />
      </Fila>
    </Muestra>
  );
}

function Estados() {
  return (
    <Muestra titulo="Avisos, vacío y carga">
      <div className="grid gap-2 max-w-3xl">
        <Aviso>Información: la ingesta va al día.</Aviso>
        <Aviso tono="ok">Guardado. Hermes rehace solo el anexo VI del lote 2.</Aviso>
        <Aviso tono="aviso" titulo="Riesgo">
          El plazo cierra en 3 días: 13 oct, 14:00 (13:00 en Canarias).
        </Aviso>
        <Aviso tono="error" titulo="Impide presentar">
          Falta el certificado ENS de categoría media.
        </Aviso>
      </div>
      <Tarjeta sinRelleno>
        <Vacio
          Icono={Inbox}
          titulo="Nada por revisar"
          texto="Cuando la criba encuentre algo que pueda encajar, aparecerá aquí."
          accion={<Boton>Ver los filtros</Boton>}
        />
      </Tarjeta>
      <Tarjeta>
        <Esqueleto lineas={3} />
      </Tarjeta>
    </Muestra>
  );
}

function Capas() {
  const [cajon, setCajon] = useState(false);
  const [dialogo, setDialogo] = useState(false);
  return (
    <Muestra titulo="Pestañas, menú, cajón y diálogo">
      <Pestanas
        vistas={[
          { key: 'resumen', label: 'Resumen' },
          { key: 'requisitos', label: 'Requisitos', cuenta: 3 },
          { key: 'criterios', label: 'Criterios de valoración' },
        ]}
        vista="requisitos"
        onVista={() => {}}
        etiqueta="Ejemplo de pestañas"
        prefijo="catalogo-pestana"
      />
      <Fila>
        <Menu
          opciones={[
            { clave: 'regenerar', texto: 'Regenerar el paquete', onElegir: () => {} },
            { clave: 'descartar', texto: 'Descartar con motivo', onElegir: () => {}, peligro: true },
          ]}
        />
        <Boton onClick={() => setCajon(true)}>Abrir cajón</Boton>
        <Boton onClick={() => setDialogo(true)}>Abrir diálogo</Boton>
      </Fila>
      <Cajon
        abierto={cajon}
        titulo="Decisiones"
        onCerrar={() => setCajon(false)}
        pie={
          <Boton variante="principal" onClick={() => setCajon(false)}>
            Guardar
          </Boton>
        }
      >
        <p className="m-0 text-cuerpo">El detalle sin salir de la pantalla. Escape lo cierra.</p>
      </Cajon>
      <Dialogo
        abierto={dialogo}
        titulo="¿Descartar esta oportunidad?"
        onCerrar={() => setDialogo(false)}
        acciones={
          <>
            <Boton onClick={() => setDialogo(false)}>Cancelar</Boton>
            <Boton variante="peligro" onClick={() => setDialogo(false)}>
              Descartar
            </Boton>
          </>
        }
      >
        Sale de Oportunidades y queda en Descartadas con el motivo.
      </Dialogo>
    </Muestra>
  );
}

export default function Catalogo() {
  return (
    <div data-testid="catalogo-diseno" className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto px-6 py-6 grid gap-8">
        <header className="grid gap-1">
          <h1 className="m-0 text-pagina font-bold text-tinta">Catálogo de componentes</h1>
          <p className="m-0 text-cuerpo text-tinta-2">
            Los componentes de components/ui con sus variantes. El verde es tu acción, el lavanda es Hermes, y el rojo y
            el ámbar, «Impide» y «Riesgo».
          </p>
        </header>
        <Botones />
        <Chips />
        <Campos />
        <Tablas />
        <Indicadores />
        <Tarjetas />
        <Estados />
        <Capas />
      </div>
    </div>
  );
}
