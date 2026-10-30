// La marca y la zona horaria de la instalación (GET /api/config, sin sesión), que la web lee una
// vez al arrancar. Sin respuesta, la marca neutra y la hora peninsular. Sin React, con tests.
import { fijarZonaEmpresa } from './formato.js';
import { variablesDelTema } from './marcaFormulario.js';

export const NEUTRA = Object.freeze({
  nombre: 'Sobre Abierto',
  logo: null,
  fuente: null,
  version: null,
  zona_horaria: 'Europe/Madrid',
});

let actual = NEUTRA;

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
// El servidor ya lo valida; aquí solo se descarta lo que no podría ser un logo o un enlace.
const logoValido = (v) => (texto(v) && /^(https?:\/\/|\/(?!\/)|data:image\/)/.test(v) ? v : null);
const versionValida = (v) => (typeof v === 'string' && /^\d+\.\d+\.\d+[\w.+-]*$/.test(v) ? v : null);
const enlaceValido = (v) => (texto(v) && /^https?:\/\//.test(v) ? v : null);

export function fijarConfigInstalacion(c) {
  actual = Object.freeze({
    nombre: texto(c?.nombre) ?? NEUTRA.nombre,
    logo: logoValido(c?.logo),
    fuente: enlaceValido(c?.fuente),
    version: versionValida(c?.version),
    zona_horaria: c?.zona_horaria === 'Atlantic/Canary' ? 'Atlantic/Canary' : NEUTRA.zona_horaria,
  });
  fijarZonaEmpresa(actual.zona_horaria);
  return actual;
}

export const configInstalacion = () => actual;

/**
 * Una marca recién guardada en Ajustes › Marca, sin recargar: nombre y logo para la web y los
 * colores en el <html> (los del servidor van en <style id="tema-instalacion">, que deja de valer).
 */
export function aplicarMarca(marca, doc = globalThis.document) {
  fijarConfigInstalacion({
    ...actual,
    nombre: marca.nombre,
    logo: marca.logo ? `/api/marca/logo?v=${marca.logo.hash}` : null,
  });
  if (!doc) return;
  doc.getElementById('tema-instalacion')?.remove();
  for (const [variable, color] of variablesDelTema(marca.tema)) {
    if (color) doc.documentElement.style.setProperty(variable, color);
    else doc.documentElement.style.removeProperty(variable);
  }
  doc.title = marca.nombre;
}

/** Pide /api/config; si falla, se queda la neutra (la web arranca igual). */
export async function cargarConfigInstalacion(pedir = (url) => fetch(url)) {
  try {
    const res = await pedir('/api/config');
    if (res.ok) fijarConfigInstalacion(await res.json());
  } catch {
    // Sin red o sin servidor: la marca neutra; GuardiaAcceso dirá que no hay conexión.
  }
  return actual;
}
