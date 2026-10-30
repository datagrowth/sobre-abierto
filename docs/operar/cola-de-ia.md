# Cola de IA

Cómo se reparten los trabajos de IA, qué los frena y qué hacer cuando uno espera. Al final, las variables de la
memoria técnica.

Cada tarea de IA es un trabajo en la cola (`nucleo.db`). Se ve en la pastilla **Hermes** de la
barra lateral y en **Ajustes › Hermes**; un agente la lee con `plataforma_trabajos`.

- **Topes:** `HERMES_RUNS_A_LA_VEZ` (1-8; más es más rápido pero agota antes el cupo y la memoria
  de Hermes), `LICITACIONES_RUNS_OFERTA_DIA` (runs automáticos por oferta en 24 h, contra bucles;
  lo pedido a mano sale igual), `LICITACIONES_PROPUESTAS_DIA` y `LICITACIONES_ACTAS_MERCADO_DIA`.
- **Apagar lo automático:** `LICITACIONES_ACTIVO=0` (ingesta), `LICITACIONES_CRIBAS_DIA=0`
  (criba), `LICITACIONES_FICHA_AUTO=0` (fichas). No hay un botón que pare toda la cola.
- **Plazos:** no se pide a Hermes un trabajo que acabaría dentro de las
  `LICITACIONES_MARGEN_FIRMA_HORAS` (2) previas al plazo, reservadas para firmar y presentar.

| `motivo_espera` | Qué hacer |
|---|---|
| `pausa_limite` | el proveedor dio límite de uso (429); la cola sigue sola a la hora de `pausa_hasta` |
| `freno` | su tipo falló tres veces seguidas: arregla la causa y relanza a mano (una versión nueva del monitor también lo levanta; un reinicio, no) |
| `espera_herramienta` | Hermes tiene las herramientas de antes del despliegue: «Reiniciar Hermes» |
| `reintento` | espera su próximo intento (2, 4 y 8 minutos) |
| `tope_oferta` | la oferta agotó sus runs de 24 h: mira qué se repite o sube el tope |
| `sin_perfil` | falta el perfil de Hermes de ese tipo (`HERMES_*_URL` y `_KEY`) |
| `cola`, `plazo_cercano` | espera su turno; las ofertas en sus últimas horas van primero |

Pausas y frenos sobreviven a los reinicios. Un trabajo que pasa 10 minutos sin llamar a ninguna
herramienta se corta y se reintenta; **¿Colgado? Parar y relanzar** lo hace sin esperar.

## Memoria técnica

La memoria técnica se redacta por fases: dossier → estrategia → ficha de solución → redacción entera →
crítico ciego → corrección de hechos → rondas. Variables principales: `LICITACIONES_MEMORIA_UMBRAL`
(0.9) y `LICITACIONES_MEMORIA_RONDAS` (3, de 0 a 3): la memoria se ensambla cuando el crítico da esa
parte de los puntos o se acaban las rondas. El crítico (`HERMES_OFERTA_CRITICO_URL` y `_KEY`) debe usar
otro modelo que el que redacta. `LICITACIONES_PRECIO_HORA`, opcional, enseña a la persona los
euros de cada compromiso; nunca llega a los agentes. El diseño está en [Memoria técnica](../como-esta-hecho/memoria-tecnica.md).
