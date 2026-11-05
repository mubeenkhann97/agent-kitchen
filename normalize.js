'use strict';
const { stationFor, isSubagentTool, isAttentionTool, summarize, describeAction, clean, vscodeToolAlias } = require('./stations');

const PROMPT_MAX = 80;

function tsOf(v) {
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : Date.now();
}

function base(source, sessionId, kind, extra, ts, cwd) {
  const ev = { source, sessionId, kind, ts };
  if (cwd) ev.cwd = cwd;
  for (const k in extra) if (extra[k] !== undefined && extra[k] !== '') ev[k] = extra[k];
  return ev;
}

function toolStart(source, sessionId, tool, toolUseId, input, ts, cwd, parentId) {
  return base(source, sessionId, 'tool_start', {
    parentId, tool, toolUseId, station: stationFor(tool), text: describeAction(tool, summarize(tool, input)),
  }, ts, cwd);
}

// Turns a raw user prompt into ticket text, or null for system-injected content.
function promptText(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const cmd = /<command-name>\s*([^<]*)<\/command-name>/.exec(s);
  if (cmd) return clean(cmd[1], PROMPT_MAX) || null;
  if (s.startsWith('<')) return null;
  if (s.startsWith('Caveat:')) return null;
  return clean(s, PROMPT_MAX);
}

/**
 * Claude Code transcript line -> events.
 * ctx: { sessionId, parentId? (set for subagent transcripts, sessionId is then the sous-chef id), cwd? }
 */
function normalizeClaude(obj, ctx = {}) {
  if (!obj || typeof obj !== 'object') return [];
  const sub = !!ctx.parentId;
  const sessionId = ctx.sessionId || obj.sessionId;
  if (!sessionId) return [];
  const ts = tsOf(obj.timestamp);
  const cwd = typeof obj.cwd === 'string' ? obj.cwd : ctx.cwd;
  const parentId = sub ? ctx.parentId : undefined;
  const out = [];

  switch (obj.type) {
    case 'custom-title':
      if (!sub && obj.customTitle) out.push(base('claude', sessionId, 'session_start', { title: clean(obj.customTitle, 60) }, ts, cwd));
      return out;
    case 'agent-name':
      if (!sub && obj.agentName) out.push(base('claude', sessionId, 'session_start', { title: clean(obj.agentName, 60) }, ts, cwd));
      return out;
    case 'last-prompt': {
      const t = !sub && promptText(obj.lastPrompt);
      if (t) out.push(base('claude', sessionId, 'session_start', { title: t, titleWeak: true }, ts, cwd));
      return out;
    }
    case 'user':
      return claudeUser(obj, sessionId, parentId, ts, cwd, sub);
    case 'assistant':
      return claudeAssistant(obj, sessionId, parentId, ts, cwd, sub);
    default:
      return out;
  }
}

function claudeUser(obj, sessionId, parentId, ts, cwd, sub) {
  const out = [];
  if (obj.isMeta) return out;
  if (obj.isSidechain && !sub) return out;
  const content = obj.message && obj.message.content;
  let prompt = null;
  if (typeof content === 'string') {
    prompt = content;
  } else if (Array.isArray(content)) {
    const texts = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'tool_result' && item.tool_use_id) {
        out.push(base('claude', sessionId, 'tool_end', { parentId, toolUseId: item.tool_use_id }, ts, cwd));
      } else if (item.type === 'text' && typeof item.text === 'string') {
        texts.push(item.text);
      }
    }
    if (!out.length && texts.length) prompt = texts.join(' ');
  }
  if (prompt != null && !sub) {
    if (/^\s*\[Request interrupted by user/.test(prompt)) {
      out.push(base('claude', sessionId, 'turn_end', { text: 'cancelled' }, ts, cwd));
    } else {
      const t = promptText(prompt);
      if (t) out.push(base('claude', sessionId, 'order', { text: t }, ts, cwd));
    }
  }
  return out;
}

