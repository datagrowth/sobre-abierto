// Usuarios, avisos e integraciones: un editor no ve la gestión de usuarios ni cambia el
// resumen semanal; un admin da de alta con una contraseña temporal y elige el resumen; quien entra
// con la temporal la cambia antes de nada; el enlace del calendario se ve una vez y se revoca; y
// «Guardar búsqueda» guarda lo buscado. El servidor es quien autoriza (permisos.test.ts): aquí, lo que se enseña.
import { test, expect } from '@playwright/test';
import { entrarComo, persona, servirFixture, USUARIOS } from './api.js';

const ELISA = persona(USUARIOS[1]);
const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const TEMPORAL = /^[a-km-zA-HJ-NP-Z2-9]{4}(-[a-km-zA-HJ-NP-Z2-9]{4}){3}$/;

test('should_not_show_user_management_to_an_editor_nor_let_them_change_the_weekly_summary', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await entrarComo(page, ELISA);
  const pedidas = [];
  page.on('request', (r) => pedidas.push(new URL(r.url()).pathname));

  // Act
  await page.goto('/#/ajustes/usuarios');

  // Assert
  await expect(page.getByTestId('ajustes-usuarios')).toContainText(
    'Solo un admin ve y cambia los usuarios. Tu permiso es editor.',
  );
  await expect(page.getByTestId('usuarios-lista')).toHaveCount(0);
  await expect(page.getByTestId('usuarios-permisos')).toBeVisible();
  await expect(page.getByTestId('usuarios-mi-contrasena')).toContainText('elisa@ejemplo.es');
  expect(pedidas).not.toContain('/api/plataforma/usuarios');
  await page.getByRole('tab', { name: 'Avisos' }).click();
  await expect(page.getByTestId('resumen-semanal')).toContainText('Lo eligen los admin. Tú no lo recibes.');
  await expect(page.getByTestId('resumen-guardar')).toHaveCount(0);
  await expect(page.getByTestId('aviso-urgentes')).toBeChecked();
});

test('should_add_a_user_with_a_temporary_password_and_say_it_once', async ({ page }) => {
  // Arrange: sin login se actúa como admin.
  await servirFixture(page, 'casoE');
  await page.goto('/#/ajustes/usuarios');
  await expect(page.getByTestId('usuarios-lista')).toContainText('Falta su primer acceso');
  const alta = page.getByTestId('alta-usuario');
  const temporal = await alta.getByLabel('Contraseña temporal').inputValue();
  expect(temporal).toMatch(TEMPORAL);

  // Act
  await alta.getByLabel('Nombre').fill('Marta Nueva');
  await alta.getByLabel('Email').fill('marta@ejemplo.es');
  await alta.getByLabel('Permisos').selectOption('lector');
  await page.getByTestId('usuario-crear').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toEqual([
      {
        metodo: 'POST',
        ruta: '/api/plataforma/usuarios',
        cuerpo: { nombre: 'Marta Nueva', email: 'marta@ejemplo.es', rol: 'lector', contrasena: temporal },
      },
    ]);
  await expect(page.getByTestId('usuarios-lista')).toContainText(
    `Marta Nueva ya tiene acceso. Su contraseña temporal es ${temporal}`,
  );
  await expect(alta.getByLabel('Nombre')).toHaveValue('');
  await expect(alta.getByLabel('Contraseña temporal')).not.toHaveValue(temporal);
});

test('should_ask_for_an_own_password_before_entering_with_the_temporary_one', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await entrarComo(page, { ...ELISA, debe_cambiarla: true });
  let enviada = null;
  await page.route('**/auth/contrasena', (route) => {
    enviada = route.request().postDataJSON();
    return json(route, 200, { usuario: ELISA });
  });
  await page.goto('/#/pipeline');
  await expect(page.getByRole('heading', { name: 'Elige tu contraseña' })).toBeVisible();
  await expect(page.getByTestId('pipeline')).toHaveCount(0);

  // Act: primero una corta, que no sale del navegador; luego una buena.
  await page.getByLabel('Contraseña temporal').fill('abcd-efgh-jkmn-pqrs');
  await page.getByLabel('Contraseña nueva').fill('corta');
  await page.getByLabel('Repite la nueva').fill('corta');
  await page.getByTestId('contrasena-guardar').click();
  await expect(page.getByTestId('formulario-contrasena')).toContainText('al menos 12 caracteres');
  expect(enviada).toBeNull();
  await page.getByLabel('Contraseña nueva').fill('una frase que recuerdo bien');
  await page.getByLabel('Repite la nueva').fill('una frase que recuerdo bien');
  await page.getByTestId('contrasena-guardar').click();

  // Assert
  await expect(page.getByTestId('pipeline')).toBeVisible();
  expect(enviada).toEqual({ actual: 'abcd-efgh-jkmn-pqrs', nueva: 'una frase que recuerdo bien' });
});

