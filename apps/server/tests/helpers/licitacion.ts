// Licitación sintética completa para los tests de mercado: lo que no se da, vacío o null.
type LicitacionData = import('../../src/dominios/licitaciones/placsp/mapper.js').LicitacionData;
export type Resultado = LicitacionData['resultados'][number];

export function resultadoSintetico(r: Partial<Resultado> = {}): Resultado {
  return {
    lote: null,
    codigo: '8',
    fecha: '2026-03-01',
    ofertas: 3,
    oferta_min: null,
    oferta_max: null,
    adjudicatario_nif: 'B00765438',
    adjudicatario_nombre: 'Sistemas Ejemplo SA',
    importe_sin_iva: 80_000,
    importe_con_iva: null,
    pyme: false,
    inicio: null,
    ...r,
  };
}

export function licitacionSintetica(l: Partial<LicitacionData> = {}): LicitacionData {
  const id = l.id ?? 'p-1';
  return {
    id,
    atom_id: `atom-${id}`,
    fuente: 'perfiles',
    expediente: `E-${id}`,
    titulo: 'Servicio',
    url: null,
    estado: 'ADJ',
    actualizada_en: '2026-03-02T10:00:00Z',
    organo: { nombre: 'Cabildo', nif: 'Q0000001H', dir3: null, ciudad: null },
    tipo_contrato: '2',
    procedimiento: '1',
    presupuesto_sin_iva: 100_000,
    presupuesto_con_iva: null,
    valor_estimado: null,
    cpvs: ['72000000'],
    nuts: 'ES70',
    lugar: null,
    duracion: null,
    periodo: null,
    publicada_en: null,
    fecha_limite: null,
    fecha_solicitud: null,
    criterios: [],
    requisitos: [],
    garantias: [],
    documentos: [],
    lotes: [],
    resultados: [],
    presentacion: { codigo: null, maximo_lotes: null, maximo_adjudicables: null, combinacion: null },
    ...l,
  };
}
