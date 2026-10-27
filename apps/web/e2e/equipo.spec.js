// Equipo con un equipo sintético: la lista con la disponibilidad calculada y el aviso de
// CV, la ficha con la docencia y dónde está, la búsqueda por requisito que lleva a «A incorporar»
// cuando nadie cumple y proponer un candidato para un perfil a incorporar.
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

const ANA = {
  id: 1,
  nombre: 'Ana Prueba',
  tipo: 'interno',
  rol: 'Coordinadora de formación',
  titulaciones: ['Grado en Pedagogía'],
  certificaciones: ['PMP'],
  anios_experiencia: 6,
  sectores: [],
  cpv: [],
  tecnologias: [],
  idiomas: [],
  linkedin: null,
  tarifa_hora: null,
  cv_ruta: 'Colaboradores/cv-ana.pdf',
  notas: '',
  activo: true,
  docencia: [{ materia: 'competencias digitales', horas: 320, desde: 2023, hasta: 2026, evidencia: 'CV, pág. 2' }],
  creada_en: '2025-09-01T10:00:00Z',
  actualizada_en: '2026-09-01T10:00:00Z',
  disponibilidad: { estado: 'parcial', motivo: '2 ofertas en curso', hasta: null },
  cv: { leido_en: '2026-09-01T10:00:00Z', antiguo: false, nuevo: null },
};
const LUIS = {
  ...ANA,
  id: 2,
  nombre: 'Luis Prueba',
  tipo: 'externo',
  rol: 'Formador de IA',
  docencia: [],
  cv_ruta: 'Colaboradores/cv-luis.pdf',
  disponibilidad: { estado: 'disponible', motivo: '', hasta: null },
  cv: { leido_en: '2024-05-01T10:00:00Z', antiguo: true, nuevo: 7 },
};
const FICHA_ANA = {
  ...ANA,
  ofertas: { ganadas: 3, resueltas: 5 },
  asignaciones: [
    {
      persona_id: 1,
      dominio: 'licitaciones',
      recurso: 'p-1',
      expediente: 'EXP-2026-0417',
      titulo: 'Formación en IA generativa',
      rol: 'coordinación',
      estado: 'en_preparacion',
      hasta: null,
    },
    {
      persona_id: 1,
      dominio: 'licitaciones',
      recurso: 'p-2',
      expediente: 'AIR-2026-0057',
      titulo: 'Calidad del aire',
      rol: 'coordinación',
      estado: 'presentada',
      hasta: null,
    },
  ],
};
const PERFIL = {
  id: 5,
  dominio: 'licitaciones',
  recurso: 'p-1',
  clave: 'docente:1',
  perfil: 'Docente de IA generativa · lote 1',
  lote: '1',
  requisitos: 'Docente con al menos 150 h impartidas en inteligencia artificial en los 3 últimos años',
  expediente: 'EXP-2026-0417',
  titulo: 'Formación en IA generativa',
  acreditar_antes: '2026-12-15',
  plazo: '10 días hábiles desde el requerimiento',
  cita: { documento: 'PCAP', pagina: 19, texto: 'cláusula 14.2' },
  estado: 'pendiente',
  candidato_id: null,
  creado_en: 'x',
  actualizado_en: 'x',
};
const regla = (resultado, detalle) => ({
  regla: 'docencia',
  exigido: '≥ 150 h de docencia en inteligencia artificial',
  resultado,
  detalle,
});
const candidato = (p, r) => ({
  id: p.id,
  nombre: p.nombre,
  tipo: p.tipo,
  rol: p.rol,
  disponibilidad: p.disponibilidad.estado,
  disponibilidad_motivo: p.disponibilidad.motivo,
  tarifa_hora: null,
  cv_ruta: p.cv_ruta,
  puntuacion: 30,
  cumple_minimos: r.resultado !== 'no_cumple',
  coincidencias: 1,
  reglas: [r],
  afinidad: [],
  materias: [],
});
const BUSQUEDA = {
  busqueda_semantica: true,
  aviso: null,
  requisitos: [
    {
      texto: PERFIL.requisitos,
      recortado: false,
      activos: 2,
      requisito: {
        anios_minimos: null,
        titulacion: null,
        certificaciones: [],
        idiomas: [],
        materias: [],
        docencia: { horas: 150, materia: { texto: 'inteligencia artificial' }, anios: 3 },
      },
      internos: [candidato(ANA, regla('no_cumple', 'Sin docencia en inteligencia artificial.'))],
      externos: [],
    },
  ],
};

