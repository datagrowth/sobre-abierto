// Base de datos del núcleo (nucleo.db): lo que comparten todos los dominios.
// SQLite en modo WAL: varios hilos del mismo proceso pueden escribir por turnos.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { rellenarIdentidad } from './organizaciones.js';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizaciones (
  nif TEXT PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL,
  dir3 TEXT, ciudad TEXT, nuts TEXT, actualizada_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS organizaciones_nombre ON organizaciones(nombre);
-- Miembros de cada UTE (identidad.ts): por nombre como lo publica el órgano y, si se casa sin
-- dudas con una sola empresa conocida por su nombre canónico, con su NIF.
CREATE TABLE IF NOT EXISTS ute_miembros (
  ute_nif TEXT NOT NULL, miembro_nombre TEXT NOT NULL, miembro_canonico TEXT NOT NULL, miembro_nif TEXT, porcentaje REAL,
  PRIMARY KEY (ute_nif, miembro_canonico));
CREATE INDEX IF NOT EXISTS ute_miembros_miembro ON ute_miembros(miembro_nif);
CREATE INDEX IF NOT EXISTS ute_miembros_canonico ON ute_miembros(miembro_canonico) WHERE miembro_nif IS NULL;
CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY, ruta TEXT NOT NULL UNIQUE, dominio TEXT NOT NULL, origen_url TEXT,
  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, registrado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, dominio TEXT NOT NULL, recurso TEXT,
  datos TEXT NOT NULL, creado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS eventos_tipo ON eventos(tipo, id);
