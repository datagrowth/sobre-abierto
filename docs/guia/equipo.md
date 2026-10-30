# Equipo

Equipo guarda a las personas, de la casa o externas, con lo que pueden acreditar en una licitación. Sirve para saber a
quién proponer cuando un pliego pide un perfil concreto y quién está ya ocupado.

<!-- captura: equipo · La ficha de una persona ficticia con lo que acredita y dónde está -->

**Equipo** (`colaboradores` en el MCP). Personas del equipo y externas con lo que pueden
acreditar en una licitación: rol, titulaciones, certificaciones, años de experiencia,
sectores y CPV con experiencia, tecnologías y habilidades, idiomas con nivel, **horas de
docencia por materia** (horas, años y evidencia: «IA generativa · 160 h · 2024-2026 · CV,
pág. 3»), tarifa opcional, su CV en `Conocimiento/Colaboradores/` y notas. Cuatro pestañas:
Personas, Buscar por requisito, CV por revisar y A incorporar.

- **Personas:** lista con filtros (equipo o externos, texto, inactivos) y la ficha al
  lado; alta y edición a mano; «Dar de baja» las saca de las búsquedas sin borrarlas y
  «Borrar» elimina sus datos y sus perfiles leídos, también los rechazados (el CV
  sigue en Drive).
- **Disponibilidad calculada**, no declarada: con un contrato ganado en ejecución, «No
  disponible» (hasta su fin, si se conoce); con dos o más ofertas en curso (en preparación o
  presentadas), «Parcial»; si no, «Disponible». Sale del equipo de las decisiones de cada oferta.
- **Ficha:** lo que acredita (la docencia con su evidencia), **dónde está** (cada oferta con su
  rol y estado, o el contrato en ejecución) y cuántas ofertas resueltas se ganaron con ella.
  Avisa si su **CV se leyó hace más de 12 meses** o si hay un CV nuevo por revisar.
- **Alta desde CV:** el CV se sube a `Colaboradores/` y **Hermes** lo lee y propone el
  perfil (sin datos de contacto ni DNI; con las horas de docencia y la página del CV de cada
  una). Queda en **CV por revisar** hasta que alguien lo revisa, lo corrige si hace falta y
  lo aprueba (o lo rechaza). Si el CV es de alguien que ya está dado de alta, se actualiza su
  ficha y se conservan su tarifa y notas. «Releer CV con Hermes» repite la lectura y «Subir CV nuevo», en su
  ficha, sube su CV actualizado y lo enlaza a esa persona (sin duplicarla).
- **Buscar por requisito:** se pega un requisito de un pliego («Docente con al menos 150 h
  impartidas en IA en los 3 últimos años y titulación universitaria») y sale qué se puede
  comprobar (años, titulación, certificaciones, idiomas y horas de docencia en la materia y el
  periodo) y quién encaja, como en el bloque Equipo. Si nadie cumple, lleva a «A incorporar».
- **A incorporar:** los perfiles que una oferta se comprometió a incorporar sin nombrar a nadie,
  con los requisitos, la fecha límite para acreditarlo (con su cláusula) y el candidato.
  «Buscar candidatos» abre la búsqueda con sus requisitos, donde cada persona se puede proponer
  como candidato; «Marcar cubierto» lo da por resuelto.
- Son datos personales: no salen en los logs, y los eventos y la auditoría solo
  guardan el id de la persona (la ruta de un CV, como hash). Los CV de
  `Colaboradores/` nunca se convierten en notas de la Biblioteca, y un agente sin
  permiso para ver colaboradores no los encuentra ni los lee.
