# Memoria descriptiva de cómo se prestará el servicio
FICHERO/SOBRE 2.- Oferta técnica · Asistente de inteligencia artificial para quejas y sugerencias de la Oficina de Atención Ciudadana (CAUCE)

**Expediente:** 2026/SER-0042 CAUCE · **Órgano:** Junta de Gobierno Local del Ayuntamiento de Villaejemplo · **Licitadora:** Analítica Ejemplo, S.L. (NIF [NIF]) · **Fecha:** 6 de octubre de 2026

## Índice

- 1. Comprensión del servicio y diseño funcional (pág. 1)
- 2. Arquitectura, modelos de IA y protección de datos (pág. 3)
- 3. Plan de trabajo, calidad y pruebas (pág. 5)
- 4. Formación, documentación y continuidad (pág. 7)
- 5. Prototipo de las pantallas (pág. 8)

## 1. Comprensión del servicio y diseño funcional

### 1.1 Objeto y alcance

La empresa propone desarrollar la Fase 1 de CAUCE como una aplicación web que ayude a la Oficina de Atención Ciudadana a tramitar las quejas, sugerencias y reclamaciones (QSR) que recibe el Ayuntamiento de Villaejemplo. La herramienta leerá cada QSR, propondrá la materia y el servicio competente y preparará un borrador de respuesta para que lo revise el personal municipal.

CAUCE ayudará a reducir los tiempos de respuesta y a mejorar la calidad de las contestaciones, aprovechando las capacidades de la inteligencia artificial generativa. La decisión final será siempre de las personas: la herramienta no firmará ni enviará respuestas. El alcance no incluye integraciones con otros sistemas municipales, que se valorarán en fases posteriores (PPT, cláusulas 3.1 y 3.2).

### 1.2 Perfiles y recorrido

Se contemplan tres perfiles: tramitador de la OAC, técnico del servicio competente y responsable de Calidad. El tramitador revisa la QSR y la clasificación propuesta; el técnico revisa y completa el borrador; Calidad consulta los informes de seguimiento.

El recorrido será el siguiente: la QSR llega por la sede electrónica, el registro o el correo; CAUCE extrae los datos principales; propone la materia; el tramitador la confirma; se genera el borrador con referencias a la normativa municipal; el técnico lo revisa y lo firma en la plataforma de firma del Ayuntamiento.

Si falta información, la herramienta lo indicará para que el tramitador pueda pedirla a la persona interesada. Los plazos de respuesta se controlarán según lo que establezca el reglamento municipal aplicable.

### 1.3 Responsables y contraste con la OAC

Persona C, responsable de proyecto, coordinará el trabajo con la OAC y con el Servicio de Informática y convocará al inicio una reunión para conocer el funcionamiento actual de la oficina. Persona D, perfil de arquitectura e IA, definirá la solución técnica. Persona B desarrollará la aplicación y Persona A preparará las plantillas de respuesta y los casos de prueba.

Se mantendrán reuniones periódicas con los usuarios clave para validar los avances. Las decisiones se recogerán en actas.

### 1.4 Entregables y riesgos

Se entregarán el catálogo de materias, las plantillas de respuesta, la aplicación configurada y una guía funcional. Entre los riesgos identificados están la calidad variable de los escritos escaneados, los cambios en la normativa municipal y la disponibilidad de los usuarios clave. Para cada uno se definirán medidas de mitigación en el plan de proyecto.

La correspondencia entre cada dato del borrador y su fuente se comprobará en las pruebas con los casos que apruebe el Ayuntamiento.

## 2. Arquitectura, modelos de IA y protección de datos

### 2.1 Arquitectura propuesta

La solución se desplegará en una nube con certificación ENS de categoría media y centros de datos en la Unión Europea, que se acordará con el Servicio de Informática. Se compondrá de una interfaz web, una API en Python, una base de datos para los metadatos y las decisiones, un almacenamiento para los documentos, un buscador sobre la normativa municipal y un servicio de modelos de lenguaje.

El acceso se hará con las credenciales corporativas del Ayuntamiento. Persona D entregará durante el análisis el diagrama de componentes y los flujos de datos. La configuración se mantendrá en un repositorio para poder reproducir el despliegue.

### 2.2 Uso de la inteligencia artificial

La clasificación de las QSR se hará con un modelo de lenguaje de última generación, complementado con reglas cuando sea necesario. Para la redacción se usará un enfoque de generación aumentada por recuperación: el buscador encontrará los artículos de las ordenanzas relacionados con la QSR y el modelo los usará para preparar el borrador.

