# Agent Kitchen

A live pixel-art restaurant kitchen for your AI coding agents. Every active **Claude Code** session and **GitHub Copilot** session (Copilot CLI and Copilot Chat in VS Code) is a chef cooking an order. Waiters bring tickets and carry plates, sous-chefs help out, and the head chef walks over when someone needs you.

- Zero npm dependencies: Node built-ins plus plain HTML/CSS/JS with `<canvas>`. No build step.
- Zero config: it tails the session log files directly. Hooks are optional.
- Local and read-only: never writes to `~/.claude` or `~/.copilot`, never sends data anywhere.

Two ways to run the same kitchen: as a **VS Code extension** or as a **local web server** (`npm start`).

## In VS Code

Install **Agent Kitchen** from the Marketplace (or a `.vsix` from [GitHub Releases](https://github.com/mubeenkhann97/agent-kitchen/releases) via *Extensions → … → Install from VSIX*), then run:

- **Agent Kitchen: Open Kitchen** from the Command Palette to open the kitchen in an editor tab.
- **Agent Kitchen: Open Demo Service** to see a synthetic busy service.

While the kitchen is open, the status bar shows the number of chefs and anyone who needs you; click it to jump to the kitchen. Settings:

| Setting | Default | |
|---|---|---|
| `agentKitchen.startOnLaunch` | `false` | Watch sessions from VS Code startup so the status bar is always live. |
| `agentKitchen.notifyOnAttention` | `true` | Notify when a chef needs you and the kitchen tab isn't visible. |
| `agentKitchen.claudeProjectsDir` | `~/.claude/projects` | Override the Claude transcripts folder. |
| `agentKitchen.copilotSessionDir` | `~/.copilot/session-state` | Override the Copilot session folder. |
| `agentKitchen.includeVSCodeChat` | `true` | Show Copilot Chat sessions from this VS Code (Chat view, agent mode). |

The extension opens no network port; the kitchen talks to the webview over VS Code's message channel under a strict Content Security Policy.

## Run from source (local web server)

Requires Node 20+ (developed on Node 24).

```powershell
git clone https://github.com/mubeenkhann97/agent-kitchen
cd agent-kitchen
npm start          # live: your real sessions
npm run demo       # synthetic busy service (node server.js --demo)
npm test           # node:test unit tests
```

Open <http://127.0.0.1:4777>. Use `--port=5000` (or `AGENT_KITCHEN_PORT`) to change the port. The server binds to `127.0.0.1` only.

## How it works

```
watchers/claude.js      ─┐
watchers/copilot.js     ─┤
watchers/vscode-chat.js ─┼─► normalize.js ─► kitchen-state.js ─┬─► SSE /stream ─► public/  (server.js, npm start)
POST /event (hooks)     ─┘                                     └─► postMessage ─► webview  (extension.js)
```

| File | Role |
|---|---|
| `tail-reader.js` | Byte-offset JSONL tailer. Starts 256 KB from the end of active files (only new bytes for older ones), keeps a partial-line buffer, survives split UTF-8, truncation and file replacement, caps reads per poll and drops oversized lines. Opens files read-only for each poll and closes them straight away. |
| `watchers/claude.js` | Polls `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` and `<sessionId>/subagents/agent-*.jsonl` once a second with `fs.stat` (no reliance on `fs.watch`). Directory listings are refreshed only when a folder's mtime changes. Subagent `.meta.json` links a sous-chef to the `Task` call that launched it. |
| `watchers/copilot.js` | Polls `~/.copilot/session-state/<id>/events.jsonl`, reads `workspace.yaml` (cwd, name) and `inuse.<pid>.lock` (a vanished lock or dead PID ends the session). |
| `watchers/vscode-chat.js` | Polls VS Code Copilot Chat sessions in `<VS Code user dir>/workspaceStorage/<id>/chatSessions/*.jsonl` (and `globalStorage/emptyWindowChatSessions`), taking the repo from the workspace's `workspace.json`. The format is a snapshot plus property-set and array-push operations; tool parts are de-duplicated by `toolCallId`. Active chats are checked every second, idle ones every 5 s, so a brand-new chat can take up to ~5 s to appear. Covers VS Code Stable and Insiders. |
| `normalize.js` | Turns every source into `{source, sessionId, parentId?, kind, tool?, station?, text?, cwd, model?, ts}` with `kind` ∈ `session_start, order, tool_start, tool_end, turn_end, needs_attention, subagent_start, subagent_end, session_end`. Optional extras: `title`, `toolUseId`, `backfill`. |
| `kitchen-state.js` | Authoritative state: chefs, tickets, sous-chefs, stats. Deduplicates hook + transcript events, seats up to 12 chefs (interactive before automated), expires chefs after 10 min idle, and emits a snapshot on connect, then batched deltas every 100 ms. |
| `server.js` | HTTP server for `npm start`: static files, `GET /stream` (SSE), `POST /event` (hooks). |
| `extension.js` / `webview.js` | VS Code extension: runs the same watchers and state, shows `public/` in a webview with a nonce-based CSP, stores your Customise choices in VS Code. |
| `public/` | `index.html` (ticket rail, clipboard panel, Customise dialog), `host.js` (browser vs VS Code transport and storage), `sprites.js` (procedural pixel art and style variants), `settings.js` (look-and-feel settings), `game.js` (map, A* pathing, characters, animations, sounds). |
| `demo.js` | Seeded synthetic service that feeds raw-format lines through the real normalizers. |

### Session semantics

- **Active:** a session file changed in the last 10 minutes. On startup, active files are backfilled silently (no waiters or sounds); events older than 60 s are always treated as backfill.
- **Claude order:** a `user` line with string content. `tool_result` items finish tools, assistant `tool_use` items start them, and `stop_reason: "end_turn"` serves the order.
- **Copilot order:** `user.message` (`data.content` only). `assistant.turn_end` fires after every model call, so the order is only served when the preceding `assistant.message` requested no tools.
- **Automated sessions:** cwd under the OS temp folder (e.g. SDK runs). They get a "line cook" tag and are seated after interactive sessions.
- **Repo name:** Claude chefs are named after the project root encoded in the folder name, even if the agent `cd`s into a subfolder.

### Cast and stations

| Role | Represents |
|---|---|
| Chef (hat band orange = Claude, purple = Copilot) | A top-level session. Walks to the station for its current tool. |
| Sous-chef (smaller) | A subagent (Claude `Task`/`Agent`, Copilot `task`). |
| Waiter | Brings a ticket on a new prompt; carries the plate from the pass to the chef's own table on order-up. |
| Head chef | Stands at the pass; walks to any chef that needs attention. |

| Station | Tools |
|---|---|
| 📖 Recipe shelf | Read, Grep, Glob, LS, view, grep, glob |
| 🔪 Cutting board | Edit, Write, MultiEdit, NotebookEdit, edit, create |
| 🔥 Stove | Bash, PowerShell, powershell, bash |
| 🛒 Market (back door) | WebFetch, WebSearch, web_fetch, `mcp__*`, `github-mcp-server-*`, other `<server>-<tool>` MCP tools |
| 📋 Ticket rail | TodoWrite, sql, Task/task, planning tools |
| 🛎️ The pass | Order up (turn end) |
| 🥣 Prep counter | Anything unknown |

## UI

- Ticket rail: one ticket per open order with source, repo, prompt (≤ 80 chars) and elapsed time. Amber after 2 min, red after 5. Click a ticket to select its chef.
- Dining room: each seated chef owns half a table (place card in its source colour). Served orders stay on that table (up to 3 plates) until the chef gets its next order; the ×N badge counts orders served since the kitchen opened, and these add up to "Orders served today". Hover a table to see who sits there and what was served; click it to select the chef.
- Click a chef to see its last five actions as kitchen lines ("chopping animate.py", "firing up `npm test`"). `Esc` closes the bubble.
- Sounds (order-up bell, attention chime) are generated with WebAudio. The mute toggle is off by default; browsers only start audio after your first click or key press.
- **Customise** (header button) changes the look, saved in your browser's localStorage:
  - Chefs: hat (tall toque, skull cap, beret, bandana, none), hat colour, jacket colour, skin tone and hair colour ("Mixed" gives each chef a stable random look). The hat band always shows the source colour.
  - Tables: square or round, tablecloth (white, red check, blue check, green, bare wood), centrepiece (flowers, candle, none).
  - Plants: fern, flower bush, cactus, little tree or monstera, in a terracotta, white, blue or black pot.
  - Display: object size (normal, large, extra large) and show/hide the clipboard for a wider kitchen.
- The stream reconnects automatically.

## Optional: Claude Code hooks (web server only)

The VS Code extension doesn't open a port, so hooks apply to `npm start` only.

Transcripts never contain permission prompts, so hooks add instant **"needs attention"** events. `hook.js` reads the hook payload, keeps only safe fields (ids, event name, tool name, file path/command/pattern/url, prompt and message, truncated), posts it to `127.0.0.1:4777/event`, never prints anything, always exits 0, and gives up after 500 ms.

Add this to `~/.claude/settings.json` yourself (Agent Kitchen never edits it), adjusting the path:

```json
{
  "hooks": {
    "Notification":     [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/Personal Claude/MK Restaurant/hook.js\"" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/Personal Claude/MK Restaurant/hook.js\"" }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"C:/Dev/Personal Claude/MK Restaurant/hook.js\"" }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"C:/Dev/Personal Claude/MK Restaurant/hook.js\"" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/Personal Claude/MK Restaurant/hook.js\"" }] }]
  }
}
```

`Notification` alone is enough for the attention feature; the others only make updates faster. Duplicate hook and transcript events are merged.

## Privacy

- Reads only; files are opened with the `r` flag and closed after each poll. Nothing is written under `~/.claude` or `~/.copilot`.
- Server listens on `127.0.0.1` only, rejects foreign `Host` headers (DNS rebinding) and cross-site `Origin`s on `POST /event`, and sends a strict CSP.
- The UI shows prompt text truncated to about 80 characters, file base names, commands truncated to 40 characters and URL host names. Tool results, file contents, assistant text, thinking text, Copilot `transformedContent` and VS Code terminal output are never read into events.
- All text is rendered with `textContent` or canvas text, never as HTML.

## Add a new tool → station mapping

Edit `TOOL_STATIONS` in [stations.js](stations.js). Keys are lower-cased tool names:

```js
const TOOL_STATIONS = {
  // ...
  mytool: 'board',
};
```

Valid stations: `pantry`, `board`, `stove`, `market`, `rail`, `pass`, `prep`. For a nicer kitchen line, add a `case` to `describeAction()` and pick which input fields `summarize()` may show (only whitelisted fields are ever used). Add a test case to `test/stations.test.js`.

## Configuration (web server)

| Variable | Default |
|---|---|
| `AGENT_KITCHEN_PORT` | `4777` |
| `AGENT_KITCHEN_CLAUDE_DIR` | `~/.claude/projects` |
| `AGENT_KITCHEN_COPILOT_DIR` | `~/.copilot/session-state` |

## Releasing (maintainers)

Publishing runs from GitHub Actions with Marketplace **Trusted Publishing** (OIDC), so no token is stored in the repo.

1. One-time: at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) → publisher `BeenTech` → **Trusted Publishing** → Create: owner `mubeenkhann97`, repository `agent-kitchen`, workflow `publish.yml`, environment empty.
2. Bump `version` in `package.json`, commit, then tag and push: `git tag v1.0.1 && git push origin v1.0.1`.
3. [`.github/workflows/publish.yml`](.github/workflows/publish.yml) runs the tests, packages the `.vsix`, publishes it to the Marketplace, and attaches it to a GitHub Release. If an `OVSX_PAT` repository secret exists it also publishes to [Open VSX](https://open-vsx.org) (Cursor, VSCodium, Windsurf).

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the tests on Windows, Linux and macOS for every push and pull request and uploads a test `.vsix`. To build one locally: `npm run package`. Regenerate the icon with `npm run icon`.
