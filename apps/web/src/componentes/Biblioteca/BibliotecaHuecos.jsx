// Biblioteca › Huecos: lo que han pedido los pliegos de los últimos 6 meses y la
// Biblioteca no respalda. Rellenar un hueco mejora todas las memorias que vengan después: pedir un
// borrador a Hermes, crear la nota o revisar la que se quedó vieja.
import { useState } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import { TENEMOS } from '../../lib/bibliotecaFormato';
import useCarga from '../../hooks/useCarga';
import { Aviso, Boton, Chip, Esqueleto, Tabla } from '../ui';

const DE = { criterio: 'Criterio de valoración', requisito: 'Requisito de solvencia o medios' };

export default function BibliotecaHuecos({ onOpenNote }) {
  const carga = useCarga(() => bibliotecaApi.huecos(), []);
  const [aviso, setAviso] = useState(null);
  const [pidiendo, setPidiendo] = useState(null);
  const borrador = async (tema) => {
    setPidiendo(tema);
    try {
      await bibliotecaApi.pedirNota({ tema });
      setAviso({ tono: 'ok', texto: `Borrador pedido a Hermes: llegará a Propuestas («${tema}»).` });
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setPidiendo(null);
    }
  };
  if (carga.kind === 'loading') return <Esqueleto lineas={5} />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const h = carga.data;
  if (h.estado === 'sin_busqueda')
    return (
      <Aviso tono="aviso" testid="huecos-sin-busqueda">
        Los huecos se calculan con la búsqueda por significado, que aún no está lista: vuelve cuando el índice termine
        de leer la Biblioteca.
      </Aviso>
    );
  const columnas = [
    {
      clave: 'tema',
      titulo: 'Qué piden',
      celda: (x) => (
        <>
          <div className="font-semibold break-words">{x.tema}</div>
          <div className="text-leyenda text-tinta-2">{DE[x.de]}</div>
        </>
      ),
    },
    { clave: 'pliegos', titulo: 'Pliegos', alinear: 'derecha' },
    {
      clave: 'tenemos',
      titulo: 'Lo que tenemos',
      celda: (x) => (
        <Chip tono={TENEMOS[x.tenemos].tono}>
          {TENEMOS[x.tenemos].texto}
          {x.nota ? `: ${x.nota.titulo}` : ''}
        </Chip>
      ),
    },
    {
      clave: 'accion',
      titulo: '',
      nitida: true,
      celda: (x) =>
        x.nota ? (
          <Boton tamano="pequeno" onClick={() => onOpenNote(x.nota.ruta)}>
            Revisar nota
          </Boton>
        ) : (
          <Boton tamano="pequeno" escribe cargando={pidiendo === x.tema} onClick={() => borrador(x.tema)}>
            Pedir borrador a Hermes
          </Boton>
        ),
    },
  ];
  return (
    <div data-testid="biblioteca-huecos" className="grid gap-3">
      <p className="text-tabla text-tinta-2 m-0 max-w-3xl">
        Lo que han pedido los pliegos de los últimos 6 meses y la Biblioteca no respalda ({h.huecos.length} de {h.temas}{' '}
        temas). Rellenar un hueco mejora todas las memorias que vengan después.
      </p>
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
      <Tabla
        etiqueta="Huecos de la Biblioteca"
        columnas={columnas}
        filas={h.huecos}
        claveFila={(x) => x.tema}
        vacio="Sin huecos: la Biblioteca respalda lo que han pedido los pliegos."
      />
    </div>
  );
}
