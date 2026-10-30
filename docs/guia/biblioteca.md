# Biblioteca de Conocimiento

La Biblioteca guarda el conocimiento de la empresa: lo que consultan las personas y lo que lee Hermes antes de
redactar. Se busca por palabras o por significado, y las notas nuevas entran como propuestas que alguien aprueba.

<!-- captura: biblioteca · La pestaña Explorar de la Biblioteca con el tipo de cada nota y en cuántas ofertas se ha usado -->

La carpeta Conocimiento de tu Drive: notas markdown
y documentos (PDF, Word, Excel, PowerPoint, Google Docs…).

- Notas con backlinks y renombrado que actualiza enlaces. Para conversar con la
  Biblioteca se usa Hermes (skill `biblioteca` o MCP), no un chat propio.
- Búsqueda en notas y dentro de los documentos, por palabras y **por significado**
  («fianza» encuentra «garantía»), con un modelo que corre en el propio servidor. Los
  documentos se abren desde la búsqueda; los PDF escaneados (sin texto) y los de texto codificado (sale como símbolos) se señalan.
- **Propuestas:** notas que propone Hermes u otro agente (p. ej. el resumen de un
  competidor o lo que convierte de un documento subido) y que apruebas o rechazas; al
  aprobarlas se guardan junto a su documento. Cada una dice qué agente la propuso. Los
  pliegos del radar no generan notas: su análisis es la ficha de la licitación.
- **Subir documento:** a la carpeta que elijas de la Biblioteca (PDF, Office,
  OpenDocument, texto, XML o markdown, hasta 100 MB); llega a Drive en un minuto y nunca
  reemplaza un archivo con el mismo nombre.
- **Explorar** (la pestaña principal): las notas con su **tipo** (caso de
  éxito, metodología, ficha de servicio, normativa del cliente, oferta presentada o
  plantilla; del frontmatter `tipo` o, sin él, deducido de la carpeta y marcado con «*»), su
  carpeta, **en cuántas ofertas se ha usado** (las que Hermes leyó mientras trabajaba en cada
  oferta) y cuándo se revisó, con **Revisar** si lleva más de 12 meses sin revisar
  (`revisada_en` del frontmatter o, sin él, la última modificación). Filtros por tipo, sector y
  estado; el índice dice en una línea cuántos documentos y notas tiene leídos y cuántos PDF
  escaneados. Una fila abre la nota; la referencia sigue siendo Drive.
- **Propuestas de Hermes**, con su origen (desde un documento, un párrafo que se repite o un
  acta) y su tipo, y **Editar antes** (título y cuerpo) además de Aprobar y Rechazar.
- **Documentos sin nota:** lo de Drive que aún no tiene nota, con **Pedir nota** uno a uno o
  **Pedir las N notas a Hermes** en bloque; los PDF escaneados salen como «No se puede leer».
- **Huecos:** lo que han pedido los pliegos de los últimos 6 meses (criterios de valoración y
  requisitos de experiencia, solvencia técnica, certificaciones y medios de las fichas) y la
  Biblioteca no respalda: nada, solo documentos sin nota o una nota sin revisar. Cada uno con
  **Pedir borrador a Hermes** (llega a Propuestas, carpeta Borradores) o **Revisar nota**. Sin la
  búsqueda por significado lista, no se calculan.

## Google Drive

**Google Drive** (en **Ajustes**). Conectas tu cuenta y eliges una carpeta, que
pasa a ser la fuente de la verdad de Hermes. `Conocimiento`, `Agent Studio` (sus
`skills` se convierten en skills de Hermes) y `Salidas` se sincronizan en ambos
sentidos, cada minuto o en segundos si algo cambia en el servidor. Los Google Docs se
leen convertidos a Office. Cada día se sube una copia de seguridad de los datos de
Hermes (las bases de datos de la plataforma, una vez por semana por defecto); se puede
desactivar con `GDRIVE_BACKUP=0` si el VPS ya tiene copia, y el panel dice si está activa
y cuándo fue la última ([Copia de seguridad](../operar/drive.md#copia-de-seguridad)).

## Hermes usa la Biblioteca

**Hermes usa la Biblioteca** con la skill `biblioteca` (se instala sola): busca antes
de responder, lee documentos por partes con sus páginas, lista los documentos que aún
no tienen nota y propone notas. Nunca escribe directamente en la Biblioteca.
