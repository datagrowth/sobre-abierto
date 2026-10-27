// El motor de la bóveda y la Biblioteca simulados sobre el banco de fixtures: lo comparten el recorrido de
// la Biblioteca y la comprobación de accesibilidad. Solo se responden las lecturas; nada escribe.
import { servirFixture } from './api.js';

export const VAULT = '/hermes-vault/api/v1';
const NOTAS = [
  {
    path: 'Casos/Medio ambiente/Calidad del aire.md',
    title: 'Cuadros de mando de calidad del aire',
    mtime: '2026-09-10T10:00:00Z',
    size: 10,
    tipo: 'caso_exito',
    tipo_deducido: false,
    sector: 'Medio ambiente',
    revisada_en: '2026-09-10T10:00:00Z',
    revisar: false,
  },
  {
    path: 'Metodologías/Formación en IA.md',
    title: 'Metodología de formación en IA generativa',
    mtime: '2026-06-01T10:00:00Z',
    size: 10,
    tipo: 'metodologia',
    tipo_deducido: true,
    sector: 'Formación',
    revisada_en: '2026-06-01T10:00:00Z',
    revisar: false,
  },
  {
    path: 'Servicios/Gobierno del dato.md',
    title: 'Gobierno del dato: qué ofrecemos',
    mtime: '2025-03-01T10:00:00Z',
    size: 10,
    tipo: 'ficha_servicio',
    tipo_deducido: false,
    sector: null,
    revisada_en: '2025-03-01T10:00:00Z',
    revisar: true,
  },
];
export const PROPUESTA = {
  path: 'Observatorio turístico.md',
  title: 'Observatorio de datos turísticos',
  mtime: '2026-10-20T10:00:00Z',
  size: 10,
  preview: 'Cliente, alcance y resultados…',
  frontmatter: {
    estado: 'pendiente',
    origen: 'licitaciones',
    fuente: 'Licitaciones/TUR-2026-0203/memoria.pdf',
    tipo: 'caso_exito',
  },
};
const SIN_NOTA = {
  total: 2,
  documentos: [
    {
      ruta: 'Licitaciones/AIR-2026-0057/Informe final.pdf',
      titulo: 'Informe final',
      estado: 'ok',
      error: null,
      paginas: 12,
      modificado: '2026-10-20T10:00:00Z',
      con_nota: false,
      propuesta_pendiente: false,
    },
    {
      ruta: 'Empresa/Certificados/Certificado Cabildo.pdf',
      titulo: 'Certificado',
      estado: 'scanned',
      error: null,
      paginas: 1,
      modificado: '2026-09-20T10:00:00Z',
      con_nota: false,
      propuesta_pendiente: false,
    },
  ],
};
const HUECOS = {
  estado: 'ok',
  calculado_en: '2026-10-23T10:00:00Z',
  temas: 9,
  huecos: [
    {
      tema: 'Casos de IA en el sector salud',
      de: 'criterio',
      pliegos: 3,
      licitaciones: ['p-1', 'p-2', 'p-3'],
      tenemos: 'nada',
      nota: null,
    },
    {
      tema: 'Materiales accesibles (WCAG)',
      de: 'requisito',
      pliegos: 2,
      licitaciones: ['p-1', 'p-4'],
      tenemos: 'nota_antigua',
      nota: { ruta: 'Servicios/Accesibilidad.md', titulo: 'Accesibilidad', revisada_en: '2024-05-01T00:00:00Z' },
    },
  ],
};

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

export async function abrirBiblioteca(page, vista = '') {
  await servirFixture(page, 'casoE');
  const rutas = {
    [`${VAULT}/vault/notes`]: { items: NOTAS },
    [`${VAULT}/documents/status`]: {
      running: true,
      error: null,
      status: {
        phase: 'idle',
        notes: 312,
        documents: 1284,
        scanned: 3,
        errors: 0,
        chunks: 10,
        embedded: 10,
        model: 'e5',
        modelError: null,
      },
    },
    [`${VAULT}/inbox`]: { items: [PROPUESTA] },
    [`${VAULT}/inbox/${encodeURIComponent(PROPUESTA.path)}`]: {
      title: PROPUESTA.title,
      body: 'Borrador de Hermes.',
      frontmatter: PROPUESTA.frontmatter,
    },
    '/api/plataforma/biblioteca/usos': {
      usos: { 'Metodologías/Formación en IA.md': 6, 'Casos/Medio ambiente/Calidad del aire.md': 4 },
    },
    '/api/plataforma/biblioteca/sin-nota': SIN_NOTA,
    '/api/licitaciones/biblioteca/huecos': HUECOS,
  };
  for (const [ruta, body] of Object.entries(rutas)) {
    await page.route(`**${ruta}`, (route) =>
      route.request().method() === 'GET' ? route.fulfill(json(body)) : route.fallback(),
    );
  }
  await page.goto(`/#/biblioteca${vista}`);
}
