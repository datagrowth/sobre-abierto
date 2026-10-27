---
name: biblioteca
description: Busca y propone conocimiento en la Biblioteca de la empresa
version: 1.1.3
author: Sobre Abierto
license: AGPL-3.0-or-later
platforms: [linux]
metadata:
  hermes:
    tags: [conocimiento, documentos, licitaciones, notas]
---

# Biblioteca de Conocimiento

La Biblioteca es el conocimiento de la empresa: notas en markdown y documentos
(PDF, Word, Excel, PowerPoint, Google Docs), entre ellos los pliegos de las
licitaciones. Vive en Google Drive (carpeta `Conocimiento`) y se sincroniza con
`/opt/data/conocimiento`. Búscala **antes de responder** cualquier cosa sobre
clientes, licitaciones, procesos, propuestas o decisiones de la empresa, y cita de
dónde sale cada dato (ruta y página).

## Carpetas (todas sincronizadas con Google Drive)

| Carpeta | Para qué | Tú |
|---|---|---|
| `/opt/data/conocimiento` | Notas y documentos de referencia | Solo lees. Lo nuevo va como propuesta (abajo) |
| `/opt/data/conocimiento/.gdocs` | Copia en docx/xlsx/pptx de los Google Docs | Solo lees |
| `/opt/data/salidas` | Lo que entregas: informes, borradores, exportaciones | Escribes aquí |
| `/opt/data/skills/empresa` | Skills de la empresa (se editan en Drive) | Lees |

Nunca escribas ni borres en `/opt/data/conocimiento`: se aprueba desde la
Biblioteca y así nada entra sin revisión.

## Comandos

```bash
B="python3 ${HERMES_SKILL_DIR}/scripts/biblioteca.py"

$B buscar "criterios de adjudicación limpieza Getafe"   # contexto listo para usar
$B buscar "garantía definitiva" --limite 10 --json        # solo la lista
$B leer "Licitaciones/Radar/2026/EXP-1 (p-1)/PCAP.pdf"    # texto, con [pág. N]
$B leer "Licitaciones/Radar/2026/EXP-1 (p-1)/PCAP.pdf" --desde 20000
$B pendientes                                             # documentos sin nota
$B proponer --titulo "Procedimiento de calidad" \
  --fuente "Empresa/Calidad/Procedimiento.pdf" --archivo /tmp/nota.md
```

- `buscar` encuentra por palabras y por significado ("fianza" encuentra
  "garantía"). Devuelve las notas enteras y, de los documentos, los fragmentos
  que responden con su página. Si hace falta más, usa `leer`.
- `leer` da el texto por partes de 20.000 caracteres; sigue con `--desde`.
- Un documento recién subido tarda unos minutos en poder buscarse.
- Un PDF escaneado (solo imagen) no tiene texto: dilo y no inventes su contenido.

## Convertir documentos en conocimiento

Cuando te lo pidan (o en una tarea programada, p. ej. cada noche):

1. `$B pendientes` para ver los documentos sin nota.
2. Lee cada uno con `$B leer` (todas las partes).
3. Escribe una nota corta con lo esencial y proponla con `--fuente` apuntando al
   documento. Al aprobarla se guarda en la misma carpeta que el documento.
4. Un documento, una propuesta. No propongas dos veces el mismo documento:
   `pendientes` ya oculta los que tienen nota o propuesta.
5. Los CV de `Colaboradores/` **nunca** se convierten en notas: son datos personales y
   su perfil va por otra vía (`colaboradores_proponer_perfil`, skill `licitaciones`).
   `pendientes` no los lista y la propuesta de una nota con esa fuente o carpeta se
   rechaza.
6. Los pliegos que baja el radar (`Licitaciones/Radar/`) tampoco: los analiza la ficha de
   cada licitación (skill `licitaciones`). `pendientes` no los lista y una nota con esa
   fuente o esa carpeta se rechaza. Puedes leerlos con `leer`, pero no los propongas.

Para una **licitación** fuera de esas carpetas (p. ej. lo que hemos presentado, en
`Licitaciones/Presentadas/`) usa esta plantilla y deja en blanco lo que el pliego no diga:

```markdown
---
tipo: licitacion
organismo: Ayuntamiento de …
expediente: …
importe_sin_iva: 125000
fecha_limite: 2026-10-15
tags: [licitacion, limpieza]
---
# Objeto del contrato

- **Organismo:** …
- **Presupuesto base (sin IVA):** … € · **Valor estimado:** … €
- **Duración y prórrogas:** …
- **Plazo de presentación:** … (fecha y hora)
- **Criterios de adjudicación:** … (puntos de cada uno; juicio de valor vs. fórmulas)
- **Solvencia económica y técnica:** …
- **Garantías:** provisional … · definitiva …
- **Documentación y sobres:** …
- **Encaje con la empresa / riesgos:** …

Fuente: `Licitaciones/…/pliego.pdf` (págs. …)
```

Para otros documentos: título claro, 5–15 líneas con lo importante, datos
concretos con su página y `tags` en el frontmatter.
