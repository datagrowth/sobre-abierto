// «Guardar búsqueda» de Oportunidades: lo buscado y los filtros a la vista, con un nombre y
// cada cuánto avisar de las nuevas. Se ven y se cambian en Ajustes › Avisos; son de cada persona.
import { useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { consultaParaGuardar, FRECUENCIAS, nombreSugerido } from '../../lib/busquedasFormato';
import { Aviso, Boton, Campo, Dialogo, Entrada, Selector } from '../ui';

function Formulario({ texto, pliegos, filtros, onCerrar }) {
  const [nombre, setNombre] = useState(nombreSugerido({ texto, filtros }));
  const [frecuencia, setFrecuencia] = useState('semanal');
  const [estado, setEstado] = useState({ guardando: false, error: '', hecho: false });
  const guardar = async (e) => {
    e.preventDefault();
    setEstado({ guardando: true, error: '', hecho: false });
    try {
      await licitacionesApi.guardarBusqueda({
        nombre,
        frecuencia,
        consulta: consultaParaGuardar({ texto, pliegos, filtros }),
      });
      setEstado({ guardando: false, error: '', hecho: true });
    } catch (err) {
      setEstado({ guardando: false, error: err.message, hecho: false });
    }
  };
  if (estado.hecho) {
    return (
      <div className="grid gap-3">
        <Aviso tono="ok">Guardada. Te avisaremos de las nuevas que la cumplan; la tienes en Ajustes › Avisos.</Aviso>
        <div>
          <Boton variante="principal" onClick={onCerrar}>
            Cerrar
          </Boton>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={guardar} data-testid="formulario-busqueda">
      <Campo etiqueta="Nombre">
        <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} required />
      </Campo>
      <Campo
        etiqueta="Avisarme de las nuevas"
        ayuda="Las que entren en Por revisar y cumplan lo que buscas ahora (texto y filtros)."
      >
        <Selector
          opciones={FRECUENCIAS.map((f) => ({ valor: f.key, texto: f.label }))}
          value={frecuencia}
          onChange={(e) => setFrecuencia(e.target.value)}
        />
      </Campo>
      {estado.error && (
        <div className="mb-3">
          <Aviso tono="error">{estado.error}</Aviso>
        </div>
      )}
      <div className="flex gap-2">
        <Boton submit variante="principal" cargando={estado.guardando} testid="busqueda-guardar">
          Guardar
        </Boton>
        <Boton variante="texto" onClick={onCerrar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

export default function GuardarBusqueda({ abierto, onCerrar, texto, pliegos, filtros }) {
  return (
    <Dialogo abierto={abierto} titulo="Guardar búsqueda" onCerrar={onCerrar} testid="dialogo-guardar-busqueda">
      {abierto && <Formulario texto={texto} pliegos={pliegos} filtros={filtros} onCerrar={onCerrar} />}
    </Dialogo>
  );
}
