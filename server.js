#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { KitchenState } = require('./kitchen-state');
const { normalizeHook } = require('./normalize');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4777;
const MAX_BODY = 64 * 1024;
const MAX_CLIENTS = 32;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Only plain file names that exist directly in public/ are served, so paths cannot escape it.
function staticFile(url) {
  const name = url === '/' ? 'index.html' : url.slice(1);
  if (!/^[a-z][a-z0-9-]*\.(html|js|css)$/.test(name)) return null;
  const file = path.join(PUBLIC, name);
  return fs.existsSync(file) ? [file, TYPES[path.extname(name)]] : null;
}
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function createServer(opts = {}) {
  const demo = !!opts.demo;
  const state = opts.state || new KitchenState();
  const clients = new Set();
  const stops = [];
  let port = opts.port ?? DEFAULT_PORT;

  const ingest = (events) => { for (const ev of events) state.apply(ev); };

  if (demo) {
    stops.push(require('./demo').startDemo(ingest, opts.demoOptions));
  } else if (opts.watch !== false) {
    const { ClaudeWatcher } = require('./watchers/claude');
    const { CopilotWatcher } = require('./watchers/copilot');
    const { VSCodeChatWatcher } = require('./watchers/vscode-chat');
    for (const w of [new ClaudeWatcher(), new CopilotWatcher(), new VSCodeChatWatcher()]) {
      w.onEvents(ingest);
      w.start();
      stops.push(() => w.stop());
    }
  }

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const flushTimer = setInterval(() => {
    const deltas = state.flush();
    if (!deltas.length) return;
    for (const res of clients) send(res, 'delta', deltas);
  }, 100);
  const tickTimer = setInterval(() => state.tick(), 5000);
  const pingTimer = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);

  // Rejects DNS-rebinding and cross-site requests; only local origins may talk to us.
  const allowedHost = (h) => h === `${HOST}:${port}` || h === `localhost:${port}`;
  const allowedOrigin = (o) => !o || o === `http://${HOST}:${port}` || o === `http://localhost:${port}`;

  const reject = (res, code, msg) => res.writeHead(code, { Connection: 'close' }).end(msg);

  const server = http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (!allowedHost(req.headers.host)) { reject(res, 403, 'Forbidden'); return; }
    const url = (req.url || '/').split('?')[0];

    const asset = req.method === 'GET' && staticFile(url);
    if (asset) {
      const [file, type] = asset;
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(buf);
      });
      return;
    }

    if (req.method === 'GET' && url === '/stream') {
      if (clients.size >= MAX_CLIENTS) { res.writeHead(503).end('Too many clients'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      send(res, 'snapshot', { ...state.snapshot(), demo });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'POST' && url === '/event') {
      if (!allowedOrigin(req.headers.origin)) { reject(res, 403, 'Forbidden'); return; }
      const chunks = [];
      let size = 0;
      let aborted = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY && !aborted) {
          aborted = true;
          reject(res, 413, 'Too large');
          req.resume();
          return;
        }
        if (!aborted) chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reject(res, 400, 'Bad JSON'); return; }
        ingest(normalizeHook(body));
        res.writeHead(204).end();
      });
      return;
    }

    res.writeHead(404).end('Not found');
  });

  return {
    server,
    state,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, () => {
          port = server.address().port;
          resolve(port);
        });
      });
    },
    close() {
      for (const stop of stops) stop();
      clearInterval(flushTimer);
      clearInterval(tickTimer);
      clearInterval(pingTimer);
      for (const res of clients) res.end();
      clients.clear();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const demo = args.includes('--demo');
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : (Number(process.env.AGENT_KITCHEN_PORT) || DEFAULT_PORT);
  const app = createServer({ demo, port });
  app.listen().then((p) => {
    console.log(`Agent Kitchen ${demo ? '(demo service) ' : ''}is open at http://${HOST}:${p}`);
  }).catch((err) => {
    console.error(`Could not start Agent Kitchen: ${err.message}`);
    process.exit(1);
  });
  const shutdown = () => { app.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer };
