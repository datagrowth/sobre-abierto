// El resumen semanal por email: a quién llega, qué día y a qué hora (la de la empresa),
// y qué lleva. Lo cambia un admin (el servidor lo niega a los demás, que lo ven en lectura), con
// la vista previa y «Enviarme una prueba». Sin SMTP lo dice: se guarda, pero no sale ningún email.
import { useEffect, useState } from 'react';
import { ExternalLink, Mail, Save } from 'lucide-react';
import useUsuario from '../../hooks/useUsuario';
import { plataformaApi } from '../../lib/plataformaApi';
import { alternarDestinatario, DIAS, nombreHora, opcionesHora, SECCIONES, textoResumen } from '../../lib/avisosFormato';
import { esAdmin, NOMBRE_ROL } from '../../lib/usuarioActual';
import { Aviso, Boton, Esqueleto, Selector, Tarjeta } from '../ui';

function useResumen() {
  const [datos, setDatos] = useState(null);
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    plataformaApi.avisosConfig().then(setDatos, (e) => setAviso({ tono: 'error', texto: e.message }));
  }, []);
  return { datos, setDatos, aviso, setAviso };
}

function Casilla({ checked, onChange, children, disabled, testid }) {
  return (
    <label className="inline-flex items-center gap-2 text-tabla text-tinta cursor-pointer">
      <input
        type="checkbox"
        className="accent-tinta"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        data-testid={testid}
      />
      {children}
    </label>
  );
}

function Formulario({ datos, onGuardado, setAviso }) {
  const [c, setC] = useState(datos.config);
  const [ocupado, setOcupado] = useState(null);
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  const hacer = (que, fn, texto) => {
    setOcupado(que);
    fn()
      .then(
        (r) => {
          setAviso({ tono: 'ok', texto });
          onGuardado?.(r);
        },
        (e) => setAviso({ tono: 'error', texto: e.message }),
      )
      .finally(() => setOcupado(null));
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-tabla text-tinta">
        <span>Se envía el</span>
        <Selector
          aria-label="Día"
          className="w-auto py-1"
          opciones={DIAS.map((d, i) => ({ valor: i + 1, texto: d }))}
          value={c.dia}
          onChange={(e) => set('dia', Number(e.target.value))}
        />
        <span>a las</span>
        <Selector
          aria-label={`Hora (${nombreHora()})`}
          className="w-auto py-1"
          opciones={opcionesHora()}
          value={c.hora}
          onChange={(e) => set('hora', Number(e.target.value))}
        />
        <span className="text-tinta-2">{nombreHora()}</span>
      </div>
      <fieldset className="grid gap-1 border-0 p-0 m-0">
        <legend className="text-leyenda font-bold text-tinta-2 mb-1 p-0">Lo reciben</legend>
        {datos.usuarios.map((u) => (
          <Casilla
            key={u.id}
            checked={c.destinatarios.includes(u.id)}
            onChange={() => set('destinatarios', alternarDestinatario(c.destinatarios, u.id))}
            disabled={!u.con_email}
            testid={`destinatario-${u.id}`}
          >
            {u.nombre}{' '}
            <small className="text-tinta-2">
              {NOMBRE_ROL[u.rol]?.toLowerCase()}
              {u.con_email ? '' : ' · sin email: ponlo en Usuarios'}
            </small>
          </Casilla>
        ))}
      </fieldset>
      <fieldset className="grid gap-1 border-0 p-0 m-0">
        <legend className="text-leyenda font-bold text-tinta-2 mb-1 p-0">Qué lleva</legend>
        {SECCIONES.map((s) => (
          <Casilla
            key={s.key}
            checked={c.secciones[s.key] !== false}
            onChange={(v) => set('secciones', { ...c.secciones, [s.key]: v })}
          >
            {s.label}
          </Casilla>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <a
          href={plataformaApi.urlPreviaResumen}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 border rounded-full px-3.5 py-1.5 text-tabla text-tinta bg-lienzo border-borde-control no-underline"
          data-testid="resumen-previa"
        >
          <ExternalLink size={14} aria-hidden="true" />
          Ver vista previa
        </a>
        <Boton
          Icono={Mail}
          cargando={ocupado === 'prueba'}
          onClick={() => hacer('prueba', plataformaApi.probarResumen, 'Prueba enviada a tu email.')}
          testid="resumen-prueba"
        >
          Enviarme una prueba
        </Boton>
        <Boton
          variante="principal"
          escribe
          Icono={Save}
          cargando={ocupado === 'guardar'}
          onClick={() => hacer('guardar', () => plataformaApi.guardarAvisosConfig(c), 'Guardado.')}
          testid="resumen-guardar"
        >
          Guardar
        </Boton>
      </div>
    </div>
  );
}

export default function ResumenSemanal() {
  const yo = useUsuario();
  const { datos, setDatos, aviso, setAviso } = useResumen();
  return (
    <Tarjeta
      titulo="Resumen semanal por email"
      subtitulo={datos ? textoResumen(datos.config) : undefined}
      testid="resumen-semanal"
    >
      {datos && !datos.smtp && (
        <div className="mb-3">
          <Aviso tono="aviso">
            El envío por email no está configurado (SMTP): se guarda, pero no sale ningún email. Ver docs/operacion.md,
            «Correo (SMTP)».
          </Aviso>
        </div>
      )}
      {aviso && (
        <div className="mb-3">
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      {!datos && !aviso && <Esqueleto lineas={4} />}
      {datos &&
        (esAdmin(yo) ? (
          <Formulario
            datos={datos}
            setAviso={setAviso}
            onGuardado={(config) => config?.dia && setDatos({ ...datos, config })}
          />
        ) : (
          <p className="m-0 text-tabla text-tinta-2">
            Lo eligen los admin. {datos.config.destinatarios.includes(yo?.id) ? 'Tú lo recibes.' : 'Tú no lo recibes.'}
          </p>
        ))}
    </Tarjeta>
  );
}
