// Perfil de la empresa (del núcleo): lo que podemos acreditar (clasificación, volumen de
// negocio, certificaciones, seguro, plantilla, experiencia), la fecha de constitución y el
// tamaño, para los anexos de las ofertas el representante y el contacto, el nombre comercial y la
// zona horaria.
// Con él el código evalúa los requisitos y descarta solo lo que no podemos presentar o pedir.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { TINTA, TINTA_2 } from '../../lib/tema';
import { plataformaApi } from '../../lib/plataformaApi';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { agregarImpactos, camposCambiados, ofertasEnPreparacion } from '../../lib/impactoFormato';
import useGuardarConImpacto from '../../hooks/useGuardarConImpacto';
import { PanelImpacto } from '../Licitaciones/Oferta/QueCambia';
import { diferenciasPerfil, formularioAPerfil, perfilAFormulario } from '../../lib/empresaFormulario';
import {
  cuerpoPerfilCostes,
  formularioAPerfilCostes,
  GRUPOS_COSTES,
  perfilCostesAFormulario,
} from '../../lib/costesFormulario';
import PropuestaIA from './PropuestaIA';
import { IDIOMAS, fechaHora } from '../../lib/formato';
import { cargarConfigInstalacion } from '../../lib/configInstalacion';
import { SectionCard } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Campo, Chip } from '../ui';
import { Pildora } from './ui';
import useUsuario from '../../hooks/useUsuario';
import { esAdmin } from '../../lib/usuarioActual';

const ancho = { width: '100%' };
const quitar = { background: 'none', border: 'none', color: TINTA_2, cursor: 'pointer', padding: 4 };

function Volumenes({ filas, onChange }) {
  const cambiar = (i, clave) => (e) => onChange(filas.map((f, j) => (j === i ? { ...f, [clave]: e.target.value } : f)));
  const ultimo = Number(filas.at(-1)?.anio) || new Date().getFullYear() - 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {filas.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="input-field"
            inputMode="numeric"
            aria-label="Año"
            value={f.anio}
            onChange={cambiar(i, 'anio')}
            style={{ width: 80 }}
          />
          <input
            className="input-field"
            inputMode="decimal"
            aria-label={`Volumen de negocio de ${f.anio}`}
            placeholder="€ sin IVA"
            value={f.importe}
            onChange={cambiar(i, 'importe')}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            onClick={() => onChange(filas.filter((_, j) => j !== i))}
            aria-label={`Quitar ${f.anio}`}
            style={quitar}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div>
        <Boton Icono={Plus} onClick={() => onChange([...filas, { anio: String(ultimo + 1), importe: '' }])}>
          Añadir año
        </Boton>
      </div>
    </div>
  );
}

const NIVELES = [
  ['', '—'],
  ['basica', 'Básica'],
  ['media', 'Media'],
  ['alta', 'Alta'],
];

