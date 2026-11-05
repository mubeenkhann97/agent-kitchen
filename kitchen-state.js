'use strict';
const os = require('os');
const path = require('path');
const { stationFor, isAttentionTool } = require('./stations');

const ACTIVE_MS = 10 * 60 * 1000;
const ATTENTION_GRACE_MS = 60 * 60 * 1000;
const ACTION_LIMIT = 5;
const SOUS_LIMIT = 8;
const DEDUPE_MS = 10 * 1000;
const PLATE_LIMIT = 3;

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function repoOf(cwd) {
  if (!cwd) return 'unknown';
  const parts = String(cwd).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unknown';
}

function underDir(child, parent) {
  if (!child || !parent) return false;
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep.toLowerCase()) || c.startsWith(p + '/');
}

function emptyStats(now) {
  return { day: dayKey(now), servedToday: 0, stations: { pantry: 0, board: 0, stove: 0, market: 0, rail: 0, pass: 0, prep: 0 } };
}

// Authoritative kitchen model: chefs, tickets and stats. Changes are collected and drained via flush().
class KitchenState {
  constructor(opts = {}) {
    this.now = opts.now || Date.now;
    this.maxSeats = opts.maxSeats ?? 12;
    this.maxTracked = opts.maxTracked ?? 100;
    this.activeMs = opts.activeMs ?? ACTIVE_MS;
    this.tmpdir = opts.tmpdir ?? os.tmpdir();
    this.chefs = new Map();
    this.internal = new Map(); // id -> { pending: Map, ended: string[] }
    this.meta = new Map(); // sessionId -> { title, titleWeak, cwd, client } for sessions without a chef yet
    this.stats = emptyStats(this.now());
    this.dirty = new Set();
    this.removed = new Set();
    this.fx = [];
    this.statsDirty = false;
  }

  // ---- public API ----

  apply(ev) {
    if (!ev || !ev.sessionId || !ev.kind) return;
    this.rollDay();
    if (ev.parentId) return this.applySous(ev);
    if (ev.kind === 'session_start' && (ev.title || ev.client) && !this.chefs.has(ev.sessionId)) {
      this.rememberMeta(ev);
      return;
    }
    let chef = this.chefs.get(ev.sessionId);
    if (!chef) {
      if (ev.kind === 'session_end' || ev.kind === 'tool_end') return;
      if (this.now() - ev.ts > this.activeMs) { this.rememberMeta(ev); return; }
      chef = this.createChef(ev);
    }
    this.updateMeta(chef, ev);
    const live = !ev.backfill;
    const inner = this.internal.get(chef.id);

    switch (ev.kind) {
      case 'session_start':
        break;
      case 'order': {
        const t = chef.ticket;
        if (t && t.text === ev.text && Math.abs(ev.ts - t.since) < DEDUPE_MS) break;
        chef.ticket = { text: ev.text || '', since: ev.ts };
        chef.status = 'cooking';
        chef.attention = null;
        chef.plates = [];
        inner.pending.clear();
        this.pushAction(chef, `new ticket: "${ev.text || ''}"`, ev.ts);
        if (live) this.addFx('order', chef.id, { text: ev.text });
        break;
      }
      case 'tool_start': {
        if (ev.toolUseId && (inner.pending.has(ev.toolUseId) || inner.ended.includes(ev.toolUseId))) break;
        const station = ev.station || stationFor(ev.tool);
        if (ev.toolUseId) inner.pending.set(ev.toolUseId, { tool: ev.tool, station });
        if (!isAttentionTool(ev.tool)) chef.attention = null;
        chef.station = station;
        chef.tool = ev.tool || null;
        chef.status = chef.attention ? 'attention' : 'cooking';
        if (!chef.ticket) chef.ticket = { text: chef.title || '', since: ev.ts };
        // Without an id a hook event cannot be matched to its transcript line, so only move the chef.
        if (ev.viaHook && !ev.toolUseId) break;
        chef.toolCount++;
        this.stats.stations[station] = (this.stats.stations[station] || 0) + 1;
        this.statsDirty = true;
        this.pushAction(chef, ev.text || `using ${ev.tool}`, ev.ts, station);
        break;
      }
      case 'tool_end': {
        if (ev.toolUseId) {
          inner.pending.delete(ev.toolUseId);
          inner.ended.push(ev.toolUseId);
          if (inner.ended.length > 50) inner.ended.shift();
          if (chef.sous.some((s) => s.id === ev.toolUseId)) this.removeSous(chef, ev.toolUseId, live);
        }
        if (chef.attention) { chef.attention = null; chef.status = 'cooking'; }
        break;
      }
      case 'turn_end': {
        inner.pending.clear();
        chef.attention = null;
        if (ev.text === 'cancelled') {
          chef.ticket = null;
          chef.status = 'idle';
          this.pushAction(chef, 'order sent back', ev.ts);
          break;
        }
        if (!chef.ticket && chef.status === 'idle') break;
        const dish = (chef.ticket && chef.ticket.text) || chef.title || 'order';
        chef.plates.push({ text: dish, ts: ev.ts });
        if (chef.plates.length > PLATE_LIMIT) chef.plates.shift();
        chef.ticket = null;
        chef.status = 'idle';
        chef.station = 'pass';
        chef.tool = null;
        if (live) {
          chef.served++;
          this.stats.servedToday++;
          this.statsDirty = true;
          this.addFx('order_up', chef.id, { text: dish });
        }
        this.pushAction(chef, 'Order up!', ev.ts, 'pass');
        break;
      }
      case 'needs_attention':
        chef.attention = ev.text || 'needs attention';
        chef.status = 'attention';
        if (live) this.addFx('attention', chef.id, { text: chef.attention });
        break;
      case 'session_end':
        this.removeChef(chef.id);
        return;
      default:
        break;
    }
    if (ev.kind !== 'session_start') chef.lastActivity = Math.max(chef.lastActivity, ev.ts);
    this.dirty.add(chef.id);
  }

