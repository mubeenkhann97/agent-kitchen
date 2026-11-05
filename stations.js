'use strict';

const STATIONS = ['pantry', 'board', 'stove', 'market', 'rail', 'pass', 'prep'];

// Exact tool names (lower-cased) -> station. Add new mappings here.
const TOOL_STATIONS = {
  // Recipe shelf / pantry: reading and searching
  read: 'pantry', grep: 'pantry', glob: 'pantry', view: 'pantry', ls: 'pantry',
  notebookread: 'pantry', toolsearch: 'pantry', tool_search_tool: 'pantry', skill: 'pantry',
  // Cutting board: editing files
  edit: 'board', write: 'board', multiedit: 'board', create: 'board', notebookedit: 'board',
  str_replace: 'board', apply_patch: 'board',
  // Stove: running commands
  bash: 'stove', powershell: 'stove', read_bash: 'stove', write_bash: 'stove', stop_bash: 'stove',
  read_powershell: 'stove', write_powershell: 'stove', stop_powershell: 'stove',
  bashoutput: 'stove', killshell: 'stove', killbash: 'stove', monitor: 'stove', taskstop: 'stove',
  // Back door / market: the outside world
  webfetch: 'market', websearch: 'market', web_fetch: 'market', web_search: 'market',
  // Ticket rail: planning and delegation
  todowrite: 'rail', todoread: 'rail', sql: 'rail', exitplanmode: 'rail', update_todo: 'rail',
  task: 'rail', agent: 'rail',
};

const SUBAGENT_TOOLS = new Set(['task', 'agent']);
const ATTENTION_TOOLS = new Set(['askuserquestion', 'ask_user']);

function stationFor(tool) {
  if (!tool || typeof tool !== 'string') return 'prep';
  const t = tool.toLowerCase();
  if (TOOL_STATIONS[t]) return TOOL_STATIONS[t];
  if (/(^|_)(todo|plan)/.test(t)) return 'rail';
  if (t.startsWith('mcp__') || t.startsWith('github-mcp-server-')) return 'market';
  // Copilot MCP tools are named "<server>-<tool>".
  if (t.includes('-')) return 'market';
  return 'prep';
}

function isSubagentTool(tool) {
  return typeof tool === 'string' && SUBAGENT_TOOLS.has(tool.toLowerCase());
}

function isAttentionTool(tool) {
  return typeof tool === 'string' && ATTENTION_TOOLS.has(tool.toLowerCase());
}

function clean(s, max) {
  if (s == null) return '';
  let t = String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1) + '\u2026';
  return t;
}

function baseName(p) {
  if (!p || typeof p !== 'string') return '';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function hostOf(url) {
  try { return new URL(String(url)).host; } catch { return ''; }
}

function mcpServer(tool) {
  if (tool.startsWith('mcp__')) return tool.split('__')[1] || 'supplier';
  if (tool.startsWith('github-mcp-server-')) return 'github';
  return tool.split('-')[0];
}

// Only whitelisted, truncated input fields are ever used.
function summarize(tool, input) {
  const i = input && typeof input === 'object' ? input : {};
  const file = baseName(i.file_path || i.path || i.notebook_path || i.filePath);
  const t = String(tool || '').toLowerCase();
  if (t === 'read' || t === 'view' || t === 'ls' || t === 'notebookread') return file;
  if (t === 'grep' || t === 'glob') return clean(i.pattern || i.query, 30);
  if (stationFor(t) === 'board') return file;
  if (stationFor(t) === 'stove') return clean(i.command || i.description, 40);
  if (t === 'webfetch' || t === 'web_fetch') return hostOf(i.url);
  if (t === 'websearch' || t === 'web_search') return clean(i.query, 30);
  if (isSubagentTool(t)) return clean(i.description || i.subagent_type || i.agent_type, 40);
  return '';
}

function describeAction(tool, detail) {
  const t = String(tool || '').toLowerCase();
  const d = detail ? String(detail) : '';
  if (isAttentionTool(t)) return 'asking the boss a question';
  if (isSubagentTool(t)) return d ? `briefing a sous-chef: ${d}` : 'briefing a sous-chef';
  switch (t) {
    case 'read': case 'view': case 'notebookread': return d ? `reading the recipe for ${d}` : 'reading a recipe';
    case 'ls': return d ? `checking the shelf ${d}` : 'checking the shelves';
    case 'grep': return d ? `searching the pantry for "${d}"` : 'searching the pantry';
    case 'glob': return d ? `rummaging the shelves for ${d}` : 'rummaging the shelves';
    case 'write': case 'create': return d ? `prepping a fresh ${d}` : 'prepping a fresh dish';
    case 'webfetch': case 'web_fetch': return d ? `running to market at ${d}` : 'running to market';
    case 'websearch': case 'web_search': return d ? `asking the market about "${d}"` : 'asking around the market';
    case 'todowrite': case 'update_todo': return 'pinning tickets on the rail';
    case 'sql': return 'checking the order book';
  }
  const station = stationFor(t);
  if (station === 'board') return d ? `chopping ${d}` : 'chopping';
  if (station === 'stove') return d ? `firing up \`${d}\`` : 'firing up the stove';
  if (station === 'market') return `calling supplier ${mcpServer(t)}`;
  if (station === 'rail') return 'planning at the ticket rail';
  if (station === 'pantry') return d ? `reading up on ${d}` : 'checking the pantry';
  return `prepping with ${clean(tool, 30)}`;
}

module.exports = {
  STATIONS, TOOL_STATIONS, stationFor, isSubagentTool, isAttentionTool, summarize, describeAction, clean, baseName,
};
