const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSessions, relTime, shortModel } = require('../extensions/sidebar-cards/meta.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-sessions-'));
  const dir = path.join(root, 'acct', 'org');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local_a.json'), JSON.stringify({
    originCwd: '/Users/x/code/acme', cwd: '/Users/x/.claude/worktrees/test-3cda1d',
    branch: 'claude/test-3cda1d', worktreeName: 'test-3cda1d', lastActivityAt: 1000, model: 'claude-opus-5-5', title: 'secret',
  }));
  fs.writeFileSync(path.join(dir, 'local_b.json'), JSON.stringify({ cwd: '/tmp/scratch', worktreeName: 'wt-name', lastActivityAt: 2000 }));
  fs.writeFileSync(path.join(dir, 'local_c.json'), '{"cwd": "/tmp/half-writ');
  fs.writeFileSync(path.join(dir, 'scheduled-tasks.json'), '[]');
  return root;
}

test('readSessions reads code sessions keyed by file stem', () => {
  const s = readSessions(fixture());
  assert.deepStrictEqual(Object.keys(s).sort(), ['local_a', 'local_b']);
  assert.deepStrictEqual(s.local_a, { folder: 'acme', branch: 'claude/test-3cda1d', time: 1000, model: 'claude-opus-5-5', working: null, state: null, summary: null });
});

test('readSessions falls back to cwd and worktreeName', () => {
  const s = readSessions(fixture());
  assert.deepStrictEqual(s.local_b, { folder: 'scratch', branch: 'wt-name', time: 2000, model: null, working: null, state: null, summary: null });
});

test('readSessions returns {} for a missing root', () => {
  assert.deepStrictEqual(readSessions('/nonexistent/cm-root'), {});
});

test('valid JSON with unexpected types never breaks the other sessions', () => {
  const root = fixture();
  const dir = path.join(root, 'acct', 'org');
  fs.writeFileSync(path.join(dir, 'local_n.json'), 'null');
  fs.writeFileSync(path.join(dir, 'local_t.json'), JSON.stringify({ cwd: 42, originCwd: ['x'], model: { id: 'opus' }, branch: 7, lastActivityAt: '5' }));
  const s = readSessions(root);
  assert.strictEqual(s.local_n, undefined);
  assert.deepStrictEqual(s.local_t, { folder: '', branch: null, time: null, model: null, working: null, state: null, summary: null });
  assert.ok(s.local_a && s.local_b);
  const { payload } = require('../extensions/sidebar-cards/meta.cjs');
  assert.doesNotThrow(() => payload(root, Date.now()));
});

