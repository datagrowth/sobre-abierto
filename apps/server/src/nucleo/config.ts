// Configuración de la plataforma (núcleo y dominios), validada al arrancar.
// Sin valores secretos por defecto: lo que falte deja la función apagada y lo dice.
import path from 'node:path';
import { z } from 'zod';
import { repositorioDelPaquete } from './paquete.js';
import { fail, ok, type Result } from './result.js';

const entero = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);

// Carpeta dentro de Conocimiento («Licitaciones/Radar»): segmentos que valen como nombre en
// Drive, Windows y Linux, sin ocultas ni «..», y nunca en Colaboradores (los CV).
// eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se descarta
const SEGMENTO = /^[^\\/:*?"<>|#^[\]\u0000-\u001f.][^\\/:*?"<>|#^[\]\u0000-\u001f]{0,79}$/;
const carpetaConocimiento = (def: string) =>
  z
    .string()
    .trim()
    .max(200)
    .refine(
      (s) => s.split('/').every((p) => SEGMENTO.test(p) && p.trim() === p),
      'carpeta relativa a Conocimiento, p. ej. «Licitaciones/Radar»',
    )
    .refine((s) => !/^colaboradores(\/|$)/i.test(s), 'Colaboradores es la carpeta de los CV')
    .default(def);

const Schema = z
  .object({
    PLATAFORMA_DATA_DIR: z.string().trim().min(1).optional(),
    HERMES_HOME: z.string().trim().min(1).optional(),
    SALIDAS_DIR: z.string().trim().min(1).optional(),
    AGENTES_DIR: z.string().trim().min(1).optional(),
    // Peticiones por minuto que puede hacer cada agente (MCP y API de la Biblioteca).
    AGENTES_PETICIONES_MINUTO: entero(120, 1, 100_000),
    HERMES_LICITACIONES_URL: z.url().optional(),
    HERMES_LICITACIONES_KEY: z.string().trim().min(16).optional(),
    // Perfil de Hermes para preparar ofertas (guion, memoria, anexos, evaluación), con un
    // modelo mejor que el de la criba y las fichas. Sin él, todo va al de licitaciones.
    HERMES_OFERTA_LICITACIONES_URL: z.url().optional(),
    HERMES_OFERTA_LICITACIONES_KEY: z.string().trim().min(16).optional(),
    // Perfil de Hermes del crítico ciego de la memoria, con otro modelo que el que redacta
    // (el mismo modelo se pone nota alta). Sin él, critica el perfil de oferta y se marca.
    HERMES_OFERTA_CRITICO_URL: z.url().optional(),
    HERMES_OFERTA_CRITICO_KEY: z.string().trim().min(16).optional(),
    LICITACIONES_ACTIVO: z.enum(['0', '1']).default('1'),
    // Runs de Hermes a la vez de toda la cola de IA: más es más rápido, pero gasta antes el cupo
    // del modelo y la memoria de Hermes.
    HERMES_RUNS_A_LA_VEZ: entero(2, 1, 8),
    LICITACIONES_SYNC_MINUTES: entero(15, 1, 24 * 60),
    LICITACIONES_CRIBAS_DIA: entero(2, 0, 24),
    LICITACIONES_LOTE_CRIBA: entero(40, 1, 100),
    LICITACIONES_MAX_PAGINAS: entero(10, 1, 500),
    LICITACIONES_FICHA_AUTO: z.enum(['0', '1']).default('1'),
    LICITACIONES_HISTORICO_TODO: z.enum(['0', '1']).default('0'),
    LICITACIONES_HISTORICO_DESDE: entero(2018, 2012, 2100),
    LICITACIONES_PRECIOS_MINIMO: entero(20, 5, 1000),
    // Horas que se dejan antes del plazo para revisar, firmar y subir la oferta: no se pide a
    // Hermes un trabajo que acabaría dentro de ese margen.
    LICITACIONES_MARGEN_FIRMA_HORAS: z.coerce.number().min(0).max(72).default(2),
    // Runs de Hermes por oferta en 24 h (lo pedido a mano no cuenta para frenar): un bucle de
    // reintentos o encadenados no puede gastar el cupo del modelo en una sola oferta. 40 deja
    // terminar una memoria con sus rondas de reescritura y el resto de la oferta.
    LICITACIONES_RUNS_OFERTA_DIA: entero(40, 5, 500),
    // Propuestas de decisiones que la plataforma pide sola por oferta en 24 h.
    LICITACIONES_PROPUESTAS_DIA: entero(3, 1, 20),
    LICITACIONES_ACTAS_MERCADO_DIA: entero(5, 0, 50),
    LICITACIONES_CARPETA_RADAR: carpetaConocimiento('Licitaciones/Radar'),
    LICITACIONES_CARPETA_PRESENTADAS: carpetaConocimiento('Licitaciones/Presentadas'),
    // La memoria se ensambla cuando el crítico le da al menos esta parte de los puntos…
    LICITACIONES_MEMORIA_UMBRAL: z.coerce.number().min(0.5).max(1).default(0.9),
    // …o cuando se acaban estas rondas de reescritura.
    LICITACIONES_MEMORIA_RONDAS: entero(3, 0, 3),
    // DEUC en XML (oferta/deuc.ts): apagado hasta comprobar a mano que el servicio DEUC lo importa.
    LICITACIONES_DEUC_XML: z.enum(['0', '1']).default('0'),
    // Opcional: con él, la ficha de solución enseña a la persona los euros de cada compromiso
    // (horas × precio). Nunca llega a los agentes: la memoria va en un sobre sin precios.
    LICITACIONES_PRECIO_HORA: z.coerce.number().positive().max(10_000).optional(),
    // Avisos por email por el SMTP del correo de la empresa, desde una cuenta del dominio.
    // Sin SMTP_HOST no se envía nada (los avisos quedan apuntados como no enviados).
    SMTP_HOST: z.string().trim().min(1).max(200).optional(),
    SMTP_PUERTO: entero(587, 1, 65_535),
    // 1: TLS desde la conexión (puerto 465); 0: STARTTLS obligatorio (587).
    SMTP_TLS: z.enum(['0', '1']).default('0'),
    SMTP_USUARIO: z.string().trim().min(1).max(200).optional(),
    SMTP_CONTRASENA: z.string().min(1).max(500).optional(),
    // Quién firma el email, p. ej. «Sobre Abierto · Acme <avisos@acme.example>».
    SMTP_REMITENTE: z.string().trim().min(3).max(200).optional(),
    // La dirección pública de la web (enlaces de los avisos y del calendario) y dónde está su código
    // fuente (aviso de la AGPL, sección 13; por defecto, el repositorio del package.json). Dependen del
    // despliegue; la marca (nombre, colores y logo) va en Ajustes › Marca.
    APP_URL: z.url({ protocol: /^https?$/ }).optional(),
    APP_SOURCE_URL: z.url({ protocol: /^https?$/ }).optional(),
  })
  .superRefine((v, ctx) => {
    // Si una estuviera dentro de la otra, la reorganización movería una carpeta a sí misma.
    const [a, b] = [v.LICITACIONES_CARPETA_RADAR.toLowerCase(), v.LICITACIONES_CARPETA_PRESENTADAS.toLowerCase()];
    if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['LICITACIONES_CARPETA_PRESENTADAS'],
        message: 'Radar y Presentadas deben ser carpetas distintas, ninguna dentro de la otra',
      });
    }
    // «Licitaciones» a secas es la estructura anterior, la que se reorganiza.
    if (a === 'licitaciones' || b === 'licitaciones') {
      ctx.addIssue({
        code: 'custom',
        path: ['LICITACIONES_CARPETA_RADAR'],
        message: 'Radar y Presentadas van dentro de una carpeta, no en «Licitaciones» a secas',
      });
    }
  });

