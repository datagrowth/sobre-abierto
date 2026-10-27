// Cabecera fija de una ficha de oportunidad (licitación o convocatoria): título, de quién
// es, una fila de indicadores para decidir (estado, requisitos, Hermes, plazo) con el
// siguiente paso y «Descartar…» a la derecha, y los motivos en una línea cada uno. Compacta:
// se queda fija arriba y no puede comerse la pantalla de lo que hay debajo.
import { useState } from 'react';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, LIENZO, SUPERFICIE_2, RADIUS, TIPO } from '../../lib/tema';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { Aviso, Boton } from '../ui';
import { urlEnlazable } from '../../lib/formato';

// testid y estado: las pruebas localizan el indicador y su veredicto sin depender del texto.
function Indicador({ label, valor, color = TINTA, testid, estado }) {
  return (
    <div
      data-testid={testid}
      data-estado={estado}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        minWidth: 0,
        background: SUPERFICIE_2,
        borderRadius: RADIUS,
        padding: '5px 10px',
      }}
    >
      <span style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>{label}</span>
      <span style={{ fontSize: TIPO.texto, fontWeight: 700, color }}>{valor}</span>
    </div>
  );
}

// Con `motivos` ([{ key, label }], Licitaciones), además del texto se elige el motivo tipificado
// (alimenta «Qué nos falta») y se llama onDescartar({ tipo, motivo }); sin ellos,
// onDescartar(motivo).
function CampoTipo({ motivos, tipo, setTipo }) {
  return (
    <label style={{ fontSize: TIPO.texto, color: TINTA }}>
      Motivo
      <select
        className="input-field"
        required
        value={tipo}
        onChange={(e) => setTipo(e.target.value)}
        data-testid="descarte-tipo"
        style={{ display: 'block', marginTop: 4 }}
      >
        <option value="">Elige el motivo…</option>
        {motivos.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormularioDescarte({ motivos, onDescartar, onHecho, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [tipo, setTipo] = useState('');
  const [estado, setEstado] = useState({ ocupado: false, error: null });
  const valido = motivo.trim().length >= 3 && (!motivos || Boolean(tipo));
  const enviar = async (e) => {
    e.preventDefault();
    if (!valido) return;
    setEstado({ ocupado: true, error: null });
    try {
      await onDescartar(motivos ? { tipo, motivo: motivo.trim() } : motivo.trim());
      onHecho();
    } catch (err) {
      setEstado({ ocupado: false, error: err.message });
    }
  };
  return (
    <form
      onSubmit={enviar}
      data-testid="descarte-formulario"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}
    >
      {motivos && <CampoTipo motivos={motivos} tipo={tipo} setTipo={setTipo} />}
      <label style={{ fontSize: TIPO.texto, color: TINTA }}>
        {motivos ? (
          'Dilo en pocas palabras'
        ) : (
          <>
            ¿Por qué se descarta? <span style={{ color: TINTA_2 }}>Sirve para afinar la criba.</span>
          </>
        )}
        <input
          className="input-field"
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={300}
          data-testid="descarte-motivo"
          placeholder="p. ej. exige ISO 27001, no cubre Canarias, plazo inviable…"
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton
          variante="peligro"
          testid="descarte-confirmar"
          escribe
          cargando={estado.ocupado}
          disabled={!valido}
          onClick={enviar}
        >
          Descartar
        </Boton>
        <Boton Icono={X} onClick={onCancelar}>
          Cancelar
        </Boton>
      </div>
      {estado.error && <Aviso tono="error">{estado.error}</Aviso>}
    </form>
  );
}

function Titulo({ titulo, subtitulo, url, urlTitulo, onVolver }) {
  const enlace = urlEnlazable(url);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {onVolver && (
        <Boton Icono={ArrowLeft} onClick={onVolver}>
          Volver
        </Boton>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: TIPO.titulo, color: TINTA, margin: 0, lineHeight: 1.35 }}>{titulo}</h2>
        <div style={{ fontSize: TIPO.texto, color: TINTA_2, marginTop: 4 }}>{subtitulo}</div>
      </div>
      {enlace && (
        <a
          href={enlace}
          target="_blank"
          rel="noreferrer"
          title={urlTitulo}
          aria-label={urlTitulo}
          style={{ color: TINTA_2 }}
        >
          <ExternalLink size={16} />
        </a>
      )}
    </div>
  );
}

/**
 * accion: { texto } o null; espera: texto cuando el paso siguiente no depende de nadie
 * (p. ej. esperar a los pliegos); onDescartar(motivo) solo si se puede descartar;
 * motivosDescarte: con ellos, el descarte pide también el motivo tipificado (onDescartar({ tipo, motivo }));
 * accesos: atajos que se ven en todas las pestañas (p. ej. las carpetas de Drive), junto a las acciones.
 * debajo: lo que se enseña bajo la cabecera, dentro de ella (p. ej. una confirmación del botón principal).
 */
// En el móvil la cabecera no se queda fija (ocuparía media pantalla): «Volver» y el
// siguiente paso van en una barra fija abajo, al alcance del pulgar.
function BarraMovil({ onVolver, accion, onAccion, ocupado }) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        display: 'flex',
        gap: 8,
        background: LIENZO,
        borderTop: `1px solid ${BORDE}`,
        padding: '8px 12px calc(8px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {onVolver && (
        <Boton Icono={ArrowLeft} onClick={onVolver}>
          Volver
        </Boton>
      )}
      {accion && (
        <span style={{ marginLeft: 'auto' }}>
          <Boton
            variante="principal"
            testid="accion-principal"
            escribe={accion.escribe}
            cargando={ocupado}
            onClick={onAccion}
          >
            {accion.texto}
          </Boton>
        </span>
      )}
    </div>
  );
}

