// Filtros del prefiltro determinista. Se dejan amplios a propósito: la IA criba
// después con el perfil de la empresa (Conocimiento/Empresa/perfil-licitaciones.md).
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { TINTA, TINTA_2 } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { AJUSTA_TUS_CPV } from '../../lib/oportunidadesFormato';
import {
  COMUNIDADES,
  comunidadesDeNuts,
  lista,
  numeroONulo,
  nutsDeComunidades,
  resumenComunidades,
} from '../../lib/formato';
import { SectionCard } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Campo } from '../ui';
import SelectorMultiple from '../comun/SelectorMultiple';

const TIPOS = [
  ['2', 'Servicios'],
  ['1', 'Suministros'],
  ['3', 'Obras'],
  ['22', 'Concesión de servicios'],
  ['8', 'Privado'],
  ['999', 'Otros'],
];

// El prefiltro mira el importe de cada lote cuando se puede ir a lotes sueltos.
function Importes({ valores, set }) {
  return (
    <Campo
      label="Importe por lote (o del contrato si no tiene lotes)"
      grupo
      ayuda="€ sin IVA. Si se puede ir a lotes sueltos, basta con que un lote quede dentro; si hay que presentarse a todos, cuenta el total."
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: TINTA_2 }}>
          Mínimo
          <input
            className="input-field"
            inputMode="numeric"
            value={valores.min}
            onChange={set('min')}
            style={{ display: 'block', marginTop: 3 }}
          />
        </label>
        <label style={{ fontSize: 12, color: TINTA_2 }}>
          Máximo
          <input
            className="input-field"
            inputMode="numeric"
            value={valores.max}
            onChange={set('max')}
            style={{ display: 'block', marginTop: 3 }}
          />
        </label>
      </div>
    </Campo>
  );
}

function aFormulario(f) {
  const { comunidades, otros } = comunidadesDeNuts(f.nuts_prefijos);
  return {
    cpv: f.cpv_prefijos.join(', '),
    palabras: f.palabras.join(', '),
    excluir: f.excluir_palabras.join(', '),
    min: f.importe_min ?? '',
    max: f.importe_max ?? '',
    tipos: f.tipos_contrato,
    comunidades,
    otrosNuts: otros,
    idiomas: f.excluir_idiomas ?? [],
  };
}

function desdeFormulario(v) {
  return {
    cpv_prefijos: lista(v.cpv),
    palabras: lista(v.palabras),
    excluir_palabras: lista(v.excluir),
    importe_min: numeroONulo(v.min),
    importe_max: numeroONulo(v.max),
    tipos_contrato: v.tipos,
    nuts_prefijos: nutsDeComunidades(v.comunidades, v.otrosNuts),
    excluir_idiomas: v.idiomas,
  };
}

const IDIOMAS_TITULO = [
  ['ca', 'Catalán o valenciano'],
  ['eu', 'Euskera'],
  ['gl', 'Gallego'],
];

