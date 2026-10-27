# Tests del servidor

Se ejecutan con `tsx --test` (el runner de Node). Desde la raíz del repo, `npm test` lanza los de las dos apps; un
test suelto: `cd apps/server && npx tsx --test tests/<ruta>.test.ts`.

## Estructura

| Carpeta | Qué prueba |
|---|---|
| `nucleo/` | El núcleo: autenticación y permisos, cola de IA, agentes y MCP, colaboradores, Drive, correo, calendario. |
| `licitaciones/` | El dominio Licitaciones: radar, ficha, propuestas, oferta, comprobaciones y memoria técnica. |
| `biblioteca/` | El motor de la Biblioteca de Conocimiento: notas, enlaces, búsqueda, documentos e indexador. |
| `fixtures/` | Datos comunes a todo el servidor. Hoy, `empresaEjemplo.ts`, la empresa ficticia de los tests. |
| `helpers/` | Utilidades de test: un servidor Express local, licitaciones y personas sintéticas, el entorno de las pruebas de memoria (`memoriaEntorno.ts`), las ofertas de `fixtures/comprobaciones` (`comprobacionesFixtures.ts`), la lectura de la skill y medición de tiempo. |
| `infra.test.ts` | Coherencia entre los Compose, los Dockerfiles y las variables de entorno que lee el servidor. |

## Cómo se escriben

- El nombre dice qué se espera: `should_return_error_when_api_key_is_invalid`.
- Arrange, Act, Assert. Se dobla solo la frontera (Hermes, Drive, la PLACSP, el reloj); la base de datos es SQLite de verdad,
  en un directorio temporal.
- Cada test que toca disco o variables de entorno fija `PLATAFORMA_DATA_DIR` a un directorio temporal antes de importar el
  módulo y lo borra al terminar. Ninguno lee un `.env`.
- Un `t.skip(...)` lleva siempre su motivo y solo existe para lo que depende de la máquina (LibreOffice, enlaces simbólicos,
  FIFOs). No hay `.only`.

## Datos de prueba

Nada identifica a nadie real. La empresa es `fixtures/empresaEjemplo.ts`, las personas son «Persona A», «Persona B»…, y los órganos,
las empresas y los textos de las fichas son inventados con la forma de los de verdad. Solo el objeto y los criterios de los feeds
de la PLACSP vienen de licitaciones públicas, sin nombres propios (ver «Cómo se generan»).

Los fixtures de Licitaciones viven en `licitaciones/fixtures/`:

| Carpeta o archivo | Contenido |
|---|---|
| `comprobaciones/` | Cinco ofertas completas (`casoB`, `casoC`, `casoD`, `casoE`, `casoF`) con su estado esperado (`*.esperado.json`). Las usan los tests de las comprobaciones y los datos de los e2e de la web. |
| `cambios/` | Las propuestas, el equipo y la memoria sobre los que se prueban los cambios tardíos de precio, lotes y personas. |
| `ofertas/` | Las mismas cinco ofertas vistas desde Hoy, la Mesa y los anexos. |
| `costes/` | Una memoria con compromisos que cuestan dinero y lo que el detector debe encontrar en ella. |
| `documentos/` | Documentos de pliego que se generan en memoria en cada test. |
| `eval/` | Un caso del banco de pruebas de memorias: rúbrica, dos versiones y el veredicto esperado. |
| `asistente/` | Treinta respuestas libres para medir al asistente de la oferta. |
| `*.atom` | Siete feeds de la PLACSP recortados y anonimizados: conservan la estructura CODICE, las fechas, los importes, los CPV y los estados de los feeds reales, y llevan órganos, adjudicatarios, NIF, direcciones y buzones ficticios. |
| `*.xml`, `pliego-*.json` | La petición del ESPD y los pliegos recortados. |
| `casoA.ts`, `casoB.ts`, `estrategiaCasoA.ts`, `criticaPares.ts` | Casos construidos por código. |

### Cómo se generan

Los feeds `*.atom` salieron de la PLACSP y se pasaron una sola vez por una tabla de sustituciones: cada órgano, adjudicatario,
persona, domicilio, web y buzón real pasó a un nombre inventado («Cabildo Insular de Isla Ejemplo», «Consultora Ejemplo Dos»,
`@example.com`) y cada NIF a uno ficticio con el dígito de control bien (`P0000002F`: letra, `0000` y tres cifras, que no
corresponde a nadie). El mismo órgano o adjudicatario lleva el mismo sustituto en todos los feeds, y los tokens opacos de los
enlaces (`idEvl`, `idBp`, `cifrado`, `DocumentIdParam`) son `anonimo-…`. Los códigos DIR3 y los identificadores de plataforma
también son inventados. Se conservaron los números de expediente (el lector los necesita con su forma), las provincias y los
códigos NUTS, porque el código los lee, y los textos de objeto, criterios y requisitos de cada licitación, que no nombran a nadie;
donde el título o la dirección sí nombraban un municipio o un edificio concretos, pasaron a «Villaejemplo», «Distrito Norte» o
«Calle Ejemplo, 1».

Un feed nuevo se anonimiza antes de entrar en el repo, con la misma regla; no hay un script en el repo porque llevaría los
nombres reales dentro. `placsp.test.ts` lo vigila: falla si un `NIF` no es de la forma ficticia o si un correo no es de
`example.com`. Si un test aserta un valor del feed (un NIF, un nombre), se cambia en el feed y en el test a la vez.

Los JSON de `comprobaciones/`, `cambios/` y `ofertas/` se mantienen a mano: si un test necesita un defecto nuevo, se escribe en el
texto sintético. Después se pasa el generalizador desde `apps/server`:

```bash
node tests/licitaciones/fixtures/generalizarFixtures.mjs
```

`generalizarFixtures.mjs` aplica `perfilesGenericos.mjs`: deja de cada persona solo el nivel y la rama de la titulación, las
certificaciones que reconoce el código y los idiomas, y quita de los textos el nombre de la empresa, la sede y los lugares que
delatan un contrato. Es idempotente: una segunda pasada no cambia nada. `perfilesGenericos.test.ts` falla si queda algo
reconocible.

Los datos de los e2e de la web (`apps/web/e2e/datos`) no se editan: se regeneran desde `comprobaciones/` con

```bash
npm run e2e:datos -w @sobre-abierto/server
```

Los JSON de `fixtures/` no los reformatea Prettier (`.prettierignore`), porque algunos tests comparan los archivos byte a
byte.
