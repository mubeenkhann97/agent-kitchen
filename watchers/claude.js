'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionWatcher, statSafe, readdirSafe, ACTIVE_MS } = require('./base');
const { normalizeClaude } = require('../normalize');

const SKIP_TYPES = /^\{"type":"(api-request|file-history|queue-operation|atis-latch|isolation-latch|cost-state|mode")/;

function claudeFilter(head) {
  return !SKIP_TYPES.test(head);
}

function defaultRoot() {
  return process.env.AGENT_KITCHEN_CLAUDE_DIR || path.join(os.homedir(), '.claude', 'projects');
}

const encodeCwd = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

// The project folder encodes the session's starting cwd; map `cd`-ed subfolders back to it.
function rootCwd(cwd, folder) {
  let p = cwd;
  for (let i = 0; i < 64 && p; i++) {
    if (encodeCwd(p) === folder) return p;
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return cwd;
}

function normalizeIn(folder) {
  return (item, ctx) => normalizeClaude(item, ctx).map((ev) => (ev.cwd ? { ...ev, cwd: rootCwd(ev.cwd, folder) } : ev));
}

// Tails ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl and <sessionId>/subagents/agent-*.jsonl.
class ClaudeWatcher extends SessionWatcher {
  constructor(opts = {}) {
    super({ ...opts, root: opts.root || defaultRoot() });
    this.dirMtimes = new Map();
    this.projects = new Set();
    this.mains = new Map(); // sessionId -> { file, dir }
  }

  async changed(dir) {
    const st = await statSafe(dir);
    if (!st) { this.dirMtimes.delete(dir); return false; }
    if (this.dirMtimes.get(dir) === st.mtimeMs) return false;
    this.dirMtimes.set(dir, st.mtimeMs);
    return true;
  }

  async discover(first) {
    if ((await this.changed(this.root)) || first) {
      for (const d of await readdirSafe(this.root)) {
        if (d.isDirectory()) this.projects.add(path.join(this.root, d.name));
      }
    }
    for (const dir of this.projects) {
      if (!(await this.changed(dir))) continue;
      for (const e of await readdirSafe(dir)) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        const sessionId = e.name.slice(0, -6);
        const file = path.join(dir, e.name);
        this.mains.set(sessionId, { file, dir: path.join(dir, sessionId) });
        await this.track(file, {
          ctx: { sessionId }, normalize: normalizeIn(path.basename(dir)), filter: claudeFilter,
          beforeItems: () => this.readTitle(sessionId),
        });
      }
    }
    // Subagent folders only matter for sessions that are currently active.
    const now = this.now();
    for (const [sessionId, m] of this.mains) {
      const entry = this.files.get(m.file);
      if (!entry || now - (entry.reader.mtimeMs || 0) > ACTIVE_MS) continue;
      const subDir = path.join(m.dir, 'subagents');
      if (!(await this.changed(subDir))) continue;
      for (const e of await readdirSafe(subDir)) {
        if (!e.isFile() || !/^agent-.+\.jsonl$/.test(e.name)) continue;
        const file = path.join(subDir, e.name);
        const agentId = e.name.slice(6, -6);
        await this.track(file, {
          ctx: { sessionId: `agent-${agentId}`, parentId: sessionId },
          normalize: normalizeIn(path.basename(path.dirname(m.dir))), filter: claudeFilter,
          beforeItems: (entry) => this.readMeta(entry, path.join(subDir, `agent-${agentId}.meta.json`)),
        });
      }
    }
  }

  // The meta file links a subagent transcript to the Task tool_use that launched it.
  async readMeta(entry, metaFile) {
    if (entry.metaLoaded) return;
    try {
      const meta = JSON.parse(await fs.promises.readFile(metaFile, 'utf8'));
      if (meta && typeof meta.toolUseId === 'string') entry.ctx.sessionId = meta.toolUseId;
      entry.metaLoaded = true;
    } catch {
      // Not written yet; retry on the next batch.
    }
  }

  async readTitle(sessionId) {
    const m = this.mains.get(sessionId);
    if (!m || m.titleChecked) return;
    m.titleChecked = true;
    try {
      const o = JSON.parse(await fs.promises.readFile(path.join(m.dir, 'custom-title.json'), 'utf8'));
      if (o && typeof o.customTitle === 'string') {
        this.emit(normalizeClaude({ type: 'custom-title', customTitle: o.customTitle, sessionId }, { sessionId })
          .map((ev) => ({ ...ev, backfill: true })));
      }
    } catch {
      // No custom title.
    }
  }
}

module.exports = { ClaudeWatcher, claudeFilter, rootCwd };
