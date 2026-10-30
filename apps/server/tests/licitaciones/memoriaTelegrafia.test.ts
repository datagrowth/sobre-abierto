// Prosa telegráfica. Los jueces leyeron como «telegráfica, difícil de leer» una
// memoria con todas las cifras: frases nominales, retahílas y palabras pegadas con barras.
// Textos sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUION_CASO_A, apartadoCasoA } from './fixtures/casoA.js';

const { DENSIDAD_MINIMA, esRetahila, esTelegrafico, fraseSinVerbo, pegadasEn, telegrafiaDe } =
  await import('../../src/dominios/licitaciones/oferta/telegrafia.js');
const { revisarApartado } = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
const { REGLAS_REDACCION } = await import('../../src/dominios/licitaciones/oferta/memoriaInstrucciones.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');

const TELEGRAFICO = [
  'Nube europea para datos, índices, copias, aplicación y registros; sin réplica fuera de España.',
  'Tres entornos: desarrollo sintético, preproducción corporativa, producción corporativa.',
  'El responsable técnico emitirá acta de recurso, versión, modalidad, cuota, saturación y resultado.',
  'Identidad/red con doble factor, identidades administradas y puntos privados; mínimo privilegio por perfil/expediente/documento.',
  'Banco técnico: 300 casos sintéticos, 180 de ajuste, 120 ciegos, disjuntos por expediente.',
  'Cola con admisión limitada a 10 usuarios concurrentes; esperas, errores y cancelaciones registradas aparte.',
  'Código, configuración, instrucciones, reglas, pruebas y manuales bajo etiqueta común de entrega.',
  'Revisión semanal: entrega, pruebas, incidencias, métricas, dependencias, acciones con responsable y fecha.',
];
const PROSA = [
  'La solución guarda los datos, los índices y las copias en una región de la nube situada en España, y por eso ningún documento sale del territorio nacional.',
  'Para separar el trabajo de desarrollo de la operación real, el servicio se organiza en tres entornos: el de desarrollo trabaja solo con datos sintéticos, mientras que el de preproducción y el de producción son corporativos.',
  'Cada semana el responsable técnico revisa con el cliente el estado de las pruebas, las incidencias abiertas y las métricas de uso, y deja en el acta las acciones que se acuerdan, con su responsable y su fecha.',
  'El banco técnico tiene 300 casos sintéticos: 180 se usan para ajustar el sistema y los 120 restantes se reservan como prueba ciega, de modo que ningún expediente aparece en los dos grupos.',
  'Además, la cola de peticiones admite como mucho a 10 usuarios a la vez y registra por separado las esperas, los errores y las cancelaciones, lo que permite explicar cualquier retraso.',
  'Al terminar el contrato, el cliente recibe el código, la configuración y los manuales con una misma etiqueta de entrega, y con ellos puede reconstruir el entorno sin depender de nosotros.',
];

test('should_detect_verbless_sentences_and_fragment_lists', () => {
  assert.equal(fraseSinVerbo('Nube europea para datos, índices y copias; sin réplica fuera de España.'), true);
  assert.equal(fraseSinVerbo('La solución guarda los datos en una región europea.'), false);
  assert.equal(fraseSinVerbo('Se incluyen los expedientes autorizados.'), false, '«se» + verbo');
  assert.equal(fraseSinVerbo('El responsable definió la muestra.'), false, 'pretérito con tilde');
  assert.equal(esRetahila('Código, configuración, instrucciones, reglas, pruebas y manuales.'), true);
  assert.equal(esRetahila('La solución guarda los datos, los índices y las copias en España.'), false);
});

test('should_detect_words_glued_with_slashes_or_figures', () => {
  assert.deepEqual(pegadasEn('Figura2perfiles y modelosS2; perfil/expediente/documento; TCP/IP y y/o no cuentan.'), [
    'Figura2perfiles',
    'modelosS2',
    'perfil/expediente/documento',
  ]);
});

test('should_measure_telegraphic_prose_by_function_word_density', () => {
  const t = telegrafiaDe([...TELEGRAFICO, ...TELEGRAFICO]);
  assert.ok(t.palabras >= 150 && t.densidad < DENSIDAD_MINIMA, `densidad ${t.densidad}`);
  assert.equal(esTelegrafico(t), true);
  const p = telegrafiaDe([...PROSA, ...PROSA]);
  assert.ok(p.densidad >= DENSIDAD_MINIMA, `densidad ${p.densidad}`);
  assert.equal(esTelegrafico(p), false);
  assert.equal(
    esTelegrafico(telegrafiaDe(TELEGRAFICO.slice(0, 2))),
    false,
    'por debajo de 150 palabras no se mide la densidad',
  );
});

