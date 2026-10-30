// Arranque del núcleo de la plataforma: nucleo.db, tools MCP de la Biblioteca,
// colaboradores, estado, cola de trabajos de IA y el puente de eventos hacia la web.
import { instruccionesNota, notaRecibida, PayloadNota, TIPO_NOTA } from './bibliotecaGestion.js';
import type { Server as IOServer } from 'socket.io';
import { iniciarNucleo, nucleo } from './contexto.js';
import type { PlataformaConfig } from './config.js';
import { anadirHerramientas, listarHerramientas } from './mcp/servidor.js';
import { anotarHuellas } from './mcp/huellas.js';
import { herramientasBiblioteca } from './mcp/biblioteca.js';
import { iniciarColaboradores } from './colaboradores/index.js';
import { registrarEstado } from './estado.js';
import { registrarHoy } from './hoy.js';
import { hoyBiblioteca, hoyEmpresa, hoyEquipo } from './hoyNucleo.js';
import { estadoCola, resumenCola } from './colaConsultas.js';
import { registrarTipoTrabajo } from './colaTipos.js';
import { rellenarCodigos } from './colaEstadisticas.js';
import { vueltaCola } from './trabajos.js';
import { marcarVuelta, registrarProgramado, siguiente, ultimaVuelta, type Automatismo } from './programado.js';
import { escuchar } from './eventos.js';
import { agentesConocidos } from './agentes/registro.js';
import { usoAgentes } from './agentes/autenticacionAgentes.js';
import { estadoIndexador } from '../biblioteca/motor/documentos/servicioIndice.js';
import { estadoConversor, type ResumenConversor } from './documentos/libreoffice.js';
import { errorMessage } from './result.js';
import { configResumen, registrarAvisoPeriodico, vueltaAvisos } from './avisos.js';
import { avisarCaducidades } from './avisosEmpresa.js';
import { avisarMenciones } from './comentarios.js';
import { hayCorreo } from './correo.js';
import { nombreEmpresa, zonaEmpresa } from './empresa.js';
import { HORA_DE } from './fechas.js';
import { logger } from './log.js';

const COLA_MS = 30_000;
const VUELTA_COLA = 'nucleo.cola';
const AVISOS_MS = 60_000;
const VUELTA_AVISOS = 'nucleo.avisos';
const log = logger('plataforma');

// LibreOffice lo usan dos hilos (el indexador para los .doc, el servidor para los PDF de
// las memorias): el estado es uno y los contadores se suman.
function conversorDeBiblioteca(): ResumenConversor {
  const servidor = estadoConversor();
  const hilo = estadoIndexador().status?.conversor;
  if (!hilo) return servidor;
  return {
    estado: servidor.estado === 'sin_comprobar' ? hilo.estado : servidor.estado,
    version: servidor.version ?? hilo.version,
    en_cola: servidor.en_cola + hilo.en_cola,
    hechas: servidor.hechas + hilo.hechas,
    fallidas: servidor.fallidas + hilo.fallidas,
    ultima_ms: servidor.ultima_ms ?? hilo.ultima_ms,
  };
}