export default function FiltrosVista() {
  const [valores, setValores] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [deEjemplo, setDeEjemplo] = useState(false);

  useEffect(() => {
    licitacionesApi.filtros().then(
      (f) => {
        setValores(aFormulario(f));
        setDeEjemplo(f.de_ejemplo === true);
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  }, []);

  if (!valores)
    return aviso ? (
      <Aviso tono="error">{aviso.texto}</Aviso>
    ) : (
      <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>
    );
  const set = (k) => (e) => setValores((v) => ({ ...v, [k]: e.target.value }));
  const alternarTipo = (t) =>
    setValores((v) => ({ ...v, tipos: v.tipos.includes(t) ? v.tipos.filter((x) => x !== t) : [...v.tipos, t] }));
  const guardar = async () => {
    const filtros = desdeFormulario(valores);
    if (Number.isNaN(filtros.importe_min) || Number.isNaN(filtros.importe_max)) {
      setAviso({ tono: 'error', texto: 'Los importes deben ser números.' });
      return;
    }
    try {
      setValores(aFormulario(await licitacionesApi.guardarFiltros(filtros)));
      setDeEjemplo(false);
      setAviso({
        tono: 'info',
        texto:
          'Guardado. Se vuelve a pasar el prefiltro a las licitaciones abiertas y a las que esperan en «Sin cribar»: las que ya no pasan salen en unos segundos.',
      });
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    }
  };

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {deEjemplo && (
        <Aviso tono="aviso" testid="filtros-de-ejemplo">
          {AJUSTA_TUS_CPV} Cuando los guardes, el radar usará los tuyos.
        </Aviso>
      )}
      <Aviso>
        Una licitación abierta pasa si casa por <b>CPV o por palabra</b>, está en el rango de importe, es de un tipo
        marcado y del territorio indicado. Después la IA la criba con el perfil de la empresa (
        <code>Empresa/perfil-licitaciones.md</code> en la Biblioteca).
      </Aviso>
      <SectionCard title="PREFILTRO">
        <Campo
          label="Prefijos CPV"
          ayuda="Separados por comas. «72» cubre todos los servicios TI; «79311» solo estudios."
        >
          <input className="input-field" value={valores.cpv} onChange={set('cpv')} style={{ width: '100%' }} />
        </Campo>
        <Campo label="Palabras clave en el título" ayuda="Sin importar tildes ni mayúsculas.">
          <textarea
            className="input-field"
            rows={2}
            value={valores.palabras}
            onChange={set('palabras')}
            style={{ width: '100%' }}
          />
        </Campo>
        <Campo label="Palabras que descartan">
          <input className="input-field" value={valores.excluir} onChange={set('excluir')} style={{ width: '100%' }} />
        </Campo>
        <Importes valores={valores} set={set} />
        <Campo grupo label="Tipos de contrato" ayuda="Ninguno marcado = todos.">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {TIPOS.map(([k, label]) => (
              <label
                key={k}
                style={{
                  fontSize: 12.5,
                  color: TINTA,
                  display: 'inline-flex',
                  gap: 6,
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <input type="checkbox" checked={valores.tipos.includes(k)} onChange={() => alternarTipo(k)} />
                {label}
              </label>
            ))}
          </div>
        </Campo>
        <Campo
          grupo
          label="Descartar las escritas en"
          ayuda="Se deduce del título (la PLACSP no publica el idioma de las plataformas autonómicas). Marcadas, no entran y las que ya estaban en Nuevas pasan a Descartadas con el motivo (salvo las que hayas movido a mano). Sin marcar, pasan y se señalan en la lista; Hermes las descarta si exigen una lengua que el equipo no habla (Ajustes › Empresa)."
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {IDIOMAS_TITULO.map(([k, label]) => (
              <label
                key={k}
                style={{
                  fontSize: 12.5,
                  color: TINTA,
                  display: 'inline-flex',
                  gap: 6,
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={valores.idiomas.includes(k)}
                  onChange={() =>
                    setValores((v) => ({
                      ...v,
                      idiomas: v.idiomas.includes(k) ? v.idiomas.filter((x) => x !== k) : [...v.idiomas, k],
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </Campo>
        <Campo
          grupo
          label="Territorio"
          ayuda={`Ninguna marcada = toda España. Cuenta el lugar de ejecución que publica la PLACSP.${valores.otrosNuts.length ? ` También se conservan estos prefijos NUTS guardados antes: ${valores.otrosNuts.join(', ')}.` : ''}`}
        >
          <SelectorMultiple
            etiqueta="Comunidades autónomas"
            opciones={COMUNIDADES}
            seleccion={valores.comunidades}
            resumen={resumenComunidades(valores.comunidades, valores.otrosNuts)}
            onCambio={(comunidades) => setValores((v) => ({ ...v, comunidades }))}
          />
        </Campo>
        <Boton variante="principal" Icono={Save} onClick={guardar}>
          Guardar filtros
        </Boton>
      </SectionCard>
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
    </div>
  );
}