test('should_flag_telegraphic_apartado_as_soft_problem_with_examples', () => {
  const mem = GuionBase.parse(GUION_CASO_A).memoria!;
  const c = {
    automaticos: [],
    apartado: { titulo: mem.apartados[0]!.titulo, puntos: 8, se_valorara: mem.apartados[0]!.se_valorara },
    cuota: null,
  };
  const a = apartadoCasoA(1, { memoria_id: 1, guion_id: 1, version: 1 });
  const con = (parrafos: string[]) => ({
    ...a,
    bloques: [{ ...a.bloques[0]!, parrafos }, ...a.bloques.slice(1).map((b) => ({ ...b, parrafos: [] }))],
  });
  const telegrafia = (x: typeof a) => revisarApartado(x, c).blandos.filter((b) => b.startsWith('PROSA TELEGRÁFICA'));
  assert.deepEqual(telegrafia(con([...PROSA, ...PROSA])), []);
  const r = telegrafia(con([...TELEGRAFICO, ...TELEGRAFICO]));
  assert.equal(r.length, 1);
  assert.match(
    r[0]!,
    /^PROSA TELEGRÁFICA: solo el \d+ % de las palabras de los párrafos son artículos, preposiciones o conjunciones/,
  );
  assert.match(r[0]!, /Frases sin verbo o en retahíla: «Nube europea para datos/);
  assert.match(r[0]!, /Si no cabe, quita lo secundario: no comprimas la sintaxis\.$/);
});

test('should_ask_for_full_paragraphs_in_writing_rules', () => {
  assert.match(REGLAS_REDACCION.prosa, /párrafos completos, frases con sujeto y verbo/);
  assert.match(REGLAS_REDACCION.prosa, /Las tablas, solo para datos/);
});

const ARQUITECTURA = [
  'La plataforma se despliega en Azure Spain Central. Azure AI Search indexa los documentos del expediente y Azure OpenAI genera los borradores; text-embedding-3-large calcula los vectores. Key Vault guarda los secretos; Entra ID gestiona identidades y accesos de los dos perfiles.',
  'Azure Container Apps ejecuta la API y Azure Functions procesa la carga nocturna. Azure Storage guarda los originales cifrados; Azure Cosmos DB conserva el estado de cada expediente. Azure Front Door publica la aplicación y Azure Firewall filtra el tráfico saliente. Defender for Cloud revisa la postura de seguridad cada día.',
  'El equipo técnico revisa cada mes los permisos y retira los que ya no se usan. Azure Monitor vigila la disponibilidad y avisa al responsable técnico cuando un servicio falla. Application Insights recoge las trazas de cada petición. Azure Policy impide desplegar recursos fuera de la región acordada. GitHub Actions despliega cada versión con Terraform.',
  'Los datos se cifran en reposo y en tránsito con claves que gestiona Key Vault. Azure Backup copia cada noche las bases de Cosmos DB y Azure Site Recovery replica las máquinas de integración. Microsoft Purview clasifica los documentos y Sentinel correlaciona las alertas de Entra ID.',
  'Log Analytics conserva las trazas 90 días y Power BI muestra el cuadro de mando semanal.',
];

test('should_not_count_product_names_and_acronyms_against_density', () => {
  const t = telegrafiaDe(ARQUITECTURA);
  assert.ok(t.palabras >= 150, `${t.palabras} palabras`);
  assert.equal(esTelegrafico(t), false, `densidad ${t.densidad}: prosa de arquitectura con sus artículos`);
});

test('should_not_count_technical_identifiers_as_glued_words', () => {
  assert.deepEqual(
    pegadasEn(
      'Los ficheros se codifican en base64 y se firman con sha256; el modelo gpt4o y llama3 corren con python3 a 100kbps.',
    ),
    [],
  );
  assert.deepEqual(pegadasEn('Figura2perfiles, 9tipos y casoA1.'), ['Figura2perfiles', '9tipos', 'casoA1']);
});
