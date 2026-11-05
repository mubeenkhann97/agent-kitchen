'use strict';
const fs = require('fs');
const { TailReader } = require('../tail-reader');

const ACTIVE_MS = 10 * 60 * 1000;
const BACKFILL_AGE_MS = 60 * 1000;

async function statSafe(p) {
  try { return await fs.promises.stat(p); } catch { return null; }
}

async function readdirSafe(p) {
  try { return await fs.promises.readdir(p, { withFileTypes: true }); } catch { return []; }
}

// Polls tracked files (never fs.watch alone) and emits normalized events.
class SessionWatcher {
  constructor({ root, intervalMs = 1000, now = Date.now } = {}) {
    this.root = root;
    this.intervalMs = intervalMs;
    this.now = now;
    this.files = new Map();
    this.listeners = new Set();
    this.timer = null;
    this.running = false;
    this.ticks = 0;
    this.started = false;
  }

  onEvents(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(events) {
    if (!events.length) return;
    for (const fn of this.listeners) fn(events);
  }

  // Files active at startup are backfilled from their tail; older ones are only read from now on.
  async track(file, entry) {
    if (this.files.has(file)) return;
    const st = await statSafe(file);
    if (!st) return;
    const recent = this.now() - st.mtimeMs < ACTIVE_MS;
    entry.reader = new TailReader(file, { startAt: recent ? 'tail' : 'end', filter: entry.filter });
    entry.firstPoll = this.ticks === 0;
    this.files.set(file, entry);
  }

  untrack(file) { this.files.delete(file); }

  async pollFiles() {
    const now = this.now();
    for (const [file, entry] of this.files) {
      let res;
      try {
        res = await entry.reader.poll();
      } catch {
        continue;
      }
      if (res.missing) { this.untrack(file); continue; }
      if (!res.items.length) { entry.firstPoll = false; continue; }
      if (entry.beforeItems) await entry.beforeItems(entry);
      const out = [];
      for (const item of res.items) {
        let evs;
        try { evs = entry.normalize(item, entry.ctx); } catch { continue; }
        for (const ev of evs) {
          if (entry.firstPoll || now - ev.ts > BACKFILL_AGE_MS) ev.backfill = true;
          out.push(ev);
        }
      }
      entry.firstPoll = false;
      if (entry.afterItems) entry.afterItems(entry, out);
      this.emit(out);
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.discover(this.ticks === 0);
      await this.pollFiles();
    } catch {
      // Keep polling; a transient FS error must not stop the watcher.
    } finally {
      this.ticks++;
      this.running = false;
    }
  }

  start() {
    if (this.started) return this;
    this.started = true;
    const loop = async () => {
      await this.tick();
      if (this.started) this.timer = setTimeout(loop, this.intervalMs);
    };
    loop();
    return this;
  }

  stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
  }
}

module.exports = { SessionWatcher, statSafe, readdirSafe, ACTIVE_MS };
