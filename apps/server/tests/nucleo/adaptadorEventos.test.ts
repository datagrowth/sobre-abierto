// Adaptación de los eventos de Hermes a elementos de actividad del gráfico en directo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server as IOServer } from 'socket.io';
import {
  adapt,
  buildActivity,
  messageActivities,
  setSessionParents,
  type ActivityItem,
  type PendingCalls,
} from '../../src/nucleo/hermes/adaptadorEventos.js';

// Socket.io es la frontera: se recogen los eventos emitidos.
function fakeIo() {
  const events: { name: string; payload: Record<string, unknown> }[] = [];
  const io = {
    emit: (name: string, payload: Record<string, unknown>) => {
      events.push({ name, payload });
      return true;
    },
    to: () => io,
  };
  return { io: io as unknown as IOServer, events };
}

const T0 = 1_790_000_000; // segundos, como en state.db

test('should_pair_tool_call_and_result_by_tool_call_id', () => {
  const pending: PendingCalls = new Map();
  const call = {
    role: 'assistant',
    timestamp: T0,
    tool_calls: [{ id: 'c1', function: { name: 'skill_view', arguments: '{"name":"google-workspace"}' } }],
  };
  const [started] = messageActivities('s1', call, pending);
  const [ended] = messageActivities(
    's1',
    { role: 'tool', tool_call_id: 'c1', timestamp: T0 + 2, content: 'ok' },
    pending,
  );

  assert.equal(started?.status, 'running');
  assert.equal(started?.subject, 'google-workspace');
  assert.equal(ended?.id, started?.id);
  assert.equal(ended?.status, 'ok');
  assert.equal(ended?.subject, 'google-workspace');
  assert.equal(ended?.endedAt, (T0 + 2) * 1000);
});

test('should_use_message_time_and_mark_failed_tools', () => {
  const items = buildActivity('s1', [
    { role: 'user', timestamp: T0, content: 'Lee la carpeta Agent Studio' },
    {
      role: 'assistant',
      timestamp: T0 + 1,
      tool_calls: JSON.stringify([{ id: 'c1', function: { name: 'terminal', arguments: { command: 'ls /nope' } } }]),
    },
    { role: 'tool', tool_call_id: 'c1', timestamp: T0 + 3, content: '{"error": "No such file"}' },
    { role: 'assistant', timestamp: T0 + 4, content: 'No existe la carpeta.' },
  ]);
  assert.deepEqual(
    items.map((i) => [i.kind, i.status]),
    [
      ['turn', 'ok'],
      ['tool', 'error'],
      ['reply', 'ok'],
    ],
  );
  assert.equal(items[0]?.at, T0 * 1000);
  assert.equal(items[1]?.subject, 'ls /nope');
});

test('should_mark_only_a_reply_without_tool_calls_as_final', () => {
  const items = buildActivity('s1', [
    { role: 'user', timestamp: T0, content: 'Prepara el informe' },
    {
      role: 'assistant',
      timestamp: T0 + 1,
      content: 'Voy a mirar la carpeta.',
      tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: '{"command":"ls"}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', timestamp: T0 + 2, content: 'ok' },
    { role: 'assistant', timestamp: T0 + 3, content: 'Hecho.' },
  ]);
  assert.deepEqual(
    items.filter((i) => i.kind === 'reply').map((i) => [i.subject, i.final]),
    [
      ['Voy a mirar la carpeta.', false],
      ['Hecho.', true],
    ],
  );
});

test('should_emit_activity_and_turn_status_when_messages_arrive_live', () => {
  const { io, events } = fakeIo();
  adapt(io, { sessionId: 'live-1', timestamp: T0, payload: { role: 'user', content: 'hola', timestamp: T0 } });
  adapt(io, {
    sessionId: 'live-1',
    timestamp: T0,
    payload: { role: 'assistant', content: 'hola!', finish_reason: 'stop', timestamp: T0 },
  });

  assert.deepEqual(
    events.map((e) => e.name),
    ['processing_start', 'activity', 'activity', 'processing_stop'],
  );
  const kinds = events.filter((e) => e.name === 'activity').map((e) => (e.payload as unknown as ActivityItem).kind);
  assert.deepEqual(kinds, ['turn', 'reply']);
});

test('should_attribute_a_new_subagent_session_to_its_delegation', () => {
  const { io, events } = fakeIo();
  const now = Date.now();
  adapt(io, {
    sessionId: 'parent-1',
    timestamp: now,
    payload: {
      role: 'assistant',
      timestamp: now,
      tool_calls: [{ id: 'd1', function: { name: 'delegate_task', arguments: { tasks: [{ goal: 'Resumir' }] } } }],
    },
  });
  adapt(io, {
    sessionId: 'child-1',
    timestamp: now,
    payload: {
      role: 'assistant',
      timestamp: now,
      tool_calls: [{ id: 'x1', function: { name: 'web_search', arguments: { query: 'datos' } } }],
    },
  });

  const child = events
    .filter((e) => e.name === 'activity')
    .map((e) => e.payload as unknown as ActivityItem)
    .find((i) => i.tool === 'web_search');
  assert.equal(child?.actor, 'd1');
  assert.equal(child?.sessionId, 'parent-1');
});

test('should_not_take_an_old_session_for_a_subagent_when_replaying_history', () => {
  const { io, events } = fakeIo();
  const now = Date.now();
  adapt(io, {
    sessionId: 'parent-2',
    timestamp: now,
    payload: {
      role: 'assistant',
      timestamp: now,
      tool_calls: [{ id: 'd2', function: { name: 'delegate_task', arguments: { goal: 'Algo' } } }],
    },
  });
  const old = now - 3_600_000;
  adapt(io, {
    sessionId: 'other-2',
    timestamp: old,
    payload: {
      role: 'assistant',
      timestamp: old,
      tool_calls: [{ id: 'y1', function: { name: 'execute_code', arguments: { code: 'print(1)' } } }],
    },
  });

  const item = events.map((e) => e.payload as unknown as ActivityItem).find((i) => i.tool === 'execute_code');
  assert.equal(item?.sessionId, 'other-2');
  assert.equal(item?.actor, 'hermes');
});

test('should_attribute_a_session_to_its_parent_when_hermes_reports_it', () => {
  const { io, events } = fakeIo();
  setSessionParents([{ id: 'child-3', parent_session_id: 'parent-3' }]);
  const old = Date.now() - 3_600_000;
  adapt(io, {
    sessionId: 'parent-3',
    timestamp: old,
    payload: {
      role: 'assistant',
      timestamp: old,
      tool_calls: [{ id: 'd3', function: { name: 'delegate_task', arguments: { goal: 'Informe' } } }],
    },
  });
  adapt(io, {
    sessionId: 'child-3',
    timestamp: old + 60_000,
    payload: {
      role: 'assistant',
      timestamp: old + 60_000,
      tool_calls: [{ id: 'w1', function: { name: 'web_search', arguments: { query: 'q' } } }],
    },
  });

  const item = events.map((e) => e.payload as unknown as ActivityItem).find((i) => i.tool === 'web_search');
  assert.equal(item?.sessionId, 'parent-3');
  assert.equal(item?.actor, 'd3');
});
