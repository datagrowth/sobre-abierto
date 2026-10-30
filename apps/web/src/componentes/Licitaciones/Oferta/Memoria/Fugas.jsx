// Las fugas entre sobres de una versión, con su cita, o lo que se comprobó si no hay ninguna.
import { PenLine } from 'lucide-react';
import { TINTA, TINTA_2, RIESGO, IMPIDE, RADIUS, alpha } from '../../../../lib/tema';
import { fechaHora } from '../../../../lib/formato';
import {
  dondeFuga,
  fugasDe,
  gravedadFuga,
  indicacionDeFuga,
  textoComprobadoFugas,
  textoFugas,
} from '../../../../lib/fugasFormato';
import { Boton, Chip } from '../../../ui';
import { texto, apagado, sePuedePedir, anclaApartado } from './compartido';

const TONO_GRAVEDAD = { impide: 'impide', sospecha: 'riesgo', no_comprobado: 'neutro' };

// Sin hallazgos se dice qué se comprobó (o que no aplica): «sin fugas» a secas no dice nada.
function ComprobadoFugas({ m, guion }) {
  const t = textoComprobadoFugas(m, guion);
  return t ? (
    <div data-testid="memoria-fugas-comprobado" style={{ ...apagado, marginTop: 8 }}>
      {t}
    </div>
  ) : null;
}

function FilaFuga({ m, h, onPedirConCita }) {
  const g = gravedadFuga(h);
  return (
    <li data-testid="memoria-fuga" data-gravedad={g.clave} style={{ ...texto, marginTop: 4 }}>
      <Chip tono={TONO_GRAVEDAD[g.clave]} punto={false}>
        {g.texto}
      </Chip>{' '}
      {h.apartado > 0 ? (
        <a href={`#${anclaApartado(m, h.apartado)}`} data-testid="memoria-fuga-apartado" style={{ color: TINTA }}>
          {dondeFuga(h)}
        </a>
      ) : (
        dondeFuga(h)
      )}
      : «{h.cita}» <span style={{ color: TINTA_2 }}>— {h.descripcion}</span>
      {onPedirConCita && (
        <div style={{ marginTop: 4 }}>
          <Boton
            Icono={PenLine}
            testid="memoria-fuga-otra-ronda"
            onClick={() => onPedirConCita(h)}
            title={indicacionDeFuga(h)}
          >
            Pedir otra ronda con esta cita
          </Boton>
        </div>
      )}
    </li>
  );
}

// Lo que la memoria dice del archivo de los automáticos o de la oferta económica, con su cita y su
// gravedad: el eco es una sospecha (lo juzga una persona); el resto impide presentarla.
export default function Fugas({ m, guion, onPedirConCita }) {
  const f = fugasDe(m);
  if (!f.hallazgos.length) return <ComprobadoFugas m={m} guion={guion} />;
  const tono = f.hallazgos.some((h) => gravedadFuga(h).clave === 'impide') ? IMPIDE : RIESGO;
  return (
    <section
      aria-label="Fugas entre sobres"
      data-testid="memoria-fugas"
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: RADIUS,
        border: `1px solid ${alpha(tono, 0.45)}`,
        background: alpha(tono, 0.04),
      }}
    >
      <div style={{ ...texto, color: tono, fontWeight: 600 }}>{textoFugas(m)}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {f.hallazgos.map((h) => (
          <FilaFuga
            key={`${h.apartado}-${h.tipo}-${h.marca}-${h.cita}`}
            m={m}
            h={h}
            onPedirConCita={sePuedePedir(m) && h.apartado > 0 ? onPedirConCita : null}
          />
        ))}
      </ul>
      {f.anulada && (
        <div style={{ ...apagado, marginTop: 6 }}>
          Anuladas el {fechaHora(f.anulada.en)}: «{f.anulada.motivo}»
        </div>
      )}
    </section>
  );
}
