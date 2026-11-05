'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionWatcher, statSafe, readdirSafe } = require('./base');
const { normalizeVSCodeChat, promptText } = require('../normalize');
const { clean } = require('../stations');

// Property updates that never matter to the kitchen; skipping them avoids parsing large lines.
const SKIP_LINE = /^\{"kind":1,"k":\[("inputState","(?!selectedModel)|"requests",\d+,"(result|followups|promptTokenDetails|contentReferences|codeCitations|outputBuffer|responseMarkdownInfo|completionTokens|promptTokens|copilotCredits|timeSpentWaiting|variableData))/;
const HEAD_BYTES = 64 * 1024;

function vscodeFilter(head) {
  return !SKIP_LINE.test(head);
}

function defaultUserDirs() {
  if (process.env.AGENT_KITCHEN_VSCODE_USER_DIR) return [process.env.AGENT_KITCHEN_VSCODE_USER_DIR];
  const home = os.homedir();
  const base = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
  return ['Code', 'Code - Insiders'].map((product) => path.join(base, product, 'User'));
}

// workspace.json holds {"folder": "file:///..."} or {"workspace": "file:///.../x.code-workspace"}.
function workspaceFolder(json) {
  const uri = json && (json.folder || json.workspace);
  if (typeof uri !== 'string') return undefined;
  let p;
  try {
    const u = new URL(uri);
    if (u.protocol !== 'file:') return undefined;
    p = decodeURIComponent(u.pathname);
  } catch {
    return undefined;
  }
  if (/^\/[A-Za-z]:/.test(p)) {
    p = p.slice(1).replace(/\//g, '\\');
    return json.folder ? p : path.win32.dirname(p);
  }
  return json.folder ? p : path.posix.dirname(p);
}

// Tails VS Code Copilot Chat sessions: <User>/workspaceStorage/<id>/chatSessions/*.jsonl and
// <User>/globalStorage/emptyWindowChatSessions/*.jsonl. Read-only.
class VSCodeChatWatcher extends SessionWatcher {
  constructor(opts = {}) {
    super({ ...opts, root: null, coldEvery: 5 });
    this.userDirs = opts.userDirs || defaultUserDirs();
    this.dirMtimes = new Map();
    this.chatDirs = new Map(); // chatSessions dir -> cwd
  }

  async changed(dir) {
    const st = await statSafe(dir);
    if (!st) return false;
    if (this.dirMtimes.get(dir) === st.mtimeMs) return false;
    this.dirMtimes.set(dir, st.mtimeMs);
    return true;
  }

  async discover(first) {
    const sweep = first || this.ticks % 5 === 0;
    for (const userDir of this.userDirs) {
      const storage = path.join(userDir, 'workspaceStorage');
      if (sweep && (await this.changed(storage) || first)) {
        for (const d of await readdirSafe(storage)) {
          if (!d.isDirectory()) continue;
          const chatDir = path.join(storage, d.name, 'chatSessions');
          if (this.chatDirs.has(chatDir)) continue;
          let cwd;
          try { cwd = workspaceFolder(JSON.parse(await fs.promises.readFile(path.join(storage, d.name, 'workspace.json'), 'utf8'))); } catch { cwd = undefined; }
          this.chatDirs.set(chatDir, cwd);
        }
        this.chatDirs.set(path.join(userDir, 'globalStorage', 'emptyWindowChatSessions'), 'Copilot Chat');
      }
    }
    if (!sweep) return;
    for (const [chatDir, cwd] of this.chatDirs) {
      if (!(await this.changed(chatDir))) continue;
      for (const e of await readdirSafe(chatDir)) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        const sessionId = e.name.slice(0, -6);
        await this.track(path.join(chatDir, e.name), {
          ctx: { sessionId, cwd, state: {} }, normalize: normalizeVSCodeChat, filter: vscodeFilter,
          beforeItems: (entry) => this.readHead(path.join(chatDir, e.name), entry),
        });
      }
    }
  }

  // The model and title are usually written once near the start, outside the tail we read; peek at a bounded head.
  async readHead(file, entry) {
    if (entry.headRead) return;
    entry.headRead = true;
    let text;
    try {
      const fh = await fs.promises.open(file, 'r');
      try {
        const buf = Buffer.alloc(HEAD_BYTES);
        const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
        text = buf.toString('utf8', 0, bytesRead);
      } finally {
        await fh.close();
      }
    } catch {
      return;
    }
    const ev = { source: 'copilot', sessionId: entry.ctx.sessionId, kind: 'session_start', ts: Date.now(), backfill: true };
    if (entry.ctx.cwd) ev.cwd = entry.ctx.cwd;
    const recent = await this.scanBack(file);
    const model = recent.model || (/"selectedModel":\{"identifier":"([^"]{1,100})"/.exec(text) || [])[1];
    if (model) {
      ev.model = model.replace(/^copilot\//, '');
      entry.ctx.state.model = ev.model;
    }
    const title = recent.title || (/"customTitle":"((?:[^"\\]|\\.){1,200})"/.exec(text) || [])[1];
    if (title) {
      try { ev.title = clean(JSON.parse(`"${title}"`), 60); } catch { /* malformed */ }
    } else if (recent.prompt) {
      // No chat title yet: name the ticket after the latest prompt.
      try {
        const p = promptText(JSON.parse(`"${recent.prompt}"`));
        if (p) { ev.title = p; ev.titleWeak = true; }
      } catch { /* malformed */ }
    }
    if (ev.model || ev.title) this.emit([ev]);
  }

  // Latest model, chat title and prompt within the last few MB, read backwards in chunks (bounded, one-off per session).
  async scanBack(file) {
    const CHUNK = 256 * 1024;
    const LIMIT = 4 * 1024 * 1024;
    const patterns = {
      model: /"modelId":"([^"]{1,100})"/g,
      title: /"k":\["customTitle"\],"v":"((?:[^"\\]|\\.){1,300})"/g,
      prompt: /"message":\{"text":"((?:[^"\\]|\\.){1,2000})"/g,
    };
    const found = {};
    let fh;
    try {
      fh = await fs.promises.open(file, 'r');
      const { size } = await fh.stat();
      const stop = Math.max(0, size - LIMIT);
      for (let end = size; end > stop; end -= CHUNK - 4096) {
        const start = Math.max(stop, end - CHUNK);
        const buf = Buffer.alloc(end - start);
        await fh.read(buf, 0, buf.length, start);
        const textChunk = buf.toString('utf8');
        for (const [name, re] of Object.entries(patterns)) {
          if (found[name]) continue;
          let last = null;
          for (const m of textChunk.matchAll(re)) last = m[1];
          if (last) found[name] = last;
        }
        if (found.model && found.title && found.prompt) break;
        if (start === stop) break;
      }
    } catch {
      // Unreadable: fall back to the head.
    } finally {
      if (fh) await fh.close();
    }
    return found;
  }
}

module.exports = { VSCodeChatWatcher, workspaceFolder, vscodeFilter };
