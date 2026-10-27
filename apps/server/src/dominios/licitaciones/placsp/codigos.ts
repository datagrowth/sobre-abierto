// Listas de códigos CODICE que usa la Plataforma de Contratación del Sector
// Público, copiadas de sus ficheros oficiales (.gc) en contrataciondelestado.es/codice/cl/.

// SyndicationContractFolderStatusCode-2.04
export const ESTADOS: Record<string, string> = {
  PRE: 'Anuncio previo',
  PUB: 'En plazo',
  EV: 'Pendiente de adjudicación',
  ADJ: 'Adjudicada',
  RES: 'Resuelta',
  ANUL: 'Anulada',
};

// ContractCode-2.08
export const TIPOS_CONTRATO: Record<string, string> = {
  '1': 'Suministros',
  '2': 'Servicios',
  '3': 'Obras',
  '7': 'Administrativo especial',
  '8': 'Privado',
  '21': 'Gestión de servicios públicos',
  '22': 'Concesión de servicios',
  '31': 'Concesión de obras públicas',
  '32': 'Concesión de obras',
  '40': 'Colaboración público-privada',
  '50': 'Patrimonial',
  '999': 'Otros',
};

// SyndicationTenderingProcessCode-2.07
export const PROCEDIMIENTOS: Record<string, string> = {
  '1': 'Abierto',
  '2': 'Restringido',
  '3': 'Negociado sin publicidad',
  '4': 'Negociado con publicidad',
  '5': 'Diálogo competitivo',
  '6': 'Contrato menor',
  '7': 'Derivado de acuerdo marco',
  '8': 'Concurso de proyectos',
  '9': 'Abierto simplificado',
  '10': 'Asociación para la innovación',
  '11': 'Derivado de asociación para la innovación',
  '12': 'Basado en un sistema dinámico de adquisición',
  '13': 'Licitación con negociación',
  '100': 'Normas internas',
  '999': 'Otros',
};

// TenderResultCode-2.02
export const RESULTADOS: Record<string, string> = {
  '1': 'Adjudicado provisionalmente',
  '2': 'Adjudicado definitivamente',
  '3': 'Desierto',
  '4': 'Desistimiento',
  '5': 'Renuncia',
  '6': 'Desierto provisionalmente',
  '7': 'Desierto definitivamente',
  '8': 'Adjudicado',
  '9': 'Formalizado',
  '10': 'Licitador mejor valorado (requerimiento de documentación)',
};

// TenderPresentationCode-1.04 (PartPresentationCode de TenderingProcess): a cuántos
// lotes se puede presentar un licitador. Las plataformas agregadas no lo publican.
export const PRESENTACION_LOTES: Record<string, string> = {
  '1': 'A un solo lote',
  '2': 'A todos los lotes',
  '3': 'A uno o varios lotes',
};

// Resultados con adjudicatario e importe: los que cuentan para bajas y competidores.
export const RESULTADOS_ADJUDICADOS = new Set(['1', '2', '8', '9']);

// Estados en los que aún se puede presentar oferta.
export const ESTADOS_ABIERTOS = new Set(['PRE', 'PUB']);

export function nombreDe(lista: Record<string, string>, codigo: string | null): string | null {
  return codigo ? (lista[codigo] ?? codigo) : null;
}
