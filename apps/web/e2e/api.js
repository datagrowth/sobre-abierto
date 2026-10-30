// La API es la frontera de la web: en el banco de fixtures (proyecto «fixtures» de
// playwright.config.mjs) se intercepta /api/** y se responde desde e2e/datos/<oferta>.json, que
// genera `npm run e2e:datos -w @sobre-abierto/server` con el servidor real sobre las 5 ofertas.
// Nunca hay servidor detrás: nada puede escribir en producción ni en datos locales.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR_DATOS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'datos');
export const OFERTAS = ['casoE', 'casoB', 'casoF', 'casoD', 'casoC'];

const ESCRITURAS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Las personas de Ajustes › Usuarios: una por rol, y la lectora aún sin su primer acceso.
export const USUARIOS = [
  {
    id: 1,
    email: 'ana@ejemplo.es',
    nombre: 'Ana Admin',
    rol: 'admin',
    debe_cambiarla: false,
    activo: true,
    ultimo_acceso: '2026-10-22T09:00:00.000Z',
    creado_en: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 2,
    email: 'elisa@ejemplo.es',
    nombre: 'Elisa Editora',
    rol: 'editor',
    debe_cambiarla: false,
    activo: true,
    ultimo_acceso: '2026-10-21T16:30:00.000Z',
    creado_en: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 3,
    email: 'luis@ejemplo.es',
    nombre: 'Luis Lector',
    rol: 'lector',
    debe_cambiarla: true,
    activo: true,
    ultimo_acceso: null,
    creado_en: '2026-10-20T08:00:00.000Z',
  },
];

/** La persona de /auth/session (con login), con la forma de quienSoy en el servidor. */
export const persona = (u, cambios = {}) => ({
  id: u.id,
  nombre: u.nombre,
  rol: u.rol,
  emergencia: false,
  debe_cambiarla: false,
  email: u.email,
  ...cambios,
});

/** Entra con login como `usuario` (registrar después de servirFixture: Playwright prueba antes la última ruta). */
export async function entrarComo(page, usuario) {
  await page.route('**/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: true, authenticated: true, usuario }),
    }),
  );
}

// Lo que no es de ningún dominio y la web pide siempre: sesión abierta, sin versión ni sesiones de Hermes.
const BASE = {
  'GET /auth/session': { status: 200, body: { enabled: false, authenticated: true } },
  // La marca y la zona de la instalación: los casos son de una empresa en Canarias, con la hora de allí.
  'GET /api/config': {
    status: 200,
    body: {
      nombre: 'Analítica Ejemplo',
      logo: null,
      fuente: 'https://git.example.com/sobre-abierto',
      zona_horaria: 'Atlantic/Canary',
    },
  },
  // Ajustes › Marca y la escala de los rankings (Fuentes y filtros), sin nada propio guardado.
  'GET /api/plataforma/marca': {
    status: 200,
    body: { nombre: 'Analítica Ejemplo', tema: {}, logo: null, actualizado_en: null },
  },
  'GET /api/licitaciones/competencia/escala': {
    status: 200,
    body: { region_nuts: 'ES70', banda_min: 7000, banda_max: 130000 },
  },
  'GET /api/version': { status: 200, body: { version: null } },
  'GET /api/sessions': { status: 200, body: { sessions: [] } },
  // Ajustes › Usuarios, Avisos e Integraciones, con la forma de sus rutas en el servidor.
  'GET /api/plataforma/usuarios': { status: 200, body: { usuarios: USUARIOS } },
  'GET /api/plataforma/avisos/config': {
    status: 200,
    body: {
      config: {
        destinatarios: [1],
        dia: 1,
        hora: 8,
        secciones: { plazos: true, nuevas: true, novedades: true, lecciones: true },
      },
      smtp: false,
      url_web: false,
      aviso_smtp: null,
      usuarios: USUARIOS.filter((u) => u.activo).map((u) => ({
        id: u.id,
        nombre: u.nombre,
        rol: u.rol,
        con_email: true,
      })),
    },
  },
  'GET /api/plataforma/yo/avisos': {
    status: 200,
    body: { urgentes: true, resoluciones: true, menciones: true, busquedas: true, caducidades: false },
  },
  'GET /api/plataforma/yo/calendario': { status: 200, body: { activo: false, creado_en: null, ultimo_uso: null } },
  // El equipo para el responsable y las menciones, los comentarios (sin ninguno), las
  // menciones de quien entra, los tokens de la API de lectura y el MCP.
  'GET /api/plataforma/companeros': {
    status: 200,
    body: { companeros: USUARIOS.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol })) },
  },
  'GET /api/plataforma/comentarios': { status: 200, body: { comentarios: [] } },
  'GET /api/plataforma/yo/menciones': { status: 200, body: { sin_leer: 0, menciones: [] } },
  'GET /api/plataforma/integraciones/tokens': {
    status: 200,
    body: {
      tokens: [
        {
          id: 1,
          nombre: 'Power BI',
          creado_por: 'Paco',
          creado_en: '2026-10-12T08:00:00.000Z',
          ultimo_uso: '2026-10-23T07:00:00.000Z',
        },
      ],
    },
  },
  'GET /api/plataforma/integraciones/mcp': {
    status: 200,
    body: { agentes: 2, ultima_llamada: '2026-10-23T07:57:00.000Z', llamadas_24h: 41 },
  },
  'GET /api/licitaciones/busquedas': {
    status: 200,
    body: {
      busquedas: [
        {
          id: 1,
          nombre: 'Formación en IA',
          consulta: { texto: 'formación' },
          frecuencia: 'semanal',
          activa: true,
          avisada_hasta: null,
          creada_en: '2026-10-20T08:00:00.000Z',
          nuevas: 2,
        },
      ],
    },
  },
};

