// Página 404: la dirección pide algo que esta aplicación no tiene. Lleva la marca de la instalación
// y una salida clara, en vez de redirigir al Pipeline sin decir nada.
import { Compass } from 'lucide-react';
import { Boton, Vacio } from '../ui';
import Logotipo from './Logotipo';

export default function NoEncontrada({ direccion, onInicio }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-6" data-testid="no-encontrada">
      <Logotipo alto={28} />
      <Vacio
        Icono={Compass}
        titulo="No encontramos esta página"
        texto={`La dirección ${direccion ? `«${direccion}» ` : ''}no corresponde a ninguna pantalla. Puede que el enlace esté mal escrito o que sea de una versión anterior.`}
        accion={
          <Boton variante="principal" onClick={onInicio} testid="no-encontrada-inicio">
            Ir al Pipeline
          </Boton>
        }
      />
    </div>
  );
}
