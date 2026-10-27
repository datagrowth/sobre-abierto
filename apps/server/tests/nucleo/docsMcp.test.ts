// docs/mcp.md se genera del registro de tools: si cambia una tool, un permiso o un parámetro,
// hay que volver a generarlo con «npm run docs:mcp -w @sobre-abierto/server».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ARCHIVO_MCP, generarDocumentoMcp } from '../../scripts/generarDocsMcp.js';

test('should_match_docs_mcp_with_registered_tools', () => {
  const actual = fs.readFileSync(ARCHIVO_MCP, 'utf8');
  assert.equal(
    actual,
    generarDocumentoMcp(),
    'docs/mcp.md desfasado: ejecuta npm run docs:mcp -w @sobre-abierto/server',
  );
});

test('should_list_tools_from_every_domain_in_docs_mcp', () => {
  const doc = generarDocumentoMcp();
  for (const nombre of ['biblioteca_buscar', 'licitaciones_ficha', 'colaboradores_buscar', 'plataforma_estado'])
    assert.ok(doc.includes(`\`${nombre}\``), `falta ${nombre}`);
});
