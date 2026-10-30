# Primeros pasos

Lo que hay que hacer después de instalar para que el radar empiece a trabajar para tu empresa: contar quién eres,
decir qué licitaciones buscar, conectar la IA y revisar la primera criba. Lo que más tiempo lleva es reunir los datos
de la empresa.

Antes de empezar necesitas la web abierta y entrar como administrador, con el correo y la contraseña que te dio el
instalador ([Instalación](instalacion.md#primer-acceso)). Todo se hace en **Ajustes**, al pie de la barra lateral.

<!-- captura: primeros-pasos · El Pipeline vacío con la tarjeta Primeros pasos y un botón Abrir por paso -->

## 1. Cuenta quién es tu empresa

Abre **Ajustes › Empresa** y rellena el perfil: nombre, NIF, región y zona horaria (península o Canarias; es la de
los avisos y la segunda hora de los plazos). Después, lo que la empresa puede acreditar: volumen de negocio por año,
clasificaciones, certificaciones, seguro de responsabilidad civil, plantilla media, años de actividad, CPV con
experiencia y el mayor contrato parecido de los últimos tres años. Si haces formaciones, pon tus **áreas de
formación**, y en **idiomas del equipo**, las lenguas que habláis: la criba descarta lo que pide otra.

Cuanto más completo esté, mejor criba Hermes: compara cada licitación con este perfil y, al leer los pliegos, decide
con él si cumples cada requisito. Al guardarlo se vuelven a evaluar las oportunidades abiertas. Si prefieres que lo
rellene un agente, Hermes o Claude Code pueden proponer un perfil completo; no cambia nada hasta que pulsas **Cargar
en el formulario**, lo revisas y lo guardas.

Hermes lee además una nota de la Biblioteca, `Empresa/perfil-licitaciones.md`, con qué hacéis y qué tenéis, en
vuestras palabras. Súbela como markdown a la carpeta `Empresa` de la Biblioteca (o déjala en esa carpeta de Drive).
**Sin esa nota no hay criba**: las candidatas esperan en *Sin cribar* y las vistas de Licitaciones avisan de que
falta.

## 2. Elige qué licitaciones buscar

En **Ajustes › Fuentes y filtros** está el prefiltro que decide qué entra en Oportunidades. Una licitación abierta
pasa si casa por CPV o por palabra clave, está en el rango de importe, es de un tipo de contrato marcado y es del
territorio elegido.

- **Prefijos CPV**, separados por comas: «72» cubre todos los servicios TI; «79311», solo estudios. El buscador del
  vocabulario CPV ayuda: «72» ofrece la división y sus grupos, y una palabra («estadístic») los códigos que la dicen.
- **Palabras clave** en el título, sin importar tildes ni mayúsculas, y palabras que descartan.
- **Importe** por lote o del contrato, y **tipo de contrato**.
- **Comunidades autónomas** que te interesan; ninguna marcada es toda España.
- **Lenguas a descartar**, si no puedes presentar en catalán, euskera o gallego.

Mientras no los guardes, los filtros son de ejemplo y Oportunidades lo avisa con «Ajusta tus CPV». Mejor un prefiltro
amplio: lo que sobre lo descarta la criba. Al guardar, los filtros se aplican también a lo que ya esperaba en *Sin
cribar*. Cómo trata el prefiltro los lotes y el idioma está en [Radar de licitaciones](../guia/radar.md).

## 3. Conecta la IA

La IA corre en Hermes, con tres perfiles: `licitaciones` (criba, fichas y actas), `oferta-licitaciones` (guion,
memoria y anexos) y `critico-licitaciones` (el crítico de la memoria). Si el instalador ya los configuró con tu
proveedor, en **Ajustes › Hermes** los verás con su modelo. Si lo dejaste para después (`LLM_PROVEEDOR=ninguno`),
elige aquí el modelo de cada uno.

Qué modelo poner en cada perfil y cuánto cuesta una licitación está en
[Proveedor de IA](instalacion.md#proveedor-de-ia). Pon en el crítico un modelo de otra familia que el de la oferta:
con el mismo, tiende a darse buena nota y la web lo avisa. Después de cambiar un modelo,
[reinicia Hermes](../operar/reiniciar-hermes.md) para que lo use.

Sin la IA conectada la plataforma no se queda parada: el radar descarga y filtra, y los trabajos de IA esperan en la
cola hasta que haya un perfil.

## 4. Revisa la primera criba

La primera sincronización con la Plataforma de Contratación trae oportunidades en unos minutos, y después vuelve cada
15 minutos. El histórico de adjudicaciones se carga en segundo plano y alimenta los rankings de competidores y
organismos.

Hermes criba dos veces al día lo que pasa el prefiltro. Para no esperar, abre **Oportunidades** y pulsa **Cribar ahora**
en la cabecera. Cuando termine:

- **Por revisar** tiene lo que encaja o merece una mirada, con la opinión de Hermes («Encaja», «Encaja con dudas» o
  «No encaja») y su motivo en la fila.
- **Sin cribar** es lo que aún no ha visto la IA. Si crece y no baja, mira el paso 1 (la nota del perfil) y el 3.
- **Descartadas** guarda lo que descartó Hermes, con su motivo, por si quieres recuperar algo.

De lo que encaja, Hermes prepara la ficha sola: requisitos, criterios y riesgos, con la página del pliego. Desde la
fila, **Aplicar** lleva la licitación al Pipeline para preparar la oferta, y **Descartar** pide un motivo, que Hermes
lee para afinar las siguientes cribas. Las primeras cribas son las que más enseñan: si ves descartes que no te
convencen, completa el perfil y la nota antes de juzgar los resultados.

## 5. Lo opcional: Drive, correo y equipo

- **Google Drive.** Sin Drive, la Biblioteca y las carpetas de cada licitación están en el disco del servidor y todo
  funciona igual. Con Drive se sincronizan con tu cuenta y hay copia diaria. Los pasos, en
  [Google Drive](../operar/drive.md).
- **Correo.** Los avisos de plazos, resoluciones y el resumen semanal necesitan un SMTP
  ([Correo, calendario y API de lectura](../operar/correo-calendario-api.md)).
- **Personas.** Da de alta a tu equipo en **Ajustes › Usuarios y permisos**
  ([Usuarios y recuperación de acceso](../operar/usuarios-y-acceso.md)) y, en **Equipo**, a quienes vayas a proponer
  en las ofertas, a mano o desde su CV ([Equipo](../guia/equipo.md)).

## La tarjeta «Primeros pasos»

En una instalación nueva el Pipeline vacío lleva, antes del aviso «Ninguna oferta en curso»,
una tarjeta «Primeros pasos» con lo que falta para que el radar trabaje para la empresa: **el perfil de la empresa**
(Ajustes › Empresa: nombre, NIF, región y zona horaria), **qué licitaciones buscar** (Ajustes › Fuentes y filtros:
mientras los filtros sigan siendo los de ejemplo, el paso está pendiente), **la IA** (Hermes configurado, Ajustes ›
Hermes) y, marcado «opcional», **Google Drive** (Ajustes › Drive; sin Drive la Biblioteca y las carpetas de las
licitaciones viven en el disco del servidor y el radar, la ficha y la oferta funcionan igual). Cada paso pendiente
tiene un botón **Abrir** que va a su pestaña; la tarjeta no guarda nada por sí sola. Solo la ve un administrador, y
desaparece sola cuando están hechos los tres pasos obligatorios.

## Y ahora

La [Guía de uso](../guia/README.md) cuenta cada pantalla: cómo se trabaja una oportunidad en el
[Pipeline](../guia/pipeline.md), qué dice la [ficha](../guia/ficha-y-oferta/ficha.md) y cómo se
[prepara la oferta](../guia/ficha-y-oferta/preparar-la-oferta.md). Si algo no responde, mira la tabla de
[Si algo falla](instalacion.md#si-algo-falla).
