'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClaudeWatcher, rootCwd } = require('../watchers/claude');
const { CopilotWatcher, parseWorkspaceYaml } = require('../watchers/copilot');
const { VSCodeChatWatcher, workspaceFolder } = require('../watchers/vscode-chat');

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kitchen-w-')); dirs.push(d); return d; };
const now = () => new Date().toISOString();

function collect(w) {
  const evs = [];
  w.onEvents((list) => evs.push(...list));
  return evs;
}

test('Claude watcher backfills active sessions, then tails live lines and subagents', async () => {
  const root = tmp();
  const proj = path.join(root, 'C--Dev-Shop');
  fs.mkdirSync(proj);
  const sid = 'sess-1';
  const file = path.join(proj, `${sid}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ type: 'user', sessionId: sid, cwd: 'C:\\Dev\\Shop', timestamp: now(), message: { content: 'old order' } }) + '\n');
  const w = new ClaudeWatcher({ root });
  const evs = collect(w);
  await w.tick();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'order');
  assert.equal(evs[0].backfill, true);

  fs.appendFileSync(file, JSON.stringify({ type: 'assistant', sessionId: sid, cwd: 'C:\\Dev\\Shop', timestamp: now(), message: { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_9', name: 'Task', input: { description: 'Scout' } }] } }) + '\n');
  await w.tick();
  const live = evs.slice(1);
  assert.deepEqual(live.map((e) => e.kind), ['tool_start', 'subagent_start']);
  assert.ok(!live[0].backfill);

  const subDir = path.join(proj, sid, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, 'agent-abc.meta.json'), JSON.stringify({ toolUseId: 'toolu_9', description: 'Scout' }));
  fs.writeFileSync(path.join(subDir, 'agent-abc.jsonl'), JSON.stringify({ type: 'assistant', isSidechain: true, sessionId: sid, timestamp: now(), message: { content: [{ type: 'tool_use', id: 'x', name: 'Grep', input: { pattern: 'p' } }] } }) + '\n');
  await w.tick();
  const sub = evs.find((e) => e.parentId === sid && e.kind === 'tool_start');
  assert.ok(sub, 'subagent tool_start emitted');
  assert.equal(sub.sessionId, 'toolu_9');
});

test('Claude watcher ignores inactive files at startup but picks up new appends', async () => {
  const root = tmp();
  const proj = path.join(root, 'p');
  fs.mkdirSync(proj);
  const file = path.join(proj, 's.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', sessionId: 's', timestamp: now(), message: { content: 'stale' } }) + '\n');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(file, old, old);
  const w = new ClaudeWatcher({ root });
  const evs = collect(w);
  await w.tick();
  assert.equal(evs.length, 0);
  fs.appendFileSync(file, JSON.stringify({ type: 'user', sessionId: 's', timestamp: now(), message: { content: 'fresh' } }) + '\n');
  await w.tick();
  assert.deepEqual(evs.map((e) => e.text), ['fresh']);
});

test('Copilot watcher reads events and workspace.yaml', async () => {
  const root = tmp();
  const sdir = path.join(root, 'cop-1');
  fs.mkdirSync(sdir);
  fs.writeFileSync(path.join(sdir, 'workspace.yaml'), 'id: cop-1\ncwd: C:\\Dev\\Pipeline\nname: Fix pipeline\nuser_named: true\n');
  fs.writeFileSync(path.join(sdir, 'events.jsonl'), JSON.stringify({ type: 'user.message', data: { content: 'Fix it' }, id: '1', timestamp: now(), parentId: null }) + '\n');
  const w = new CopilotWatcher({ root });
  const evs = collect(w);
  await w.tick();
  const meta = evs.find((e) => e.kind === 'session_start');
  assert.equal(meta.cwd, 'C:\\Dev\\Pipeline');
  assert.equal(meta.title, 'Fix pipeline');
  assert.ok(evs.some((e) => e.kind === 'order' && e.text === 'Fix it'));
});

test('VS Code chat watcher reads chat sessions with the workspace folder as cwd', async () => {
  const user = tmp();
  const ws = path.join(user, 'workspaceStorage', 'abc123');
  fs.mkdirSync(path.join(ws, 'chatSessions'), { recursive: true });
  const folder = process.platform === 'win32' ? 'file:///c%3A/Dev/My%20Shop' : 'file:///home/me/My%20Shop';
  fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ folder }));
  const file = path.join(ws, 'chatSessions', 'chat-1.jsonl');
  fs.writeFileSync(file, JSON.stringify({ kind: 0, v: { sessionId: 'chat-1', requests: [] } }) + '\n');
  const w = new VSCodeChatWatcher({ userDirs: [user] });
  const evs = collect(w);
  await w.tick();
  fs.appendFileSync(file, JSON.stringify({ kind: 2, k: ['requests'], v: [{ requestId: 'r1', message: { text: 'Hello chef' }, response: [] }] }) + '\n');
  fs.appendFileSync(file, JSON.stringify({ kind: 1, k: ['requests', 0, 'result'], v: { metadata: { secret: 'x' } } }) + '\n');
  await w.tick();
  const order = evs.find((e) => e.kind === 'order');
  assert.ok(order && !order.backfill);
  assert.equal(order.sessionId, 'chat-1');
  assert.equal(order.cwd, process.platform === 'win32' ? 'c:\\Dev\\My Shop' : '/home/me/My Shop');
});

test('workspaceFolder handles folders, .code-workspace files and non-file URIs', () => {
  if (process.platform === 'win32') {
    assert.equal(workspaceFolder({ workspace: 'file:///c%3A/Dev/proj/team.code-workspace' }), 'c:\\Dev\\proj');
  }
  assert.equal(workspaceFolder({ folder: 'vscode-remote://ssh-remote+box/home/x' }), undefined);
  assert.equal(workspaceFolder({}), undefined);
});

test('parseWorkspaceYaml handles quotes and skips block scalars', () => {
  assert.deepEqual(parseWorkspaceYaml('cwd: "C:\\x"\nsummary: |\n  hi\nname: \'n\''), { cwd: 'C:\\x', name: 'n' });
});

test('rootCwd maps a cd-ed subfolder back to the encoded project root', { skip: process.platform !== 'win32' && 'Windows paths' }, () => {
  assert.equal(rootCwd('C:\\Dev\\Personal Claude\\Clipping supoclip\\frontend', 'C--Dev-Personal-Claude-Clipping-supoclip'), 'C:\\Dev\\Personal Claude\\Clipping supoclip');
  assert.equal(rootCwd('C:\\Elsewhere', 'C--Dev-Shop'), 'C:\\Elsewhere');
});
