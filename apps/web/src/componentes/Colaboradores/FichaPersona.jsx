// Ficha de un colaborador: lo que acredita con su evidencia (horas de docencia por
// materia con la página del CV), dónde está (ofertas y contratos con su rol), las ofertas ganadas
// con ella y la disponibilidad que sale de ahí. Avisa si el CV es antiguo o hay uno nuevo por
// revisar. Desde aquí se edita, se vuelve a leer el CV con Hermes o se sube uno nuevo, se da de
// baja (inactivo) o se borra. Abierta desde la matriz de equipo (#/equipo/<id>#campo=topografía), va a esa
// materia: si la ficha no la recoge y su CV la menciona, se añade con el formulario de siempre.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, FileText, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { TINTA, TINTA_2, OK_TEXTO, RIESGO, IMPIDE, RADIUS, alpha } from '../../lib/tema';
import { colaboradoresApi } from '../../lib/colaboradoresApi';
import { urlDocumento } from '../../lib/apiCliente';
import { DISPONIBILIDADES, TIPOS, docenciaATexto, idiomasATexto } from '../../lib/colaboradoresFormulario';
import { fechaCorta, fechaHora } from '../../lib/formato';
import { rutaA, rutaFicha } from '../../lib/rutas';
import { slug } from '../../lib/matrizEquipoFormato';
import useCarga from '../../hooks/useCarga';
import useRuta from '../../hooks/useRuta';
import { KPI } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Chip } from '../ui';
import { Bloque, EstadoFicha } from '../comun/ui';
import FormularioPersona from './FormularioPersona';
import SubirCv from './SubirCv';

const COLOR_DISPONIBILIDAD = { disponible: OK_TEXTO, parcial: RIESGO, no_disponible: IMPIDE };
const ESTADO_ASIGNACION = {
  en_preparacion: 'En preparación',
  presentada: 'Presentada',
  en_ejecucion: 'En ejecución',
  ganada: 'Ganada',
  perdida: 'Perdida',
};