CREATE TABLE IF NOT EXISTS trabajos_ia (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, dominio TEXT NOT NULL, clave TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL, estado TEXT NOT NULL, run_id TEXT, intentos INTEGER NOT NULL DEFAULT 0,
  error TEXT, proximo_intento_en TEXT, creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trabajos_estado ON trabajos_ia(estado, id);
CREATE TABLE IF NOT EXISTS auditoria_agentes (
  id INTEGER PRIMARY KEY, agente TEXT NOT NULL, herramienta TEXT NOT NULL, dominio TEXT NOT NULL,
  recurso TEXT, resultado TEXT NOT NULL, creado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS auditoria_agente ON auditoria_agentes(agente, id);
CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1,
  cv_ruta TEXT, datos TEXT NOT NULL, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS personas_propuestas (
  id INTEGER PRIMARY KEY, persona_id INTEGER, cv_ruta TEXT NOT NULL, estado TEXT NOT NULL, datos TEXT NOT NULL,
  agente TEXT NOT NULL, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL, revisada_en TEXT);
CREATE INDEX IF NOT EXISTS personas_propuestas_estado ON personas_propuestas(estado, cv_ruta);
-- Perfiles que una oferta se comprometió a incorporar sin nombrar a nadie: uno por (dominio, recurso, clave).
CREATE TABLE IF NOT EXISTS perfiles_a_incorporar (
  id INTEGER PRIMARY KEY, dominio TEXT NOT NULL, recurso TEXT NOT NULL, clave TEXT NOT NULL, estado TEXT NOT NULL,
  candidato_id INTEGER, datos TEXT NOT NULL, creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL, UNIQUE (dominio, recurso, clave));
CREATE TABLE IF NOT EXISTS perfil_empresa (id INTEGER PRIMARY KEY CHECK (id = 1), datos TEXT NOT NULL, actualizado_en TEXT NOT NULL);
-- Aparte de perfil_empresa a propósito: ni perfilParaAgentes ni plataforma_empresa lo leen y un agente no lo puede proponer.
CREATE TABLE IF NOT EXISTS perfil_costes (id INTEGER PRIMARY KEY CHECK (id = 1), datos TEXT NOT NULL, actualizado_en TEXT NOT NULL);
-- La marca de la instalación (Ajustes › Marca, marca.ts): una fila; sin ella, la neutra. El logo, en binario
-- para que vaya en la copia de las bases.
CREATE TABLE IF NOT EXISTS marca (id INTEGER PRIMARY KEY CHECK (id = 1), nombre TEXT NOT NULL, tema TEXT NOT NULL,
  logo BLOB, logo_tipo TEXT, logo_hash TEXT, actualizado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS perfil_empresa_propuesta (
  id INTEGER PRIMARY KEY CHECK (id = 1), datos TEXT NOT NULL, agente TEXT NOT NULL, motivo TEXT NOT NULL, propuesto_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operaciones_unicas (
  clave TEXT PRIMARY KEY, estado TEXT NOT NULL, datos TEXT NOT NULL, actualizada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_huellas (agente TEXT PRIMARY KEY, huella TEXT NOT NULL, desde TEXT);
-- huella: la de la lista que se le sirvió; listado_en vacío: se dio por cargada al ver al agente por primera vez.
CREATE TABLE IF NOT EXISTS mcp_listados (agente TEXT PRIMARY KEY, huella TEXT NOT NULL, listado_en TEXT);
-- Estado de la cola que debe sobrevivir a un reinicio: la pausa por el límite de uso y las reactivaciones a mano.
CREATE TABLE IF NOT EXISTS cola_marcas (clave TEXT PRIMARY KEY, valor TEXT NOT NULL, actualizada_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trabajos_tipo ON trabajos_ia(tipo, id);
-- Documentos de la empresa que valen para cualquier oferta (certificados, escrituras, CV...): la ruta es
-- única porque es el archivo de la biblioteca; caduca_en avisa antes de que venza lo que se presenta.
CREATE TABLE IF NOT EXISTS empresa_documentos (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('certificado','rolece','aeat','tgss','escritura','seguro','titulo','cv','otro')),
  nombre TEXT NOT NULL, ruta TEXT NOT NULL UNIQUE, persona_id INTEGER, emitido_en TEXT, caduca_en TEXT,
  horas_desglosadas INTEGER NOT NULL DEFAULT 0, notas TEXT NOT NULL DEFAULT '', actualizado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS empresa_documentos_caduca ON empresa_documentos(caduca_en);
-- Cada run lanzado (los reintentos y relanzamientos de un trabajo, uno por fila): los topes por
-- oferta cuentan runs, y trabajos_ia.lanzado_en solo guarda el último.
CREATE TABLE IF NOT EXISTS trabajos_lanzamientos (trabajo_id INTEGER NOT NULL, lanzado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trabajos_lanzamientos_en ON trabajos_lanzamientos(trabajo_id, lanzado_en);
CREATE TRIGGER IF NOT EXISTS trabajos_lanzamientos_borrar AFTER DELETE ON trabajos_ia
  BEGIN DELETE FROM trabajos_lanzamientos WHERE trabajo_id = OLD.id; END;
-- Sesiones del servidor cerradas antes de caducar (nucleo/autenticacion.ts), hasta expira_ms.
CREATE TABLE IF NOT EXISTS sesiones_revocadas (id TEXT PRIMARY KEY, expira_ms INTEGER NOT NULL);
-- Personas que entran en la web (nucleo/usuarios.ts). contrasena_en: las sesiones abiertas antes
-- de cambiar la contraseña dejan de valer. avisos: las preferencias de aviso de cada persona (JSON).
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','editor','lector')), hash TEXT NOT NULL,
  debe_cambiarla INTEGER NOT NULL DEFAULT 1, activo INTEGER NOT NULL DEFAULT 1, avisos TEXT NOT NULL DEFAULT '{}',
  contrasena_en TEXT NOT NULL, ultimo_acceso TEXT, creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL);
-- El resumen semanal por email (nucleo/avisos.ts): a quién llega (ids de usuarios), qué día (1 lunes … 7
-- domingo) y a qué hora (en la zona de la empresa), y qué lleva. Una sola fila; sin ella, lo de por defecto.
CREATE TABLE IF NOT EXISTS avisos_config (
  id INTEGER PRIMARY KEY CHECK (id = 1), destinatarios TEXT NOT NULL, dia INTEGER NOT NULL, hora INTEGER NOT NULL,
  secciones TEXT NOT NULL, actualizado_en TEXT NOT NULL);
-- Cada aviso enviado (o que no se pudo enviar), una vez: la clave dice cuál («resumen:2026-W44»…).
CREATE TABLE IF NOT EXISTS avisos_enviados (clave TEXT PRIMARY KEY, tipo TEXT NOT NULL, destinatarios INTEGER NOT NULL, estado TEXT NOT NULL, en TEXT NOT NULL);
-- El enlace del calendario ICS de cada persona (nucleo/calendario.ts): solo el hash del token.
CREATE TABLE IF NOT EXISTS calendario_tokens (
  usuario_id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, creado_en TEXT NOT NULL, ultimo_uso TEXT);
-- Tokens de la API de lectura (nucleo/apiLectura.ts): uno por integración, solo su sha256.
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, creado_por TEXT NOT NULL, creado_en TEXT NOT NULL,
  ultimo_uso TEXT, revocado_en TEXT);
-- Comentarios de la web (nucleo/comentarios.ts): de qué recurso de qué dominio, en qué sitio (entidad:
-- oferta, bloqueo o requisito, con su clave en entidad_id), quién y a quién menciona (ids, JSON).
CREATE TABLE IF NOT EXISTS comentarios (
  id INTEGER PRIMARY KEY, dominio TEXT NOT NULL, recurso TEXT NOT NULL, entidad TEXT NOT NULL, entidad_id TEXT NOT NULL DEFAULT '',
  usuario_id INTEGER, autor TEXT NOT NULL, texto TEXT NOT NULL, menciones TEXT NOT NULL DEFAULT '[]',
  resuelto INTEGER NOT NULL DEFAULT 0, resuelto_por TEXT, resuelto_en TEXT, creado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS comentarios_recurso ON comentarios(dominio, recurso, id);
-- Cada mención, para el contador de quien la recibe (leida_en) y su email (avisada_en).
CREATE TABLE IF NOT EXISTS comentario_menciones (
  comentario_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, leida_en TEXT, avisada_en TEXT, PRIMARY KEY (comentario_id, usuario_id));
CREATE INDEX IF NOT EXISTS comentario_menciones_usuario ON comentario_menciones(usuario_id, leida_en);
`;

export function nucleoFile(dataDir: string): string {
  return path.join(dataDir, 'nucleo.db');
}

// Columnas añadidas después de crear las tablas: se crean al abrir una base anterior.
// trabajos_ia: cuándo se lanzó el run, sus métricas (modelo, tokens, llamadas, duración) y el
// código de su último fallo (para contar por qué fallan sin leer los mensajes), y desde cuándo
// puede haber un run suyo vivo (el más antiguo que no se pudo dar por terminado).
const COLUMNAS_NUEVAS: Record<string, Record<string, string>> = {
  trabajos_ia: {
    lanzado_en: 'TEXT',
    metricas: 'TEXT',
    codigo: 'TEXT',
    run_vivo_desde: 'TEXT',
    // a_mano: lo pidió una persona. relanzamientos: los colgados que se relanzaron solos sin gastar intento.
    a_mano: 'INTEGER NOT NULL DEFAULT 0',
    relanzamientos: 'INTEGER NOT NULL DEFAULT 0',
  },
  // identidad.ts: nombre_canonico agrupa los alias (alias: JSON con los nombres vistos),
  // nif_estado (valido, extranjero, no_valido) dice si el NIF sirve para agregar, es_ute marca
  // las UTE y provincia sale del código postal del órgano. nif_estado va la última: al crearla
  // se rellenan todas.
  organizaciones: {
    nombre_canonico: 'TEXT',
    alias: "TEXT NOT NULL DEFAULT '[]'",
    provincia: 'TEXT',
    es_ute: 'INTEGER NOT NULL DEFAULT 0',
    nif_estado: 'TEXT',
  },
};

// Al crear a_mano (DEFAULT 0), lo que una persona pidió antes quedaría como automático: perdería
// la ventaja de lo pedido a mano y contaría en los topes de la plataforma sola. Antes de la columna,
// lo pedido a mano llevaba la hora de la petición en la clave (`guion-<id>-<ISO>`…) y las memorias
// por apartados siempre las pedía una persona; lo automático lleva «-auto-» o no lleva hora.
const ISO_EN_CLAVE = "clave GLOB '*-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:*'";
const PREFIJOS_A_MANO = [
  'ficha-',
  'guion-',
  'decisiones-',
  'anexo-',
  'borrador-',
  'evaluar-',
  'resumen-competidor-',
  'subv-ficha-',
  'aprender-acta-',
];
const MARCAR_A_MANO = `UPDATE trabajos_ia SET a_mano = 1 WHERE clave NOT GLOB '*-auto-*' AND (
  (${ISO_EN_CLAVE} AND (${PREFIJOS_A_MANO.map((p) => `clave GLOB '${p}*'`).join(' OR ')}))
  OR clave GLOB 'memoria-*-v[0-9]*-a[0-9]*' OR clave GLOB 'eval-*')`;

// Lo que hay que hacer una sola vez con las filas de antes, cuando se crea la columna `tabla.col`.
// Se añade siempre al final.
const AL_CREAR: Record<string, string | ((db: Db) => void)> = {
  'trabajos_ia.a_mano': MARCAR_A_MANO,
  'organizaciones.nif_estado': rellenarIdentidad,
};

// `tabla` y `columnas` son nombres fijos del código, nunca entrada.
function anadirColumnas(db: Db): void {
  db.transaction(() => {
    for (const [tabla, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
      const existentes = new Set(
        (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name),
      );
      for (const [col, tipo] of Object.entries(columnas)) {
        if (existentes.has(col)) continue;
        db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`);
        const alCrear = AL_CREAR[`${tabla}.${col}`];
        if (typeof alCrear === 'string') db.exec(alCrear);
        else alCrear?.(db);
      }
    }
  }).immediate();
}

// Índices sobre columnas que añade la migración: van después de ella.
const INDICES_MIGRADOS = 'CREATE INDEX IF NOT EXISTS organizaciones_canonico ON organizaciones(nombre_canonico, tipo);';

/** Abre (y crea si hace falta) nucleo.db. Cada hilo abre su propia conexión. */
export function abrirNucleo(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(nucleoFile(dataDir));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  anadirColumnas(db);
  db.exec(INDICES_MIGRADOS);
  return db;
}

export function ahora(): string {
  return new Date().toISOString();
}
