// Panel de la Biblioteca: reúne exploración, notas, propuestas, huecos y búsqueda.
import { useState, useCallback, useEffect } from 'react';
import { Search } from 'lucide-react';
import { TINTA_2 } from '../../lib/tema';
import { Boton } from '../ui';
import PanelDominio from '../comun/PanelDominio';
import useRuta from '../../hooks/useRuta';
import { leerCarpetaBiblioteca } from '../../lib/bibliotecaCarpeta';
import BibliotecaExplorar from './BibliotecaExplorar';
import BibliotecaHuecos from './BibliotecaHuecos';
import BibliotecaSinNota from './BibliotecaSinNota';
import BibliotecaBandeja from './BibliotecaBandeja';
import BibliotecaNota from './BibliotecaNota';
import BibliotecaBusqueda from './BibliotecaBusqueda';
import BibliotecaSubida from './BibliotecaSubida';

// La carpeta de la Biblioteca se configura en Ajustes › Drive.
// Explorar, las propuestas de Hermes, los documentos sin nota y los huecos. Una nota
// abierta va en «notas» (#/biblioteca/notas/<ruta>), que cuelga de Explorar.
const TABS = [
  { key: 'explorar', label: 'Explorar' },
  { key: 'propuestas', label: 'Propuestas de Hermes' },
  { key: 'sin-nota', label: 'Documentos sin nota' },
  { key: 'huecos', label: 'Huecos' },
];
const VISTAS = new Set([...TABS.map((t) => t.key), 'notas']);

export default function PanelBiblioteca() {
  const ruta = useRuta();
  // #/biblioteca/carpeta/<carpeta> («Documentos de esta oferta»): el índice de notas filtrado.
  const carpeta = leerCarpetaBiblioteca(ruta);
  const sub = carpeta ? 'notas' : VISTAS.has(ruta.vista) ? ruta.vista : 'explorar';
  const selectedNote = sub === 'notas' && !carpeta ? ruta.id : null;
  const [searchOpen, setSearchOpen] = useState(false);
  const { irVista } = ruta;

  // Abrir una nota desde cualquier vista → salta a «Notas» (null = índice de notas); la nota va en la ruta.
  const openNote = useCallback((path) => irVista('notas', path ?? null), [irVista]);

  // Ctrl/Cmd+K abre la búsqueda global. El panel solo está montado con la pestaña
  // Hermes Vault activa, así que el atajo no interfiere con el resto del monitor.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const render = () => {
    switch (sub) {
      case 'notas':
        return (
          <BibliotecaNota
            path={selectedNote}
            onOpenNote={openNote}
            carpeta={carpeta}
            onQuitarCarpeta={() => irVista('notas')}
          />
        );
      case 'propuestas':
        return <BibliotecaBandeja />;
      case 'sin-nota':
        return <BibliotecaSinNota />;
      case 'huecos':
        return <BibliotecaHuecos onOpenNote={openNote} />;
      default:
        return <BibliotecaExplorar onOpenNote={openNote} />;
    }
  };

  const acciones = (
    <>
      <BibliotecaSubida />
      <Boton Icono={Search} onClick={() => setSearchOpen(true)} title="Buscar en la Biblioteca (Ctrl+K)">
        Buscar <span style={{ color: TINTA_2, fontWeight: 400 }}>Ctrl+K</span>
      </Boton>
    </>
  );
  return (
    <PanelDominio
      titulo="Biblioteca"
      subtitulo="el conocimiento de la empresa, guardado en Drive: Hermes lo usa para redactar y tú decides qué entra"
      acciones={acciones}
      vistas={TABS}
      vista={sub === 'notas' ? 'explorar' : sub}
      onVista={(v) => irVista(v)}
    >
      {render()}
      <BibliotecaBusqueda open={searchOpen} onClose={() => setSearchOpen(false)} onOpenNote={openNote} />
    </PanelDominio>
  );
}
