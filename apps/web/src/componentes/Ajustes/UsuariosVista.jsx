// Ajustes › Usuarios y permisos. Un admin da de alta (con una contraseña temporal que
// la persona cambia al entrar), cambia roles y da de baja. Todos ven qué puede hacer cada rol y
// cambian su propia contraseña. El servidor es quien autoriza: esto solo enseña.
import { useCallback, useEffect, useState } from 'react';
import { Check, Minus, RefreshCw, UserPlus } from 'lucide-react';
import useUsuario from '../../hooks/useUsuario';
import { usuariosApi } from '../../lib/accesoApi';
import { fechaHora } from '../../lib/formato';
import {
  contrasenaTemporal,
  esAdmin,
  estadoUsuario,
  NOMBRE_ROL,
  problemaContrasena,
  QUE_PUEDE,
  ROLES,
} from '../../lib/usuarioActual';
import FormularioContrasena from '../Acceso/FormularioContrasena';
import { Iniciales, Aviso, Boton, Campo, Chip, Entrada, Selector, Tabla, Tarjeta } from '../ui';

const OPCIONES_ROL = ROLES.map((r) => ({ valor: r, texto: NOMBRE_ROL[r] }));

function Persona({ u }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <Iniciales nombre={u.nombre} decorativo />
      <span className="min-w-0">
        <span className="block font-medium">{u.nombre}</span>
        <span className="block text-leyenda text-tinta-2">{u.email}</span>
      </span>
    </span>
  );
}

function useUsuarios() {
  const [usuarios, setUsuarios] = useState(null);
  const [aviso, setAviso] = useState(null);
  const cargar = useCallback(
    () =>
      usuariosApi.listar().then(
        (r) => setUsuarios(r.usuarios),
        (e) => setAviso({ tono: 'error', texto: e.message }),
      ),
    [],
  );
  useEffect(() => {
    cargar();
  }, [cargar]);
  // Cada cambio vuelve a leer la lista: el servidor puede negarlo (p. ej. dejar sin ningún admin).
  // Devuelve si salió bien.
  const hacer = (promesa, texto) =>
    promesa.then(
      () => {
        setAviso(texto ? { tono: 'ok', texto } : null);
        cargar();
        return true;
      },
      (e) => {
        setAviso({ tono: 'error', texto: e.message });
        cargar();
        return false;
      },
    );
  return { usuarios, aviso, hacer };
}

function AltaUsuario({ onAlta }) {
  const [d, setD] = useState({ nombre: '', email: '', rol: 'editor', contrasena: contrasenaTemporal() });
  const [error, setError] = useState('');
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const enviar = (e) => {
    e.preventDefault();
    const p = problemaContrasena(d.contrasena);
    if (p) return setError(p);
    setError('');
    onAlta(d).then((ok) => {
      if (ok) setD({ nombre: '', email: '', rol: 'editor', contrasena: contrasenaTemporal() });
    });
  };
  return (
    <form
      onSubmit={enviar}
      data-testid="alta-usuario"
      className="grid gap-x-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
    >
      <Campo etiqueta="Nombre">
        <Entrada value={d.nombre} onChange={set('nombre')} autoComplete="off" required />
      </Campo>
      <Campo etiqueta="Email">
        <Entrada type="email" value={d.email} onChange={set('email')} autoComplete="off" required />
      </Campo>
      <Campo etiqueta="Permisos">
        <Selector opciones={OPCIONES_ROL} value={d.rol} onChange={set('rol')} />
      </Campo>
      <Campo etiqueta="Contraseña temporal" ayuda="Pásasela tú; la cambiará al entrar." error={error}>
        <Entrada value={d.contrasena} onChange={set('contrasena')} autoComplete="off" className="font-mono" />
      </Campo>
      <div className="flex items-end gap-2 mb-3">
        <Boton submit variante="principal" escribe Icono={UserPlus} testid="usuario-crear">
          Añadir usuario
        </Boton>
      </div>
    </form>
  );
}

