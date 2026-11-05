'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVSCodeChat } = require('../normalize');

const SECRET = 'TOPSECRET-DO-NOT-LEAK';
const SID = '14f53f21-0398-465d-aebf-a6f663db169a';

function run(lines, cwd = 'C:\\Dev\\Shop') {
  const ctx = { sessionId: SID, cwd, state: {} };
  return lines.flatMap((l) => normalizeVSCodeChat(JSON.parse(JSON.stringify(l)), ctx));
}

const fileUri = (p) => ({ [`file:///${p}`]: { $mid: 1, path: `/${p}`, scheme: 'file' } });
const readPart = (id, done = true) => ({
  kind: 'toolInvocationSerialized', toolId: 'copilot_readFile', toolCallId: id, isComplete: done,
  invocationMessage: { value: `Reading ${SECRET}`, uris: fileUri('c:/Dev/Shop/src/animate.py') },
  pastTenseMessage: { value: SECRET },
});
const termPart = (id) => ({
  kind: 'toolInvocationSerialized', toolId: 'run_in_terminal', toolCallId: id, isComplete: true,
  toolSpecificData: { kind: 'terminal', commandLine: { original: 'npm test', forDisplay: 'npm test' }, terminalCommandOutput: { text: SECRET } },
});
const request = (extra = {}) => ({
  requestId: 'req-1', timestamp: 1793878000000, modelId: 'copilot/claude-opus-5.5',
  message: { text: 'Build the kitchen ' + 'x'.repeat(200), parts: [] }, response: [], modelState: { value: 0 }, ...extra,
});

test('a new request is an order with the model; prompt truncated', () => {
  const evs = run([{ kind: 2, k: ['requests'], v: [request()] }]);
  assert.deepEqual(evs.map((e) => e.kind), ['session_start', 'order']);
  assert.equal(evs[0].model, 'claude-opus-5.5');
  assert.equal(evs[1].source, 'copilot');
  assert.equal(evs[1].cwd, 'C:\\Dev\\Shop');
  assert.ok(evs[1].text.length <= 80);
  assert.equal(evs[1].ts, 1793878000000);
});

test('tool parts start and finish tools; re-pushed parts are not duplicated', () => {
  const evs = run([
    { kind: 2, k: ['requests'], v: [request()] },
    { kind: 2, k: ['requests', 0, 'response'], v: [{ kind: 'thinking', value: SECRET }, readPart('t1'), { value: SECRET }] },
    { kind: 2, k: ['requests', 0, 'response'], i: 0, v: [readPart('t1'), termPart('t2')] },
  ]);
  const tools = evs.filter((e) => e.kind === 'tool_start');
  assert.deepEqual(tools.map((e) => [e.tool, e.station, e.text]), [
    ['read', 'pantry', 'reading the recipe for animate.py'],
    ['bash', 'stove', 'firing up `npm test`'],
  ]);
  assert.equal(evs.filter((e) => e.kind === 'tool_end').length, 2);
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('a running tool finishes when it is pushed again as complete', () => {
  const evs = run([
    { kind: 2, k: ['requests', 0, 'response'], v: [readPart('t1', false)] },
    { kind: 2, k: ['requests', 0, 'response'], i: 0, v: [readPart('t1', false)] },
    { kind: 2, k: ['requests', 0, 'response'], i: 0, v: [readPart('t1', true)] },
  ]);
  assert.deepEqual(evs.map((e) => e.kind), ['tool_start', 'tool_end']);
});

test('model state: complete serves once, cancelled sends back, needs input asks for attention', () => {
  const evs = run([
    { kind: 2, k: ['requests'], v: [request()] },
    { kind: 1, k: ['requests', 0, 'modelState'], v: { value: 4 } },
    { kind: 1, k: ['requests', 0, 'modelState'], v: { value: 1, completedAt: 1793878100000 } },
    { kind: 1, k: ['requests', 0, 'modelState'], v: { value: 1, completedAt: 1793878100000 } },
    { kind: 2, k: ['requests'], v: [request({ requestId: 'req-2' })] },
    { kind: 1, k: ['requests', 1, 'modelState'], v: { value: 2 } },
  ]);
  const kinds = evs.map((e) => e.kind);
  assert.deepEqual(kinds, ['session_start', 'order', 'needs_attention', 'turn_end', 'order', 'turn_end']);
  assert.equal(evs[3].ts, 1793878100000);
  assert.equal(evs[5].text, 'cancelled');
});

test('subagent tool parts become a sous-chef of the session', () => {
  const sub = { ...readPart('s1'), subAgentInvocationId: 'call-sub' };
  const runSub = {
    kind: 'toolInvocationSerialized', toolId: 'runSubagent', toolCallId: 'call-sub', isComplete: true,
    toolSpecificData: { kind: 'subagent', description: 'Explore the repo', prompt: SECRET, result: SECRET },
  };
  const evs = run([{ kind: 2, k: ['requests', 0, 'response'], v: [sub, runSub] }]);
  const sous = evs.filter((e) => e.parentId === SID);
  assert.deepEqual(sous.map((e) => [e.kind, e.sessionId]), [
    ['tool_start', 'call-sub'], ['tool_end', 'call-sub'], ['subagent_start', 'call-sub'],
  ]);
  assert.equal(sous[2].text, 'Explore the repo');
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('questions and confirmations ask for attention once', () => {
  const q = { kind: 'questionCarousel', questions: [{ title: SECRET }], resolveId: 'q1' };
  const evs = run([
    { kind: 2, k: ['requests', 0, 'response'], v: [q] },
    { kind: 2, k: ['requests', 0, 'response'], i: 0, v: [q] },
  ]);
  assert.deepEqual(evs.map((e) => e.kind), ['needs_attention']);
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('selected model updates the chef model once', () => {
  const evs = run([
    { kind: 1, k: ['inputState', 'selectedModel'], v: { identifier: 'copilot/gpt-5.5', metadata: { tooltip: SECRET } } },
    { kind: 1, k: ['inputState', 'selectedModel'], v: { identifier: 'copilot/gpt-5.5' } },
  ]);
  assert.deepEqual(evs.map((e) => [e.kind, e.model]), [['session_start', 'gpt-5.5']]);
});

test('snapshot and custom title', () => {
  const evs = run([
    { kind: 0, v: { sessionId: SID, customTitle: 'Agent Kitchen build', requests: [request({ response: [termPart('t9')], modelState: { value: 1, completedAt: 1 } })] } },
    { kind: 1, k: ['customTitle'], v: 'Renamed chat' },
    { kind: 1, k: ['inputState', 'inputText'], v: SECRET },
  ]);
  assert.deepEqual(evs.map((e) => e.kind), ['session_start', 'session_start', 'order', 'tool_start', 'tool_end', 'turn_end', 'session_start']);
  assert.equal(evs[0].title, 'Agent Kitchen build');
  assert.equal(evs[6].title, 'Renamed chat');
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});