/** preguntas: lo que va debajo de la fila de indicadores y acciones (las tres preguntas de una licitación). */
export default function CabeceraDecision({
  indicadores,
  preguntas = null,
  lineas = [],
  accion,
  espera,
  onAccion,
  ocupado,
  error,
  onDescartar,
  onDescartado,
  motivosDescarte = null,
  debajo = null,
  accesos = null,
  ...titulo
}) {
  const [descartando, setDescartando] = useState(false);
  const { isSmall } = useAnchoPantalla();
  return (
    <div
      data-testid="ficha-cabecera"
      style={{
        position: isSmall ? 'static' : 'sticky',
        top: 0,
        zIndex: 2,
        background: LIENZO,
        paddingBottom: 10,
        borderBottom: `1px solid ${BORDE}`,
      }}
    >
      {isSmall && <BarraMovil onVolver={titulo.onVolver} accion={accion} onAccion={onAccion} ocupado={ocupado} />}
      <Titulo {...titulo} onVolver={isSmall ? undefined : titulo.onVolver} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
        {indicadores.filter(Boolean).map((i) => (
          <Indicador key={i.label} {...i} />
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {accesos}
          {espera && (
            <span data-testid="cabecera-espera" style={{ fontSize: TIPO.texto, color: TINTA_2 }}>
              {espera}
            </span>
          )}
          {onDescartar && !descartando && (
            <Boton variante="peligro" testid="accion-descartar" onClick={() => setDescartando(true)}>
              Descartar…
            </Boton>
          )}
          {accion && !isSmall && (
            <Boton
              variante="principal"
              testid="accion-principal"
              escribe={accion.escribe}
              cargando={ocupado}
              onClick={onAccion}
            >
              {accion.texto}
            </Boton>
          )}
        </span>
      </div>
      {preguntas}
      {lineas.filter(Boolean).length > 0 && (
        <div style={{ fontSize: TIPO.texto, color: TINTA_2, marginTop: 8, lineHeight: 1.5 }}>
          {lineas.filter(Boolean).map((l) => (
            <div
              key={l}
              title={l}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isSmall ? 'normal' : 'nowrap' }}
            >
              {l}
            </div>
          ))}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
      {debajo}
      {descartando && (
        <FormularioDescarte
          motivos={motivosDescarte}
          onDescartar={onDescartar}
          onHecho={() => {
            setDescartando(false);
            onDescartado?.();
          }}
          onCancelar={() => setDescartando(false)}
        />
      )}
    </div>
  );
}
