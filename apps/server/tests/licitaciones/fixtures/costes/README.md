Fixtures sintéticos del caso C (lote 3: cinco cursos en teleformación para mujeres de un consorcio comarcal ficticio) para la prueba de aceptación de los compromisos con coste. No salen de ninguna oferta ni de ningún pliego real: la memoria, el pliego y el guion están inventados para reproducir un defecto concreto, una memoria que promete cosas que el pliego no pide y que cuestan dinero (un kit a cada alumna, 3,5 h fijas por subgrupo y semana, una entrevista con cada alumna apta…). No llevan nombres de personas ni de organismos reales, NIF, correos, teléfonos, enlaces ni importes en la memoria.

| Archivo | Qué contiene |
|---|---|
| `casoC-memoria.json` | `{apartados: [{n, titulo, texto}]}`: una memoria técnica corta en markdown, partida por `## 1.1`, `## 1.2` y `## 1.3`, con la presentación y la guía de lectura en el apartado 1. Tiene tablas, `###`/`####` y viñetas, porque el detector lee la cabecera de la tabla y el título del bloque. Lleva a propósito 14 compromisos con coste que el pliego no pide, las 12 obligaciones del pliego concretadas sin pasarse y algunos añadidos tolerados. |
| `casoC-guion.json` | `{guion_id, datos}`: un guion que valida con `GuionBase`, con los tres apartados de la memoria y sus «se valorará», el presupuesto base (18.557) y `alcance` del lote 3: 5 cursos con 40, 40, 60, 69 y 120 alumnas, sus horas y 1 grupo. |
| `casoC-pliego.json` | `Pasaje[]` del PPT y del PCAP ficticios: la descripción del servicio de los lotes 1 y 2 (con el material fungible, que no obliga en el lote 3) y del lote 3, los medios personales, el cuadro y los cursos del lote 3 (pág. 13-14) y los criterios de juicio de valor (pág. 77-79). |
| `casoC-esperado.json` | Lo que debe encontrar costesCasoC.test.ts en la memoria. Ver abajo. |

`casoC-esperado.json`:

- `compromisos`: las 14 filas de la tabla de referencia («Lo que la memoria añade y no es obligatorio»), una por compromiso, con `tipo` del catálogo, `fragmento_cita` literal de su `apartado` (y `otras_citas` del mismo compromiso en otros sitios, como la guía de lectura), rango de horas y, en los kits, de euros, y `barata_contiene` (basta con que la formulación barata contenga uno). Rangos con el perfil por defecto: kits 4.000-6.000 € (189 alumnas: las 69 de huerto y las 120 de reparaciones), dedicación 500-800 h, entrevistas 110-200 h; el resto por su banda (`bajo` ≤ 30 h, `bajo-medio` ≤ 150 h, `medio` 15-150 h, `medio-alto` 50-250 h).
- `exigidos_revisados`: 12 obligaciones del PPT que la memoria concreta y que no pueden salir como añadidos, con la cita literal del pliego. Las que el pliego nombra sin cifra («tutorías que se fijen», «informes periódicos») cuentan solo en su concreción mínima.
- `extras_tolerados`: añadidos que la tabla no lista (tutoría en directo semanal, sesión grupal de orientación, publicación semanal de ofertas…): si el detector los encuentra, no son falsos positivos.
- `firma`: los 14 compromisos los firma Persona K. Los exigidos y los tolerados son una propuesta: falta la firma de Persona K o Persona F antes de dar el caso por cerrado.

Qué prueba cada test:

- `costesCasoC.test.ts`: cada apartado pasa por `compromisosDetallados` con el perfil por defecto, el guion y el pliego. Al menos 12 de los 14 compromisos salen como añadidos con su tipo y su cita; los kits, la dedicación y las entrevistas caen en su rango y el resto en su banda; ningún exigido revisado sale como añadido; no hay más de 8 añadidos caros fuera de la tabla y de los tolerados, y cada compromiso trae su formulación barata.
- `comprobacionesReglasCostes.test.ts`: con la memoria entera, las comprobaciones abren una fila «Suavizar» por cada añadido caro (los kits, en el apartado 1.2) y la fila del total frente al presupuesto base, sin euros en los títulos.
- `costesFixtureSeguro.test.ts`: que no se cuele un correo, un teléfono, un NIF, un enlace, una firma nominal ni un importe en la memoria; que cada cita del esperado esté literal en su apartado o en el pliego; que el guion valide y traiga el alcance del lote 3, y que el pliego tenga los pasajes con su página y su lote. Con `FIXTURES_BRUTOS=<dir>` busca además los nombres de una plantilla real que viva fuera del repo.

Si se cambia la memoria, el esperado se ajusta a mano: las citas tienen que seguir siendo literales y el detector tiene que seguir dando los mismos tipos, bandas y rangos.
