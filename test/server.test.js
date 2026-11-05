'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../server');

function request(port, opts = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', agent: false, ...opts, headers: { host: `127.0.0.1:${port}`, ...(opts.headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function firstSnapshot(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/stream', agent: false }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        const m = /event: snapshot\ndata: (.*)\n\n/.exec(buf);
        if (m) { req.destroy(); resolve({ headers: res.headers, data: JSON.parse(m[1]) }); }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

test('serves the page, streams a snapshot, accepts hooks and rejects foreign hosts', async () => {
  const app = createServer({ port: 0, watch: false });
  const port = await app.listen();
  try {
    const page = await request(port);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);

    const bad = await request(port, { headers: { host: `evil.example:${port}` } });
    assert.equal(bad.status, 403);

    const notFound = await request(port, { path: '/../server.js' });
    assert.equal(notFound.status, 404);

    const hook = JSON.stringify({ session_id: 'h1', hook_event_name: 'UserPromptSubmit', prompt: 'Hi chef', cwd: 'C:\\Dev\\Hooked' });
    const posted = await request(port, { method: 'POST', path: '/event', headers: { 'content-type': 'application/json' } }, hook);
    assert.equal(posted.status, 204);

    const cross = await request(port, { method: 'POST', path: '/event', headers: { origin: 'https://evil.example' } }, hook);
    assert.equal(cross.status, 403);

    const big = await request(port, { method: 'POST', path: '/event' }, 'x'.repeat(70 * 1024)).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);

    const snap = await firstSnapshot(port);
    assert.match(snap.headers['content-type'], /text\/event-stream/);
    assert.equal(snap.data.type, 'snapshot');
    assert.equal(snap.data.chefs[0].repo, 'Hooked');
    assert.equal(snap.data.chefs[0].ticket.text, 'Hi chef');
  } finally {
    await app.close();
  }
});

test('demo mode produces chefs', async () => {
  const app = createServer({ port: 0, demo: true, demoOptions: { speed: 20 } });
  const port = await app.listen();
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const snap = await firstSnapshot(port);
    assert.equal(snap.data.demo, true);
    assert.ok(snap.data.chefs.length >= 4, `chefs: ${snap.data.chefs.length}`);
    assert.ok(snap.data.chefs.some((c) => c.source === 'claude') && snap.data.chefs.some((c) => c.source === 'copilot'));
  } finally {
    await app.close();
  }
});