export type PlataformaConfig = {
  dataDir: string;
  agentesDir: string;
  agentesPeticionesMinuto: number;
  // Carpeta de datos de Hermes (HERMES_HOME): de ahí se leen las tareas de cron de cada perfil.
  hermesHome: string;
  // Carpeta Salidas de Drive (borradores y entregables); null = sin redactor ni lectura de Salidas.
  salidasDir: string | null;
  hermesRunsALaVez: number;
  hermesLicitaciones: { url: string; key: string } | null;
  // Perfil de Hermes de la preparación de ofertas; null = usa el de licitaciones.
  hermesOferta: { url: string; key: string } | null;
  hermesOfertaAviso: string | null;
  // Perfil del crítico de la memoria; null = critica el de oferta (sin independencia).
  hermesCritico: { url: string; key: string } | null;
  hermesCriticoAviso: string | null;
  licitaciones: {
    activo: boolean;
    syncMinutos: number;
    cribasDia: number;
    loteCriba: number;
    maxPaginas: number;
    fichaAuto: boolean;
    // historicoTodo: guardar del histórico también lo que no es del sector (ocupa mucho más disco).
    historicoTodo: boolean;
    historicoDesde: number;
    preciosMinimo: number;
    margenFirmaHoras: number;
    // Topes por oferta y 24 h: runs automáticos y propuestas de decisiones pedidas solas.
    runsOfertaDia: number;
    propuestasDia: number;
    // Actas de expedientes ajenos que lee Hermes en 24 h cuando el código no basta; 0 = solo código.
    actasMercadoDia: number;
    // Carpetas dentro de Conocimiento: lo que baja el radar y lo que la empresa ha presentado.
    carpetaRadar: string;
    carpetaPresentadas: string;
    memoriaUmbral: number;
    memoriaRondas: number;
    precioHora: number | null;
    deucXml: boolean;
  };
  // El SMTP de los avisos; null = no se envía email. La contraseña no sale nunca de aquí (ni a Estado ni al log).
  correo: {
    host: string;
    puerto: number;
    tls: boolean;
    usuario: string | null;
    contrasena: string | null;
    remitente: string;
  } | null;
  correoAviso: string | null;
  // Para los enlaces de los avisos y del calendario; null = los avisos van sin botón.
  urlWeb: string | null;
  // El código fuente: null si no hay APP_SOURCE_URL ni repositorio en el package.json.
  fuente: string | null;
};

