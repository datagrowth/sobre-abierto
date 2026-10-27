// Ajustes › Marca: el nombre de la app, los colores y el logo de la instalación (marca.ts en el
// servidor). Los cambia un admin; los demás los ven. Al guardar se aplican en el momento; el
// servidor rechaza un color que deje algún texto sin contraste AA y dice cuál.
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import useUsuario from '../../hooks/useUsuario';
import { plataformaApi } from '../../lib/plataformaApi';
import { aplicarMarca, configInstalacion } from '../../lib/configInstalacion';
import { formularioAMarca, marcaAFormulario, TOKENS_MARCA } from '../../lib/marcaFormulario';
import { esAdmin } from '../../lib/usuarioActual';
import { Aviso, Boton, Campo, Entrada, Esqueleto, Tarjeta } from '../ui';

function Color({ t, valor, onCambio, soloLectura }) {
  return (
    <label className="flex items-center gap-2 text-tabla text-tinta" style={{ minWidth: 0 }}>
      <input
        type="color"
        value={valor}
        onChange={(e) => onCambio(e.target.value.toUpperCase())}
        disabled={soloLectura}
        aria-label={t.nombre}
        data-testid={`marca-color-${t.token}`}
        style={{ width: 32, height: 28, padding: 0, border: 'none', background: 'none' }}
      />
      <span className="truncate" style={{ flex: 1 }}>
        {t.nombre}
      </span>
      <Entrada
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        disabled={soloLectura}
        aria-label={`${t.nombre} (#RRGGBB)`}
        className="py-1"
        style={{ width: 92 }}
      />
    </label>
  );
}

function Logo({ marca, soloLectura, onCambio, setAviso }) {
  const archivo = useRef(null);
  const subir = (f) => plataformaApi.subirLogo(f).then(onCambio, (e) => setAviso({ tono: 'error', texto: e.message }));
  const quitar = () => plataformaApi.quitarLogo().then(onCambio, (e) => setAviso({ tono: 'error', texto: e.message }));
  const url = marca.logo ? `/api/marca/logo?v=${marca.logo.hash}` : null;
  return (
    <Tarjeta
      titulo="Logo"
      subtitulo="SVG, PNG o WebP de hasta 200 KB. Sin logo, el sobre de Sobre Abierto con el nombre de la app."
      testid="marca-logo"
    >
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          <img src={url} alt={marca.nombre} style={{ height: 32, width: 'auto' }} />
        ) : (
          <span className="text-tabla text-tinta-2">Sin logo propio.</span>
        )}
        {!soloLectura && (
          <>
            <input
              ref={archivo}
              type="file"
              accept=".svg,.png,.webp"
              hidden
              data-testid="marca-logo-archivo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) subir(f);
              }}
            />
            <Boton tamano="pequeno" Icono={Upload} onClick={() => archivo.current?.click()}>
              {url ? 'Cambiar logo' : 'Subir logo'}
            </Boton>
            {url && (
              <Boton tamano="pequeno" variante="texto" Icono={Trash2} onClick={quitar}>
                Quitar
              </Boton>
            )}
          </>
        )}
      </div>
    </Tarjeta>
  );
}

export default function MarcaVista() {
  const soloLectura = !esAdmin(useUsuario());
  const [marca, setMarca] = useState(null);
  const [valores, setValores] = useState(null);
  const [aviso, setAviso] = useState(null);
  const cargar = (m) => {
    setMarca(m);
    setValores(marcaAFormulario(m));
    aplicarMarca(m);
  };
  useEffect(() => {
    plataformaApi.marca().then(
      (m) => {
        setMarca(m);
        setValores(marcaAFormulario(m));
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  }, []);
  if (!valores)
    return aviso ? <Aviso tono="error">{aviso.texto}</Aviso> : <Esqueleto lineas={4} etiqueta="Cargando la marca…" />;

  const color = (token) => (v) => setValores((x) => ({ ...x, colores: { ...x.colores, [token]: v } }));
  const neutros = () =>
    setValores((x) => ({ ...x, colores: Object.fromEntries(TOKENS_MARCA.map((t) => [t.token, t.neutro])) }));
  const guardar = () => {
    const { marca: m, errores } = formularioAMarca(valores);
    if (errores.length) {
      setAviso({ tono: 'error', texto: errores.join(' ') });
      return;
    }
    plataformaApi.guardarMarca(m).then(
      (r) => {
        cargar(r);
        setAviso({ tono: 'ok', texto: 'Guardada: ya se ve en toda la web.' });
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 920 }}>
      {soloLectura && <Aviso>Solo un admin cambia la marca.</Aviso>}
      <Tarjeta
        titulo="Nombre de la aplicación"
        subtitulo="En la pestaña del navegador, el acceso, los emails y el calendario."
        testid="marca-nombre"
      >
        <Campo etiqueta="Nombre">
          <Entrada
            value={valores.nombre}
            onChange={(e) => setValores((x) => ({ ...x, nombre: e.target.value }))}
            maxLength={60}
            disabled={soloLectura}
            data-testid="marca-nombre-entrada"
          />
        </Campo>
      </Tarjeta>
      <Logo marca={marca} soloLectura={soloLectura} onCambio={cargar} setAviso={setAviso} />
      <Tarjeta
        titulo="Colores"
        subtitulo={`Los de ${configInstalacion().nombre} en la web y en los emails. Todo texto tiene que leerse bien (WCAG AA): si no, no se guarda y se dice qué par falla.`}
        testid="marca-colores"
      >
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {TOKENS_MARCA.map((t) => (
            <Color
              key={t.token}
              t={t}
              valor={valores.colores[t.token]}
              onCambio={color(t.token)}
              soloLectura={soloLectura}
            />
          ))}
        </div>
      </Tarjeta>
      {!soloLectura && (
        <div className="flex flex-wrap gap-2">
          <Boton variante="principal" Icono={Save} onClick={guardar} testid="marca-guardar">
            Guardar marca
          </Boton>
          <Boton Icono={RotateCcw} onClick={neutros}>
            Volver a los colores neutros
          </Boton>
        </div>
      )}
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
    </div>
  );
}