test('should_save_the_weekly_summary_day_recipients_and_sections', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/ajustes/avisos');
  const resumen = page.getByTestId('resumen-semanal');
  await expect(resumen).toContainText('Los lunes a las 08:00 (hora de Canarias), a 1 persona');
  await expect(resumen).toContainText('no está configurado (SMTP)');

  // Act
  await resumen.getByLabel('Día', { exact: true }).selectOption({ label: 'viernes' });
  await page.getByTestId('destinatario-2').check();
  await resumen.getByLabel('Lecciones por revisar').uncheck();
  await page.getByTestId('resumen-guardar').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toEqual([
      {
        metodo: 'PUT',
        ruta: '/api/plataforma/avisos/config',
        cuerpo: {
          destinatarios: [1, 2],
          dia: 5,
          hora: 8,
          secciones: { plazos: true, nuevas: true, novedades: true, lecciones: false },
        },
      },
    ]);
  await expect(resumen).toContainText('Guardado.');
  await expect(page.getByTestId('busqueda-1')).toContainText('Cada semana · 2 nuevas esta semana');
});

test('should_show_the_calendar_link_once_and_revoke_it', async ({ page }) => {
  // Arrange: el enlace vive en el servidor; aquí, su estado entre peticiones.
  await servirFixture(page, 'casoE');
  await entrarComo(page, ELISA);
  const token = 'x'.repeat(43);
  let activo = false;
  await page.route('**/api/plataforma/yo/calendario', (route) => {
    const metodo = route.request().method();
    if (metodo === 'POST') activo = true;
    if (metodo === 'DELETE') activo = false;
    const estado = { activo, creado_en: activo ? '2026-10-23T08:00:00.000Z' : null, ultimo_uso: null };
    return json(
      route,
      metodo === 'POST' ? 201 : 200,
      metodo === 'POST' ? { ...estado, url: null, ruta: `/cal/${token}.ics` } : estado,
    );
  });
  await page.goto('/#/ajustes/integraciones');

  // Act
  await page.getByTestId('calendario-crear').click();

  // Assert: la dirección (con el origen de esta web, sin dirección pública), solo esta vez.
  const direccion = page.getByLabel('Dirección del calendario');
  await expect(direccion).toHaveValue(new RegExp(`^http://127\\.0\\.0\\.1:4173/cal/${token}\\.ics$`));
  await expect(page.getByTestId('calendario-crear')).toHaveText('Revocar y crear otro enlace');
  await page.getByTestId('calendario-revocar').click();
  await expect(page.getByTestId('calendario')).toContainText('Enlace revocado');
  await expect(direccion).toHaveCount(0);
  await expect(page.getByTestId('calendario-crear')).toHaveText('Crear el enlace');
});

test('should_save_the_search_with_what_is_typed_and_how_often_to_warn', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/oportunidades');
  const buscada = page.waitForRequest((r) => r.url().includes('/revision') && r.url().includes('texto=formaci'));
  await page.getByLabel('Buscar oportunidades').fill('formación');
  await buscada;

  // Act
  await page.getByTestId('guardar-busqueda').click();
  const dialogo = page.getByTestId('dialogo-guardar-busqueda');
  await expect(dialogo.getByLabel('Nombre')).toHaveValue('formación');
  await dialogo.getByLabel('Avisarme de las nuevas').selectOption({ label: 'Cada día' });
  await page.getByTestId('busqueda-guardar').click();

  // Assert
  await expect(dialogo).toContainText('Guardada.');
  const [escritura] = page.__escrituras;
  expect(escritura).toMatchObject({
    metodo: 'POST',
    ruta: '/api/licitaciones/busquedas',
    cuerpo: { nombre: 'formación', frecuencia: 'diaria', consulta: { texto: 'formación' } },
  });
  expect(escritura.cuerpo.consulta).not.toHaveProperty('pestana');
});
