'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { KitchenState, underDir } = require('../kitchen-state');

const TMP = process.platform === 'win32' ? 'C:\\Temp' : '/tmp/agent-kitchen';
const T0 = new Date(2026, 10, 5, 12, 0, 0).getTime();
function make(opts = {}) {
  let now = T0;
  const k = new KitchenState({ now: () => now, tmpdir: TMP, ...opts });
  return { k, advance: (ms) => { now += ms; }, at: () => now };
}
const ev = (o) => ({ source: 'claude', ts: T0, cwd: 'C:\\Dev\\Shop', ...o });

test('order creates a chef with a ticket and a waiter effect', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 's1', kind: 'order', text: 'Fix bug' }));
  const out = k.flush();
  const chef = out.find((d) => d.type === 'chef').chef;
  assert.equal(chef.repo, 'Shop');
  assert.equal(chef.ticket.text, 'Fix bug');
  assert.equal(chef.status, 'cooking');
  assert.equal(chef.seat, 0);
  assert.ok(out.some((d) => d.type === 'fx' && d.fx === 'order'));
});

test('backfill events update state silently', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 's1', kind: 'order', text: 'x', backfill: true }));
  k.apply(ev({ sessionId: 's1', kind: 'turn_end', backfill: true }));
  const out = k.flush();
  assert.ok(!out.some((d) => d.type === 'fx'));
  assert.equal(k.snapshot().stats.servedToday, 0);
});

test('tool start/end move the chef and count stations; duplicates are ignored', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 's1', kind: 'tool_start', tool: 'Edit', station: 'board', toolUseId: 'u1', text: 'chopping a.js' }));
  k.apply(ev({ sessionId: 's1', kind: 'tool_start', tool: 'Edit', station: 'board', toolUseId: 'u1', text: 'chopping a.js', viaHook: true }));
  let chef = k.snapshot().chefs[0];
  assert.equal(chef.station, 'board');
  assert.equal(chef.toolCount, 1);
  assert.equal(k.snapshot().stats.stations.board, 1);
  k.apply(ev({ sessionId: 's1', kind: 'tool_end', toolUseId: 'u1' }));
  k.apply(ev({ sessionId: 's1', kind: 'tool_start', tool: 'Edit', station: 'board', toolUseId: 'u1' }));
  chef = k.snapshot().chefs[0];
  assert.equal(chef.toolCount, 1, 'late duplicate after end is ignored');
  assert.deepEqual(chef.actions.map((a) => a.text), ['chopping a.js']);
});

test('turn_end serves the order once', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 's1', kind: 'order', text: 'x' }));
  k.apply(ev({ sessionId: 's1', kind: 'turn_end' }));
  k.apply(ev({ sessionId: 's1', kind: 'turn_end', viaHook: true }));
  const out = k.flush();
  assert.equal(out.filter((d) => d.fx === 'order_up').length, 1);
  const s = k.snapshot();
  assert.equal(s.stats.servedToday, 1);
  assert.equal(s.chefs[0].ticket, null);
});

test('duplicate orders from hook and transcript are merged', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 's1', kind: 'order', text: 'same', viaHook: true }));
  k.apply(ev({ sessionId: 's1', kind: 'order', text: 'same', ts: T0 + 800 }));
  assert.equal(k.flush().filter((d) => d.fx === 'order').length, 1);
});

test('needs_attention is cleared by the next activity', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 's1', kind: 'tool_start', tool: 'Bash', toolUseId: 'b' }));
  k.apply(ev({ sessionId: 's1', kind: 'needs_attention', text: 'needs permission' }));
  assert.equal(k.snapshot().chefs[0].status, 'attention');
  assert.ok(k.flush().some((d) => d.fx === 'attention'));
  k.apply(ev({ sessionId: 's1', kind: 'tool_end', toolUseId: 'b' }));
  assert.equal(k.snapshot().chefs[0].attention, null);
});

