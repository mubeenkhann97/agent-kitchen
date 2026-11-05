'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stationFor, describeAction, summarize } = require('../stations');

test('maps Claude tools to stations', () => {
  const cases = {
    Read: 'pantry', Grep: 'pantry', Glob: 'pantry', LS: 'pantry',
    Edit: 'board', Write: 'board', MultiEdit: 'board', NotebookEdit: 'board',
    Bash: 'stove', WebFetch: 'market', WebSearch: 'market', TodoWrite: 'rail', Task: 'rail', Agent: 'rail',
  };
  for (const [tool, station] of Object.entries(cases)) assert.equal(stationFor(tool), station, tool);
});

test('maps Copilot tools to stations', () => {
  const cases = {
    view: 'pantry', grep: 'pantry', glob: 'pantry', edit: 'board', create: 'board',
    powershell: 'stove', bash: 'stove', web_fetch: 'market', sql: 'rail', task: 'rail',
  };
  for (const [tool, station] of Object.entries(cases)) assert.equal(stationFor(tool), station, tool);
});

test('MCP tools go to the market, planning tools to the rail', () => {
  assert.equal(stationFor('mcp__github__create_issue'), 'market');
  assert.equal(stationFor('github-mcp-server-search_repositories'), 'market');
  assert.equal(stationFor('cambridge-insight-dev-insight_list_repositories'), 'market');
  assert.equal(stationFor('mcp__ccd_turn__update_plan'), 'rail');
});

test('unknown tools go to the prep counter', () => {
  assert.equal(stationFor('SomethingNew'), 'prep');
  assert.equal(stationFor(''), 'prep');
  assert.equal(stationFor(undefined), 'prep');
});

test('describes actions as kitchen lines using only safe details', () => {
  assert.equal(describeAction('Edit', summarize('Edit', { file_path: 'C:\\src\\animate.py', old_string: 'SECRET' })), 'chopping animate.py');
  assert.equal(describeAction('Bash', summarize('Bash', { command: 'npm test' })), 'firing up `npm test`');
  assert.equal(describeAction('view', summarize('view', { path: '/repo/README.md' })), 'reading the recipe for README.md');
  assert.equal(describeAction('WebFetch', summarize('WebFetch', { url: 'https://example.com/a?token=x' })), 'running to market at example.com');
  assert.equal(describeAction('mcp__github__get_me', ''), 'calling supplier github');
  const long = summarize('Bash', { command: 'x'.repeat(200) });
  assert.ok(long.length <= 40);
});