// Nombre (el que firma en el historial) y email (con el que entra) de una persona.
function EditarUsuario({ u, onGuardar, onCancelar }) {
  const [d, setD] = useState({ nombre: u.nombre, email: u.email });
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const enviar = (e) => {
    e.preventDefault();
    onGuardar(d).then((ok) => {
      if (ok) onCancelar();
    });
  };
  return (
    <form
      onSubmit={enviar}
      data-testid="editar-usuario"
      className="grid gap-x-3 mt-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
    >
      <Campo etiqueta="Nombre" ayuda="Es el que firma lo que guarda.">
        <Entrada value={d.nombre} onChange={set('nombre')} autoComplete="off" required />
      </Campo>
      <Campo etiqueta="Email" ayuda="Con el que entra.">
        <Entrada type="email" value={d.email} onChange={set('email')} autoComplete="off" required />
      </Campo>
      <div className="flex items-start gap-2 mt-6">
        <Boton submit variante="principal" escribe testid="usuario-guardar">
          Guardar
        </Boton>
        <Boton variante="texto" onClick={onCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

function columnas({ yo, hacer, onEditar }) {
  const temporal = (u) => {
    const c = contrasenaTemporal();
    hacer(usuariosApi.temporal(u.id, c), `Contraseña temporal de ${u.nombre}: ${c} — pásasela; la cambiará al entrar.`);
  };
  return [
    { clave: 'nombre', titulo: 'Persona', celda: (u) => <Persona u={u} /> },
    {
      clave: 'rol',
      titulo: 'Permisos',
      nitida: true,
      celda: (u) => (
        <Selector
          aria-label={`Permisos de ${u.nombre}`}
          opciones={OPCIONES_ROL}
          value={u.rol}
          disabled={!u.activo}
          onChange={(e) => hacer(usuariosApi.cambiar(u.id, { rol: e.target.value }), null)}
        />
      ),
    },
    {
      clave: 'ultimo_acceso',
      titulo: 'Último acceso',
      valor: (u) => (u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : '—'),
    },
    {
      clave: 'estado',
      titulo: 'Estado',
      celda: (u) => {
        const e = estadoUsuario(u);
        return <Chip tono={e.tono}>{e.texto}</Chip>;
      },
    },
    {
      clave: 'acciones',
      titulo: '',
      nitida: true,
      celda: (u) => (
        <span className="inline-flex gap-1 flex-wrap">
          <Boton variante="texto" tamano="pequeno" onClick={() => onEditar(u)}>
            Editar
          </Boton>
          {u.activo && (
            <Boton variante="texto" tamano="pequeno" escribe Icono={RefreshCw} onClick={() => temporal(u)}>
              Contraseña temporal
            </Boton>
          )}
          {u.id !== yo && (
            <Boton
              variante="texto"
              tamano="pequeno"
              escribe
              onClick={() => hacer(usuariosApi.cambiar(u.id, { activo: !u.activo }), null)}
            >
              {u.activo ? 'Dar de baja' : 'Reactivar'}
            </Boton>
          )}
        </span>
      ),
    },
  ];
}

function GestionUsuarios({ yo }) {
  const { usuarios, aviso, hacer } = useUsuarios();
  const [editando, setEditando] = useState(null);
  const alta = (d) =>
    hacer(
      usuariosApi.crear(d),
      `${d.nombre} ya tiene acceso. Su contraseña temporal es ${d.contrasena}: pásasela; la cambiará al entrar.`,
    );
  return (
    <Tarjeta
      titulo="Usuarios"
      subtitulo="Cada persona entra con su email y una contraseña propia de Hermes."
      testid="usuarios-lista"
    >
      {aviso && (
        <div className="mb-3">
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      {usuarios && (
        <Tabla
          etiqueta="Usuarios"
          columnas={columnas({ yo, hacer, onEditar: setEditando })}
          filas={usuarios}
          apagada={(u) => !u.activo}
          vacio="Aún no hay usuarios."
        />
      )}
      {editando && (
        <EditarUsuario
          key={editando.id}
          u={editando}
          onCancelar={() => setEditando(null)}
          onGuardar={(d) => hacer(usuariosApi.cambiar(editando.id, d), `Guardado: ${d.nombre}.`)}
        />
      )}
      <h4 className="text-tabla font-bold text-tinta mt-4 mb-2">Añadir usuario</h4>
      <AltaUsuario onAlta={alta} />
    </Tarjeta>
  );
}

function Si({ si }) {
  return si ? (
    <Check size={15} aria-label="Sí" className="text-ok inline" />
  ) : (
    <Minus size={15} aria-label="No" className="text-tinta-2 inline" />
  );
}

function QuePuede() {
  return (
    <Tarjeta
      titulo="Qué puede hacer cada uno"
      subtitulo="Lo que alguien guarda queda en el historial con su nombre."
      testid="usuarios-permisos"
    >
      <table className="w-full text-tabla text-tinta border-collapse">
        <thead>
          <tr>
            <th className="text-left py-1.5" />
            {ROLES.map((r) => (
              <th key={r} className="text-center py-1.5 text-leyenda text-tinta-2">
                {NOMBRE_ROL[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QUE_PUEDE.map(([que, ...si]) => (
            <tr key={que} className="border-t border-borde">
              <td className="py-2 pr-3">{que}</td>
              {si.map((s, i) => (
                <td key={ROLES[i]} className="text-center">
                  <Si si={s} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Tarjeta>
  );
}

export default function UsuariosVista() {
  const yo = useUsuario();
  return (
    <div className="grid gap-4" style={{ maxWidth: 1040 }} data-testid="ajustes-usuarios">
      {esAdmin(yo) ? (
        <GestionUsuarios yo={yo?.id ?? 0} />
      ) : (
        <Aviso>Solo un admin ve y cambia los usuarios. Tu permiso es {NOMBRE_ROL[yo.rol].toLowerCase()}.</Aviso>
      )}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <QuePuede />
        {yo && !yo.emergencia && (
          <Tarjeta titulo="Tu contraseña" subtitulo={yo.email ?? undefined} testid="usuarios-mi-contrasena">
            <FormularioContrasena />
          </Tarjeta>
        )}
        {yo?.emergencia && (
          <Aviso tono="aviso">
            Has entrado con el acceso de emergencia: no tiene contraseña propia. Entra con tu email para usar Hermes con
            tu nombre.
          </Aviso>
        )}
      </div>
    </div>
  );
}
