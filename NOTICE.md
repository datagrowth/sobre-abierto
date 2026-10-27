# Avisos de terceros

Sobre Abierto se distribuye con la licencia [AGPL-3.0-or-later](LICENSE). Copyright © 2026 Datagrowth.

Incluye o usa estos componentes de terceros, cada uno con su propia licencia.

## Código incluido en el repositorio

| Componente | Dónde | Licencia |
|---|---|---|
| Hermes Vault | `apps/server/src/biblioteca/` | MIT; texto original en [`apps/server/src/biblioteca/LICENSE`](apps/server/src/biblioteca/LICENSE) |
| ESPD `BASIC-ESPDResponse-2.1.1.xml`, muestra oficial de [ESPD-EDM](https://github.com/OP-TED/ESPD-EDM) (Comisión Europea) | `apps/server/tests/licitaciones/fixtures/documentos/espd-referencia/`, solo en los tests | EUPL-1.2, la licencia del repositorio de origen |

Hermes Vault es la base de la Biblioteca de Conocimiento.

## Servicios y modelos que se descargan al ejecutar

| Componente | Uso | Licencia |
|---|---|---|
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) (Nous Research) | Agente de IA. Se ejecuta como imagen Docker aparte (`nousresearch/hermes-agent`); su código no se copia en este repositorio | MIT |
| [`Xenova/multilingual-e5-small`](https://huggingface.co/Xenova/multilingual-e5-small), basado en [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) | Embeddings de la Biblioteca; se descarga en el primer uso (`BIBLIOTECA_EMBEDDING_MODEL`) | MIT |

## Fuentes

| Fuente | Paquete | Licencia |
|---|---|---|
| DM Sans | `@fontsource/dm-sans` | SIL Open Font License 1.1 |
| JetBrains Mono | `@fontsource/jetbrains-mono` | SIL Open Font License 1.1 |

## Imagen Docker del monitor

Se instalan desde los paquetes de Debian en `infra/Dockerfile`:

| Componente | Uso | Licencia |
|---|---|---|
| LibreOffice Writer | Convierte `.doc` a `.docx` y pagina las memorias | MPL-2.0 |
| Tesseract OCR | OCR de los pliegos escaneados | Apache-2.0 |
| poppler-utils | Convierte páginas de PDF a imagen para el OCR | GPL-2.0-or-later |

## Imagen Docker de drive-sync

| Componente | Uso | Licencia |
|---|---|---|
| [rclone](https://rclone.org) (imagen `rclone/rclone`) | Sincroniza las carpetas con Google Drive | MIT |

## Dependencias de npm sin licencia MIT

El resto de dependencias son MIT, ISC, BSD o Apache-2.0. `npm run licencias` revisa el
`package-lock.json` entero y falla si aparece una licencia incompatible con la AGPL.

| Paquete | Licencia | Nota |
|---|---|---|
| `@resvg/resvg-js` | MPL-2.0 | Renderiza SVG en el servidor |
| `lightningcss` | MPL-2.0 | Solo al compilar la web |
| `@img/sharp-libvips-*` | LGPL-3.0-or-later | Binario opcional de `sharp`, se enlaza dinámicamente |
| `jszip` | MIT OR GPL-3.0-or-later | Se usa con la licencia MIT |
| `caniuse-lite` | CC-BY-4.0 | Solo al compilar la web |
