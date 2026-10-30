// Resumen de las llamadas a herramienta de Hermes: categoría, sujeto y enmascarado de secretos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeToolCall, describeResult, redact } from '../../src/nucleo/hermes/actividadHerramientas.js';

test('should_name_the_skill_when_hermes_views_a_skill', () => {
  const d = describeToolCall('skill_view', { name: 'google-workspace' });
  assert.deepEqual([d.category, d.subject], ['skills', 'google-workspace']);
});

test('should_split_server_and_tool_when_the_tool_is_mcp', () => {
  const d = describeToolCall('mcp__notion__search', { query: 'x' });
  assert.deepEqual([d.category, d.subject], ['mcp', 'notion · search']);
});

test('should_show_the_command_when_hermes_uses_the_terminal', () => {
  const d = describeToolCall('terminal', {
    command: 'python /opt/data/skills/productivity/google-workspace/scripts/google_api.py drive list',
  });
  assert.equal(d.category, 'terminal');
  assert.match(d.subject, /^python \/opt\/data\/skills\/.+drive list$/);
});

test('should_treat_hermes_profile_cli_as_a_delegation', () => {
  const d = describeToolCall('terminal', { command: 'hermes -p disenador chat -q "haz un logo"' });
  assert.deepEqual(
    [d.category, d.subject, d.agent],
    ['delegation', 'Perfil disenador: haz un logo', 'profile:disenador'],
  );
});

test('should_use_first_task_goal_and_call_id_when_delegating_a_batch', () => {
  const d = describeToolCall('delegate_task', { tasks: [{ goal: 'Resumir informe' }, { goal: 'Otra' }] }, 'call_1');
  assert.deepEqual([d.category, d.subject, d.agent], ['delegation', 'Resumir informe (+1)', 'call_1']);
});

test('should_describe_web_browser_files_and_memory_calls', () => {
  assert.equal(describeToolCall('web_search', { query: 'precio luz' }).subject, 'precio luz');
  assert.equal(
    describeToolCall('web_extract', { urls: ['https://a.es', 'https://b.es'] }).subject,
    'https://a.es (+1)',
  );
  assert.equal(describeToolCall('browser_navigate', { url: 'https://example.com' }).category, 'browser');
  assert.equal(describeToolCall('read_file', { path: '/opt/data/documentos/MANUAL.md' }).subject, 'leer MANUAL.md');
  assert.equal(describeToolCall('memory', { action: 'add', target: 'user' }).subject, 'add (user)');
});

test('should_fall_back_to_a_known_argument_for_unmapped_tools', () => {
  const d = describeToolCall('kanban_create', { name: 'Tarea nueva' });
  assert.deepEqual([d.category, d.subject], ['other', 'Tarea nueva']);
});

test('should_never_expose_typed_text_or_file_contents', () => {
  assert.equal(describeToolCall('browser_type', { ref: 'e12', text: 'mi-contraseña' }).subject, 'escribir en e12');
  assert.doesNotMatch(describeToolCall('write_file', { path: 'a.txt', content: 'SECRETO' }).subject, /SECRETO/);
  const v4a =
    '*** Begin Patch\n*** Update File: /opt/data/agent-studio/INTAKE.md\n@@\n-viejo\n+SECRETO\n*** Add File: notas.md\n+hola\n*** End Patch';
  assert.equal(
    describeToolCall('patch', { mode: 'patch', patch: v4a }).subject,
    'editar /opt/data/agent-studio/INTAKE.md (+1)',
  );
});

test('should_mask_secrets_in_commands', () => {
  const d = describeToolCall('terminal', {
    // Secretos falsos: el test comprueba que se tapan.
    command: 'curl -H "Authorization: Bearer abcdef123456" https://x --token tk_999 API_KEY=sk-live123456789', // gitleaks:allow
  });
  assert.doesNotMatch(d.subject, /abcdef123456|tk_999|sk-live123456789/);
  assert.equal(redact('postgres://user:hunter2@db:5432'), 'postgres://user:•••@db:5432'); // trufflehog:ignore
});

test('should_mark_error_results_and_summarise_delegations', () => {
  assert.equal(describeResult('{"error": "no such file"}').status, 'error');
  assert.equal(describeResult('Traceback (most recent call last): …').status, 'error');
  assert.deepEqual(describeResult('{"output": "3 archivos"}'), { status: 'ok', result: '3 archivos' });
  const batch = describeResult(JSON.stringify({ results: [{ status: 'completed', summary: 'Hecho' }] }));
  assert.deepEqual(batch, { status: 'ok', result: 'Hecho' });
});

function ms(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

test('should_describe_huge_arguments_quickly', () => {
  // Las regex de secretos y de perfil de la CLI son cuadráticas: sin recortar la entrada,
  // estos argumentos (unos cientos de KB) tenían el servidor parado segundos.
  const perfil = ms(() => describeToolCall('terminal', { command: 'hermes '.repeat(60_000) }));
  const secretos = ms(() => describeToolCall('terminal', { command: 'KEY'.repeat(60_000) }));
  const resultado = ms(() => describeResult('x KEY'.repeat(60_000)));
  assert.ok(perfil < 200, `perfil: ${Math.round(perfil)} ms`);
  assert.ok(secretos < 200, `secretos: ${Math.round(secretos)} ms`);
  assert.ok(resultado < 200, `resultado: ${Math.round(resultado)} ms`);
});

test('should_not_leave_half_a_secret_when_cutting_a_long_argument', () => {
  const masked = redact(`${'a'.repeat(8185)} sk-ABCDEFGHIJKLMNOP`);
  assert.ok(!masked.includes('sk-ABC'));
  assert.equal(redact('token sk-ABCDEFGHIJKLMNOP'), 'token sk-•••');
});
