// La pestaña Oferta: todo se gestiona desde aquí, sin pasar por las comprobaciones aparte. En
// preparación, el estado de la oferta, el asistente que pregunta y el detalle (guion, decisiones,
// equipo, memoria y documentos). Descartada, o por decidir con el plazo encima, lo que hay que
// decidir: recuperarla, o prepararla o descartarla viendo lo que la frena. Las filas que impiden
// presentar, con sus acciones, están en la Revisión.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TINTA_2 } from '../../../lib/tema';
import {
  cajonDeDestino,
  filasDeModo,
  modoComprobaciones,
  pidePrepararConfirmacion,
  salidaDeDestino,
  textoDescarte,
} from '../../../lib/comprobacionesFormato';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import useComprobaciones from '../../../hooks/useComprobaciones';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { CambiosContext, useGuardiaSalida, useRegistroCambios } from '../../../hooks/useCambiosSinGuardar';
import { useFocoBloqueo } from '../../../hooks/useFocoFilas';
import { ir } from '../../../hooks/useRuta';
import { Aviso, Boton } from '../../ui';
import Confirmacion from '../../comun/Confirmacion';
import DescarteTipificado from '../DescarteTipificado';
import AsistenteOferta from './AsistenteOferta';
import Bloqueos from './Bloqueos';
import Comprobado from './Comprobado';
import { useCajones, useDatosDetalle, useSalida } from '../../../hooks/useDetalleOferta';
import DetalleOferta, { AvisoSalida } from './DetalleOferta';
import EstadoOferta from './EstadoOferta';

function Recuperar({ f, onCambio }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  return (
    <div data-testid="comprobaciones-solo-lectura" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Aviso tono="aviso">{textoDescarte(f)}</Aviso>
      <div>
        <Boton
          variante="principal"
          escribe
          cargando={ocupado}
          testid="recuperar"
          onClick={() => hacer(() => licitacionesApi.cambiar(f.id, { estado: 'nueva' }), 'Recuperada.')}
        >
          Recuperar
        </Boton>
      </div>
      {aviso?.tono === 'error' && <Aviso tono="error">{aviso.texto}</Aviso>}
    </div>
  );
}

function Decidir({ f, irA, onCambio }) {
  const [pide, setPide] = useState(null);
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const preparar = () => hacer(() => licitacionesApi.cambiar(f.id, { estado: 'en_preparacion' }), 'En preparación.');
  const cerrar = () => setPide(null);
  return (
    <div data-testid="comprobaciones-decidir" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!pide && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Boton
            variante="principal"
            escribe
            cargando={ocupado}
            testid="preparar-oferta"
            onClick={() => (pidePrepararConfirmacion(f) ? setPide('preparar') : preparar())}
          >
            Preparar la oferta
          </Boton>
          <Boton escribe variante="peligro" testid="descartar-oferta" onClick={() => setPide('descartar')}>
            Descartar con motivo
          </Boton>
          <Boton testid="ver-ficha" onClick={() => irA?.('requisitos')}>
            Ver la ficha completa
          </Boton>
        </div>
      )}
      {pide === 'preparar' && (
        <Confirmacion
          pregunta="¿Preparar la oferta de todos modos?"
          textoSi="Preparar la oferta"
          detalle={
            f.retirada ? 'La licitación está retirada en la Plataforma.' : 'Los requisitos de la ficha están en rojo.'
          }
          onSi={() => {
            cerrar();
            preparar();
          }}
          onNo={cerrar}
        />
      )}
      {pide === 'descartar' && (
        <DescarteTipificado
          id={f.id}
          testid="comprobaciones-descarte"
          onCancelar={cerrar}
          onHecho={() => {
            cerrar();
            onCambio();
          }}
        />
      )}
      {aviso?.tono === 'error' && <Aviso tono="error">{aviso.texto}</Aviso>}
    </div>
  );
}

