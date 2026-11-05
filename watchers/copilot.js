'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionWatcher, statSafe, readdirSafe, ACTIVE_MS } = require('./base');
const { normalizeCopilot } = require('../normalize');
const { clean } = require('../stations');

function defaultRoot() {
  return process.env.AGENT_KITCHEN_COPILOT_DIR || path.join(os.homedir(), '.copilot', 'session-state');
}

// Minimal reader for flat "key: value" workspace.yaml files.
function parseWorkspaceYaml(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v === '|' || v === '>' || v.startsWith('|') || v.startsWith('>')) continue;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Tails ~/.copilot/session-state/<sessionId>/events.jsonl, plus workspace.yaml and inuse.<pid>.lock.
class CopilotWatcher extends SessionWatcher {
  constructor(opts = {}) {
    super({ ...opts, root: opts.root || defaultRoot() });
    this.rootMtime = null;
    this.sessions = new Map(); // sessionId -> { dir, dirMtime, pids:Set, yamlMtime }
  }

  async discover(first) {
    const st = await statSafe(this.root);
    if (!st) return;
    if (first || st.mtimeMs !== this.rootMtime || this.ticks % 10 === 0) {
      this.rootMtime = st.mtimeMs;
      for (const d of await readdirSafe(this.root)) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        if (!this.sessions.has(d.name)) {
          this.sessions.set(d.name, { dir: path.join(this.root, d.name), dirMtime: null, pids: new Set(), yamlMtime: null });
        }
      }
    }
    const now = this.now();
    for (const [sessionId, s] of this.sessions) {
      const file = path.join(s.dir, 'events.jsonl');
      const entry = this.files.get(file);
      if (!entry) {
        await this.track(file, {
          ctx: { sessionId, state: {} },
          normalize: normalizeCopilot,
          beforeItems: () => this.readWorkspace(sessionId, s),
        });
        continue;
      }
      // Lock and workspace changes only matter for sessions active recently.
      if (now - (entry.reader.mtimeMs || 0) > ACTIVE_MS && !s.pids.size) continue;
      const dst = await statSafe(s.dir);
      if (dst && dst.mtimeMs !== s.dirMtime) {
        s.dirMtime = dst.mtimeMs;
        await this.scanLocks(sessionId, s);
        await this.readWorkspace(sessionId, s);
      } else if (this.ticks % 5 === 0 && s.pids.size) {
        for (const pid of s.pids) {
          if (!pidAlive(pid)) {
            s.pids.delete(pid);
            if (!s.pids.size) this.emit([{ source: 'copilot', sessionId, kind: 'session_end', ts: Date.now() }]);
          }
        }
      }
    }
  }

  async scanLocks(sessionId, s) {
    const pids = new Set();
    for (const e of await readdirSafe(s.dir)) {
      const m = /^inuse\.(\d+)\.lock$/.exec(e.name);
      if (m && pidAlive(Number(m[1]))) pids.add(Number(m[1]));
    }
    const hadLock = s.pids.size > 0;
    s.pids = pids;
    if (hadLock && !pids.size) this.emit([{ source: 'copilot', sessionId, kind: 'session_end', ts: Date.now() }]);
  }

  async readWorkspace(sessionId, s) {
    const file = path.join(s.dir, 'workspace.yaml');
    const st = await statSafe(file);
    if (!st || st.mtimeMs === s.yamlMtime || st.size > 64 * 1024) return;
    s.yamlMtime = st.mtimeMs;
    let ws;
    try { ws = parseWorkspaceYaml(await fs.promises.readFile(file, 'utf8')); } catch { return; }
    const ev = { source: 'copilot', sessionId, kind: 'session_start', ts: Date.now(), backfill: true };
    if (ws.cwd) ev.cwd = ws.cwd;
    if (ws.name) {
      ev.title = clean(ws.name, 60);
      if (ws.user_named !== 'true') ev.titleWeak = true;
    }
    if (ws.client_name) ev.client = clean(ws.client_name, 40);
    this.emit([ev]);
  }
}

module.exports = { CopilotWatcher, parseWorkspaceYaml, pidAlive };
