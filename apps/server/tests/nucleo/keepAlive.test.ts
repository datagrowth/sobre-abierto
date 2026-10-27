// El 502 intermitente de las tools MCP: Traefik reutiliza conexiones ociosas hasta 90 s y
// Node las cerraba a los 5 s. Node tiene que esperar más que el proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ajustarKeepAlive } from '../../src/nucleo/http.js';

const IDLE_TRAEFIK_MS = 90_000;

test('should_keep_idle_connections_open_longer_than_the_proxy', () => {
  const server = http.createServer();
  assert.ok(server.keepAliveTimeout < IDLE_TRAEFIK_MS, 'el valor por defecto de Node es el que daba 502');
  ajustarKeepAlive(server);
  assert.ok(server.keepAliveTimeout > IDLE_TRAEFIK_MS);
  assert.ok(server.headersTimeout > server.keepAliveTimeout, 'las cabeceras no cortan antes que la conexión ociosa');
});
