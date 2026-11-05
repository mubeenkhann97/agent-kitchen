'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeClaude } = require('../normalize');

const SECRET = 'TOPSECRET-DO-NOT-LEAK';
const SID = '56b77884-3c9b-448e-9adb-1f66975a03a7';
const common = { sessionId: SID, cwd: 'C:\\Dev\\AI-Video-Editor', timestamp: '2026-11-05T10:00:00.000Z', isSidechain: false };

const ctx = { sessionId: SID };
const parse = (line, c = ctx) => normalizeClaude(JSON.parse(line), c);

test('string user content is an order truncated to 80 chars', () => {
  const line = JSON.stringify({ ...common, type: 'user', message: { role: 'user', content: 'Please refactor ' + 'a'.repeat(200) } });
  const [ev] = parse(line);
  assert.equal(ev.kind, 'order');
  assert.equal(ev.source, 'claude');
  assert.equal(ev.sessionId, SID);
  assert.equal(ev.cwd, common.cwd);
  assert.ok(ev.text.length <= 80);
  assert.equal(ev.ts, Date.parse(common.timestamp));
});

test('tool_result array produces tool_end without leaking results', () => {
  const line = JSON.stringify({
    ...common, type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: SECRET }] },
    toolUseResult: { stdout: SECRET },
  });
  const evs = parse(line);
  assert.deepEqual(evs.map((e) => e.kind), ['tool_end']);
  assert.equal(evs[0].toolUseId, 'toolu_1');
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('assistant tool_use produces tool_start with station; thinking/text never leak', () => {
  const line = JSON.stringify({
    ...common, type: 'assistant',
    message: {
      model: 'claude-opus-4-7', stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: SECRET },
        { type: 'text', text: SECRET },
        { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: 'C:\\x\\animate.py', content: SECRET } },
      ],
    },
  });
  const evs = parse(line);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'tool_start');
  assert.equal(evs[0].tool, 'Read');
  assert.equal(evs[0].station, 'pantry');
  assert.equal(evs[0].toolUseId, 'toolu_2');
  assert.equal(evs[0].model, 'claude-opus-4-7');
  assert.equal(evs[0].text, 'reading the recipe for animate.py');
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('Task and Agent tool_use also start a sous-chef', () => {
  for (const name of ['Task', 'Agent']) {
    const line = JSON.stringify({
      ...common, type: 'assistant',
      message: { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_t', name, input: { description: 'Research', prompt: SECRET } }] },
    });
    const evs = parse(line);
    assert.deepEqual(evs.map((e) => e.kind), ['tool_start', 'subagent_start']);
    assert.equal(evs[1].sessionId, 'toolu_t');
    assert.equal(evs[1].parentId, SID);
    assert.equal(evs[1].text, 'Research');
    assert.ok(!JSON.stringify(evs).includes(SECRET));
  }
});

test('AskUserQuestion raises needs_attention', () => {
  const line = JSON.stringify({ ...common, type: 'assistant', message: { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: {} }] } });
  assert.deepEqual(parse(line).map((e) => e.kind), ['tool_start', 'needs_attention']);
});

test('final assistant text with end_turn is a turn_end', () => {
  const line = JSON.stringify({ ...common, type: 'assistant', message: { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: SECRET }] } });
  const evs = parse(line);
  assert.deepEqual(evs.map((e) => e.kind), ['session_start', 'turn_end']);
  assert.ok(!JSON.stringify(evs).includes(SECRET));
});

test('intermediate assistant text (stop_reason tool_use) is not a turn_end', () => {
  const line = JSON.stringify({ ...common, type: 'assistant', message: { model: 'm', stop_reason: 'tool_use', content: [{ type: 'text', text: 'x' }] } });
  assert.ok(!parse(line).some((e) => e.kind === 'turn_end'));
});

test('custom-title, agent-name and last-prompt set the order name', () => {
  assert.equal(parse(JSON.stringify({ type: 'custom-title', customTitle: 'Fix video export', sessionId: SID }))[0].title, 'Fix video export');
  assert.equal(parse(JSON.stringify({ type: 'agent-name', agentName: 'Builder', sessionId: SID }))[0].title, 'Builder');
  const lp = parse(JSON.stringify({ type: 'last-prompt', lastPrompt: 'do things', sessionId: SID }))[0];
  assert.equal(lp.title, 'do things');
  assert.equal(lp.titleWeak, true);
});

test('noise line types are ignored', () => {
  for (const type of ['api-request', 'api-request-blob', 'attachment', 'file-history-delta', 'queue-operation', 'system']) {
    assert.deepEqual(parse(JSON.stringify({ ...common, type, message: { content: SECRET } })), []);
  }
});

test('meta, command and system-injected user lines are handled', () => {
  assert.deepEqual(parse(JSON.stringify({ ...common, type: 'user', isMeta: true, message: { content: 'x' } })), []);
  assert.deepEqual(parse(JSON.stringify({ ...common, type: 'user', message: { content: '<local-command-stdout>x</local-command-stdout>' } })), []);
  const cmd = parse(JSON.stringify({ ...common, type: 'user', message: { content: '<command-name>/review</command-name><command-args></command-args>' } }));
  assert.equal(cmd[0].text, '/review');
  const intr = parse(JSON.stringify({ ...common, type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }));
  assert.equal(intr[0].kind, 'turn_end');
});

test('sidechain lines in a main transcript are ignored', () => {
  const line = JSON.stringify({ ...common, isSidechain: true, type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] } });
  assert.deepEqual(parse(line), []);
});

test('subagent transcript lines become sous-chef events', () => {
  const sctx = { sessionId: 'toolu_t', parentId: SID };
  const brief = JSON.stringify({ ...common, isSidechain: true, agentId: 'a1', type: 'user', message: { content: SECRET } });
  assert.deepEqual(parse(brief, sctx), []);
  const tool = parse(JSON.stringify({ ...common, isSidechain: true, type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Grep', input: { pattern: 'foo' } }] } }), sctx);
  assert.equal(tool[0].kind, 'tool_start');
  assert.equal(tool[0].sessionId, 'toolu_t');
  assert.equal(tool[0].parentId, SID);
  const done = parse(JSON.stringify({ ...common, isSidechain: true, type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } }), sctx);
  assert.deepEqual(done.map((e) => e.kind), ['subagent_end']);
});