// Descartada (solo lectura, con «Recuperar») o por decidir con prisa (solo la elegibilidad).
function SinPreparar({ f, c, modo, foco, irA, recargar }) {
  const { abiertas, noComprobadas } = filasDeModo(c, modo);
  const { resaltada } = useFocoBloqueo(foco?.bloqueo, abiertas.concat(noComprobadas), c);
  const fila = {
    idLicitacion: f.id,
    soloLectura: modo === 'solo_lectura',
    resaltada,
    recargar,
    pliegos: f.pliegos ?? [],
  };
  return (
    <div data-testid="oferta-sin-preparar" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <EstadoOferta f={f} c={c} modo={modo} />
      {modo === 'solo_lectura' ? (
        <Recuperar f={f} onCambio={recargar} />
      ) : (
        <Decidir f={f} irA={irA} onCambio={recargar} />
      )}
      <Bloqueos filas={abiertas} {...fila} />
      <Comprobado comprobado={modo === 'decidir' ? [] : c.comprobado} noComprobadas={noComprobadas} {...fila} />
    </div>
  );
}

// El destino de un dato: su apartado del detalle con el foco en el campo, o la sección de fuera donde
// se arregla (Ajustes › Empresa, los requisitos). Salir con cambios sin guardar pregunta antes.
function useAbrirDestino(cajones, pedirSalida, irA) {
  const { abrir } = cajones;
  return useCallback(
    (destino) => {
      const c = cajonDeDestino(destino);
      if (c) {
        pedirSalida(() => abrir(c.nombre, c.campo), c.nombre);
        return;
      }
      const salida = salidaDeDestino(destino);
      if (salida === 'ajustes') pedirSalida(() => ir('ajustes'));
      else if (salida === 'expediente') pedirSalida(() => irA?.('requisitos'));
    },
    [abrir, pedirSalida, irA],
  );
}

function EnPreparacion({ f, c, comprobaciones, foco, version, irA, onCambio }) {
  const cajones = useCajones();
  const { sucios, marcar } = useRegistroCambios();
  const salida = useSalida(sucios, cajones);
  useGuardiaSalida(salida.pedirSalida);
  const datos = useDatosDetalle(f.id, cajones.abiertos.length > 0);
  const abrirCajon = useAbrirDestino(cajones, salida.pedirSalida, irA);
  // Desde la Revisión («Pedir cambios», un dato de una fila): el apartado del detalle con su campo.
  const { abrir } = cajones;
  useEffect(() => {
    if (foco?.cajon) abrir(foco.cajon, foco.campo ?? null);
  }, [foco?.cajon, foco?.campo, foco?.pedido, abrir]);
  const contexto = useMemo(
    () => ({ sucios, marcar, pedirSalida: salida.pedirSalida, abrirCajon }),
    [sucios, marcar, salida.pedirSalida, abrirCajon],
  );
  const tras = () => {
    datos.oferta.recargar();
    datos.propuesta.recargar();
    comprobaciones.recargar();
    onCambio?.();
  };
  return (
    <CambiosContext.Provider value={contexto}>
      <div data-testid="oferta" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <EstadoOferta f={f} c={c} modo="completa" />
        <AsistenteOferta f={f} version={version} irA={irA} />
        <DetalleOferta
          f={f}
          cajones={cajones}
          salida={salida}
          sucios={sucios}
          datos={datos}
          comprobaciones={comprobaciones}
          tras={tras}
          irA={irA}
        />
        <AvisoSalida salida={salida} />
      </div>
    </CambiosContext.Provider>
  );
}

/** f: la ficha (una nueva con ficha va como «ficha_por_revisar»); foco: { bloqueo, cajon, campo } de la ruta o de la Revisión. */
export default function OfertaPestana({ f, foco = null, version, irA, onCambio }) {
  const comprobaciones = useComprobaciones(f.id);
  if (comprobaciones.kind === 'error') return <Aviso tono="error">{comprobaciones.message}</Aviso>;
  if (!comprobaciones.data) return <div style={{ color: TINTA_2, fontSize: 13, padding: 20 }}>Cargando la oferta…</div>;
  const modo = modoComprobaciones(f, comprobaciones.data);
  const recargar = () => {
    comprobaciones.recargar();
    onCambio?.();
  };
  if (modo !== 'completa')
    return <SinPreparar f={f} c={comprobaciones.data} modo={modo} foco={foco} irA={irA} recargar={recargar} />;
  return (
    <EnPreparacion
      f={f}
      c={comprobaciones.data}
      comprobaciones={comprobaciones}
      foco={foco}
      version={version}
      irA={irA}
      onCambio={onCambio}
    />
  );
}