// Certificaciones propias (ENS, ISO…): sin filas ni casilla es «sin indicar», que no es lo mismo
// que «no tenemos ninguna»; el servidor solo da por comprobable la segunda.
function Certificaciones({ valores, setValores }) {
  const { certificados: filas, sin_certificados: ninguna } = valores;
  const poner = (cambio) => setValores((v) => ({ ...v, ...cambio }));
  const cambiar = (i, clave) => (e) =>
    poner({ certificados: filas.map((f, j) => (j === i ? { ...f, [clave]: e.target.value } : f)) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {filas.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input-field"
            aria-label="Nombre"
            placeholder="ENS, ISO 27001…"
            value={f.nombre}
            onChange={cambiar(i, 'nombre')}
            data-testid={`empresa-certificado-${i}-nombre`}
            style={{ flex: '2 1 160px', minWidth: 0 }}
          />
          <select
            className="input-field"
            aria-label="Nivel (solo para el ENS)"
            title="Solo para el ENS"
            value={f.nivel}
            onChange={cambiar(i, 'nivel')}
            data-testid={`empresa-certificado-${i}-nivel`}
            style={{ width: 110 }}
          >
            {NIVELES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            className="input-field"
            type="date"
            aria-label="Caduca"
            value={f.caduca}
            onChange={cambiar(i, 'caduca')}
            data-testid={`empresa-certificado-${i}-caduca`}
            style={{ flex: '1 1 140px', minWidth: 0 }}
          />
          <button
            type="button"
            onClick={() => poner({ certificados: filas.filter((_, j) => j !== i) })}
            aria-label="Quitar"
            title="Quitar"
            style={quitar}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div>
        <Boton
          Icono={Plus}
          onClick={() =>
            poner({ certificados: [...filas, { nombre: '', nivel: '', caduca: '' }], sin_certificados: false })
          }
          testid="empresa-certificado-anadir"
        >
          Añadir certificación
        </Boton>
      </div>
      {!filas.length && (
        <label style={{ fontSize: 13, color: TINTA, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={ninguna}
            onChange={(e) => poner({ sin_certificados: e.target.checked })}
            data-testid="empresa-sin-certificados"
          />
          No tenemos ninguna certificación
        </label>
      )}
      {!filas.length && !ninguna && (
        <div style={{ fontSize: 12, color: TINTA_2 }}>
          Sin indicar: Hermes no podrá comprobar las certificaciones que exija un pliego.
        </div>
      )}
    </div>
  );
}

function Fila({ children }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>;
}

// Lo que usan las licitaciones (DEUC, tamaño en la memoria y la crítica, declaraciones).
function DatosEmpresa({ valores, set, input }) {
  return (
    <SectionCard title="DATOS DE EMPRESA">
      <Fila>
        <div style={{ flex: '1 1 160px' }}>
          <Campo label="Fecha de constitución">{input('fecha_constitucion', { type: 'date' })}</Campo>
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <Campo label="Tamaño">
            <select className="input-field" value={valores.tamano} onChange={set('tamano')} style={ancho}>
              <option value="">Sin indicar</option>
              <option value="micro">Micro</option>
              <option value="pequena">Pequeña</option>
              <option value="mediana">Mediana</option>
              <option value="grande">Grande</option>
            </select>
          </Campo>
        </div>
      </Fila>
    </SectionCard>
  );
}

function Direccion({ input }) {
  const caja = (k, testid, label, flex, extra = {}) => (
    <div style={{ flex }}>
      <Campo label={label}>{input(k, { 'data-testid': testid, ...extra })}</Campo>
    </div>
  );
  return (
    <>
      <Fila>
        {caja('calle', 'empresa-calle', 'Calle y número', '3 1 240px', { autoComplete: 'address-line1' })}
        {caja('codigo_postal', 'empresa-cp', 'Código postal', '1 1 100px', {
          inputMode: 'numeric',
          maxLength: 5,
          autoComplete: 'postal-code',
        })}
      </Fila>
      <Fila>
        {caja('municipio', 'empresa-municipio', 'Municipio', '2 1 200px', { autoComplete: 'address-level2' })}
        {caja('provincia', 'empresa-provincia', 'Provincia', '2 1 200px', { autoComplete: 'address-level1' })}
      </Fila>
      <div style={{ fontSize: 12, color: TINTA_2, marginBottom: 12 }}>
        Va en el DEUC, los anexos y la firma de la memoria.
      </div>
    </>
  );
}

function Identidad({ input }) {
  return (
    <>
      <SectionCard title="IDENTIDAD">
        <Fila>
          <div style={{ flex: '1 1 160px' }}>
            <Campo label="NIF">{input('nif', { autoComplete: 'off' })}</Campo>
          </div>
          <div style={{ flex: '3 1 240px' }}>
            <Campo label="Razón social">{input('nombre')}</Campo>
          </div>
        </Fila>
        <Campo
          label="Nombre comercial"
          ayuda="Cómo se llama la empresa en las memorias y en las tareas de Hermes («Acme», no «ACME SOLUCIONES, S.L.»). Vacío: la razón social sin la forma jurídica."
        >
          {input('nombre_comercial', { 'data-testid': 'empresa-nombre-comercial', maxLength: 80 })}
        </Campo>
        <Direccion input={input} />
        <Fila>
          <div style={{ flex: '1 1 160px' }}>
            <Campo label="Años de actividad">{input('anios_actividad', { inputMode: 'numeric' })}</Campo>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <Campo label="Plantilla media anual" ayuda="Personas">
              {input('plantilla_media', { inputMode: 'numeric' })}
            </Campo>
          </div>
        </Fila>
      </SectionCard>
      <Representacion input={input} />
    </>
  );
}

// La hora de la empresa: la de los avisos por email y la que se enseña al lado de la peninsular de
// los plazos.
function ZonaHoraria({ valores, set }) {
  return (
    <SectionCard title="ZONA HORARIA">
      <Campo
        label="Zona horaria"
        ayuda="La de los avisos. Los plazos de la PLACSP son siempre peninsulares; en Canarias se ve también la hora de allí."
      >
        <select
          className="input-field"
          value={valores.zona_horaria}
          onChange={set('zona_horaria')}
          style={ancho}
          data-testid="empresa-zona"
        >
          <option value="Europe/Madrid">Península, Baleares, Ceuta y Melilla</option>
          <option value="Atlantic/Canary">Canarias</option>
        </select>
      </Campo>
    </SectionCard>
  );
}

// Lo que piden los anexos y la PLACSP («D./Dña. … con NIF … en calidad de …»): Hermes lo
// copia en los modelos que rellena y sale en la hoja de datos de la oferta.
function Representacion({ input }) {
  return (
    <SectionCard title="REPRESENTANTE Y CONTACTO">
      <Fila>
        <div style={{ flex: '2 1 220px' }}>
          <Campo label="Representante legal" ayuda="Nombre y apellidos de quien firma las ofertas">
            {input('rep_nombre', { autoComplete: 'name' })}
          </Campo>
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <Campo label="NIF del representante">{input('rep_nif', { autoComplete: 'off' })}</Campo>
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <Campo label="Cargo" ayuda="p. ej. Administrador único">
            {input('rep_cargo', { autoComplete: 'organization-title' })}
          </Campo>
        </div>
      </Fila>
      <Fila>
        <div style={{ flex: '2 1 220px' }}>
          <Campo label="Correo de contacto" ayuda="El de las notificaciones de las licitaciones">
            {input('email', { type: 'email', autoComplete: 'email' })}
          </Campo>
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <Campo label="Teléfono de contacto">{input('telefono', { type: 'tel', autoComplete: 'tel' })}</Campo>
        </div>
      </Fila>
      <div style={{ fontSize: 12, color: TINTA_2 }}>
        Van en los anexos que rellena Hermes y en la hoja de datos de cada oferta. O completos o vacíos.
      </div>
    </SectionCard>
  );
}

function Formulario({ valores, set, setValores }) {
  const input = (k, extra = {}) => (
    <input className="input-field" value={valores[k]} onChange={set(k)} style={ancho} {...extra} />
  );
  return (
    <>
      <Identidad input={input} />
      <SectionCard title="SOLVENCIA">
        <Campo
          label="Clasificaciones empresariales"
          ayuda="Grupo-subgrupo-categoría separados por comas: V-2-C, V-2-3, M-2-5. Vale la categoría en letra o en número."
        >
          {input('clasificaciones')}
        </Campo>
        <Campo
          grupo
          label="Volumen anual de negocio"
          ayuda="Por ejercicio, en € sin IVA. Se usa el mejor de los tres últimos cerrados."
        >
          <Volumenes filas={valores.volumen} onChange={(volumen) => setValores((v) => ({ ...v, volumen }))} />
        </Campo>
        <Fila>
          <div style={{ flex: '1 1 200px' }}>
            <Campo label="Seguro de responsabilidad civil" ayuda="Importe asegurado en €">
              {input('seguro_rc', { inputMode: 'decimal' })}
            </Campo>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <Campo label="Mayor contrato similar" ayuda="Últimos 3 años, € sin IVA">
              {input('mayor_contrato_similar', { inputMode: 'decimal' })}
            </Campo>
          </div>
        </Fila>
      </SectionCard>
      <SectionCard title="EXPERIENCIA Y CERTIFICACIONES">
        <Campo grupo label="Certificaciones" ayuda="El nivel solo es para el ENS.">
          <Certificaciones valores={valores} setValores={setValores} />
        </Campo>
        <Campo label="CPV con experiencia" ayuda="Prefijos separados por comas: 72, 7331, 79311">
          {input('cpv', { inputMode: 'numeric' })}
        </Campo>
        <Campo
          grupo
          label="Idiomas del equipo"
          ayuda="Con ellos Hermes descarta las licitaciones que exigen otra lengua (euskera, catalán, gallego…)."
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(IDIOMAS).map(([k, l]) => (
              <Pildora
                key={k}
                label={l}
                activa={valores.idiomas.includes(k)}
                onClick={() =>
                  setValores((v) => ({
                    ...v,
                    idiomas: v.idiomas.includes(k) ? v.idiomas.filter((x) => x !== k) : [...v.idiomas, k],
                  }))
                }
              />
            ))}
          </div>
        </Campo>
        <Campo
          label="Áreas de formación"
          ayuda="Una por línea. Si das formación, Hermes descarta los cursos de otras materias; vacío, una formación se juzga como cualquier otro contrato."
        >
          <textarea
            className="input-field"
            rows={3}
            value={valores.areas_formacion}
            onChange={set('areas_formacion')}
            style={{ ...ancho, resize: 'vertical' }}
            data-testid="empresa-areas-formacion"
          />
        </Campo>
        <Campo label="Notas">
          <textarea
            className="input-field"
            rows={3}
            maxLength={5000}
            value={valores.notas}
            onChange={set('notas')}
            style={{ ...ancho, resize: 'vertical' }}
          />
        </Campo>
      </SectionCard>
      <DatosEmpresa valores={valores} set={set} input={input} />
      <ZonaHoraria valores={valores} set={set} />
    </>
  );
}

// Propuesta de un agente: no cambia nada hasta que se carga en el formulario y se guarda.
function PropuestaPendiente({ p }) {
  const { propuesta, guardado, cargada, cargar, cerrar } = p;
  const cambios = diferenciasPerfil(guardado, propuesta.perfil);
  return (
    <PropuestaIA
      titulo="Perfil de la empresa propuesto"
      agente={propuesta.agente}
      fecha={propuesta.propuesto_en}
      cambios={cambios}
      nota={
        cargada
          ? 'Cargada en el formulario: revísala y pulsa «Guardar perfil».'
          : cambios.length
            ? 'No cambia nada hasta que la cargas en el formulario y guardas.'
            : 'Coincide con el perfil guardado.'
      }
      aprobar={cargada ? undefined : { texto: 'Cargar en el formulario', onClick: cargar }}
      rechazar={{ texto: 'Descartar', onClick: cerrar }}
    >
      <details style={{ fontSize: 12.5, color: TINTA_2 }}>
        <summary style={{ cursor: 'pointer' }}>De dónde sale cada dato</summary>
        <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{propuesta.motivo}</div>
      </details>
    </PropuestaIA>
  );
}

function usePropuesta(setValores, setAviso) {
  const [propuesta, setPropuesta] = useState(null);
  const [cargada, setCargada] = useState(false);
  const cargar = () => {
    setValores(perfilAFormulario(propuesta.perfil));
    setCargada(true);
  };
  const cerrar = async () => {
    try {
      await plataformaApi.cerrarPropuestaEmpresa();
      setPropuesta(null);
      setCargada(false);
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    }
  };
  return { propuesta, setPropuesta, cargada, cargar, cerrar };
}

// Qué cambia el perfil en las ofertas en preparación (como mucho 10, en paralelo). Si una falla,
// falla todo: sin saber qué cambia en esa oferta no se puede decir que nada cambia.
async function impactoEnOfertas(campos) {
  if (!campos.length) return { afectadas: [], se_mantiene: [], resumen: '' };
  const ofertas = ofertasEnPreparacion(await licitacionesApi.mesa());
  const impactos = await Promise.all(
    ofertas.map((o) =>
      licitacionesApi.impacto(o.id, { cambio: { empresa: campos } }).then((impacto) => ({ ...o, impacto })),
    ),
  );
  return agregarImpactos(impactos);
}

// Guarda el perfil pasando antes por «Qué cambia»; los errores de forma se avisan antes de llamar al servidor.
function useGuardarPerfil({ valores, setValores, guardado, setGuardado, setAviso, p }) {
  const pendiente = useRef(null);
  const escribir = async () => {
    const r = await plataformaApi.guardarEmpresa(pendiente.current);
    setValores(perfilAFormulario(r.perfil));
    setGuardado(r);
    if (p.cargada) await p.cerrar();
    await cargarConfigInstalacion();
    setAviso({
      tono: 'info',
      texto: 'Se vuelven a evaluar los requisitos de las licitaciones y convocatorias abiertas.',
    });
  };
  const impacto = useGuardarConImpacto(null, { guardar: escribir, calcular: impactoEnOfertas });
  const guardar = () => {
    const { perfil, errores } = formularioAPerfil(valores);
    if (errores.length) {
      setAviso({ tono: 'error', texto: errores.join(' ') });
      return;
    }
    setAviso(null);
    pendiente.current = perfil;
    impacto.iniciar(camposCambiados(guardado.perfil, perfil));
  };
  return { guardar, impacto };
}

// Carga el perfil y la propuesta pendiente de un agente.
function useEmpresa() {
  const [valores, setValores] = useState(null);
  const [guardado, setGuardado] = useState({ perfil: null, actualizado_en: null });
  const [aviso, setAviso] = useState(null);
  const p = usePropuesta(setValores, setAviso);
  const { setPropuesta } = p;

  useEffect(() => {
    plataformaApi.empresa().then(
      (r) => {
        setValores(perfilAFormulario(r.perfil));
        setGuardado(r);
        setPropuesta(r.propuesta ?? null);
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  }, [setPropuesta]);

  const { guardar, impacto } = useGuardarPerfil({ valores, setValores, guardado, setGuardado, setAviso, p });
  return {
    valores,
    setValores,
    actualizado: guardado.actualizado_en,
    aviso,
    guardar,
    impacto,
    propuesta: { ...p, guardado: guardado.perfil },
  };
}

// Costes internos: van aparte del perfil (su tabla, su Guardar) porque nunca llegan a un agente;
// sirven para que las comprobaciones avisen de lo que la memoria compromete y cuesta dinero.
function useCostes() {
  const [valores, setValores] = useState(null);
  const [estado, setEstado] = useState({ actualizado_en: null, por_defecto: true });
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const aplicar = useCallback((r) => {
    setValores(perfilCostesAFormulario(r.perfil));
    setEstado({ actualizado_en: r.actualizado_en, por_defecto: r.por_defecto });
  }, []);
  useEffect(() => {
    plataformaApi.getCostes().then(aplicar, (e) => setAviso({ tono: 'error', texto: e.message }));
  }, [aplicar]);
  const guardar = async () => {
    const { perfil, errores } = formularioAPerfilCostes(valores);
    if (errores.length) {
      setAviso({ tono: 'error', texto: errores.join(' ') });
      return;
    }
    setGuardando(true);
    setAviso(null);
    try {
      aplicar(await plataformaApi.putCostes(cuerpoPerfilCostes(perfil)));
      setAviso({ tono: 'info', texto: 'Costes guardados. Los vacíos toman el valor por defecto.' });
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setGuardando(false);
    }
  };
  return { valores, setValores, estado, aviso, guardando, guardar };
}

function CampoCoste({ c, valor, onChange }) {
  return (
    <div style={{ flex: '1 1 220px' }}>
      <Campo label={`${c.etiqueta} (${c.unidad})`} ayuda={c.ayuda || undefined}>
        <input
          className="input-field"
          inputMode={c.tipo === 'entero' ? 'numeric' : 'decimal'}
          placeholder="Por defecto"
          value={valor}
          onChange={(e) => onChange(c.clave, e.target.value)}
          data-testid={`costes-${c.clave}`}
          style={ancho}
        />
      </Campo>
    </div>
  );
}

function CostesInternos() {
  const { valores, setValores, estado, aviso, guardando, guardar } = useCostes();
  const cambiar = (clave, texto) => setValores((v) => ({ ...v, [clave]: texto }));
  const insignia = estado.por_defecto ? <Chip testid="costes-por-defecto">Valores por defecto</Chip> : null;
  return (
    <SectionCard title="COSTES INTERNOS" right={insignia}>
      <div data-testid="costes-internos" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Aviso>
          Lo que nos cuesta una hora, un envío o un informe, para avisar de lo que una memoria compromete y cuesta
          dinero. <b>No salen de Hermes ni van a la memoria.</b>
        </Aviso>
        {valores &&
          GRUPOS_COSTES.map((g) => (
            <Campo key={g.id} grupo label={g.titulo}>
              <Fila>
                {g.campos.map((c) => (
                  <CampoCoste key={c.clave} c={c} valor={valores[c.clave]} onChange={cambiar} />
                ))}
              </Fila>
            </Campo>
          ))}
        {!valores && !aviso && <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>}
        {valores && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Boton escribe Icono={Save} onClick={guardar} cargando={guardando} testid="costes-guardar">
              Guardar costes
            </Boton>
            {estado.actualizado_en && (
              <span style={{ fontSize: 11.5, color: TINTA_2 }} data-testid="costes-actualizado">
                Última actualización: {fechaHora(estado.actualizado_en)}
              </span>
            )}
          </div>
        )}
        {aviso && (
          <div data-testid="costes-aviso">
            <Aviso tono={aviso.tono}>
              <span style={{ color: TINTA }}>{aviso.texto}</span>
            </Aviso>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

const INTRO = (
  <>
    Lo que la empresa puede acreditar. Con esto se evalúan los requisitos de cada licitación (semáforo de la ficha) y,
    si uno excluyente no se cumple, la oportunidad pasa sola a <b>Descartadas</b> con el motivo. Hermes lo lee para
    preparar las fichas.
  </>
);

export default function EmpresaVista() {
  const { valores, setValores, actualizado, aviso, guardar, impacto, propuesta } = useEmpresa();
  const usuario = useUsuario();
  if (!valores)
    return aviso ? (
      <Aviso tono="error">{aviso.texto}</Aviso>
    ) : (
      <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>
    );
  const set = (k) => (e) => setValores((v) => ({ ...v, [k]: e.target.value }));
  return (
    <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Aviso>{INTRO}</Aviso>
      {propuesta.propuesta && <PropuestaPendiente p={propuesta} />}
      <Formulario valores={valores} set={set} setValores={setValores} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Boton
          variante="principal"
          escribe
          Icono={Save}
          onClick={guardar}
          cargando={impacto.ocupado}
          disabled={impacto.estado.fase === 'panel'}
          testid="empresa-guardar"
        >
          Guardar perfil
        </Boton>
        {actualizado && (
          <span style={{ fontSize: 11.5, color: TINTA_2 }}>Última actualización: {fechaHora(actualizado)}</span>
        )}
      </div>
      <PanelImpacto
        g={impacto}
        conMarcar={false}
        textoRehacer="Guardar perfil"
        textoFallo="No se pudo calcular qué cambia en las ofertas en preparación. ¿Guardar el perfil igualmente, sin saber antes qué cambia en ellas?"
      />
      {aviso && (
        <Aviso tono={aviso.tono}>
          <span style={{ color: TINTA }}>{aviso.texto}</span>
        </Aviso>
      )}
      {/* Los euros internos solo los ve un admin (el servidor no se los da a nadie más). */}
      {esAdmin(usuario) && <CostesInternos />}
    </div>
  );
}
