// A incorporar: los perfiles que una oferta se comprometió a incorporar sin
// nombrar a nadie, con los requisitos, la fecha límite para acreditarlo y el candidato. Salen de
// las decisiones de la pestaña Oferta; aquí se busca a quién y se da por cubierto.
import { useState } from 'react';
import { colaboradoresApi } from '../../lib/colaboradoresApi';
import { fechaCorta } from '../../lib/formato';
import { rutaFicha } from '../../lib/rutas';
import useCarga from '../../hooks/useCarga';
import { Aviso, Boton, Chip, Esqueleto, Tabla } from '../ui';

const citaDe = (c) => (c ? `${c.documento}${c.pagina ? `, pág. ${c.pagina}` : ''}` : null);

function Perfil({ p }) {
  return (
    <div>
      <div className="font-semibold">{p.perfil}</div>
      <div className="text-leyenda text-tinta-2">{p.requisitos}</div>
    </div>
  );
}

function Plazo({ p }) {
  return (
    <div>
      <div>{p.acreditar_antes ? `${fechaCorta(p.acreditar_antes)}, si nos proponen` : 'Sin fecha'}</div>
      <div className="text-leyenda text-tinta-2">{[p.plazo, citaDe(p.cita)].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

function Estado({ p, nombres }) {
  if (p.estado === 'cubierto') return <Chip tono="ok">Cubierto</Chip>;
  if (p.candidato_id)
    return <Chip tono="hermes">Candidato: {nombres.get(p.candidato_id) ?? `colaborador ${p.candidato_id}`}</Chip>;
  return <Chip tono="riesgo">Sin candidato</Chip>;
}

function Acciones({ p, onBuscar, onCambiar }) {
  return (
    <div className="flex gap-1.5 flex-wrap justify-end">
      <Boton tamano="pequeno" onClick={() => onBuscar(p.id)} testid={`incorporar-buscar-${p.id}`}>
        Buscar candidatos
      </Boton>
      {p.estado === 'cubierto' ? (
        <Boton tamano="pequeno" variante="texto" escribe onClick={() => onCambiar(p.id, { estado: 'pendiente' })}>
          Reabrir
        </Boton>
      ) : (
        <Boton
          tamano="pequeno"
          escribe
          onClick={() => onCambiar(p.id, { estado: 'cubierto' })}
          testid={`incorporar-cubierto-${p.id}`}
        >
          Marcar cubierto
        </Boton>
      )}
    </div>
  );
}

export default function IncorporarVista({ version, onRecargar, onBuscar }) {
  const [error, setError] = useState(null);
  const carga = useCarga(
    () => Promise.all([colaboradoresApi.aIncorporar(), colaboradoresApi.personas({ inactivos: true })]),
    [],
    version,
  );
  if (carga.kind === 'loading') return <Esqueleto />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const [perfiles, personas] = carga.data;
  const nombres = new Map(personas.items.map((x) => [x.id, x.nombre]));
  const cambiar = (id, cambio) =>
    colaboradoresApi.cambiarIncorporar(id, cambio).then(
      () => {
        setError(null);
        onRecargar();
      },
      (e) => setError(e.message),
    );
  const columnas = [
    { clave: 'perfil', titulo: 'Perfil', celda: (p) => <Perfil p={p} /> },
    {
      clave: 'oferta',
      titulo: 'Oferta',
      celda: (p) => (
        <a
          href={rutaFicha(p.recurso, 'oferta')}
          className="font-mono text-leyenda text-tinta underline underline-offset-3"
        >
          {p.expediente}
        </a>
      ),
    },
    { clave: 'acreditar', titulo: 'Acreditar antes de', celda: (p) => <Plazo p={p} /> },
    { clave: 'estado', titulo: 'Estado', celda: (p) => <Estado p={p} nombres={nombres} /> },
    {
      clave: 'acciones',
      titulo: '',
      nitida: true,
      celda: (p) => <Acciones p={p} onBuscar={onBuscar} onCambiar={cambiar} />,
    },
  ];
  return (
    <div className="grid gap-3" data-testid="equipo-incorporar">
      <p className="text-tabla text-tinta-2 m-0">
        Perfiles que una oferta se comprometió a incorporar. Salen de las decisiones de la pestaña Oferta.
      </p>
      {error && <Aviso tono="error">{error}</Aviso>}
      <Tabla
        columnas={columnas}
        filas={perfiles}
        etiqueta="Perfiles a incorporar"
        densidad="comoda"
        apagada={(p) => p.estado === 'cubierto'}
        vacio="Ninguna oferta tiene perfiles por incorporar."
      />
    </div>
  );
}
