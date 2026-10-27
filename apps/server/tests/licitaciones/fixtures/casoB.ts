// Guion v4 del caso B (p-91000740, ficticio): un contrato de formación en cinco lotes, criterios
// automáticos distintos en el lote 1 (C1-C6) y en el lote 2, y dos precios por edición en el
// lote 2. El guion v3 de este caso solo tenía los criterios del lote 1 y un total de 97.216 €.
const ARCHIVO = 'Sobre único';
const PCAP = 'PCAP.pdf';

const auto = (criterio: string, lotes: string[], puntos: number, extra: Record<string, unknown> = {}) => ({
  criterio, puntos, como_se_acredita: 'Declaración en el modelo de oferta', casilla_en: 'Anexo II, apartado 2', archivo: ARCHIVO,
  marcas: [`marca ${criterio.toLowerCase()}`], documento: PCAP, pagina: 30, lotes, ...extra,
});

const oferta = (lotes: string[], presupuesto: number, precios: { concepto: string; maximo: number; cantidad: number }[]) => ({
  lotes, formula: 'P = 60 × (precio mínimo / precio ofertado)', presupuesto_base: presupuesto, impuesto_aparte: 'IVA',
  precios_unitarios: precios.map((p) => ({ ...p, unidad: 'edición' })), umbral_anormalidad: null, modelo: 'Anexo II', archivo: ARCHIVO, documento: PCAP, pagina: 28,
});

export const GUION_CASO_B = {
  archivos: [{
    nombre: ARCHIVO, contenido: 'Documentación administrativa y propuestas técnica y económica de cada lote.', ambito: 'por_lote',
    documentos: [
      { tipo: 'deuc', nombre: 'DEUC', obligatorio: true, produce: 'persona' },
      { tipo: 'oferta_economica', nombre: 'Anexo II. Oferta económica', obligatorio: true, produce: 'persona' },
      { tipo: 'acreditacion', nombre: 'Acreditación de centro autorizado de la herramienta', obligatorio: true, produce: 'persona', lotes: ['2'] },
    ],
    documento: PCAP, pagina: 20,
  }],
  memoria: null,
  automaticos: [
    auto('C1 Horas de acompañamiento adicionales', ['1'], 10, {
      tipo: 'compromiso',
      tramos: [{ descripcion: 'Entre 8 y 15 horas más', puntos: 5, valor: '8' }, { descripcion: '16 horas o más', puntos: 10, valor: '16' }],
      penalizacion: { texto: '1,5 % del importe del lote por cada incumplimiento', documento: PCAP, pagina: 41 },
    }),
    auto('C2 Guías de estudio en lectura fácil', ['1'], 5),
    auto('C3 Entorno de práctica propio', ['1'], 5),
    auto('C4 Resúmenes escritos de cada sesión', ['1'], 5),
    auto('C5 Sello de calidad en formación', ['1'], 5, { tipo: 'acreditacion', exige_documento: 'Certificado de gestión de la calidad en vigor' }),
    auto('C6 Sesiones de refuerzo sin coste', ['1'], 10, { tipo: 'compromiso' }),
    auto('L2 Docente con acreditación oficial de la herramienta', ['2'], 15, { tipo: 'acreditacion', exige_documento: 'Acreditación oficial del docente' }),
    auto('Plazo de arranque', [], 5, { tipo: 'compromiso' }),
  ],
  ofertas_economicas: [
    oferta(['1'], 26_880, [{ concepto: 'Edición', maximo: 4_480, cantidad: 6 }]),
    oferta(['2'], 51_744, [{ concepto: 'Edición nivel básico', maximo: 4_704, cantidad: 6 }, { concepto: 'Edición nivel avanzado', maximo: 5_880, cantidad: 4 }]),
    oferta(['3'], 6_720, [{ concepto: 'Edición', maximo: 3_360, cantidad: 2 }]),
    oferta(['4'], 6_720, [{ concepto: 'Edición', maximo: 3_360, cantidad: 2 }]),
    oferta(['5'], 5_152, [{ concepto: 'Edición', maximo: 2_576, cantidad: 2 }]),
  ],
  plazo: { fecha_limite: '2027-10-18T14:00', canal: 'PLACSP' },
  lotes: ['1', '2', '3', '4', '5'],
};