function claudeAssistant(obj, sessionId, parentId, ts, cwd, sub) {
  const out = [];
  if (obj.isSidechain && !sub) return out;
  const msg = obj.message || {};
  const model = typeof msg.model === 'string' && !msg.model.startsWith('<') ? msg.model : undefined;
  const content = Array.isArray(msg.content) ? msg.content : [];
  let hasTool = false;
  for (const item of content) {
    if (!item || item.type !== 'tool_use' || typeof item.name !== 'string') continue;
    hasTool = true;
    const ev = toolStart('claude', sessionId, item.name, item.id, item.input, ts, cwd, parentId);
    if (model) ev.model = model;
    out.push(ev);
    if (isSubagentTool(item.name) && !sub && item.id) {
      out.push(base('claude', item.id, 'subagent_start', {
        parentId: sessionId, text: summarize(item.name, item.input) || 'sous-chef',
      }, ts, cwd));
    }
    if (isAttentionTool(item.name)) {
      out.push(base('claude', sessionId, 'needs_attention', { parentId, text: 'has a question for you' }, ts, cwd));
    }
  }
  if (!out.length && model && !sub) out.push(base('claude', sessionId, 'session_start', { model }, ts, cwd));
  const stop = msg.stop_reason;
  if (!hasTool && (stop === 'end_turn' || stop === 'stop_sequence')) {
    if (sub) out.push(base('claude', sessionId, 'subagent_end', { parentId }, ts, cwd));
    else out.push(base('claude', sessionId, 'turn_end', { model }, ts, cwd));
  }
  return out;
}

/**
 * Copilot events.jsonl line -> events.
 * ctx: { sessionId, state: {} } — state is per-session and mutated here.
 */
function normalizeCopilot(obj, ctx = {}) {
  if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') return [];
  const st = ctx.state || (ctx.state = {});
  st.agents = st.agents || {};
  const d = obj.data && typeof obj.data === 'object' ? obj.data : {};
  const sessionId = ctx.sessionId || d.sessionId;
  if (!sessionId) return [];
  const ts = tsOf(obj.timestamp);
  const ev = (kind, extra) => base('copilot', sessionId, kind, extra || {}, ts);
  // Events emitted inside a subagent carry a top-level agentId.
  const agentSous = obj.agentId ? (st.agents[obj.agentId] || obj.agentId) : null;
  const sousEv = (kind, extra) => base('copilot', agentSous, kind, { parentId: sessionId, ...extra }, ts);

  switch (obj.type) {
    case 'session.start':
    case 'session.resume': {
      const cwd = d.context && typeof d.context.cwd === 'string' ? d.context.cwd : undefined;
      if (d.selectedModel) st.model = d.selectedModel;
      const e = ev('session_start', { model: d.selectedModel });
      if (cwd) e.cwd = cwd;
      return [e];
    }
    case 'session.model_change':
      if (!d.newModel || d.newModel === st.model) return [];
      st.model = d.newModel;
      return [ev('session_start', { model: d.newModel })];
    case 'user.message': {
      if (obj.agentId || d.parentAgentTaskId) return [];
      const t = promptText(d.content);
      st.lastToolRequests = 0;
      return t ? [ev('order', { text: t })] : [];
    }
    case 'assistant.message': {
      if (obj.agentId) return [];
      st.lastToolRequests = Array.isArray(d.toolRequests) ? d.toolRequests.length : 0;
      if (d.model && d.model !== st.model) {
        st.model = d.model;
        return [ev('session_start', { model: d.model })];
      }
      return [];
    }
    case 'assistant.turn_end':
      // A turn ends after every model call; the order is only served when no tools were requested.
      if (obj.agentId || st.lastToolRequests) return [];
      return [ev('turn_end', { model: st.model })];
    case 'abort':
      if (obj.agentId) return [];
      return [ev('turn_end', { text: 'cancelled' })];
    case 'tool.execution_start': {
      const tool = typeof d.toolName === 'string' ? d.toolName : 'tool';
      const out = [];
      if (agentSous) {
        out.push(toolStart('copilot', agentSous, tool, d.toolCallId, d.arguments, ts, undefined, sessionId));
        return out;
      }
      out.push(toolStart('copilot', sessionId, tool, d.toolCallId, d.arguments, ts));
      if (isSubagentTool(tool) && d.toolCallId) {
        out.push(base('copilot', d.toolCallId, 'subagent_start', {
          parentId: sessionId, text: summarize(tool, d.arguments) || 'sous-chef',
        }, ts));
      }
      if (isAttentionTool(tool)) out.push(ev('needs_attention', { text: 'has a question for you' }));
      return out;
    }
    case 'tool.execution_complete':
      if (!d.toolCallId) return [];
      if (agentSous) return [sousEv('tool_end', { toolUseId: d.toolCallId })];
      return [ev('tool_end', { toolUseId: d.toolCallId })];
    case 'subagent.started': {
      const sid = d.toolCallId || obj.agentId;
      if (!sid) return [];
      if (obj.agentId) st.agents[obj.agentId] = sid;
      return [base('copilot', sid, 'subagent_start', {
        parentId: sessionId, text: clean(d.agentDisplayName || d.agentName || 'sous-chef', 40),
      }, ts)];
    }
    case 'subagent.completed':
    case 'subagent.failed': {
      const sid = d.toolCallId || agentSous;
      if (!sid) return [];
      return [base('copilot', sid, 'subagent_end', { parentId: sessionId }, ts)];
    }
    case 'session.shutdown':
      return [ev('session_end')];
    default:
      return [];
  }
}

