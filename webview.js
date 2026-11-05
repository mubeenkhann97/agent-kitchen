'use strict';
// Builds the VS Code webview HTML from public/index.html: webview script URIs, nonce-based CSP and initial state.

const SCRIPT_TAG = /<script src="\/([a-z][a-z0-9-]*\.js)"><\/script>/g;

function buildWebviewHtml({ indexHtml, scriptUri, cspSource, nonce, initialState }) {
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  // JSON in a data block; escaping "<" keeps "</script>" in values from closing the tag.
  const state = JSON.stringify(initialState || {}).replace(/</g, '\\u003c');
  let html = indexHtml.replace(SCRIPT_TAG, (_, name) => `<script nonce="${nonce}" src="${scriptUri(name)}"></script>`);
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
  html = html.replace('<body>', `<body>\n  <script type="application/json" id="initialState">${state}</script>`);
  return html;
}

function makeNonce() {
  return require('crypto').randomBytes(18).toString('base64');
}

const STORE_KEYS = new Set(['agentKitchenStyle', 'agentKitchenMuted']);

// Accepts only known keys with small string values from the webview.
function validStore(msg) {
  return !!msg && msg.type === 'store' && STORE_KEYS.has(msg.key) && typeof msg.value === 'string' && msg.value.length <= 4096;
}

module.exports = { buildWebviewHtml, makeNonce, validStore, STORE_KEYS };
