// Carpetas con significado propio dentro de la bóveda.

// Propuestas de notas (de Hermes o de otras herramientas) pendientes de aprobar.
// Vive en Drive junto al resto del conocimiento, así que se revisa desde cualquier sitio.
export const CARPETA_PROPUESTAS = '_Propuestas';

// Copia de solo lectura de los Google Docs de la carpeta, convertidos a
// docx/xlsx/pptx por drive-sync para poder leerlos.
export const CARPETA_GDOCS = '.gdocs';

// Nunca contienen notas: salida del antiguo grafo (graphify), dependencias y propuestas.
export const CARPETAS_EXCLUIDAS = new Set(['graphify-out', CARPETA_PROPUESTAS, 'node_modules']);