// Las variables vacías de Compose («VAR=») cuentan como no definidas.
function sinVacias(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''),
  );
}

function destino(url: string | undefined, key: string | undefined): { url: string; key: string } | null {
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

// Solo una de las dos variables de un perfil propio: se dice y se usa el de respaldo.
function avisoPerfil(
  nombre: string,
  url: string | undefined,
  key: string | undefined,
  respaldo: string,
): string | null {
  if (url && !key) return `${nombre}_URL sin KEY: ${respaldo}`;
  if (!url && key) return `${nombre}_KEY sin URL: ${respaldo}`;
  return null;
}

function correo(v: z.infer<typeof Schema>): PlataformaConfig['correo'] {
  if (!v.SMTP_HOST || !v.SMTP_REMITENTE) return null;
  return {
    host: v.SMTP_HOST,
    puerto: v.SMTP_PUERTO,
    tls: v.SMTP_TLS === '1',
    usuario: v.SMTP_USUARIO ?? null,
    contrasena: v.SMTP_CONTRASENA ?? null,
    remitente: v.SMTP_REMITENTE,
  };
}

function avisoCorreo(v: z.infer<typeof Schema>): string | null {
  if (v.SMTP_HOST && !v.SMTP_REMITENTE) return 'SMTP_HOST sin SMTP_REMITENTE: no se envían avisos por email';
  if (v.SMTP_USUARIO && !v.SMTP_CONTRASENA)
    return 'SMTP_USUARIO sin SMTP_CONTRASENA: el servidor de correo rechazará el envío';
  return null;
}

function aConfig(v: z.infer<typeof Schema>): PlataformaConfig {
  const hermesHome = v.HERMES_HOME ?? path.join(process.env.HOME ?? '.', '.hermes');
  return {
    dataDir: v.PLATAFORMA_DATA_DIR ?? path.resolve('.plataforma'),
    hermesHome,
    agentesDir: v.AGENTES_DIR ?? path.join(hermesHome, '.agentes'),
    agentesPeticionesMinuto: v.AGENTES_PETICIONES_MINUTO,
    salidasDir: v.SALIDAS_DIR ?? null,
    hermesRunsALaVez: v.HERMES_RUNS_A_LA_VEZ,
    hermesLicitaciones: destino(v.HERMES_LICITACIONES_URL, v.HERMES_LICITACIONES_KEY),
    hermesOferta: destino(v.HERMES_OFERTA_LICITACIONES_URL, v.HERMES_OFERTA_LICITACIONES_KEY),
    hermesOfertaAviso: avisoPerfil(
      'HERMES_OFERTA_LICITACIONES',
      v.HERMES_OFERTA_LICITACIONES_URL,
      v.HERMES_OFERTA_LICITACIONES_KEY,
      'la preparación de ofertas usa el perfil de licitaciones',
    ),
    hermesCritico: destino(v.HERMES_OFERTA_CRITICO_URL, v.HERMES_OFERTA_CRITICO_KEY),
    hermesCriticoAviso: avisoPerfil(
      'HERMES_OFERTA_CRITICO',
      v.HERMES_OFERTA_CRITICO_URL,
      v.HERMES_OFERTA_CRITICO_KEY,
      'la crítica de la memoria la hace el perfil de oferta',
    ),
    licitaciones: {
      activo: v.LICITACIONES_ACTIVO === '1',
      syncMinutos: v.LICITACIONES_SYNC_MINUTES,
      cribasDia: v.LICITACIONES_CRIBAS_DIA,
      loteCriba: v.LICITACIONES_LOTE_CRIBA,
      maxPaginas: v.LICITACIONES_MAX_PAGINAS,
      fichaAuto: v.LICITACIONES_FICHA_AUTO === '1',
      historicoTodo: v.LICITACIONES_HISTORICO_TODO === '1',
      historicoDesde: v.LICITACIONES_HISTORICO_DESDE,
      preciosMinimo: v.LICITACIONES_PRECIOS_MINIMO,
      margenFirmaHoras: v.LICITACIONES_MARGEN_FIRMA_HORAS,
      runsOfertaDia: v.LICITACIONES_RUNS_OFERTA_DIA,
      propuestasDia: v.LICITACIONES_PROPUESTAS_DIA,
      actasMercadoDia: v.LICITACIONES_ACTAS_MERCADO_DIA,
      carpetaRadar: v.LICITACIONES_CARPETA_RADAR,
      carpetaPresentadas: v.LICITACIONES_CARPETA_PRESENTADAS,
      memoriaUmbral: v.LICITACIONES_MEMORIA_UMBRAL,
      memoriaRondas: v.LICITACIONES_MEMORIA_RONDAS,
      deucXml: v.LICITACIONES_DEUC_XML === '1',
      precioHora: v.LICITACIONES_PRECIO_HORA ?? null,
    },
    correo: correo(v),
    correoAviso: avisoCorreo(v),
    urlWeb: v.APP_URL?.replace(/\/+$/, '') ?? null,
    fuente: v.APP_SOURCE_URL ?? repositorioDelPaquete(),
  };
}

/** La config del entorno; lanza si no es válida (para los tests y quien ya la validó). */
export function leerConfig(env: NodeJS.ProcessEnv = process.env): PlataformaConfig {
  return aConfig(Schema.parse(sinVacias(env)));
}

/**
 * La config del entorno sin lanzar, para el arranque. El error solo lleva los nombres de las
 * variables que no valen, nunca sus valores (pueden ser claves).
 */
export function validarConfig(env: NodeJS.ProcessEnv = process.env): Result<PlataformaConfig> {
  const v = Schema.safeParse(sinVacias(env));
  if (v.success) return ok(aConfig(v.data));
  return fail('config_invalida', [...new Set(v.error.issues.map((i) => i.path.join('.') || '(raíz)'))].join(', '));
}
