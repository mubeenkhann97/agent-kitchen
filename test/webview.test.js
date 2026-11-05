'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildWebviewHtml, makeNonce, validStore } = require('../webview');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function build(initialState) {
  return buildWebviewHtml({
    indexHtml,
    scriptUri: (name) => `vscode-webview://abc/public/${name}`,
    cspSource: 'vscode-webview://abc',
    nonce: 'NONCE123',
    initialState,
  });
}

test('rewrites every script to a nonce-tagged webview URI', () => {
  const html = build({});
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)];
  assert.ok(scripts.length >= 4);
  for (const m of scripts) {
    assert.match(m[0], /nonce="NONCE123"/);
    assert.match(m[1], /^vscode-webview:\/\/abc\/public\/[a-z-]+\.js$/);
  }
  assert.ok(!/src="\//.test(html), 'no absolute server paths remain');
});

test('adds a strict CSP without network access', () => {
  const html = build({});
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-NONCE123'/);
  assert.match(csp, /connect-src 'none'/);
  assert.ok(!csp.includes('unsafe-eval'));
});

test('embeds initial state safely', () => {
  const html = build({ agentKitchenStyle: '</script><script>alert(1)</script>' });
  const block = /<script type="application\/json" id="initialState">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!block.includes('</script>'));
  assert.equal(JSON.parse(block).agentKitchenStyle, '</script><script>alert(1)</script>');
});

test('nonces are random and store messages are validated', () => {
  assert.notEqual(makeNonce(), makeNonce());
  assert.ok(validStore({ type: 'store', key: 'agentKitchenStyle', value: '{}' }));
  assert.ok(!validStore({ type: 'store', key: 'other', value: '{}' }));
  assert.ok(!validStore({ type: 'store', key: 'agentKitchenMuted', value: 1 }));
  assert.ok(!validStore({ type: 'store', key: 'agentKitchenStyle', value: 'x'.repeat(5000) }));
});
