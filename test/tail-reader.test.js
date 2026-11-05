'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TailReader } = require('../tail-reader');

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kitchen-test-'));
  dirs.push(dir);
  return path.join(dir, name);
}

test('reads complete lines and buffers a partial line across appends', async () => {
  const f = tmpFile('a.jsonl');
  fs.writeFileSync(f, '{"n":1}\n{"n":');
  const r = new TailReader(f);
  assert.deepEqual((await r.poll()).items, [{ n: 1 }]);
  fs.appendFileSync(f, '2}\r\n{"n":3}\n');
  assert.deepEqual((await r.poll()).items, [{ n: 2 }, { n: 3 }]);
  assert.deepEqual((await r.poll()).items, []);
});

test('skips invalid JSON and blank lines', async () => {
  const f = tmpFile('b.jsonl');
  fs.writeFileSync(f, 'not json\n\n{"ok":true}\n[1,\n');
  const r = new TailReader(f);
  assert.deepEqual((await r.poll()).items, [{ ok: true }]);
});

test('handles a multi-byte UTF-8 character split across writes', async () => {
  const f = tmpFile('c.jsonl');
  const bytes = Buffer.from('{"t":"caf\u00e9 \ud83c\udf73"}\n', 'utf8');
  fs.writeFileSync(f, bytes.subarray(0, 12));
  const r = new TailReader(f);
  assert.deepEqual((await r.poll()).items, []);
  fs.appendFileSync(f, bytes.subarray(12));
  assert.deepEqual((await r.poll()).items, [{ t: 'caf\u00e9 \ud83c\udf73' }]);
});

test('large file: starts near the end and drops the first partial line', async () => {
  const f = tmpFile('big.jsonl');
  const line = JSON.stringify({ pad: 'x'.repeat(1000) }) + '\n';
  const fd = fs.openSync(f, 'w');
  for (let i = 0; i < 3500; i++) fs.writeSync(fd, line);
  fs.writeSync(fd, '{"last":true}\n');
  fs.closeSync(fd);
  const size = fs.statSync(f).size;
  assert.ok(size > 3 * 1024 * 1024);
  const r = new TailReader(f, { initialBytes: 256 * 1024 });
  const { items } = await r.poll();
  assert.ok(r.bytesRead <= 256 * 1024 + 1, `read ${r.bytesRead} bytes`);
  assert.deepEqual(items[items.length - 1], { last: true });
  assert.ok(items.slice(0, -1).every((o) => o.pad && o.pad.length === 1000));
  assert.ok(items.length < 300);
});

test('startAt end ignores existing content and reads only new lines', async () => {
  const f = tmpFile('e.jsonl');
  fs.writeFileSync(f, '{"old":1}\n');
  const r = new TailReader(f, { startAt: 'end' });
  assert.deepEqual((await r.poll()).items, []);
  fs.appendFileSync(f, '{"new":1}\n');
  assert.deepEqual((await r.poll()).items, [{ new: 1 }]);
});

test('caps bytes read per poll', async () => {
  const f = tmpFile('cap.jsonl');
  fs.writeFileSync(f, '');
  const r = new TailReader(f, { maxReadPerPoll: 100 });
  await r.poll();
  fs.appendFileSync(f, ('{"a":1}\n').repeat(50));
  const first = await r.poll();
  assert.equal(r.bytesRead, 100);
  const rest = [];
  for (let i = 0; i < 10; i++) rest.push(...(await r.poll()).items);
  assert.equal(first.items.length + rest.length, 50);
});

test('detects truncation and restarts', async () => {
  const f = tmpFile('t.jsonl');
  fs.writeFileSync(f, '{"a":1}\n{"a":2}\n');
  const r = new TailReader(f);
  await r.poll();
  fs.writeFileSync(f, '{"b":1}\n');
  const res = await r.poll();
  assert.equal(res.reset, true);
  assert.deepEqual(res.items, [{ b: 1 }]);
});

test('detects rotation (file replaced) and restarts', async () => {
  const f = tmpFile('r.jsonl');
  fs.writeFileSync(f, '{"a":1}\n');
  const r = new TailReader(f);
  await r.poll();
  const g = f + '.new';
  fs.writeFileSync(g, '{"rotated":1}\n{"rotated":2}\n{"rotated":3}\n');
  fs.rmSync(f);
  fs.renameSync(g, f);
  const res = await r.poll();
  assert.equal(res.reset, true);
  assert.deepEqual(res.items, [{ rotated: 1 }, { rotated: 2 }, { rotated: 3 }]);
});

test('drops an oversized line and recovers at the next newline', async () => {
  const f = tmpFile('o.jsonl');
  fs.writeFileSync(f, '');
  const r = new TailReader(f, { maxLineBytes: 1024, maxReadPerPoll: 512 });
  await r.poll();
  fs.appendFileSync(f, '{"huge":"' + 'y'.repeat(5000) + '"}\n{"after":1}\n');
  const items = [];
  for (let i = 0; i < 20; i++) items.push(...(await r.poll()).items);
  assert.deepEqual(items, [{ after: 1 }]);
  assert.equal(r.pending, null);
});

test('filter can skip lines without parsing them', async () => {
  const f = tmpFile('f.jsonl');
  fs.writeFileSync(f, '{"type":"api-request","x":1}\n{"type":"user"}\n');
  const r = new TailReader(f, { filter: (head) => !head.startsWith('{"type":"api-request') });
  assert.deepEqual((await r.poll()).items, [{ type: 'user' }]);
});

test('missing files are reported, not thrown', async () => {
  const r = new TailReader(path.join(os.tmpdir(), 'agent-kitchen-does-not-exist.jsonl'));
  assert.equal((await r.poll()).missing, true);
});