function colaIa(): Automatismo {
  const c = resumenCola(nucleo().db);
  const ultima = ultimaVuelta(VUELTA_COLA);
  const frenos = c.frenados.map((f) => `${f.tipo} hasta ${f.hasta}`).join('; ');
  const desfasados = c.desfasados.map((d) => d.agente).join(', ');
  const levantados = c.levantados_por_version;
  const detalle = [
    `${c.en_marcha} en marcha · ${c.pendientes} en espera`,
    c.pausa_hasta ? `en pausa por el límite de uso del modelo hasta ${c.pausa_hasta}` : null,
    frenos ? `frenado: ${frenos}` : null,
    desfasados
      ? `Hermes tiene la lista de herramientas de antes del despliegue (${desfasados}): reinicia Hermes`
      : null,
    levantados
      ? `freno levantado al desplegar una versión nueva (${levantados.desde}): ${levantados.tipos.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id: VUELTA_COLA,
    dominio: 'plataforma',
    nombre: 'Cola de IA',
    accion: null,
    que_hace: `Lanza en Hermes los trabajos pendientes (criba, fichas, borradores, evaluaciones…), ${nucleo().config.hermesRunsALaVez} a la vez, y comprueba si terminaron.`,
    cada: `${COLA_MS / 1000} s`,
    ultima,
    proxima: siguiente(ultima, COLA_MS),
    estado: c.pausa_hasta ? 'en_pausa' : c.frenados.length || c.desfasados.length ? 'frenado' : 'activo',
    detalle,
  };
}

function avisosEmail(): Automatismo {
  const ultima = ultimaVuelta(VUELTA_AVISOS);
  const cfg = configResumen(nucleo().db);
  const dia = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][cfg.dia - 1];
  return {
    id: VUELTA_AVISOS,
    dominio: 'plataforma',
    nombre: 'Avisos por email',
    accion: null,
    que_hace: `El resumen semanal (los ${dia} desde las ${cfg.hora}:00, ${HORA_DE[zonaEmpresa(nucleo().db)]}, a ${cfg.destinatarios.length} personas) y los avisos de cada persona: plazo a 48 h, resoluciones, búsquedas guardadas y caducidades.`,
    cada: `${AVISOS_MS / 1000} s`,
    ultima,
    proxima: siguiente(ultima, AVISOS_MS),
    estado: hayCorreo() ? 'activo' : 'en_pausa',
    detalle: hayCorreo()
      ? null
      : (nucleo().config.correoAviso ?? 'Sin SMTP: no sale ningún email (SMTP_HOST y SMTP_REMITENTE).'),
  };
}

/** `config` ya validada al arrancar (validarConfig), antes de escuchar. */
export function iniciarPlataforma(io: IOServer, config: PlataformaConfig): void {
  iniciarNucleo(config);
  // Los fallos de antes de la columna `codigo` también cuentan en las estadísticas de la cola.
  try {
    rellenarCodigos(nucleo().db);
  } catch (err) {
    log.error('códigos de trabajos sin rellenar', { error: errorMessage(err) });
  }
  anadirHerramientas(herramientasBiblioteca);
  iniciarColaboradores();
  // «Pedir nota» de la Biblioteca: al perfil de licitaciones, como la lectura de un CV.
  registrarTipoTrabajo(TIPO_NOTA, {
    destino: () => nucleo().config.hermesLicitaciones,
    instrucciones: (p) => instruccionesNota(PayloadNota.parse(p), nombreEmpresa(nucleo().db)),
    hecho: (p) => notaRecibida(nucleo().db, PayloadNota.parse(p)),
  });
  registrarEstado('biblioteca', () => ({ ...estadoIndexador(), conversor: conversorDeBiblioteca() }));
  registrarEstado('trabajos', () => estadoCola(nucleo().db));
  registrarHoy('empresa', () => hoyEmpresa(nucleo().db));
  registrarHoy('equipo', () => hoyEquipo(nucleo().db));
  registrarHoy('biblioteca', hoyBiblioteca);
  registrarEstado('agentes', () => {
    const uso = usoAgentes();
    return agentesConocidos(nucleo().config.agentesDir).map((a) => ({
      nombre: a.nombre,
      permisos: a.permisos,
      llamadas_ultimo_minuto: uso[a.nombre] ?? 0,
    }));
  });
  escuchar('*', (evento) => io.emit('plataforma', evento));
  registrarProgramado(VUELTA_COLA, colaIa);
  registrarAvisoPeriodico('nucleo.caducidades', (ms) => avisarCaducidades(nucleo().db, ms));
  registrarAvisoPeriodico('nucleo.menciones', () => avisarMenciones(nucleo().db));
  registrarProgramado(VUELTA_AVISOS, avisosEmail);
  setInterval(() => {
    marcarVuelta(VUELTA_AVISOS);
    vueltaAvisos(nucleo().db).catch((err: unknown) =>
      log.error('vuelta de avisos fallida', { error: errorMessage(err) }),
    );
  }, AVISOS_MS).unref();
  setInterval(() => {
    marcarVuelta(VUELTA_COLA);
    vueltaCola(nucleo().db, nucleo().config.hermesRunsALaVez).catch((err: unknown) =>
      log.error('vuelta de la cola fallida', { error: errorMessage(err) }),
    );
  }, COLA_MS).unref();
  log.info('plataforma iniciada', { datos: config.dataDir, agentes: agentesConocidos(config.agentesDir).length });
}

// Los permisos se releen en caliente (registro de agentes): la huella también, cada minuto.
const HUELLAS_MS = 60_000;
let anotando = false;

function anotarHuellasAhora(): void {
  if (anotando) return;
  anotando = true;
  const agentes = agentesConocidos(nucleo().config.agentesDir);
  anotarHuellas(nucleo().db, agentes, listarHerramientas)
    .catch((err: unknown) => log.error('huellas de herramientas sin anotar', { error: errorMessage(err) }))
    .finally(() => {
      anotando = false;
    });
}

/**
 * La huella de las herramientas MCP de cada agente (ver mcp/huellas.ts). Va después de que los
 * dominios registren las suyas: con solo las del núcleo, cada arranque parecería un cambio.
 */
export function anotarHuellasMcp(): void {
  anotarHuellasAhora();
  setInterval(anotarHuellasAhora, HUELLAS_MS).unref();
}
