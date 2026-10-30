# Preguntas frecuentes

Respuestas cortas a lo que más se pregunta antes de instalar y al empezar a usar Sobre Abierto, con el enlace a la
página que lo explica entero.

## General

**¿Qué hace y qué no hace?**
Vigila la Plataforma de Contratación del Sector Público (PLACSP), criba lo que encaja con tu empresa y te ayuda a
preparar la oferta. No presenta la oferta por ti: genera los documentos, y una persona los firma y los sube a la
plataforma del órgano de contratación. Las pantallas, una a una, están en [Guía de uso](../guia/README.md).

**¿Funciona fuera de España?**
No. Está pensada para la contratación pública española: PLACSP, códigos CPV, DEUC, clasificación de contratistas y la
LCSP. La interfaz y los textos que genera la IA están en español.

**¿La IA decide algo?**
No. La IA lee pliegos, propone fichas, redacta borradores y critica; el código comprueba los hechos y una persona
decide si se presenta, a qué precio y con qué equipo. Lo que la IA propone queda registrado como propuesta, no como
decisión.

**¿Se envían mis datos a alguien?**
No hay telemetría. Las únicas conexiones de salida son las que configuras: las fuentes públicas, tu proveedor de IA,
tu SMTP y, si lo activas, Google Drive. Tu proveedor de IA recibe los textos que Hermes le manda en cada trabajo
(pliegos, perfil de la empresa y borradores); si eso no es aceptable, usa un modelo local.

## Instalación

**¿Qué servidor necesito?**
Linux (amd64 o arm64) con Docker 24 o posterior y Compose v2, 6 GB de memoria como mínimo (8 GB recomendados), 2 CPU y
20 GB de disco. Un VPS modesto basta. Ver [Instalación](../empezar/instalacion.md).

**¿Puedo usar un modelo local, sin pagar a un proveedor?**
Sí: `LLM_PROVEEDOR=local` con `LLM_URL` apuntando a cualquier servidor compatible con la API de OpenAI (Ollama, LM
Studio…). La calidad de las fichas y de la memoria técnica depende mucho del modelo; para el perfil de oferta se
recomienda uno de los mejores que puedas usar.

**¿Por qué tres perfiles de Hermes?**
Cada uno lleva su modelo y solo sus herramientas. El de `licitaciones` hace el trabajo de volumen (criba, fichas) y
conviene que sea barato; el de `oferta-licitaciones` redacta, y el de `critico-licitaciones` evalúa la memoria sin
conocer al redactor. El crítico debe ser de **otra familia** de modelos: uno que se evalúa a sí mismo tiende a darse
buena nota.

**¿Necesito Google Drive?**
No. Sin Drive, la Biblioteca y las carpetas de cada licitación están en el disco del servidor, y todo funciona igual.
Drive añade la sincronización con las carpetas del equipo y, con `GDRIVE_BACKUP=1`, una copia de seguridad diaria.

**¿Puedo instalarlo sin dominio?**
Sí, en local o detrás de un túnel SSH (`ssh -L 3110:127.0.0.1:3110 usuario@servidor`). Para abrirlo a Internet
necesitas un dominio y HTTPS: la web lleva contraseñas.

## Uso

**No me llegan oportunidades.**
Mira Ajustes › Fuentes y filtros: si siguen los CPV de ejemplo, cámbialos por los tuyos. La sincronización con la PLACSP
corre cada 15 minutos y el histórico se carga en segundo plano. Si hay oportunidades pero ninguna encaja, revisa el
perfil de la empresa: es lo que Hermes compara con cada pliego.

**La IA no hace nada.**
Los trabajos esperan si falta el modelo o la clave de un perfil, si el proveedor ha llegado a su límite de uso (la cola
se pausa 30 minutos) o si Hermes tiene una lista de herramientas anterior a la última actualización. Ajustes › Hermes
lo dice con el motivo. Ver [Reiniciar Hermes](../operar/reiniciar-hermes.md).

**¿Cuánto cuesta cada licitación?**
Depende del modelo. Una ficha completa gasta entre 0,4 y 1 millón de tokens; la memoria técnica, bastante más. Cada
trabajo guarda el modelo y los tokens, así que puedes medir tu caso con cinco licitaciones (ver
[Cuánto cuesta una licitación](../empezar/instalacion.md#cuánto-cuesta-una-licitación)).

**Los plazos no coinciden con mi hora.**
Los plazos de la PLACSP son siempre en hora peninsular. Si la zona horaria de tu empresa (Ajustes › Empresa) es otra,
la web añade tu hora local junto a la peninsular.

**¿Puede editar mi equipo la oferta al mismo tiempo?**
Los documentos generados se editan donde ya trabajáis (Word, Drive); la plataforma guarda decisiones, estado y
comentarios con menciones. Los roles (`admin`, `editor`, `lector`) limitan quién puede cambiar qué, y el precio solo lo
decide un administrador.

## Datos y seguridad

**¿Dónde están mis datos?**
En dos bases SQLite del volumen `plataforma_data` (usuarios, perfil de la empresa, ofertas, memorias, cola de IA) y en
el volumen `hermes_data` (la Biblioteca, las carpetas de cada licitación y los perfiles de Hermes). El histórico de la
PLACSP se puede volver a descargar. La copia de seguridad está en [Copias de seguridad y restauración](../operar/copias-y-restauracion.md).

**¿Qué ve el agente de IA?**
Solo lo que sus herramientas MCP le dejan ver, según sus permisos ([Servidor MCP](mcp.md)). Los datos de CV solo llegan al
perfil de oferta. El crítico de la memoria recibe un paquete anonimizado y no puede leer la Biblioteca.

**He encontrado una vulnerabilidad.**
Avisa de forma privada siguiendo [SECURITY.md](../../.github/SECURITY.md); no abras una incidencia pública.

## Licencia

**¿Puedo usarlo en mi empresa?**
Sí, con la [AGPL-3.0-or-later](../../LICENSE). Si ofreces a otras personas, por red, una versión modificada, debes darles
su código fuente; el pie de la aplicación enlaza al código. Usarlo sin modificar dentro de tu
empresa no te obliga a nada más.

**¿Puedo usar el nombre y el logo?**
Para decir que usas el software, sí; para presentar un producto propio como Sobre Abierto, no. Ver
[TRADEMARKS.md](../../TRADEMARKS.md).