async function servirEquipo(page) {
  await servirFixture(page, 'casoE');
  await page.route(
    (url) => url.pathname.startsWith('/api/colaboradores'),
    (route) => {
      const url = new URL(route.request().url());
      const metodo = route.request().method();
      const cuerpo = (body) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/colaboradores')
        return cuerpo({ items: [ANA, LUIS], propuestas_pendientes: 1, a_incorporar: 1 });
      if (url.pathname === '/api/colaboradores/1') return cuerpo(FICHA_ANA);
      if (url.pathname === '/api/colaboradores/a-incorporar' && metodo === 'GET') return cuerpo([PERFIL]);
      if (url.pathname === '/api/colaboradores/buscar') return cuerpo(BUSQUEDA);
      if (url.pathname === '/api/colaboradores/propuestas') return cuerpo([]);
      page.__escrituras.push({ metodo, ruta: url.pathname, cuerpo: route.request().postDataJSON() });
      return cuerpo({ ...PERFIL, candidato_id: 1 });
    },
  );
}

test('should_list_people_with_calculated_availability_and_old_cv_notice', async ({ page }) => {
  // Arrange
  await servirEquipo(page);

  // Act
  await page.goto('/#/equipo');

  // Assert
  await expect(page.getByRole('tab', { name: /CV por revisar/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /A incorporar/ })).toBeVisible();
  const fila = page.getByRole('button', { name: /Ana Prueba/ });
  await expect(fila).toContainText('competencias digitales 320 h');
  await expect(fila.getByTestId('persona-disponibilidad')).toHaveText('Parcial');
  await expect(page.getByRole('button', { name: /Luis Prueba/ }).getByTestId('persona-cv-nuevo')).toBeVisible();
});

test('should_show_teaching_evidence_and_where_someone_is_in_the_card', async ({ page }) => {
  // Arrange
  await servirEquipo(page);
  await page.goto('/#/equipo');

  // Act
  await page.getByRole('button', { name: /Ana Prueba/ }).click();

  // Assert
  await expect(page.getByTestId('persona-docencia')).toContainText('CV, pág. 2');
  const donde = page.getByTestId('persona-donde');
  await expect(donde).toContainText('EXP-2026-0417');
  await expect(donde).toContainText('En preparación');
  await expect(page.getByText('3 de 5')).toBeVisible();
});

test('should_point_to_a_incorporar_when_nobody_meets_the_requirement', async ({ page }) => {
  // Arrange
  await servirEquipo(page);
  await page.goto('/#/equipo/buscar');

  // Act
  await page.getByLabel('Requisito de medios personales').fill(PERFIL.requisitos);
  await page.getByRole('button', { name: 'Buscar' }).click();

  // Assert
  await expect(page.getByText('Docencia ≥ 150 h de docencia en inteligencia artificial: No cumple')).toBeVisible();
  await expect(page.getByTestId('buscar-nadie-cumple')).toBeVisible();
  await page.getByRole('button', { name: 'Ver A incorporar' }).click();
  await expect(page.getByTestId('equipo-incorporar')).toContainText('Docente de IA generativa · lote 1');
  await expect(page.getByTestId('equipo-incorporar')).toContainText('PCAP, pág. 19');
});

test('should_propose_a_candidate_for_a_profile_to_incorporate', async ({ page }) => {
  // Arrange
  await servirEquipo(page);
  await page.goto('/#/equipo/incorporar');

  // Act
  await page.getByTestId(`incorporar-buscar-${PERFIL.id}`).click();
  await expect(page.getByLabel('Requisito de medios personales')).toHaveValue(PERFIL.requisitos);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByTestId('proponer-1').click();

  // Assert
  await expect(page.getByText('Ana Prueba queda como candidato')).toBeVisible();
  expect(page.__escrituras).toContainEqual({
    metodo: 'PATCH',
    ruta: `/api/colaboradores/a-incorporar/${PERFIL.id}`,
    cuerpo: { candidato_id: 1 },
  });
});