function withTranscripts() {
  const root = fixture();
  const dir = path.join(root, 'acct', 'org');
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-projects-'));
  const write = (id, cwd, cliId, lines) => {
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ cwd, cliSessionId: cliId, lastActivityAt: 1 }));
    if (!lines) return;
    const slugDir = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, `${cliId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  };
  write('local_m', '/Users/x/code/acme', 'cli-m', [{ gitBranch: 'main' }, { type: 'x' }, { gitBranch: 'feature/cards' }, { type: 'y' }]);
  write('local_h', '/Users/x/code/other', 'cli-h', [{ gitBranch: 'HEAD' }]);
  write('local_none', '/Users/x/code/other', 'cli-none', null);
  return { root, projects };
}

test('branch falls back to the latest gitBranch in the Claude Code session log', () => {
  const { root, projects } = withTranscripts();
  const s = readSessions(root, { projectsRoot: projects });
  assert.strictEqual(s.local_m.branch, 'feature/cards');
});

test('a detached HEAD or a missing session log leaves the branch empty', () => {
  const { root, projects } = withTranscripts();
  const s = readSessions(root, { projectsRoot: projects });
  assert.strictEqual(s.local_h.branch, null);
  assert.strictEqual(s.local_none.branch, null);
});

test('a worktree branch recorded by the app wins over the session log', () => {
  const { root, projects } = withTranscripts();
  const s = readSessions(root, { projectsRoot: projects });
  assert.strictEqual(s.local_a.branch, 'claude/test-3cda1d');
});

// ---- working state from the Claude Code session log ----
function logFixture(entries, { ageMs = 1000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-w-'));
  const dir = path.join(root, 'acct', 'org');
  fs.mkdirSync(dir, { recursive: true });
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-wp-'));
  const cwd = '/Users/x/code/acme';
  fs.writeFileSync(path.join(dir, 'local_w.json'), JSON.stringify({ cwd, cliSessionId: 'cli-w', lastActivityAt: 1 }));
  const slug = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(slug, { recursive: true });
  const file = path.join(slug, 'cli-w.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(file, t, t);
  return readSessions(root, { projectsRoot: projects }).local_w;
}
const prompt = (ts, text = 'do it') => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'text', text }] } });
const toolResult = (ts) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
const assistant = (ts, stop) => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: 'x' }] } });
const T0 = '2026-11-12T10:00:00.000Z', T1 = '2026-11-12T10:00:05.000Z', T2 = '2026-11-12T10:00:09.000Z';

test('a turn in progress is working, timed from the last prompt', () => {
  const s = logFixture([prompt(T0), assistant(T1, 'tool_use'), toolResult(T2), { type: 'queue-operation', timestamp: T2 }]);
  assert.strictEqual(s.working, Date.parse(T0));
});

test('a finished turn is not working', () => {
  const s = logFixture([prompt(T0), assistant(T1, 'end_turn'), { type: 'system', subtype: 'stop_hook_summary', timestamp: T2 }]);
  assert.strictEqual(s.working, null);
});

test('a prompt just sent is working', () => {
  const s = logFixture([prompt(T0), assistant(T1, 'end_turn'), prompt(T2, 'next')]);
  assert.strictEqual(s.working, Date.parse(T2));
});

test('an interrupted turn is not working', () => {
  const s = logFixture([prompt(T0), assistant(T1, 'tool_use'), prompt(T2, '[Request interrupted by user for tool use]')]);
  assert.strictEqual(s.working, null);
});

test('a turn with no log writes for 15 minutes is not working', () => {
  const s = logFixture([prompt(T0), assistant(T1, 'tool_use')], { ageMs: 16 * 60e3 });
  assert.strictEqual(s.working, null);
});

// ---- the app's own after-turn status ----
test('app status: attention states map to chips, completed maps to none', () => {
  const { appState } = require('../extensions/sidebar-cards/meta.cjs');
  const pts = (status_category, needs_action = '') => ({ postTurnSummary: { status_category, needs_action, status_detail: 'one line' } });
  assert.strictEqual(appState(pts('needs_input')), 'needs');
  assert.strictEqual(appState(pts('awaiting_permission')), 'needs');
  assert.strictEqual(appState(pts('blocked')), 'blocked');
  assert.strictEqual(appState(pts('failed')), 'failed');
  assert.strictEqual(appState(pts('review_ready')), 'review');
  assert.strictEqual(appState(pts('completed')), null);
  assert.strictEqual(appState(pts('completed', 'Approve the deploy')), 'needs');
  assert.strictEqual(appState({ interruptedAwaitingPerson: { at: 1 } }), 'needs');
  assert.strictEqual(appState({}), null);
});

test('payload carries working, app state, summary and your label', () => {
  const { payload } = require('../extensions/sidebar-cards/meta.cjs');
  const root = fixture();
  fs.writeFileSync(path.join(root, 'acct', 'org', 'local_s.json'), JSON.stringify({ cwd: '/tmp/s', lastActivityAt: 1, postTurnSummary: { status_category: 'blocked', status_detail: 'waiting on CI' } }));
  const p = payload(root, Date.now(), { labels: { local_a: { label: 'doing', setAt: 1 } } });
  assert.strictEqual(p.local_s.state, 'blocked');
  assert.strictEqual(p.local_s.summary, 'waiting on CI');
  assert.strictEqual(p.local_s.label, null);
  assert.strictEqual(p.local_a.label, 'doing');
  assert.strictEqual(p.local_a.working, null);
});

test('relTime buckets', () => {
  const now = 1e12;
  assert.strictEqual(relTime(now - 30e3, now), 'now');
  assert.strictEqual(relTime(now - 5 * 60e3, now), '5m');
  assert.strictEqual(relTime(now - 3 * 3600e3, now), '3h');
  assert.strictEqual(relTime(now - 8 * 86400e3, now), '8d');
  assert.strictEqual(relTime(now - 20 * 86400e3, now), '2w');
  assert.strictEqual(relTime(now - 100 * 86400e3, now), '3mo');
});

test('payload is what the page renders: rel time and short model', () => {
  const { payload } = require('../extensions/sidebar-cards/meta.cjs');
  const p = payload(fixture(), 2000 + 8 * 86400e3);
  assert.deepStrictEqual(p.local_a, { folder: 'acme', branch: 'claude/test-3cda1d', rel: '8d', model: 'Opus 5.5', working: null, state: null, summary: null, label: null });
  assert.deepStrictEqual(p.local_b, { folder: 'scratch', branch: 'wt-name', rel: '8d', model: null, working: null, state: null, summary: null, label: null });
});

test('shortModel', () => {
  assert.strictEqual(shortModel('claude-opus-5-5'), 'Opus 5.5');
  assert.strictEqual(shortModel('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.strictEqual(shortModel(null), null);
});
