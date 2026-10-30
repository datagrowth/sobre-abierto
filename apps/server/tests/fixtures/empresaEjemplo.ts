// Empresa ficticia de los tests: una micropyme de datos con cifras inventadas pero coherentes
// (volumen que crece, un contrato similar por debajo del volumen, cuatro personas). El NIF tiene
// el control bien y la provincia 00, que no existe: valida y no puede ser de nadie.
// La web tiene la misma en apps/web/tests/fixtures/empresaEjemplo.mjs.

export const NIF_EJEMPLO = 'B00123455';
export const NOMBRE_EJEMPLO = 'Analítica Ejemplo, S.L.';

export const VOLUMEN_2024 = { anio: 2024, importe: 152_310.72 };
export const VOLUMEN_2025 = { anio: 2025, importe: 268_420.15 };

export const EMPRESA_EJEMPLO = {
  nif: NIF_EJEMPLO,
  nombre: NOMBRE_EJEMPLO,
  volumen_negocio: [VOLUMEN_2024, VOLUMEN_2025],
  mayor_contrato_similar: 174_905.36,
  plantilla_media: 4,
  anios_actividad: 3,
  seguro_rc: 250_000,
  fecha_constitucion: '2023-03-14',
  tamano: 'micro',
  cpv_experiencia: ['72'],
};