function Lista({ titulo, items, vacio = 'Sin datos.' }) {
  return (
    <Bloque titulo={titulo}>
      {items.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {items.map((x) => (
            <Chip key={x}>{x}</Chip>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>{vacio}</div>
      )}
    </Bloque>
  );
}

// Los mismos campos en los que la matriz de equipo busca la materia (sectores primero).
const CAMPOS_EXPERIENCIA = ['sectores', 'tecnologias', 'certificaciones', 'titulaciones'];
const plano = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

function registradas(p, campo) {
  const buscada = plano(campo);
  return CAMPOS_EXPERIENCIA.flatMap((c) => p[c] ?? []).filter((v) => plano(v).includes(buscada));
}

const pagina = (f) => (Number.isInteger(f?.pagina) ? ` (pág. ${f.pagina})` : '');

function EvidenciaCv({ p, campo, onAnadir }) {
  const carga = useCarga(
    () => (p.cv_ruta ? colaboradoresApi.evidencia(p.id, campo) : Promise.resolve({ fragmentos: [] })),
    [p.id, p.cv_ruta, campo],
  );
  const [aviso, setAviso] = useState(null);
  const pedir = () =>
    colaboradoresApi.desdeCv(p.cv_ruta, p.id).then(
      () =>
        setAviso({ tono: 'info', texto: 'Hermes leerá el CV y dejará el perfil en «Por aprobar» para confirmarlo.' }),
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  if (carga.kind === 'loading')
    return <div style={{ fontSize: 12.5, color: TINTA_2 }}>Buscando «{campo}» en su CV…</div>;
  const primero = carga.kind === 'ready' ? carga.data.fragmentos[0] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {carga.kind === 'error' && <Aviso tono="aviso">No se ha podido leer su CV ahora ({carga.message}).</Aviso>}
      {primero ? (
        <Aviso tono="aviso">
          <span data-testid="persona-campo-cv">
            Su CV menciona «{campo}»{pagina(primero)}: «{primero.texto}»
          </span>
        </Aviso>
      ) : (
        carga.kind === 'ready' && (
          <div style={{ fontSize: 12.5, color: TINTA_2 }}>
            {p.cv_ruta ? `Su CV no menciona «${campo}».` : 'Sin CV en la Biblioteca.'}
          </div>
        )
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Boton variante={primero ? 'principal' : undefined} onClick={onAnadir} testid="persona-campo-anadir" escribe>
          Añadir «{campo}» a su experiencia
        </Boton>
        {p.cv_ruta && (
          <Boton
            Icono={Sparkles}
            onClick={pedir}
            testid="persona-campo-pedir-hermes"
            escribe
            title="Hermes lee el CV y propone el perfil; una persona lo confirma en «Por aprobar»"
          >
            Pedir a Hermes que lea el CV
          </Boton>
        )}
      </div>
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
    </div>
  );
}

function CampoPedido({ p, campo, onAnadir }) {
  const ref = useRef(null);
  const suyas = registradas(p, campo);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [campo]);
  const color = suyas.length ? OK_TEXTO : RIESGO;
  return (
    <div
      ref={ref}
      data-testid={`persona-campo-${slug(campo)}`}
      data-estado={suyas.length ? 'registrada' : 'falta'}
      style={{ borderRadius: RADIUS, boxShadow: `0 0 0 2px ${alpha(color, 0.6)}` }}
    >
      <Bloque titulo={`EXPERIENCIA EN «${campo.toUpperCase()}»`}>
        {suyas.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {suyas.map((x) => (
              <Chip key={x} tono="ok" punto={false}>
                ✓ {x}
              </Chip>
            ))}
          </div>
        ) : (
          <EvidenciaCv p={p} campo={campo} onAnadir={onAnadir} />
        )}
      </Bloque>
    </div>
  );
}

function Docencia({ docencia }) {
  return (
    <Bloque titulo="DOCENCIA ACREDITADA">
      {docencia.length ? (
        <ul
          data-testid="persona-docencia"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}
        >
          {docencia.map((d) => (
            <li
              key={docenciaATexto(d)}
              style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontSize: 12.5, color: TINTA }}
            >
              <span>
                {d.materia} · {d.horas} h
                {d.desde || d.hasta ? ` (${[d.desde, d.hasta].filter(Boolean).join('-')})` : ''}
              </span>
              <span style={{ color: d.evidencia ? TINTA_2 : RIESGO }}>{d.evidencia ?? 'sin evidencia'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>
          Sin horas de docencia registradas. Si su CV las trae, pide a Hermes que lo relea.
        </div>
      )}
    </Bloque>
  );
}

function DondeEsta({ asignaciones }) {
  return (
    <Bloque titulo="DÓNDE ESTÁ">
      {asignaciones.length ? (
        <ul data-testid="persona-donde" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {asignaciones.map((a) => (
            <li
              key={`${a.dominio}-${a.recurso}`}
              style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontSize: 12.5, color: TINTA }}
            >
              <span>
                <a
                  href={a.dominio === 'licitaciones' ? rutaFicha(a.recurso) : rutaA({ seccion: a.dominio })}
                  className="font-mono"
                  style={{ color: TINTA }}
                >
                  {a.expediente}
                </a>{' '}
                · {a.titulo}
                {a.rol ? ` · ${a.rol}` : ''}
              </span>
              <span style={{ color: TINTA_2, whiteSpace: 'nowrap' }}>
                {ESTADO_ASIGNACION[a.estado]}
                {a.estado === 'en_ejecucion' && a.hasta ? ` hasta el ${fechaCorta(a.hasta)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>No figura en ninguna oferta.</div>
      )}
    </Bloque>
  );
}

function AvisoCv({ p }) {
  const ruta = useRuta();
  if (p.cv.nuevo) {
    return (
      <Aviso tono="info">
        <span data-testid="persona-aviso-cv-nuevo">Hay un CV nuevo leído por Hermes esperando revisión.</span>{' '}
        <Boton onClick={() => ruta.irVista('pendientes', String(p.cv.nuevo))}>Revisarlo</Boton>
      </Aviso>
    );
  }
  if (p.cv.antiguo)
    return (
      <Aviso tono="aviso">
        <span data-testid="persona-aviso-cv-antiguo">
          Su CV se leyó el {fechaCorta(p.cv.leido_en)}: tiene más de 12 meses. Pídele uno actualizado antes de
          comprometerla en una oferta.
        </span>
      </Aviso>
    );
  return null;
}

const textoDisponibilidad = (d) =>
  d.estado === 'no_disponible' && d.hasta ? `Hasta el ${fechaCorta(d.hasta)}` : DISPONIBILIDADES[d.estado];

function Vista({ p }) {
  return (
    <>
      <AvisoCv p={p} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KPI label="Experiencia" value={p.anios_experiencia === null ? '—' : `${p.anios_experiencia} años`} />
        <KPI
          label="Disponibilidad"
          value={textoDisponibilidad(p.disponibilidad)}
          hint={p.disponibilidad.motivo || undefined}
          accent={COLOR_DISPONIBILIDAD[p.disponibilidad.estado]}
        />
        <KPI
          label="Ofertas ganadas con ella"
          value={p.ofertas.resueltas ? `${p.ofertas.ganadas} de ${p.ofertas.resueltas}` : '—'}
        />
        <KPI label="Tarifa" value={p.tarifa_hora === null ? '—' : `${p.tarifa_hora} €/h`} />
      </div>
      <Docencia docencia={p.docencia} />
      <DondeEsta asignaciones={p.asignaciones} />
      <Lista titulo="TITULACIONES" items={p.titulaciones} />
      <Lista titulo="CERTIFICACIONES" items={p.certificaciones} />
      <Lista titulo="TECNOLOGÍAS Y HABILIDADES" items={p.tecnologias} />
      <Lista titulo="IDIOMAS" items={p.idiomas.length ? [idiomasATexto(p.idiomas)] : []} />
      <Lista titulo="SECTORES Y CPV" items={[...p.sectores, ...p.cpv.map((c) => `CPV ${c}`)]} />
      <Bloque titulo="CV Y NOTAS">
        {p.linkedin && (
          <div style={{ marginBottom: 8 }}>
            <a
              href={p.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: TINTA, fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center' }}
            >
              <ExternalLink size={13} />
              Ver en LinkedIn
            </a>
          </div>
        )}
        {p.cv_ruta ? (
          <a
            href={urlDocumento(p.cv_ruta)}
            target="_blank"
            rel="noreferrer"
            style={{ color: TINTA, fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center' }}
          >
            <FileText size={13} />
            {p.cv_ruta}
          </a>
        ) : (
          <div style={{ fontSize: 12.5, color: TINTA_2 }}>Sin CV en la Biblioteca.</div>
        )}
        {p.notas && (
          <div style={{ fontSize: 12.5, color: TINTA_2, marginTop: 8, whiteSpace: 'pre-wrap' }}>{p.notas}</div>
        )}
        <div style={{ fontSize: 11.5, color: TINTA_2, marginTop: 8 }}>
          {p.cv.leido_en ? `CV leído: ${fechaCorta(p.cv.leido_en)} · ` : ''}Ficha actualizada:{' '}
          {fechaHora(p.actualizada_en)}
        </div>
      </Bloque>
    </>
  );
}

function Acciones({ p, onEditar, onHecho, onBorrada }) {
  const [aviso, setAviso] = useState(null);
  const hacer = async (fn, texto, despues = onHecho) => {
    try {
      await fn();
      setAviso({ tono: 'info', texto });
      despues();
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    }
  };
  const borrar = () => {
    if (window.confirm(`¿Borrar a ${p.nombre} y sus perfiles pendientes? Su CV sigue en la Biblioteca.`))
      hacer(() => colaboradoresApi.borrar(p.id), 'Borrado.', onBorrada);
  };
  const {
    id: _id,
    creada_en: _c,
    actualizada_en: _a,
    disponibilidad: _d,
    cv: _cv,
    asignaciones: _as,
    ofertas: _o,
    ...datos
  } = p;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Boton Icono={Pencil} onClick={onEditar}>
          Editar
        </Boton>
        {p.cv_ruta && (
          <Boton
            Icono={Sparkles}
            onClick={() =>
              hacer(
                () => colaboradoresApi.desdeCv(p.cv_ruta, p.id),
                'Hermes leerá el CV y dejará el perfil en «Por aprobar».',
              )
            }
            title="Hermes lee el CV y propone los cambios"
          >
            Releer CV con Hermes
          </Boton>
        )}
        <SubirCv
          personaId={p.id}
          onAviso={setAviso}
          title="Sube su CV actualizado; Hermes propone los cambios sobre esta ficha"
        >
          Subir CV nuevo
        </SubirCv>
        <Boton
          onClick={() =>
            hacer(
              () => colaboradoresApi.guardar(p.id, { ...datos, activo: !p.activo }),
              p.activo ? 'Dado de baja: ya no sale en las búsquedas.' : 'Activo de nuevo.',
            )
          }
        >
          {p.activo ? 'Dar de baja' : 'Reactivar'}
        </Boton>
        <Boton Icono={Trash2} onClick={borrar} title="Borra sus datos de la plataforma">
          Borrar
        </Boton>
      </div>
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
    </div>
  );
}

// El ancla #campo= solo vale para la persona que se está viendo.
function useCampo(id) {
  const ruta = useRuta();
  return ruta.seccion === 'equipo' && String(ruta.id) === String(id) ? (ruta.campo ?? null) : null;
}

export default function FichaPersona({ id, version, onVolver, onCambio, onBorrada }) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  // null: viendo la ficha; si no, la persona con la que se abre el formulario de siempre.
  const [editando, setEditando] = useState(null);
  const campo = useCampo(id);
  const cargar = useCallback(
    () =>
      colaboradoresApi.persona(id).then(
        (p) => setEstado({ kind: 'ready', p }),
        (e) => setEstado({ kind: 'error', message: e.message }),
      ),
    [id],
  );
  useEffect(() => {
    cargar();
  }, [cargar, version]);
  const tras = () => {
    cargar();
    onCambio();
  };

  if (estado.kind !== 'ready') return <EstadoFicha estado={estado} onVolver={onVolver} />;
  const p = estado.p;
  const guardar = async (persona) => {
    await colaboradoresApi.guardar(p.id, persona);
    setEditando(null);
    tras();
  };
  const conCampo = () => setEditando({ ...p, sectores: [...p.sectores, campo] });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {onVolver && (
          <Boton Icono={ArrowLeft} onClick={onVolver}>
            Volver
          </Boton>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, color: TINTA, margin: 0 }}>{p.nombre}</h2>
          <div style={{ fontSize: 12, color: TINTA_2, marginTop: 4 }}>
            {p.rol || 'Sin rol'} · {TIPOS[p.tipo].toLowerCase()}
            {!p.activo && ' · inactivo'}
          </div>
        </div>
      </div>
      {editando ? (
        <FormularioPersona
          key={p.actualizada_en}
          inicial={editando}
          onGuardar={guardar}
          onCancelar={() => setEditando(null)}
        />
      ) : (
        <>
          <Acciones p={p} onEditar={() => setEditando(p)} onHecho={tras} onBorrada={onBorrada} />
          {campo && <CampoPedido p={p} campo={campo} onAnadir={conCampo} />}
          <Vista p={p} />
        </>
      )}
    </div>
  );
}
