import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capabilityStates,
  satellites,
  groupByTurn,
  formatDuration,
  agentState,
  formatElapsed,
  formatAgo,
} from './enVivoModelo.js';

const NOW = 1_000_000;
const tool = (id, category, extra = {}) => ({
  id,
  kind: 'tool',
  actor: 'hermes',
  category,
  subject: id,
  status: 'ok',
  at: NOW - 60000,
  endedAt: NOW - 59000,
  ...extra,
});

test('should_light_a_capability_while_its_tool_runs_and_keep_its_last_subject', () => {
  const states = capabilityStates(
    [
      tool('a', 'skills'),
      tool('b', 'skills', { subject: 'google-workspace', status: 'running', at: NOW - 500, endedAt: undefined }),
    ],
    NOW,
  );
  assert.equal(states.skills.count, 2);
  assert.equal(states.skills.active, true);
  assert.equal(states.skills.last.subject, 'google-workspace');
});

test('should_mark_a_capability_as_failed_only_for_a_while', () => {
  const recent = capabilityStates([tool('a', 'terminal', { status: 'error', endedAt: NOW - 1000 })], NOW);
  const old = capabilityStates([tool('a', 'terminal', { status: 'error' })], NOW);
  assert.equal(recent.terminal.error, true);
  assert.equal(old.terminal.error, false);
});

test('should_show_a_running_delegation_with_the_last_action_of_its_subagent', () => {
  const sats = satellites(
    [
      tool('d1', 'delegation', {
        status: 'running',
        agent: 'call_1',
        subject: 'Resumir informe',
        at: NOW - 5000,
        endedAt: undefined,
      }),
      tool('x', 'web', { actor: 'call_1', subject: 'datos', at: NOW - 1000 }),
    ],
    NOW,
  );
  assert.equal(sats.length, 1);
  assert.equal(sats[0].label, 'Resumir informe');
  assert.equal(sats[0].lastAction.subject, 'datos');
});

test('should_drop_finished_delegations_after_a_while', () => {
  assert.equal(satellites([tool('d1', 'delegation', { endedAt: NOW - 60000 })], NOW).length, 0);
});

test('should_name_profile_actors_even_before_their_delegation_arrives', () => {
  const [sat] = satellites([tool('p', 'files', { actor: 'profile:disenador', at: NOW - 1000 })], NOW);
  assert.equal(sat.label, 'Perfil disenador');
});

test('should_group_activity_by_turn_newest_first', () => {
  const groups = groupByTurn([
    { id: 't1', kind: 'turn', at: 1 },
    tool('a', 'web', { at: 2 }),
    { id: 't2', kind: 'turn', at: 3 },
    tool('b', 'files', { at: 4 }),
    { id: 'r', kind: 'reply', at: 5 },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.turn.id, g.items.map((i) => i.id)]),
    [
      ['t2', ['b', 'r']],
      ['t1', ['a']],
    ],
  );
});

const turn = (id, at) => ({ id, kind: 'turn', actor: 'hermes', subject: id, status: 'ok', at });
const reply = (id, at, final) => ({ id, kind: 'reply', actor: 'hermes', subject: id, status: 'ok', at, final });

test('should_be_working_while_a_tool_runs', () => {
  const state = agentState(
    [turn('t', NOW - 9000), tool('a', 'terminal', { status: 'running', at: NOW - 2000, endedAt: undefined })],
    NOW,
  );
  assert.equal(state.phase, 'tool');
  assert.equal(state.current.id, 'a');
  assert.equal(state.since, NOW - 9000);
});

test('should_be_thinking_between_tools_until_the_final_reply', () => {
  const thinking = agentState(
    [turn('t', NOW - 9000), tool('a', 'web', { at: NOW - 8000, endedAt: NOW - 7000 }), reply('r1', NOW - 6000, false)],
    NOW,
  );
  assert.equal(thinking.phase, 'thinking');
  const done = agentState([turn('t', NOW - 9000), reply('r2', NOW - 5000, true)], NOW);
  assert.equal(done.phase, 'idle');
  assert.equal(done.endedAt, NOW - 5000);
});

test('should_consider_an_unanswered_turn_stopped_after_a_long_silence', () => {
  assert.equal(agentState([turn('t', NOW - 20 * 60000)], NOW).phase, 'idle');
});

test('should_trust_the_start_signal_until_a_newer_final_reply_arrives', () => {
  const old = [turn('t', NOW - 60000), reply('r', NOW - 50000, true)];
  assert.equal(agentState(old, NOW, { executing: true, executingSince: NOW - 1000 }).phase, 'thinking');
  const answered = [...old, turn('t2', NOW - 900), reply('r2', NOW - 100, true)];
  assert.equal(agentState(answered, NOW, { executing: true, executingSince: NOW - 1000 }).phase, 'idle');
  assert.equal(agentState([], NOW).phase, 'idle');
});

test('should_format_elapsed_and_ago_times', () => {
  assert.equal(formatElapsed(45000), '45 s');
  assert.equal(formatElapsed(185000), '3 min 05 s');
  assert.equal(formatAgo(NOW - 5 * 60000, NOW), 'hace 5 min');
});

test('should_format_durations', () => {
  assert.equal(formatDuration({ at: 0, endedAt: 450 }), '450 ms');
  assert.equal(formatDuration({ at: 0, endedAt: 591.8198 }), '592 ms');
  assert.equal(formatDuration({ at: 0, endedAt: 2500 }), '2.5 s');
  assert.equal(formatDuration({ at: 0 }), '');
});
