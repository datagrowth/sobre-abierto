// Biblioteca › Documentos sin nota: lo de Drive que Hermes aún no ha resumido en una
// nota (sin nota se encuentra peor al redactar), con «Pedir nota» uno a uno o en bloque. Un PDF
// escaneado no se puede leer: se marca y no se pide.
import { useState } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import { LEIBLE, motivoIlegible } from '../../lib/bibliotecaFormato';
import { fechaCorta } from '../../lib/formato';
import useCarga from '../../hooks/useCarga';
import { Aviso, Boton, Chip, Esqueleto, Tabla } from '../ui';

const MAX_EN_BLOQUE = 50;
const carpetaDe = (ruta) => ruta.split('/').slice(0, -1).join('/');
const nombreDe = (ruta) => ruta.split('/').pop();

export default function BibliotecaSinNota() {
  const carga = useCarga(() => bibliotecaApi.sinNota(), []);
  const [aviso, setAviso] = useState(null);
  const [pidiendo, setPidiendo] = useState(null);
  const pedir = async (rutas, clave) => {
    setPidiendo(clave);
    try {
      const r = await bibliotecaApi.pedirNota({ rutas });
      setAviso({
        tono: 'ok',
        texto: `${r.pedidas === 1 ? '1 nota pedida' : `${r.pedidas} notas pedidas`} a Hermes: llegarán a Propuestas para aprobarlas.`,
      });
      await carga.recargar();
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setPidiendo(null);
    }
  };
  if (carga.kind === 'loading') return <Esqueleto lineas={5} />;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const docs = carga.data.documentos ?? [];
  const legibles = docs.filter(LEIBLE).slice(0, MAX_EN_BLOQUE);
  const columnas = [
    {
      clave: 'titulo',
      titulo: 'Documento',
      celda: (d) => (
        <>
          <a
            href={bibliotecaApi.documents.rawUrl(d.ruta)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-tinta break-words"
          >
            {nombreDe(d.ruta)}
          </a>
          {!LEIBLE(d) && <div className="text-leyenda text-tinta-2">{motivoIlegible(d)}</div>}
        </>
      ),
    },
    {
      clave: 'carpeta',
      titulo: 'Carpeta',
      celda: (d) => <span className="font-mono text-leyenda break-all">{carpetaDe(d.ruta) || '(raíz)'}</span>,
    },
    {
      clave: 'modificado',
      titulo: 'Subido',
      celda: (d) => <span className="whitespace-nowrap">{fechaCorta(d.modificado)}</span>,
    },
    {
      clave: 'accion',
      titulo: '',
      nitida: true,
      celda: (d) =>
        LEIBLE(d) ? (
          <Boton
            tamano="pequeno"
            escribe
            cargando={pidiendo === d.ruta}
            testid={`pedir-nota-${d.ruta}`}
            onClick={() => pedir([d.ruta], d.ruta)}
          >
            Pedir nota
          </Boton>
        ) : (
          <Chip>No se puede leer</Chip>
        ),
    },
  ];
  return (
    <div data-testid="biblioteca-sin-nota" className="grid gap-3">
      <div className="flex gap-3 items-center justify-between flex-wrap">
        <p className="text-tabla text-tinta-2 m-0 max-w-2xl">
          Documentos de Drive que Hermes todavía no ha resumido en una nota. Sin nota, se encuentran peor al redactar.
        </p>
        {legibles.length > 0 && (
          <Boton
            variante="principal"
            escribe
            cargando={pidiendo === 'todas'}
            testid="pedir-todas"
            onClick={() =>
              pedir(
                legibles.map((d) => d.ruta),
                'todas',
              )
            }
          >
            Pedir las {legibles.length} notas a Hermes
          </Boton>
        )}
      </div>
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
      <Tabla
        etiqueta="Documentos sin nota"
        columnas={columnas}
        filas={docs}
        claveFila={(d) => d.ruta}
        apagada={(d) => !LEIBLE(d)}
        vacio="Todos los documentos tienen su nota o una propuesta pendiente."
      />
    </div>
  );
}