  applySous(ev) {
    const chef = this.chefs.get(ev.parentId);
    if (!chef) return;
    const live = !ev.backfill;
    let sous = chef.sous.find((s) => s.id === ev.sessionId);
    if (ev.kind === 'subagent_end') {
      if (sous) this.removeSous(chef, sous.id, live);
      return;
    }
    if (!sous) {
      // A Task tool already finished (e.g. background agent) does not re-seat a sous-chef from late start events.
      if (ev.kind === 'subagent_start' && this.internal.get(chef.id).ended.includes(ev.sessionId)) return;
      if (chef.sous.length >= SOUS_LIMIT) return;
      sous = { id: ev.sessionId, text: ev.text || 'sous-chef', station: 'prep', tool: null, since: ev.ts };
      chef.sous.push(sous);
      if (live) this.addFx('sous_enter', chef.id, { sousId: sous.id });
    }
    if (ev.kind === 'subagent_start' && ev.text) sous.text = ev.text;
    if (ev.kind === 'tool_start') {
      const station = ev.station || stationFor(ev.tool);
      sous.station = station;
      sous.tool = ev.tool || null;
      this.stats.stations[station] = (this.stats.stations[station] || 0) + 1;
      this.statsDirty = true;
      this.pushAction(chef, `sous-chef ${ev.text || 'working'}`, ev.ts, station);
    }
    chef.lastActivity = Math.max(chef.lastActivity, ev.ts);
    this.dirty.add(chef.id);
  }

  // Expire idle chefs; call periodically.
  tick() {
    this.rollDay();
    const now = this.now();
    for (const chef of [...this.chefs.values()]) {
      const limit = chef.attention ? ATTENTION_GRACE_MS : this.activeMs;
      if (now - chef.lastActivity > limit) this.removeChef(chef.id);
    }
  }

  snapshot() {
    return { type: 'snapshot', now: this.now(), chefs: [...this.chefs.values()].map(publicChef), stats: this.publicStats() };
  }

  flush() {
    const out = [];
    for (const id of this.removed) out.push({ type: 'remove', id });
    for (const id of this.dirty) {
      const chef = this.chefs.get(id);
      if (chef) out.push({ type: 'chef', chef: publicChef(chef) });
    }
    for (const fx of this.fx) out.push(fx);
    if (this.statsDirty) out.push({ type: 'stats', stats: this.publicStats() });
    this.removed.clear();
    this.dirty.clear();
    this.fx = [];
    this.statsDirty = false;
    return out;
  }

  // ---- internals ----

  rollDay() {
    const k = dayKey(this.now());
    if (k !== this.stats.day) {
      this.stats = emptyStats(this.now());
      this.statsDirty = true;
    }
  }

  rememberMeta(ev) {
    const m = this.meta.get(ev.sessionId) || {};
    if (ev.title && (!ev.titleWeak || !m.title || m.titleWeak)) { m.title = ev.title; m.titleWeak = !!ev.titleWeak; }
    if (ev.cwd) m.cwd = ev.cwd;
    if (ev.model) m.model = ev.model;
    if (ev.client) m.client = ev.client;
    this.meta.delete(ev.sessionId);
    this.meta.set(ev.sessionId, m);
    if (this.meta.size > 500) this.meta.delete(this.meta.keys().next().value);
  }

  createChef(ev) {
    const chef = {
      id: ev.sessionId, source: ev.source, cwd: null, repo: 'unknown', model: null, title: null, titleWeak: true,
      client: null, automated: false, status: 'idle', attention: null, station: 'prep', tool: null,
      ticket: null, plates: [], actions: [], sous: [], toolCount: 0, served: 0, seat: null,
      createdAt: ev.ts, lastActivity: ev.ts,
    };
    const m = this.meta.get(ev.sessionId);
    if (m) {
      this.meta.delete(ev.sessionId);
      this.updateMeta(chef, { ...m });
    }
    this.updateMeta(chef, ev);
    this.chefs.set(chef.id, chef);
    this.internal.set(chef.id, { pending: new Map(), ended: [] });
    this.enforceTrackedLimit();
    this.seat(chef);
    if (!ev.backfill) this.addFx('chef_enter', chef.id);
    return chef;
  }

