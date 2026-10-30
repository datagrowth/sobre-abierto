// Pantalla Equipo: personas del equipo y externas (lista, ficha, alta y
// edición), búsqueda por requisito, CV por revisar (perfiles leídos de un CV por aprobar) y A
// incorporar (perfiles que una oferta se comprometió a incorporar). Se refresca sola con los
// eventos «colaboradores.*» de la plataforma.
import { useCallback, useEffect, useState } from 'react';
import { TINTA_2 } from '../../lib/tema';
import { colaboradoresApi } from '../../lib/colaboradoresApi';
import { Bloque } from '../comun/ui';
import PanelDominio from '../comun/PanelDominio';
import useRuta from '../../hooks/useRuta';
import PersonasVista from './PersonasVista';
import PendientesVista from './PendientesVista';
import BuscarCandidatos from './BuscarCandidatos';
import IncorporarVista from './IncorporarVista';

// La clave «pendientes» se queda: los enlaces guardados (y los de «Hoy») abren #/equipo/pendientes/<id>.
const VISTAS = [
  { key: 'personas', label: 'Personas' },
  { key: 'buscar', label: 'Buscar por requisito' },
  { key: 'pendientes', label: 'CV por revisar' },
  { key: 'incorporar', label: 'A incorporar' },
];

// Abierta desde «A incorporar» (#/equipo/buscar/<id>), la búsqueda arranca con los requisitos de ese perfil.
function BuscarVista({ perfilId, version, onVerIncorporar }) {
  const [perfil, setPerfil] = useState(null);
  useEffect(() => {
    let vivo = true;
    if (perfilId)
      colaboradoresApi.aIncorporar().then(
        (ps) => vivo && setPerfil(ps.find((p) => String(p.id) === String(perfilId)) ?? null),
        () => {},
      );
    return () => {
      vivo = false;
    };
  }, [perfilId, version]);
  return (
    <div style={{ maxWidth: 900 }}>
      <Bloque titulo={perfil ? `CANDIDATOS PARA «${perfil.perfil.toUpperCase()}»` : 'PEGA EL REQUISITO DEL PLIEGO'}>
        <div style={{ fontSize: 12.5, color: TINTA_2, marginBottom: 8 }}>
          Se comprueban años, titulación, certificaciones, idiomas y horas de docencia contra cada perfil y se suma la
          afinidad (tecnologías, rol y CV parecido en la Biblioteca). Sin IA: revisa siempre el CV.
        </div>
        <BuscarCandidatos
          key={perfil?.id ?? 'libre'}
          inicial={perfil?.requisitos}
          perfil={perfil}
          onVerIncorporar={onVerIncorporar}
        />
      </Bloque>
    </div>
  );
}

// Las cuentas de las pestañas: perfiles leídos de un CV por revisar y perfiles a incorporar pendientes.
function useCuentas(version) {
  const [cuentas, setCuentas] = useState({});
  useEffect(() => {
    let vivo = true;
    colaboradoresApi.personas().then(
      (r) =>
        vivo &&
        setCuentas({ personas: r.items.length, pendientes: r.propuestas_pendientes, incorporar: r.a_incorporar }),
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, [version]);
  return cuentas;
}

export default function ColaboradoresPanel() {
  const ruta = useRuta();
  const vista = VISTAS.some((v) => v.key === ruta.vista) ? ruta.vista : 'personas';
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const cuentas = useCuentas(version);
  useEffect(() => {
    const alEvento = (e) => {
      if (String(e.detail?.tipo ?? '').startsWith('colaboradores')) recargar();
    };
    window.addEventListener('plataforma', alEvento);
    return () => window.removeEventListener('plataforma', alEvento);
  }, [recargar]);
  const vistas = VISTAS.map((v) => ({ ...v, cuenta: cuentas[v.key] || undefined }));

  return (
    <PanelDominio
      titulo="Equipo"
      subtitulo="personas internas y externas, con lo que pueden acreditar ante un pliego"
      vistas={vistas}
      vista={vista}
      onVista={(v) => ruta.irVista(v)}
      lleno={vista !== 'buscar'}
    >
      {vista === 'personas' && <PersonasVista version={version} onRecargar={recargar} />}
      {vista === 'pendientes' && (
        <PendientesVista
          version={version}
          onRecargar={recargar}
          seleccion={ruta.id}
          onElegir={(id) => ruta.irVista('pendientes', id)}
        />
      )}
      {vista === 'buscar' && (
        <BuscarVista perfilId={ruta.id} version={version} onVerIncorporar={() => ruta.irVista('incorporar')} />
      )}
      {vista === 'incorporar' && (
        <IncorporarVista
          version={version}
          onRecargar={recargar}
          onBuscar={(id) => ruta.irVista('buscar', String(id))}
        />
      )}
    </PanelDominio>
  );
}
