// Un hilo de comentarios: en el hilo de la oferta, en cada comprobación de la Revisión y en
// cada requisito. Plegado tras su botón («Comentar», «2 comentarios · 1 sin resolver»), salvo que
// mencione a quien mira y siga abierto. «Mencionar» añade «@Nombre» de alguien del equipo; el
// servidor decide a quién avisa. Cualquiera comenta; dar por resuelto, quien escribió o un editor.
import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import useCompaneros from '../../hooks/useCompaneros';
import useUsuario from '../../hooks/useUsuario';
import { insertarMencion, partesComentario, textoBotonComentarios } from '../../lib/comentariosFormato';
import { fechaHora } from '../../lib/formato';
import { puede } from '../../lib/usuarioActual';
import { clases } from '../../lib/uiFormato';
import { AreaTexto, Iniciales, Aviso, Boton, Selector } from '../ui';

function Texto({ c }) {
  return (
    <p className="m-0 whitespace-pre-wrap break-words">
      {partesComentario(c.texto, c.menciones).map((p, i) =>
        p.mencion ? (
          <b key={i} className="text-tinta">
            {p.texto}
          </b>
        ) : (
          <span key={i}>{p.texto}</span>
        ),
      )}
    </p>
  );
}

function Uno({ c, yo, onResolver }) {
  const [ocupado, setOcupado] = useState(false);
  const puedeResolver = puede(yo, 'editor') || (yo && c.autor_id === yo.id);
  const cambiar = async () => {
    setOcupado(true);
    try {
      await onResolver(c.id, !c.resuelto);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <li
      data-testid={`comentario-${c.id}`}
      data-resuelto={c.resuelto || undefined}
      className={clases('flex gap-2 items-start', c.resuelto && 'opacity-60')}
    >
      <Iniciales nombre={c.autor} tamano="pequeno" decorativo />
      <div className="grid gap-0.5 min-w-0 flex-1 text-tabla text-tinta">
        <span className="text-leyenda text-tinta-2">
          <b className="text-tinta">{c.autor}</b> · {fechaHora(c.creado_en)}
          {c.resuelto && c.resuelto_por ? ` · resuelto por ${c.resuelto_por}` : ''}
        </span>
        <Texto c={c} />
      </div>
      {puedeResolver && (
        <Boton
          tamano="pequeno"
          variante="texto"
          cargando={ocupado}
          onClick={cambiar}
          testid={`comentario-resolver-${c.id}`}
        >
          {c.resuelto ? 'Reabrir' : 'Resuelto'}
        </Boton>
      )}
    </li>
  );
}

function Escribir({ onPublicar }) {
  const companeros = useCompaneros();
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState({ ocupado: false, error: null });
  const enviar = async (e) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setEstado({ ocupado: true, error: null });
    try {
      await onPublicar(texto.trim());
      setTexto('');
      setEstado({ ocupado: false, error: null });
    } catch (err) {
      setEstado({ ocupado: false, error: err.message });
    }
  };
  return (
    <form onSubmit={enviar} className="grid gap-1.5">
      <AreaTexto
        rows={2}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={4000}
        placeholder="Escribe un comentario; menciona con @Nombre"
        aria-label="Comentario"
        data-testid="comentario-texto"
      />
      <div className="flex flex-wrap gap-2 items-center">
        {companeros.length > 0 && (
          <Selector
            aria-label="Mencionar a alguien del equipo"
            value=""
            className="w-auto py-1"
            data-testid="comentario-mencionar"
            onChange={(e) => {
              if (e.target.value) setTexto((t) => insertarMencion(t, e.target.value));
            }}
            opciones={[
              { valor: '', texto: 'Mencionar…' },
              ...companeros.map((c) => ({ valor: c.nombre, texto: c.nombre })),
            ]}
          />
        )}
        <Boton tamano="pequeno" submit cargando={estado.ocupado} disabled={!texto.trim()} testid="comentario-publicar">
          Publicar
        </Boton>
      </div>
      {estado.error && <Aviso tono="error">{estado.error}</Aviso>}
    </form>
  );
}

/**
 * hilo: los comentarios de este sitio; onPublicar(texto) y onResolver(id, resuelto) guardan y
 * recargan; abierto: desplegado de entrada (el hilo de la oferta, que tiene su propia tarjeta).
 */
export default function Comentarios({
  hilo = [],
  onPublicar,
  onResolver,
  testid = 'comentarios',
  abierto: deEntrada = false,
}) {
  const yo = useUsuario();
  const meMencionan = hilo.some((c) => !c.resuelto && yo && c.menciones.some((m) => m.id === yo.id));
  // Hasta que la persona lo pliega o despliega, abierto de entrada o si la menciona (los
  // comentarios llegan después del primer pintado).
  const [aMano, setAbierto] = useState(null);
  const abierto = aMano ?? (deEntrada || meMencionan);
  return (
    <div data-testid={testid} className="grid gap-2">
      <div>
        <Boton
          tamano="pequeno"
          variante="texto"
          Icono={MessageSquare}
          onClick={() => setAbierto(!abierto)}
          testid={`${testid}-abrir`}
        >
          {textoBotonComentarios(hilo)}
        </Boton>
      </div>
      {abierto && (
        <div className="grid gap-2.5 pl-2 border-l-2 border-borde">
          {hilo.length > 0 && (
            <ul className="list-none m-0 p-0 grid gap-2">
              {hilo.map((c) => (
                <Uno key={c.id} c={c} yo={yo} onResolver={onResolver} />
              ))}
            </ul>
          )}
          <Escribir onPublicar={onPublicar} />
        </div>
      )}
    </div>
  );
}