  updateMeta(chef, ev) {
    if (ev.cwd && ev.cwd !== chef.cwd) {
      chef.cwd = ev.cwd;
      chef.repo = repoOf(ev.cwd);
      const automated = underDir(ev.cwd, this.tmpdir);
      if (automated !== chef.automated) {
        chef.automated = automated;
        if (this.chefs.has(chef.id)) this.reseat();
      }
    }
    if (ev.model) chef.model = ev.model;
    if (ev.client) chef.client = ev.client;
    if (ev.title && (!ev.titleWeak || chef.titleWeak || !chef.title)) {
      chef.title = ev.title;
      chef.titleWeak = !!ev.titleWeak;
    }
  }

  pushAction(chef, text, ts, station) {
    chef.actions.push({ text, ts, station: station || null });
    if (chef.actions.length > ACTION_LIMIT) chef.actions.splice(0, chef.actions.length - ACTION_LIMIT);
  }

  addFx(fx, chefId, extra) {
    this.fx.push({ type: 'fx', fx, chefId, ...extra });
    if (this.fx.length > 200) this.fx.shift();
  }

  removeSous(chef, sousId, live) {
    chef.sous = chef.sous.filter((s) => s.id !== sousId);
    if (live) this.addFx('sous_leave', chef.id, { sousId });
    this.dirty.add(chef.id);
  }

  removeChef(id) {
    if (!this.chefs.delete(id)) return;
    this.internal.delete(id);
    this.dirty.delete(id);
    this.removed.add(id);
    this.statsDirty = true;
    this.reseat();
  }

  enforceTrackedLimit() {
    while (this.chefs.size > this.maxTracked) {
      let oldest = null;
      for (const c of this.chefs.values()) if (!oldest || c.lastActivity < oldest.lastActivity) oldest = c;
      this.removeChef(oldest.id);
    }
  }

  // Interactive sessions are seated before automated ones, then by most recent activity.
  priority(c) {
    return (c.automated ? 0 : 1e15) + c.lastActivity;
  }

  seat(chef) {
    const seated = [...this.chefs.values()].filter((c) => c.seat !== null);
    if (seated.length < this.maxSeats) {
      chef.seat = this.freeSeat(seated);
    } else {
      const victim = seated.filter((c) => c.automated && !chef.automated)
        .sort((a, b) => a.lastActivity - b.lastActivity)[0];
      if (victim) {
        chef.seat = victim.seat;
        victim.seat = null;
        this.dirty.add(victim.id);
      } else {
        chef.seat = null;
      }
    }
    this.statsDirty = true;
  }

  freeSeat(seated) {
    const used = new Set(seated.map((c) => c.seat));
    for (let i = 0; i < this.maxSeats; i++) if (!used.has(i)) return i;
    return null;
  }

  reseat() {
    const all = [...this.chefs.values()];
    let seated = all.filter((c) => c.seat !== null);
    // Interactive chefs waiting replace seated automated ones.
    for (const w of all.filter((c) => c.seat === null && !c.automated).sort((a, b) => b.lastActivity - a.lastActivity)) {
      const victim = seated.filter((c) => c.automated).sort((a, b) => a.lastActivity - b.lastActivity)[0];
      if (!victim) break;
      w.seat = victim.seat;
      victim.seat = null;
      this.dirty.add(w.id);
      this.dirty.add(victim.id);
      seated = all.filter((c) => c.seat !== null);
    }
    const waiting = all.filter((c) => c.seat === null).sort((a, b) => this.priority(b) - this.priority(a));
    for (const w of waiting) {
      if (seated.length >= this.maxSeats) break;
      w.seat = this.freeSeat(seated);
      seated.push(w);
      this.dirty.add(w.id);
    }
    this.statsDirty = true;
  }

  publicStats() {
    const chefs = [...this.chefs.values()];
    let busiest = null;
    for (const c of chefs) if (c.toolCount > 0 && (!busiest || c.toolCount > busiest.toolCount)) busiest = c;
    return {
      servedToday: this.stats.servedToday,
      stations: { ...this.stats.stations },
      active: chefs.filter((c) => c.seat !== null).length,
      waiting: chefs.filter((c) => c.seat === null).length,
      busiest: busiest ? { id: busiest.id, repo: busiest.repo, tools: busiest.toolCount } : null,
    };
  }
}

function publicChef(c) {
  return {
    id: c.id, source: c.source, repo: c.repo, model: c.model, title: c.title, client: c.client,
    automated: c.automated, status: c.status, attention: c.attention, station: c.station, tool: c.tool,
    ticket: c.ticket ? { ...c.ticket } : null, plates: c.plates.map((p) => ({ ...p })), actions: c.actions.map((a) => ({ ...a })),
    sous: c.sous.map((s) => ({ ...s })), toolCount: c.toolCount, served: c.served, seat: c.seat,
    lastActivity: c.lastActivity,
  };
}

module.exports = { KitchenState, repoOf, underDir };
