'use strict';
// Synthetic busy service: emits raw-format transcript lines through the real normalizers.
const os = require('os');
const path = require('path');
const { normalizeClaude, normalizeCopilot } = require('./normalize');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SESSIONS = [
  { source: 'claude', repo: 'AI-Video-Editor', model: 'claude-opus-4-7' },
  { source: 'copilot', repo: 'CAIP-CSI-Pipeline', model: 'gpt-5.5' },
  { source: 'claude', repo: 'Shortsmith', model: 'claude-sonnet-4-6' },
  { source: 'copilot', repo: 'cem-insight-developermcp', model: 'claude-sonnet-5.5' },
  { source: 'claude', repo: 'supoclip', model: 'claude-haiku-4-5' },
  { source: 'copilot', repo: 'MK Restaurant', model: 'gpt-5.5-codex' },
  { source: 'copilot', repo: 'storyvideo-copilot-write-x1', model: 'claude-sonnet-5.5', automated: true },
  { source: 'claude', repo: 'Software-Application-Architect', model: 'claude-opus-4-7' },
];

const PROMPTS = [
  'Add a dark mode toggle to the settings page',
  'Why does the export fail for 4K videos? Please investigate and fix',
  'Refactor the pipeline config loader and add unit tests',
  'Write a README section about deployment',
  'Fix the flaky integration test in OrderServiceTests',
  'Upgrade the project to Node 24 and check everything still builds',
  'Make the thumbnail generator 2x faster',
  'Review my last commit for security issues',
  'Add pagination to the /api/orders endpoint',
  'Rename the clip model to segment everywhere',
];

const FILES = ['animate.py', 'server.js', 'OrderService.cs', 'README.md', 'pipeline.yaml', 'index.html', 'render.ts', 'config.json'];
const COMMANDS = ['npm test', 'dotnet build', 'git status', 'pytest -q', 'npm run lint', 'dotnet test --no-build', 'git diff --stat'];
const PATTERNS = ['TODO', 'exportVideo', 'class Order', 'useEffect', 'connectionString'];
const URLS = ['https://learn.microsoft.com/dotnet', 'https://nodejs.org/api/http.html', 'https://developer.mozilla.org/docs/Web/API/Canvas_API'];

const CLAUDE_TOOLS = [
  ['Read', (r) => ({ file_path: `C:\\Dev\\src\\${pick(r, FILES)}` })],
  ['Grep', (r) => ({ pattern: pick(r, PATTERNS) })],
  ['Glob', () => ({ pattern: '**/*.ts' })],
  ['Edit', (r) => ({ file_path: `C:\\Dev\\src\\${pick(r, FILES)}` })],
  ['Write', (r) => ({ file_path: `C:\\Dev\\src\\${pick(r, FILES)}` })],
  ['Bash', (r) => ({ command: pick(r, COMMANDS) })],
  ['Bash', (r) => ({ command: pick(r, COMMANDS) })],
  ['WebFetch', (r) => ({ url: pick(r, URLS) })],
  ['WebSearch', () => ({ query: 'canvas pixel art scaling' })],
  ['TodoWrite', () => ({})],
  ['mcp__github__list_issues', () => ({})],
];
const COPILOT_TOOLS = [
  ['view', (r) => ({ path: `C:\\Dev\\src\\${pick(r, FILES)}` })],
  ['grep', (r) => ({ pattern: pick(r, PATTERNS) })],
  ['glob', () => ({ pattern: '**/*.cs' })],
  ['edit', (r) => ({ path: `C:\\Dev\\src\\${pick(r, FILES)}` })],
  ['create', (r) => ({ path: `C:\\Dev\\src\\${pick(r, FILES)}` })],
  ['powershell', (r) => ({ command: pick(r, COMMANDS) })],
  ['powershell', (r) => ({ command: pick(r, COMMANDS) })],
  ['web_fetch', (r) => ({ url: pick(r, URLS) })],
  ['sql', () => ({})],
  ['github-mcp-server-search_issues', () => ({})],
];

function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

