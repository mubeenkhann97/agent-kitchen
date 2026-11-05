'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { KitchenState } = require('./kitchen-state');
const { buildWebviewHtml, makeNonce, validStore, STORE_KEYS } = require('./webview');

const NOTIFY_COOLDOWN_MS = 60 * 1000;
const kitchens = new Map(); // 'live' | 'demo' -> kitchen
let context = null;
let statusItem = null;

const config = () => vscode.workspace.getConfiguration('agentKitchen');

function startKitchen(mode) {
  const state = new KitchenState();
  const kitchen = { mode, state, panels: new Set(), stops: [], notified: new Map(), keepAlive: false };
  const ingest = (events) => { for (const ev of events) state.apply(ev); };
  if (mode === 'demo') {
    kitchen.stops.push(require('./demo').startDemo(ingest));
  } else {
    const { ClaudeWatcher } = require('./watchers/claude');
    const { CopilotWatcher } = require('./watchers/copilot');
    const cfg = config();
    const watchers = [
      new ClaudeWatcher({ root: cfg.get('claudeProjectsDir') || undefined }),
      new CopilotWatcher({ root: cfg.get('copilotSessionDir') || undefined }),
    ];
    for (const w of watchers) {
      w.onEvents(ingest);
      w.start();
      kitchen.stops.push(() => w.stop());
    }
  }
  const flush = setInterval(() => {
    const deltas = state.flush();
    if (!deltas.length) return;
    for (const panel of kitchen.panels) panel.webview.postMessage({ type: 'delta', data: deltas });
    if (mode === 'live') {
      updateStatus();
      notifyAttention(kitchen, deltas);
    }
  }, 100);
  const tick = setInterval(() => state.tick(), 5000);
  kitchen.stops.push(() => { clearInterval(flush); clearInterval(tick); });
  kitchens.set(mode, kitchen);
  updateStatus();
  return kitchen;
}

function stopKitchen(kitchen) {
  for (const stop of kitchen.stops) stop();
  kitchens.delete(kitchen.mode);
  updateStatus();
}

function webviewHtml(webview) {
  const pub = vscode.Uri.joinPath(context.extensionUri, 'public');
  const indexHtml = fs.readFileSync(path.join(pub.fsPath, 'index.html'), 'utf8');
  const initialState = {};
  for (const key of STORE_KEYS) {
    const v = context.globalState.get(key);
    if (typeof v === 'string') initialState[key] = v;
  }
  return buildWebviewHtml({
    indexHtml,
    scriptUri: (name) => webview.asWebviewUri(vscode.Uri.joinPath(pub, name)).toString(),
    cspSource: webview.cspSource,
    nonce: makeNonce(),
    initialState,
  });
}

function openPanel(mode) {
  const kitchen = kitchens.get(mode) || startKitchen(mode);
  const existing = kitchen.panels.values().next().value;
  if (existing) {
    existing.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'agentKitchen',
    mode === 'demo' ? 'Agent Kitchen (demo)' : 'Agent Kitchen',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'public')],
    },
  );
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
  panel.webview.html = webviewHtml(panel.webview);
  kitchen.panels.add(panel);
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg && msg.type === 'ready') {
      panel.webview.postMessage({ type: 'snapshot', data: { ...kitchen.state.snapshot(), demo: mode === 'demo' } });
    } else if (validStore(msg)) {
      context.globalState.update(msg.key, msg.value);
    }
  });
  panel.onDidDispose(() => {
    kitchen.panels.delete(panel);
    if (!kitchen.panels.size && !kitchen.keepAlive) stopKitchen(kitchen);
  });
}

function updateStatus() {
  if (!statusItem) return;
  const kitchen = kitchens.get('live');
  if (!kitchen) {
    statusItem.hide();
    return;
  }
  const chefs = [...kitchen.state.chefs.values()];
  const attention = chefs.filter((c) => c.status === 'attention');
  statusItem.text = `$(flame) ${chefs.length}${attention.length ? `  $(bell-dot) ${attention.length}` : ''}`;
  statusItem.tooltip = attention.length
    ? `Agent Kitchen: ${chefs.length} chef(s), needs you: ${attention.map((c) => c.repo).join(', ')}`
    : `Agent Kitchen: ${chefs.length} chef(s) cooking`;
  statusItem.backgroundColor = attention.length ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  statusItem.show();
}

// Pops a notification when a chef needs you and no kitchen tab is visible.
function notifyAttention(kitchen, deltas) {
  if (!config().get('notifyOnAttention')) return;
  if ([...kitchen.panels].some((p) => p.visible)) return;
  const now = Date.now();
  for (const d of deltas) {
    if (d.type !== 'fx' || d.fx !== 'attention') continue;
    if (now - (kitchen.notified.get(d.chefId) || 0) < NOTIFY_COOLDOWN_MS) continue;
    kitchen.notified.set(d.chefId, now);
    const chef = kitchen.state.chefs.get(d.chefId);
    const who = chef ? chef.repo : 'A chef';
    vscode.window.showInformationMessage(`Agent Kitchen: ${who} ${d.text || 'needs your attention'}`, 'Open Kitchen')
      .then((choice) => { if (choice) openPanel('live'); });
  }
}

function activate(ctx) {
  context = ctx;
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = 'agentKitchen.open';
  ctx.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('agentKitchen.open', () => openPanel('live')),
    vscode.commands.registerCommand('agentKitchen.openDemo', () => openPanel('demo')),
    { dispose: () => { for (const k of [...kitchens.values()]) stopKitchen(k); } },
  );
  if (config().get('startOnLaunch')) {
    const kitchen = kitchens.get('live') || startKitchen('live');
    kitchen.keepAlive = true;
  }
}

function deactivate() {
  for (const k of [...kitchens.values()]) stopKitchen(k);
}

module.exports = { activate, deactivate };