El borrador incluirá referencias a las normas en que se basa. Si el modelo no encuentra información suficiente, lo indicará para que el técnico complete la respuesta. La elección final del modelo y de la técnica de búsqueda se hará durante el proyecto, comparando alternativas con casos reales.

### 2.3 Protección de datos y seguridad

El tratamiento cumplirá el RGPD, la Ley Orgánica de Protección de Datos y el Esquema Nacional de Seguridad. Los datos personales se protegerán mediante medidas técnicas y organizativas adecuadas y los datos no se usarán para entrenar modelos. Se colaborará con la Delegada de Protección de Datos en lo que sea necesario.

El acceso a cada QSR se limitará a los perfiles autorizados. Se registrarán las acciones de los usuarios para su auditoría. Se aplicarán controles frente a la inyección de instrucciones en los textos que lleguen a la herramienta.

### 2.4 Indicadores

Se medirán el acierto de la clasificación, la calidad de los borradores y los tiempos de respuesta de la herramienta. Los valores objetivo se acordarán con el Ayuntamiento en la fase de análisis, a partir de una muestra de QSR históricas.

### 2.5 Entregables

Persona D entregará el diseño de la arquitectura, el análisis de riesgos de seguridad y la documentación de los flujos de datos. Persona B entregará el código de la aplicación y los scripts de despliegue. Persona A entregará el informe de evaluación del modelo con los resultados obtenidos en las pruebas.

Todos los entregables quedarán en los repositorios que indique el Ayuntamiento.

## 3. Plan de trabajo, calidad y pruebas

### 3.1 Metodología

El proyecto seguirá una metodología ágil con iteraciones de dos semanas. Al final de cada iteración se mostrará el avance a la OAC y se recogerán sus comentarios. Persona C mantendrá el tablero de tareas y el registro de riesgos.

### 3.2 Calendario

El proyecto durará cinco meses: un primer mes de análisis y diseño, dos meses de desarrollo y dos meses de piloto con la OAC y los servicios que designe el Ayuntamiento. El calendario detallado se ajustará en la reunión de arranque.

Los hitos principales serán la aprobación del diseño, la entrega de la primera versión, el paso a producción y el informe final del piloto.

### 3.3 Pruebas

Persona A preparará un conjunto de casos de prueba a partir de QSR históricas facilitadas por la OAC. Se harán pruebas funcionales, de calidad de la IA, de seguridad y de rendimiento. Los defectos se registrarán y se corregirán antes del paso a producción.

La aceptación dependerá de la conformidad del Ayuntamiento con los resultados de las pruebas y del piloto.

### 3.4 Riesgos y dependencias

El proyecto depende de que el Ayuntamiento facilite a tiempo las QSR de ejemplo, la normativa vigente, los accesos y la disponibilidad de los usuarios clave. Si hay retrasos, Persona C propondrá una replanificación al Ayuntamiento.

### 3.5 Calidad

Persona C revisará cada entrega antes de presentarla al Ayuntamiento y comprobará que cumple los requisitos del pliego de prescripciones técnicas. Las incidencias detectadas por los usuarios durante el piloto se clasificarán por gravedad y se resolverán en el menor plazo posible.

Al final del piloto se entregará un informe con los resultados de los indicadores y las mejoras propuestas para las fases siguientes.

## 4. Formación, documentación y continuidad

### 4.1 Formación

Se impartirán sesiones de formación a los tramitadores de la OAC, a los técnicos de los servicios piloto y al personal de Informática, adaptadas a cada perfil. Se entregará el material de las sesiones.

### 4.2 Documentación

Se entregarán el manual de usuario, el manual de administración, la documentación técnica y el código fuente, que quedará en propiedad del Ayuntamiento.

### 4.3 Soporte y continuidad

Durante los seis meses de soporte se atenderán las incidencias y consultas del Ayuntamiento según su criticidad. Al final del soporte se entregará la documentación necesaria para que el Ayuntamiento pueda continuar con la herramienta por sus propios medios.

## 5. Prototipo de las pantallas

### 5.1 Pantallas previstas

La aplicación tendrá, al menos, las siguientes pantallas: bandeja de QSR con su estado y plazo; ficha de la QSR con los datos extraídos; pantalla de clasificación con la materia propuesta; editor del borrador de respuesta con las referencias normativas; y un panel de seguimiento para Calidad.

La interfaz será sencilla, accesible y adaptada a la imagen corporativa del Ayuntamiento.

### 5.2 Validación del prototipo

Durante el análisis se presentará a la OAC un prototipo navegable de estas pantallas para recoger sus comentarios antes del desarrollo.