function startDemo(emit, opts = {}) {
  const rand = mulberry32(opts.seed ?? 4777);
  const speed = opts.speed ?? 1;
  const timers = new Set();
  let stopped = false;
  let idSeq = 0;
  const nextId = (p) => `${p}_${(++idSeq).toString(36)}`;

  const sleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(() => { timers.delete(t); resolve(); }, ms / speed);
    timers.add(t);
  });

  function send(sess, raw) {
    if (stopped) return;
    raw.timestamp = new Date().toISOString();
    const evs = sess.source === 'claude'
      ? normalizeClaude(raw, sess.ctx)
      : normalizeCopilot(raw, sess.ctx);
    if (evs.length) emit(evs);
  }

  function toolCall(sess, tool, input, parent) {
    const id = nextId(sess.source === 'claude' ? 'toolu' : 'call');
    if (sess.source === 'claude') {
      const ctx = parent ? { sessionId: parent, parentId: sess.id } : sess.ctx;
      const evs = normalizeClaude({
        type: 'assistant', sessionId: sess.id, cwd: sess.cwd, timestamp: new Date().toISOString(), isSidechain: !!parent,
        message: { model: sess.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: tool, input }] },
      }, ctx);
      if (!stopped && evs.length) emit(evs);
    } else {
      send(sess, { type: 'tool.execution_start', data: { toolCallId: id, toolName: tool, arguments: input }, ...(parent ? { agentId: parent } : {}) });
    }
    return id;
  }

  function toolDone(sess, id, parent) {
    if (sess.source === 'claude') {
      const ctx = parent ? { sessionId: parent, parentId: sess.id } : sess.ctx;
      const evs = normalizeClaude({
        type: 'user', sessionId: sess.id, cwd: sess.cwd, timestamp: new Date().toISOString(), isSidechain: !!parent,
        message: { content: [{ type: 'tool_result', tool_use_id: id, content: '' }] },
      }, ctx);
      if (!stopped && evs.length) emit(evs);
    } else {
      send(sess, { type: 'tool.execution_complete', data: { toolCallId: id, success: true }, ...(parent ? { agentId: parent } : {}) });
    }
  }

  async function runSubagent(sess, tools) {
    const desc = pick(rand, ['Explore the codebase', 'Research API docs', 'Review the diff', 'Find all callers']);
    const taskId = toolCall(sess, sess.source === 'claude' ? 'Task' : 'task', { description: desc });
    let agentKey = taskId;
    if (sess.source === 'copilot') {
      agentKey = nextId('agent');
      send(sess, { type: 'subagent.started', agentId: agentKey, data: { toolCallId: taskId, agentName: 'explore', agentDisplayName: desc } });
    }
    await sleep(1500);
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n && !stopped; i++) {
      const [tool, input] = pick(rand, tools.slice(0, 3));
      const id = toolCall(sess, tool, input(rand), agentKey);
      await sleep(1500 + rand() * 2500);
      toolDone(sess, id, agentKey);
    }
    if (sess.source === 'copilot') send(sess, { type: 'subagent.completed', agentId: agentKey, data: { toolCallId: taskId } });
    toolDone(sess, taskId);
  }

  async function serve(sess) {
    const tools = sess.source === 'claude' ? CLAUDE_TOOLS : COPILOT_TOOLS;
    await sleep(500 + rand() * 6000);
    if (sess.source === 'copilot') {
      send(sess, { type: 'session.start', data: { sessionId: sess.id, selectedModel: sess.model, context: { cwd: sess.cwd } } });
    } else {
      send(sess, { type: 'custom-title', customTitle: `${sess.repo} work`, sessionId: sess.id });
    }
    while (!stopped) {
      const prompt = pick(rand, PROMPTS);
      if (sess.source === 'claude') {
        send(sess, { type: 'user', sessionId: sess.id, cwd: sess.cwd, message: { role: 'user', content: prompt } });
      } else {
        send(sess, { type: 'user.message', data: { content: prompt } });
        send(sess, { type: 'assistant.turn_start', data: { turnId: '0' } });
      }
      await sleep(2500);
      const steps = 3 + Math.floor(rand() * 6);
      for (let i = 0; i < steps && !stopped; i++) {
        const roll = rand();
        if (roll < 0.1) {
          await runSubagent(sess, tools);
        } else if (roll < 0.16) {
          const id = toolCall(sess, sess.source === 'claude' ? 'AskUserQuestion' : 'ask_user', {});
          await sleep(7000 + rand() * 4000);
          toolDone(sess, id);
        } else {
          const [tool, input] = pick(rand, tools);
          if (sess.source === 'copilot') send(sess, { type: 'assistant.message', data: { model: sess.model, toolRequests: [{}] } });
          const id = toolCall(sess, tool, input(rand));
          await sleep(2500 + rand() * 4500);
          toolDone(sess, id);
          if (sess.source === 'copilot') send(sess, { type: 'assistant.turn_end', data: { turnId: String(i) } });
        }
        await sleep(400 + rand() * 900);
      }
      if (stopped) break;
      if (sess.source === 'claude') {
        send(sess, { type: 'assistant', sessionId: sess.id, cwd: sess.cwd, message: { model: sess.model, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } });
      } else {
        send(sess, { type: 'assistant.message', data: { model: sess.model, toolRequests: [] } });
        send(sess, { type: 'assistant.turn_end', data: { turnId: 'last' } });
      }
      await sleep(5000 + rand() * 12000);
    }
  }

  const tmp = os.tmpdir();
  for (const [i, s] of SESSIONS.entries()) {
    const id = `demo-${s.source}-${i}`;
    const cwd = s.automated ? path.join(tmp, s.repo) : `C:\\Dev\\${s.repo}`;
    const sess = { ...s, id, cwd, ctx: { sessionId: id, state: {} } };
    serve(sess).catch(() => {});
  }

  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}

module.exports = { startDemo };
