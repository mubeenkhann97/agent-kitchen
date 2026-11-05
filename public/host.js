'use strict';
// Runs the page in either a browser (SSE + localStorage) or a VS Code webview (postMessage + extension storage).
(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  let stored = {};
  if (vscode) {
    const el = document.getElementById('initialState');
    try { stored = JSON.parse(el ? el.textContent : '{}') || {}; } catch { stored = {}; }
  }

  function connect({ onSnapshot, onDelta, onStatus }) {
    if (vscode) {
      window.addEventListener('message', (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'snapshot') { onStatus(true); onSnapshot(msg.data); }
        if (msg.type === 'delta' && Array.isArray(msg.data)) onDelta(msg.data);
      });
      vscode.postMessage({ type: 'ready' });
      return;
    }
    let es = null;
    let backoff = 1000;
    const open = () => {
      if (es) es.close();
      es = new EventSource('/stream');
      es.addEventListener('snapshot', (e) => { backoff = 1000; onStatus(true); onSnapshot(JSON.parse(e.data)); });
      es.addEventListener('delta', (e) => onDelta(JSON.parse(e.data)));
      es.onerror = () => {
        onStatus(false);
        if (es.readyState === EventSource.CLOSED) {
          setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, 15000);
        }
      };
    };
    open();
  }

  window.KitchenHost = {
    inVSCode: !!vscode,
    load(key) {
      if (vscode) return typeof stored[key] === 'string' ? stored[key] : null;
      try { return localStorage.getItem(key); } catch { return null; }
    },
    save(key, value) {
      if (vscode) {
        stored[key] = value;
        vscode.postMessage({ type: 'store', key, value });
        return;
      }
      try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
    },
    connect,
  };
})();
