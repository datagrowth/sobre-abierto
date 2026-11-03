// Empresa ficticia de los tests: la misma que apps/server/tests/fixtures/empresaEjemplo.ts.
// El NIF tiene el control bien y la provincia 00, que no existe: valida y no puede ser de nadie.

export const NIF_EJEMPLO = 'B00123455';
export const NOMBRE_EJEMPLO = 'Analítica Ejemplo, S.L.';

export const VOLUMEN_2024 = { anio: 2024, importe: 118640.55 };
export const VOLUMEN_2025 = { anio: 2025, importe: 196275.85 };

export const EMPRESA_EJEMPLO = {
  nif: NIF_EJEMPLO,
  nombre: NOMBRE_EJEMPLO,
  volumen_negocio: [VOLUMEN_2024, VOLUMEN_2025],
  mayor_contrato_similar: 132480.35,
  plantilla_media: 4,
  anios_actividad: 3,
  seguro_rc: 250000,
  fecha_constitucion: '2023-03-14',
  tamano: 'micro',
  cpv_experiencia: ['72'],
};
