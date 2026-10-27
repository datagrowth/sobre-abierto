// Las acciones de la versión actual: descargar el Word, subir el tuyo, pedir cambios, rehacerla o descartarla.
import { ListRestart, PenLine, RefreshCw, RotateCcw, Upload, X } from 'lucide-react';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { revisionDeVersion, textoArriba, textoRehacerVigente, versionSiguiente } from '../../../../lib/memoriaFormato';
import { motivosPrecargados } from '../../../../lib/apartadosFormato';
import { Boton } from '../../../ui';
import { apagado, sePuedePedir, COMO_REDACTA } from './compartido';
import EnlaceDoc from './EnlaceDoc';

const CICLO_WORD =
  'Descarga el Word, edítalo y súbelo con «Subir mi Word» (hasta 30 MB): queda como una versión nueva y Hermes no la toca.';

// Una de otro guion no se arregla pidiendo cambios: se rehace desde cero (horas de máquina, por eso pide confirmación).
function RehacerVigente({ id, m, o, hacer, onAviso }) {
  const rehacer = () => {
    if (!window.confirm(textoRehacerVigente(m, o))) return;
    hacer(() => licitacionesApi.redactarMemoria(id, m.lote ?? null), textoArriba(onAviso, COMO_REDACTA.aviso));
  };
  return (
    <Boton
      Icono={RotateCcw}
      variante="principal"
      testid="memoria-rehacer-vigente"
      escribe
      onClick={rehacer}
      title="Redacta una versión nueva desde cero con el guion vigente"
    >
      Rehacer con el guion vigente
    </Boton>
  );
}

export function BotonSubirWord({ siguiente, abierto, onAbrir }) {
  return (
    <Boton
      Icono={Upload}
      testid="memoria-subir-word"
      disabled={abierto}
      onClick={onAbrir}
      title={`Sube el Word (o el PDF) que has editado: será la v${siguiente}`}
    >
      Subir mi Word
    </Boton>
  );
}

// Una de ensayo no se da por buena ni se mejora: se compara con la presentada. «Dar por buena» solo
// está en su tarjeta (ResumenMemoria): aquí se saltaba el resumen y el motivo de lo marcado.
export default function Acciones({ id, m, o, abierto, onPedir, onPedirMotivos, subiendo, onSubir, hacer, onAviso }) {
  const r = revisionDeVersion(m);
  const otroGuion = !m.ensayo && Boolean(m.guion_cambiado);
  const deMano = !m.ensayo && m.estado === 'ensamblada' && Boolean(m.origen?.subida) && !m.sin_repartir;
  const descartar = () => hacer(() => licitacionesApi.revisarBorrador(r.id, 'descartar'), `v${m.version} descartada.`);
  // Un Word subido a mano no se recompone: su portada es la que trae el Word.
  const remontable = m.estado === 'ensamblada' && !m.origen?.subida;
  const remontar = () =>
    hacer(
      () => licitacionesApi.remontarMemoria(id, m.version),
      `La v${m.version} se volvió a montar con el perfil de empresa de ahora.`,
    );
  return (
    <>
      <div data-testid="memoria-ciclo-word" style={{ ...apagado, marginTop: 10 }}>
        {CICLO_WORD}
      </div>
      {deMano && (
        <div data-testid="memoria-subida-a-mano" style={{ ...apagado, marginTop: 4 }}>
          Subida a mano: Hermes no la rehace. Para otra versión con Hermes, pide una memoria nueva en «Más opciones».
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        {r?.rutas.map((ruta) => (
          <EnlaceDoc key={ruta} ruta={ruta} />
        ))}
        <BotonSubirWord siguiente={versionSiguiente(o.memorias)} abierto={subiendo} onAbrir={onSubir} />
        <span style={{ flex: '1 1 0', minWidth: 8 }} />
        {otroGuion && <RehacerVigente id={id} m={m} o={o} hacer={hacer} onAviso={onAviso} />}
        {sePuedePedir(m) && (
          <Boton
            Icono={PenLine}
            variante={!otroGuion ? 'principal' : undefined}
            disabled={abierto}
            onClick={onPedir}
            title="Crea la versión siguiente con tus indicaciones"
          >
            Pedir cambios
          </Boton>
        )}
        {sePuedePedir(m) && motivosPrecargados(m).length > 0 && (
          <Boton
            Icono={ListRestart}
            testid="otra-ronda"
            disabled={abierto}
            onClick={onPedirMotivos}
            title="Abre «Pedir cambios» con los apartados con fuga, fallidos o flojos ya marcados y la cita de cada fuga"
          >
            Otra ronda con estos motivos
          </Boton>
        )}
        {remontable && (
          <Boton
            Icono={RefreshCw}
            testid="memoria-remontar"
            escribe
            onClick={remontar}
            title="Rehace la portada y la firma con el perfil de empresa de ahora; no gasta Hermes"
          >
            Volver a montar sin IA
          </Boton>
        )}
        {r && r.estado !== 'descartada' && (
          <Boton Icono={X} onClick={descartar} title="No sirve: deja de ser la memoria de la oferta">
            Descartar
          </Boton>
        )}
      </div>
    </>
  );
}