test('seats at most 12 chefs, interactive before automated', () => {
  const { k, advance } = make();
  for (let i = 0; i < 12; i++) {
    advance(1000);
    k.apply(ev({ sessionId: `auto${i}`, kind: 'order', text: 'x', cwd: path.join(TMP, `job${i}`), ts: T0 + i * 1000 }));
  }
  k.apply(ev({ sessionId: 'me', kind: 'order', text: 'mine', cwd: 'C:\\Dev\\App', ts: T0 + 20000 }));
  const s = k.snapshot();
  assert.equal(s.chefs.filter((c) => c.seat !== null).length, 12);
  assert.notEqual(s.chefs.find((c) => c.id === 'me').seat, null);
  assert.equal(s.chefs.find((c) => c.id === 'auto0').seat, null, 'oldest automated chef waits');
  assert.equal(s.stats.waiting, 1);
  k.apply(ev({ sessionId: 'auto5', kind: 'session_end' }));
  assert.notEqual(k.snapshot().chefs.find((c) => c.id === 'auto0').seat, null, 'waiting chef is promoted');
});

test('chefs expire after 10 minutes of inactivity', () => {
  const { k, advance } = make();
  k.apply(ev({ sessionId: 's1', kind: 'order', text: 'x' }));
  advance(9 * 60 * 1000);
  k.tick();
  assert.equal(k.snapshot().chefs.length, 1);
  advance(2 * 60 * 1000);
  k.tick();
  assert.equal(k.snapshot().chefs.length, 0);
  assert.ok(k.flush().some((d) => d.type === 'remove' && d.id === 's1'));
});

test('old events and title-only metadata do not create chefs', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 's1', kind: 'session_start', title: 'My order' }));
  k.apply(ev({ sessionId: 's2', kind: 'order', text: 'ancient', ts: T0 - 60 * 60 * 1000 }));
  assert.equal(k.snapshot().chefs.length, 0);
  k.apply(ev({ sessionId: 's1', kind: 'tool_start', tool: 'Read', toolUseId: 'r' }));
  assert.equal(k.snapshot().chefs[0].title, 'My order');
});

test('sous-chefs join and leave their parent', () => {
  const { k } = make();
  k.apply(ev({ sessionId: 'p', kind: 'tool_start', tool: 'Task', toolUseId: 't1' }));
  k.apply(ev({ sessionId: 't1', parentId: 'p', kind: 'subagent_start', text: 'Scout' }));
  k.apply(ev({ sessionId: 't1', parentId: 'p', kind: 'tool_start', tool: 'Grep', station: 'pantry', text: 'searching' }));
  let chef = k.snapshot().chefs[0];
  assert.equal(chef.sous.length, 1);
  assert.equal(chef.sous[0].station, 'pantry');
  k.apply(ev({ sessionId: 'p', kind: 'tool_end', toolUseId: 't1' }));
  chef = k.snapshot().chefs[0];
  assert.equal(chef.sous.length, 0);
  const fx = k.flush().filter((d) => d.type === 'fx').map((d) => d.fx);
  assert.ok(fx.includes('sous_enter') && fx.includes('sous_leave'));
});

test('served counter resets at local midnight', () => {
  const { k, advance } = make();
  k.apply(ev({ sessionId: 's1', kind: 'order', text: 'x' }));
  k.apply(ev({ sessionId: 's1', kind: 'turn_end' }));
  assert.equal(k.snapshot().stats.servedToday, 1);
  advance(13 * 60 * 60 * 1000);
  k.tick();
  assert.equal(k.snapshot().stats.servedToday, 0);
});

test('underDir is boundary-safe (and case-insensitive on Windows)', () => {
  assert.ok(underDir(path.join(TMP, 'job'), TMP));
  assert.ok(!underDir(`${TMP}orary${path.sep}job`, TMP));
  if (process.platform === 'win32') assert.ok(underDir('C:\\Temp\\job', 'c:\\temp'));
});
