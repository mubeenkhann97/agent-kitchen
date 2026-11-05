'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCopilot, normalizeHook } = require('../normalize');

const SECRET = 'TOPSECRET-DO-NOT-LEAK';
const SID = 'fbe5e4fb-6df6-4e7d-84d1-7de5018a62fa';
let n = 0;
const line = (type, data, extra = {}) => JSON.stringify({ type, data, id: `id-${++n}`, timestamp: '2026-11-05T10:00:00.000Z', parentId: null, ...extra });

function run(lines) {
  const ctx = { sessionId: SID, state: {} };
  return lines.flatMap((l) => normalizeCopilot(JSON.parse(l), ctx));
}

test('session.start gives cwd and model', () => {
  const [ev] = run([line('session.start', { sessionId: SID, selectedModel: 'gpt-5.5', context: { cwd: 'C:\\Dev\\Shop' } })]);
  assert.equal(ev.kind, 'session_start');
  assert.equal(ev.source, 'copilot');
  assert.equal(ev.cwd, 'C:\\Dev\\Shop');
  assert.equal(ev.model, 'gpt-5.5');
});

test('user.message uses content, never transformedContent', () => {
  const [ev] = run([line('user.message', { content: 'Add login page', transformedContent: SECRET })]);
  assert.equal(ev.kind, 'order');
  assert.equal(ev.text, 'Add login page');
  const [long] = run([line('user.message', { content: 'x'.repeat(500) })]);
  assert.ok(long.text.length <= 80);
});

test('tool execution start/complete map to tool events', () => {
  const evs = run([
    line('tool.execution_start', { toolCallId: 'c1', toolName: 'powershell', arguments: { command: 'npm test', secret: SECRET } }),
    line('tool.execution_complete', { toolCallId: 'c1', success: true, result: { content: SECRET } }),
  ]);
  assert.deepEqual(evs.map((e) => e.kind), ['tool_start', 'tool_end']);
  assert.equal(evs[0].station, 'stove');
  assert.equal(evs[0].text, 'firing up `npm test`');
  assert.equal(evs[1].toolUseId, 'c1');
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('turn_end only serves the order when the last message requested no tools', () => {
  const evs = run([
    line('user.message', { content: 'go' }),
    line('assistant.turn_start', { turnId: '0' }),
    line('assistant.message', { content: SECRET, toolRequests: [{}] }),
    line('tool.execution_start', { toolCallId: 'c', toolName: 'view', arguments: { path: 'a.txt' } }),
    line('tool.execution_complete', { toolCallId: 'c', success: true }),
    line('assistant.turn_end', { turnId: '0' }),
    line('assistant.turn_start', { turnId: '1' }),
    line('assistant.message', { content: SECRET, toolRequests: [] }),
    line('assistant.turn_end', { turnId: '1' }),
  ]);
  assert.deepEqual(evs.map((e) => e.kind), ['order', 'tool_start', 'tool_end', 'turn_end']);
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('task tool and subagent events create and finish a sous-chef', () => {
  const evs = run([
    line('tool.execution_start', { toolCallId: 't1', toolName: 'task', arguments: { description: 'Explore repo', prompt: SECRET } }),
    line('subagent.started', { toolCallId: 't1', agentName: 'explore', agentDisplayName: 'Explore' }, { agentId: 'ag1' }),
    line('tool.execution_start', { toolCallId: 'c2', toolName: 'grep', arguments: { pattern: 'foo' } }, { agentId: 'ag1' }),
    line('subagent.completed', { toolCallId: 't1' }, { agentId: 'ag1' }),
  ]);
  assert.deepEqual(evs.map((e) => e.kind), ['tool_start', 'subagent_start', 'subagent_start', 'tool_start', 'subagent_end']);
  assert.equal(evs[1].sessionId, 't1');
  assert.equal(evs[1].parentId, SID);
  assert.equal(evs[3].sessionId, 't1');
  assert.equal(evs[3].parentId, SID);
  assert.equal(evs[4].sessionId, 't1');
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('ask_user raises needs_attention', () => {
  const evs = run([line('tool.execution_start', { toolCallId: 'q', toolName: 'ask_user', arguments: { question: SECRET } })]);
  assert.deepEqual(evs.map((e) => e.kind), ['tool_start', 'needs_attention']);
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('shutdown ends the session; noise is ignored', () => {
  const evs = run([
    line('session.shutdown', { codeChanges: {}, modelMetrics: {} }),
    line('hook.start', { input: SECRET }),
    line('system.message', { content: SECRET }),
    line('session.usage_checkpoint', {}),
    line('subagent.deselected', {}),
  ]);
  assert.deepEqual(evs.map((e) => e.kind), ['session_end']);
});

test('model_change updates the model once', () => {
  const evs = run([
    line('session.model_change', { newModel: 'claude-sonnet-5.5' }),
    line('assistant.message', { model: 'claude-sonnet-5.5', toolRequests: [] }),
  ]);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].model, 'claude-sonnet-5.5');
});

test('hook payloads map to events', () => {
  const base = { session_id: 's1', cwd: 'C:\\Dev\\x', transcript_path: 'p' };
  assert.equal(normalizeHook({ ...base, hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' })[0].kind, 'needs_attention');
  assert.equal(normalizeHook({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'hello' })[0].kind, 'order');
  const pre = normalizeHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'u', tool_input: { file_path: 'a/b.js', new_string: SECRET } })[0];
  assert.equal(pre.kind, 'tool_start');
  assert.equal(pre.station, 'board');
  assert.ok(!JSON.stringify(pre).includes(SECRET));
  assert.equal(normalizeHook({ ...base, hook_event_name: 'PostToolUse', tool_use_id: 'u', tool_response: SECRET })[0].kind, 'tool_end');
  assert.equal(normalizeHook({ ...base, hook_event_name: 'Stop' })[0].kind, 'turn_end');
  assert.deepEqual(normalizeHook({ hook_event_name: 'Stop' }), []);
  assert.deepEqual(normalizeHook({ ...base, hook_event_name: 'Weird' }), []);
});
