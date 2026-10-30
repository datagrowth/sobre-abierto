<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Cribar un lote

**Cuándo leer esto.** En una tarea «criba el lote N» (llega sola con el número de lote). Para preguntas sobre una oportunidad ya cribada no hace falta.

## Cribar un lote

Llega como tarea automática con el número de lote:

1. Lee el perfil de la empresa: `biblioteca_leer` con ruta `Empresa/perfil-licitaciones.md`.
   Si no puedes leerlo (no existe o la herramienta falla), **no cribes**: termina sin enviar
   veredictos y la plataforma lo reintentará. Una criba sin el perfil se rechaza.
2. `licitaciones_candidatas` con el lote.
3. Para cada candidata: `interesa` (encaja claramente), `descartar` (claramente fuera por
   sector, tamaño o requisitos que no cumplimos) o `revisar` (dudas). Motivo concreto
   en una o dos frases y confianza de 0 a 1. Ante la duda, `revisar`: descartar algo bueno
   cuesta más que revisar algo malo.
   **Formaciones** (cursos, planes de formación, capacitación, talleres, CPV 80…): si el
   perfil de la empresa (`plataforma_empresa`, campo `areas_formacion`) tiene áreas de
   formación, solo interesan las de esas materias. Si es de otra materia (medio ambiente,
   sanidad, idiomas, PRL…), `descartar` con el motivo «Formación fuera de nuestras áreas:
   <materia>»; si el título no deja claro de qué es la formación, `revisar`. Con
   `areas_formacion` vacío, una formación se juzga contra el perfil como cualquier otro
   contrato.
   **Antecedentes:** `antecedentes.nivel` resume los indicios de que la licitación esté
   pensada para quien ya presta el servicio (mismo adjudicatario en ediciones anteriores,
   una sola oferta, bajas mínimas, plazo por debajo del mínimo legal, solvencia por encima
   de la referencia legal); `ambito` dice si sale del contrato o de un lote, y
   `ediciones_anteriores` y `adjudicatario_anterior` son de ese mismo ámbito. Con nivel `alto`, dilo en
   el motivo («la ganó X en las tres últimas ediciones con una sola oferta») y baja la
   confianza; no descartes solo por eso, pero si además encaja a medias, prefiere
   `revisar`. Son indicios, no acusaciones: no escribas que está amañada.
   **Idioma:** `idioma_titulo` es la lengua en que está escrito el título (`ca` catalán o
   valenciano, `eu` euskera, `gl` gallego, `es` español; `null` si no se sabe). El campo
   `idiomas` del perfil de la empresa (`plataforma_empresa`) dice en qué lenguas trabaja el
   equipo: si la licitación exige trabajar o atender en una que no está ahí (personal con
   euskera, atención en catalán…), `descartar`; si solo está publicada en esa lengua y no
   consta que la exija, `revisar` y dilo en el motivo.
4. **Lotes.** Un contrato de 1 M€ puede tener un lote de 100.000 € a nuestra medida: el
   tamaño se juzga por lote cuando se puede ir a lotes sueltos. Cada candidata con lotes
   trae `presentacion` (`regla`, `codigo`: 1 a un solo lote, 2 a todos, 3 a uno o varios,
   `null` sin confirmar; `se_eligen_lotes`, `maximo_lotes`, `maximo_adjudicables` y
   `combinacion`, el texto del órgano) y `lotes` (id, nombre, importe, CPV y
   `encaja_prefiltro`; como mucho 30, los que encajaron primero, y `lotes_total`).
   - Si `se_eligen_lotes` es `true`, juzga cada lote por su importe, su CPV y su objeto y,
     con `interesa` o `revisar`, envía en `lotes` los de interés: `[{ "id": "2", "motivo":
     "…" }]`, como mucho `maximo_lotes` (uno solo si la regla es «A un solo lote»: elige el
     mejor). Solo lotes dentro de `rango_importe_lotes` (el rango de importe de los
     filtros, en la respuesta de `licitaciones_candidatas`): la plataforma rechaza los
     demás. Si el código es `null` (las plataformas agregadas no lo publican), elige igual
     y di en el motivo que la regla está sin confirmar: la ficha la confirmará.
   - Si hay que ir a todos los lotes (`codigo` 2), juzga el total y **no** envíes `lotes`.
   - Un `descartar` no lleva `lotes`. Sin lotes de interés, todo se mide contra el contrato.
5. `licitaciones_cribar` con **todos** los veredictos a la vez, uno por candidata. Si
   responde con error, lee qué falta, sobra o está repetido (o qué lote no vale: que no
   existe, repetido, más del máximo o lotes sueltos donde hay que ir a todos), corrige y
   reenvía.

Ejemplo de envío:

```json
{
  "lote": 12,
  "veredictos": [
    { "id": "p-20379303", "veredicto": "interesa", "motivo": "Servicios de analítica y cuadros de mando para un organismo estatal; importe dentro de nuestro rango.", "confianza": 0.85 },
    { "id": "p-20602952", "veredicto": "revisar", "motivo": "El lote 2 (103.624 €) encaja por tamaño; el 1 es de asistencia psicológica, fuera de lo nuestro.", "confianza": 0.6,
      "lotes": [{ "id": "2", "motivo": "Asistencia social: importe a nuestra medida y CPV 85320000 cercano a proyectos previos." }] },
    { "id": "a-20508788", "veredicto": "descartar", "motivo": "Obras de adecuación de espacios: fuera de nuestro sector.", "confianza": 0.95 }
  ]
}
```
