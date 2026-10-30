# Correo, calendario y API de lectura

Las salidas de la plataforma hacia otras herramientas: el correo de los avisos, el calendario de plazos y la API de
lectura para BI. Cómo se configura cada una y cómo se prueba. Los comandos usan los atajos `$DC`, `$MON` y `$HB` de
[La instalación en producción](produccion.md#atajos-de-los-comandos).

## Correo (SMTP)

Los avisos por email (plazos, resoluciones, búsquedas guardadas, resumen semanal) salen por tu
SMTP. **Sin `SMTP_HOST` y `SMTP_REMITENTE` no sale ningún correo**; la plataforma funciona igual
y los avisos quedan apuntados como no enviados.

```env
SMTP_HOST=smtp.example.com
SMTP_PUERTO=587                 # 587 con STARTTLS (SMTP_TLS=0) o 465 con TLS (SMTP_TLS=1)
SMTP_TLS=0
SMTP_USUARIO=avisos@example.com
SMTP_CONTRASENA=...             # o una contraseña de aplicación si la cuenta tiene doble factor
SMTP_REMITENTE=Sobre Abierto <avisos@example.com>
APP_URL=https://plataforma.example.com   # enlaces de emails y calendario
```

Recrea el monitor. En **Ajustes › Avisos**, cada persona elige sus avisos y un `admin` configura
el resumen semanal con **Enviarme una prueba**. La contraseña no sale en la web ni en el log.

```bash
$DC logs $MON | grep -E 'aviso por email|email sin enviar' | tail -10
```

- `Invalid login` o `535`: usuario o contraseña mal (con doble factor, contraseña de aplicación).
- `wrong version number` o `self-signed certificate`: 465 va con `SMTP_TLS=1`, 587 con `0`.
- Emails sin botón: falta `APP_URL`. Alguien no recibe nada: su usuario no es un email de verdad
  o tiene el aviso apagado.

## Calendario de plazos (ICS)

Cada persona crea su enlace en **Ajustes › Integraciones › Calendario** y lo copia (solo se ve
esa vez; crear otro anula el anterior). En Google Calendar, **Otros calendarios › + › Desde
URL**. Necesita `APP_URL` para salir completo. Trae las ofertas en preparación. Los plazos de la
PLACSP van en hora peninsular con su zona (`TZID`): cada calendario los muestra en la suya.
Google refresca los calendarios suscritos cada pocas horas. Para probar un enlace:
`curl -s https://plataforma.example.com/cal/<token>.ics | head` empieza por `BEGIN:VCALENDAR`.

## API de lectura para BI

Un `admin` crea un token por integración en **Ajustes › Integraciones › API de lectura** (solo
se ve al crearlo). Solo lectura, por el dominio de la web y sin datos de personas, costes ni
documentos. `GET /api/v1` lista los recursos; cada respuesta trae `datos`, `total` y `siguiente`
(pásalo como `desde` hasta que sea `null`; `limite` hasta 5000). En Power BI: Obtener datos ›
**Web** › **Avanzada**, con el encabezado `Authorization: Bearer <token>`. El token va siempre en
la cabecera, nunca en la URL. `401 sin_token`: falta o se revocó; `405 solo_lectura`: intenta
escribir. Para probar: `curl -s -H "Authorization: Bearer $TOKEN" https://plataforma.example.com/api/v1`.