/** Un archivo de e2e/datos sin la extensión: `casoE` o `casoE.impacto.precio-lote-2`. */
export function leerDatos(nombre) {
  const archivo = path.join(DIR_DATOS, `${nombre}.json`);
  if (!fs.existsSync(archivo))
    throw new Error(`Falta ${archivo}: genera los datos con npm run e2e:datos -w @sobre-abierto/server`);
  return JSON.parse(fs.readFileSync(archivo, 'utf8'));
}

const responder = (route, { status, body }) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function apuntarEscritura(page, route, url) {
  const req = route.request();
  let cuerpo = null;
  try {
    cuerpo = req.postDataJSON();
  } catch {
    cuerpo = req.postData();
  }
  page.__escrituras.push({ metodo: req.method(), ruta: url.pathname, cuerpo });
  return responder(route, { status: 200, body: {} });
}

// Primero la ruta con su consulta (si el mapa la trae así) y luego sin ella.
function respuestaDe(mapa, metodo, url) {
  return mapa[`${metodo} ${url.pathname}${url.search}`] ?? mapa[`${metodo} ${url.pathname}`] ?? null;
}

/**
 * Sirve la oferta `oferta` a la página. Las escrituras responden 200 {} y quedan en
 * page.__escrituras; lo que no está en el mapa responde 404 y queda en page.__sinFixture. Un spec
 * que necesite otra respuesta registra su propio page.route después de llamar a esto (Playwright
 * prueba antes la última ruta registrada).
 */
export async function servirFixture(page, oferta) {
  const mapa = { ...BASE, ...leerDatos(oferta) };
  page.__escrituras = [];
  page.__sinFixture = [];
  // El navegador vive a la hora de la captura: las cuentas atrás y «vence en» casan con las respuestas.
  if (mapa._ahora) await page.clock.install({ time: new Date(mapa._ahora) });
  const atender = (route) => {
    const url = new URL(route.request().url());
    const metodo = route.request().method();
    if (ESCRITURAS.has(metodo)) return apuntarEscritura(page, route, url);
    const r = respuestaDe(mapa, metodo, url);
    if (r) return responder(route, r);
    page.__sinFixture.push(`${metodo} ${url.pathname}`);
    return responder(route, { status: 404, body: { error: 'not_found', message: 'Sin fixture para esta ruta' } });
  };
  await page.route('**/api/**', atender);
  await page.route('**/auth/**', atender);
  // Sin servidor no hay Socket.io: la web debe aguantar sin él.
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.route('**/socket.io/**', (route) => route.abort());
}

/**
 * Cuánto se sale la página por la derecha. html, body y #root no se desplazan (overflow hidden):
 * la app lo hace dentro de la página de la ficha o del panel de pestañas, así que se mide ahí.
 * Una tabla con su propio desplazamiento no cuenta.
 */
export function desbordeHorizontal(page) {
  return page.evaluate(() => {
    const cajas = [
      document.documentElement,
      ...document.querySelectorAll('[data-testid="pagina-licitacion"], [role="tabpanel"]'),
    ];
    return Math.max(...cajas.map((c) => c.scrollWidth - c.clientWidth));
  });
}
