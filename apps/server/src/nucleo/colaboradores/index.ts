// Arranque de colaboradores: trabajo «leer un CV» para Hermes, tools MCP y estado.
import { nucleo } from '../contexto.js';
import { nombreEmpresa } from '../empresa.js';
import { registrarTipoTrabajo } from '../colaTipos.js';
import { anadirHerramientas } from '../mcp/servidor.js';
import { registrarEstado } from '../estado.js';
import { herramientasColaboradores } from './tools.js';
import { instruccionesPerfilCv, PayloadPerfilCv, perfilRecibido } from './propuestas.js';
import { TIPO_PERFIL_CV } from './cvs.js';

// La lectura de CV va al perfil «licitaciones» de Hermes (el mismo destino que la criba): es quien prepara los
// equipos y no hace falta otra clave.
/** Cuántas personas y perfiles pendientes hay; sin nombres. */
function estadoColaboradores(): Record<string, unknown> {
  const db = nucleo().db;
  const porTipo = db.prepare('SELECT tipo, COUNT(*) AS n FROM personas WHERE activo = 1 GROUP BY tipo').all() as {
    tipo: string;
    n: number;
  }[];
  const pendientes = (
    db.prepare("SELECT COUNT(*) AS n FROM personas_propuestas WHERE estado = 'pendiente'").get() as { n: number }
  ).n;
  return { activos: Object.fromEntries(porTipo.map((f) => [f.tipo, f.n])), perfiles_pendientes: pendientes };
}

export function iniciarColaboradores(): void {
  registrarTipoTrabajo(TIPO_PERFIL_CV, {
    destino: () => nucleo().config.hermesLicitaciones,
    instrucciones: (p) => instruccionesPerfilCv(PayloadPerfilCv.parse(p), nombreEmpresa(nucleo().db)),
    hecho: (p) => {
      const { cv_ruta, pedida_en } = PayloadPerfilCv.parse(p);
      return perfilRecibido(nucleo().db, cv_ruta, pedida_en);
    },
  });
  anadirHerramientas(herramientasColaboradores);
  registrarEstado('colaboradores', estadoColaboradores);
}
