#!/usr/bin/env node
'use strict';
// Claude Code hook forwarder: posts a trimmed hook payload to Agent Kitchen. Never blocks, never prints.
const http = require('http');

const PORT = Number(process.env.AGENT_KITCHEN_PORT) || 4777;
const MAX_STDIN = 8 * 1024 * 1024;
const INPUT_KEYS = ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'subagent_type'];

const exit = () => process.exit(0);
setTimeout(exit, 500);

function cut(v, n) {
  return typeof v === 'string' ? v.slice(0, n) : undefined;
}

function trim(o) {
  const out = {
    session_id: cut(o.session_id, 200),
    hook_event_name: cut(o.hook_event_name, 60),
    tool_name: cut(o.tool_name, 200),
    tool_use_id: cut(o.tool_use_id, 200),
    cwd: cut(o.cwd, 1000),
    prompt: cut(o.prompt, 300),
    message: cut(o.message, 300),
  };
  if (o.tool_input && typeof o.tool_input === 'object') {
    out.tool_input = {};
    for (const k of INPUT_KEYS) if (typeof o.tool_input[k] === 'string') out.tool_input[k] = o.tool_input[k].slice(0, 300);
  }
  return out;
}

const chunks = [];
let size = 0;
process.stdin.on('data', (c) => {
  size += c.length;
  if (size > MAX_STDIN) exit();
  chunks.push(c);
});
process.stdin.on('error', exit);
process.stdin.on('end', () => {
  let body;
  try {
    body = JSON.stringify(trim(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
  } catch {
    exit();
    return;
  }
  const req = http.request({
    host: '127.0.0.1', port: PORT, path: '/event', method: 'POST', timeout: 500,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, (res) => { res.resume(); res.on('end', exit); });
  req.on('error', exit);
  req.on('timeout', () => { req.destroy(); exit(); });
  req.end(body);
});