// Only a file path, a terminal command line or a subagent description is ever taken from a VS Code tool part.
function vscodeToolInput(part) {
  const tsd = part.toolSpecificData && typeof part.toolSpecificData === 'object' ? part.toolSpecificData : {};
  if (tsd.commandLine && typeof tsd.commandLine === 'object') return { command: tsd.commandLine.forDisplay || tsd.commandLine.original };
  if (typeof tsd.description === 'string') return { description: tsd.description };
  const msg = part.invocationMessage;
  const uris = msg && typeof msg === 'object' && msg.uris && typeof msg.uris === 'object' ? Object.values(msg.uris) : [];
  const first = uris.find((u) => u && typeof u.path === 'string');
  if (first) {
    try { return { path: decodeURIComponent(first.path) }; } catch { return { path: first.path }; }
  }
  return {};
}

// VS Code ResponseModelState: 0 pending, 1 complete, 2 cancelled, 3 failed, 4 needs input.
const VS_COMPLETE = 1;
const VS_CANCELLED = new Set([2, 3]);
const VS_NEEDS_INPUT = 4;

/**
 * VS Code Copilot Chat session line -> events. Lines are a snapshot (kind 0), a property set (kind 1)
 * or an array push/splice (kind 2) addressed by the path in `k`.
 * ctx: { sessionId, cwd?, state: {} } - state is per-session and mutated here.
 */
function normalizeVSCodeChat(obj, ctx = {}) {
  if (!obj || typeof obj !== 'object' || typeof obj.kind !== 'number' || !ctx.sessionId) return [];
  const st = ctx.state || (ctx.state = {});
  st.tools = st.tools || new Map(); // toolCallId -> completed?
  st.requests = st.requests || new Set();
  st.finished = st.finished || new Set();
  st.notes = st.notes || new Set();
  if (st.count === undefined) st.count = 0;
  const sessionId = ctx.sessionId;
  const now = Date.now();
  const out = [];
  const ev = (kind, extra, ts) => base('copilot', sessionId, kind, extra || {}, ts || now, ctx.cwd);
  const key = Array.isArray(obj.k) ? obj.k : [];

  const remember = (set, value) => {
    set.add(value);
    if (set.size > 5000) set.delete(set.values().next().value);
  };

  const onState = (index, ms) => {
    if (!ms || typeof ms !== 'object') return;
    if (ms.value === VS_NEEDS_INPUT) {
      out.push(ev('needs_attention', { text: 'is waiting for your input' }));
    } else if ((ms.value === VS_COMPLETE || VS_CANCELLED.has(ms.value)) && !st.finished.has(index)) {
      remember(st.finished, index);
      const extra = { model: st.model };
      if (ms.value !== VS_COMPLETE) extra.text = 'cancelled';
      out.push(ev('turn_end', extra, typeof ms.completedAt === 'number' ? ms.completedAt : now));
    }
  };

  const onParts = (parts) => {
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (part.kind === 'questionCarousel' || part.kind === 'confirmation') {
        const title = part.title && typeof part.title === 'object' ? part.title.value : part.title;
        const note = `${part.kind}:${part.resolveId || clean(title, 60)}`;
        if (!st.notes.has(note)) {
          remember(st.notes, note);
          out.push(ev('needs_attention', { text: part.kind === 'confirmation' ? 'needs your confirmation' : 'has a question for you' }));
        }
        continue;
      }
      if (part.kind !== 'toolInvocationSerialized' || typeof part.toolCallId !== 'string') continue;
      const id = part.toolCallId;
      const done = !!part.isComplete;
      const known = st.tools.get(id);
      if (known === true || (known === false && !done)) continue;
      const tool = vscodeToolAlias(part.toolId);
      const sous = typeof part.subAgentInvocationId === 'string' && part.subAgentInvocationId !== id ? part.subAgentInvocationId : null;
      if (known === undefined) {
        const input = vscodeToolInput(part);
        if (sous) {
          out.push(toolStart('copilot', sous, tool, id, input, now, ctx.cwd, sessionId));
        } else {
          out.push(toolStart('copilot', sessionId, tool, id, input, now, ctx.cwd));
          if (isSubagentTool(tool)) {
            out.push(base('copilot', id, 'subagent_start', { parentId: sessionId, text: summarize(tool, input) || 'sous-chef' }, now, ctx.cwd));
          }
          if (isAttentionTool(tool) && !done) out.push(ev('needs_attention', { text: 'has a question for you' }));
        }
      }
      st.tools.set(id, done);
      if (st.tools.size > 5000) st.tools.delete(st.tools.keys().next().value);
      if (done) {
        out.push(sous
          ? base('copilot', sous, 'tool_end', { parentId: sessionId, toolUseId: id }, now, ctx.cwd)
          : ev('tool_end', { toolUseId: id }));
      }
    }
  };

  const onRequest = (req, index) => {
    if (!req || typeof req !== 'object') return;
    if (typeof req.modelId === 'string') {
      const model = req.modelId.replace(/^copilot\//, '');
      if (model !== st.model) {
        st.model = model;
        out.push(ev('session_start', { model }));
      }
    }
    const reqId = req.requestId || `#${index}`;
    if (!st.requests.has(reqId)) {
      remember(st.requests, reqId);
      const text = !req.hiddenFromTranscript && req.message && promptText(req.message.text);
      if (text) out.push(ev('order', { text }, typeof req.timestamp === 'number' ? req.timestamp : now));
    }
    if (Array.isArray(req.response)) onParts(req.response);
    onState(index, req.modelState);
  };

  if (obj.kind === 0) {
    const v = obj.v && typeof obj.v === 'object' ? obj.v : {};
    if (typeof v.customTitle === 'string') out.push(ev('session_start', { title: clean(v.customTitle, 60) }));
    const reqs = Array.isArray(v.requests) ? v.requests : [];
    reqs.forEach((r, i) => onRequest(r, i));
    st.count = reqs.length;
  } else if (obj.kind === 1) {
    if (key.length === 1 && key[0] === 'customTitle' && typeof obj.v === 'string') {
      out.push(ev('session_start', { title: clean(obj.v, 60) }));
    } else if (key.length === 2 && key[0] === 'inputState' && key[1] === 'selectedModel') {
      const id = obj.v && typeof obj.v.identifier === 'string' ? obj.v.identifier.replace(/^copilot\//, '') : null;
      if (id && id !== st.model) {
        st.model = id;
        out.push(ev('session_start', { model: id }));
      }
    } else if (key.length === 3 && key[0] === 'requests' && key[2] === 'modelState') {
      onState(key[1], obj.v);
    }
  } else if (obj.kind === 2) {
    const items = Array.isArray(obj.v) ? obj.v : [obj.v];
    if (key.length === 1 && key[0] === 'requests') {
      const start = Number.isInteger(obj.i) ? obj.i : st.count;
      items.forEach((r, j) => onRequest(r, start + j));
      st.count = start + items.length;
    } else if (key.length === 3 && key[0] === 'requests' && key[2] === 'response') {
      onParts(items);
    }
  }
  return out;
}

/** Claude Code hook payload -> events. */
function normalizeHook(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const sessionId = typeof obj.session_id === 'string' ? obj.session_id : null;
  if (!sessionId) return [];
  const ts = Date.now();
  const cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;
  const ev = (kind, extra) => ({ ...base('claude', sessionId, kind, extra || {}, ts, cwd), viaHook: true });
  const tool = typeof obj.tool_name === 'string' ? obj.tool_name : undefined;
  switch (obj.hook_event_name) {
    case 'SessionStart': return [ev('session_start')];
    case 'UserPromptSubmit': {
      const t = promptText(obj.prompt);
      return t ? [ev('order', { text: t })] : [];
    }
    case 'PreToolUse':
      if (!tool) return [];
      return [{ ...toolStart('claude', sessionId, tool, obj.tool_use_id, obj.tool_input, ts, cwd), viaHook: true }];
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return obj.tool_use_id ? [ev('tool_end', { toolUseId: obj.tool_use_id })] : [];
    case 'Notification':
      return [ev('needs_attention', { text: clean(obj.message || 'needs your attention', PROMPT_MAX) })];
    case 'PermissionRequest':
      return [ev('needs_attention', { text: tool ? `needs permission for ${clean(tool, 30)}` : 'needs permission' })];
    case 'Stop': return [ev('turn_end')];
    case 'SessionEnd': return [ev('session_end')];
    default: return [];
  }
}

module.exports = { normalizeClaude, normalizeCopilot, normalizeVSCodeChat, normalizeHook, promptText, PROMPT_MAX };
