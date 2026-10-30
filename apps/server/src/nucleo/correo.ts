// Envío de email por el SMTP del correo de la empresa (SMTP_*), con nodemailer.
import nodemailer from 'nodemailer';
import { nucleo } from './contexto.js';
import type { PlataformaConfig } from './config.js';
import { logger } from './log.js';
import { errorMessage, fail, ok, type Result } from './result.js';

// TLS y STARTTLS verificando el certificado, autenticación y MIME bien hechos no se escriben a mano. Sin SMTP
// configurado no se envía nada y se dice. Al log van el tipo y cuántos, nunca las direcciones ni el contenido
// (PII).
const log = logger('correo');

export type Correo = { para: string; asunto: string; html: string; texto: string };
export type Enviar = (c: Correo) => Promise<Result<{ id: string }>>;

// Una cabecera no lleva saltos de línea: un asunto con uno inyectaría otras cabeceras.
const enUnaLinea = (t: string) => t.replace(/[\r\n]+/g, ' ').trim();
// El servidor de correo repite a veces la dirección que rechaza («<x@y.es>: Recipient rejected»).
export const sinEmails = (t: string) => t.replace(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g, '[email]');

function transporteDe(c: NonNullable<PlataformaConfig['correo']>): Enviar {
  const t = nodemailer.createTransport({
    host: c.host,
    port: c.puerto,
    secure: c.tls,
    requireTLS: !c.tls,
    ...(c.usuario ? { auth: { user: c.usuario, pass: c.contrasena ?? '' } } : {}),
  });
  return async (m) => {
    try {
      const r = await t.sendMail({
        from: c.remitente,
        to: m.para,
        subject: enUnaLinea(m.asunto),
        html: m.html,
        text: m.texto,
      });
      return ok({ id: String(r.messageId ?? '') });
    } catch (err) {
      return fail('correo_fallo', sinEmails(errorMessage(err)).slice(0, 200));
    }
  };
}

let probar: Enviar | null = null;

/** Para los tests: lo que se enviaría va aquí en vez de al SMTP (null lo quita). */
export function usarEnvioDePrueba(enviar: Enviar | null): void {
  probar = enviar;
}

export const hayCorreo = (): boolean => probar !== null || nucleo().config.correo !== null;

/** Envía un email; fail('sin_smtp') si no hay SMTP. El tipo solo es para el log. */
export async function enviarCorreo(c: Correo, tipo: string): Promise<Result<{ id: string }>> {
  const cfg = nucleo().config.correo;
  const enviar = probar ?? (cfg ? transporteDe(cfg) : null);
  if (!enviar) return fail('sin_smtp', 'El envío por email no está configurado (SMTP_HOST y SMTP_REMITENTE).');
  const r = await enviar(c);
  if (r.error) log.warn('email sin enviar', { tipo, codigo: r.error.code });
  return r;
}
