// The sidebar cards' data sources (extensions/sidebar-cards/sources.ts): the desktop app's bridge and claude.ai's
// session API, mapped to cards, merged, polled gently and stopped cleanly. Everything is faked; nothing reads files.
import { test } from 'bun:test';
import assert from 'node:assert';
import { baseName, cloudCards, localCards, relTime, repoName, SessionFeed, shortModel, type Cards, type FeedHost } from '../extensions/sidebar-cards/sources';

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

test('relTime buckets', () => {
  assert.strictEqual(relTime(NOW - 30e3, NOW), 'now');
  assert.strictEqual(relTime(NOW - 5 * 60e3, NOW), '5m');
  assert.strictEqual(relTime(NOW - 3 * 3600e3, NOW), '3h');
  assert.strictEqual(relTime(NOW - 8 * 86400e3, NOW), '8d');
  assert.strictEqual(relTime(NOW - 20 * 86400e3, NOW), '2w');
  assert.strictEqual(relTime(NOW - 100 * 86400e3, NOW), '3mo');
});

test('shortModel', () => {
  assert.strictEqual(shortModel('claude-opus-5-5'), 'Opus 5.5');
  assert.strictEqual(shortModel('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.strictEqual(shortModel('claude-opus-5-5[1m]'), 'Opus 5.5');
  assert.strictEqual(shortModel(null), null);
});

test('folder and repository names work for POSIX and Windows paths and https or ssh URLs', () => {
  assert.strictEqual(baseName('/home/user/projects/demo-app'), 'demo-app');
  assert.strictEqual(baseName('C:\\Users\\user\\demo-app\\'), 'demo-app');
  assert.strictEqual(baseName(''), '');
  assert.strictEqual(repoName('https://github.com/acme/demo-app.git'), 'demo-app');
  assert.strictEqual(repoName('https://github.com/acme/demo-app'), 'demo-app');
  assert.strictEqual(repoName('git@github.com:acme/api-server.git'), 'api-server');
});

const LOCAL = [
  { sessionId: 'local_a', cwd: '/work/demo-app/.claude/worktrees/x', originCwd: '/work/demo-app', branch: 'feature/cards', model: 'claude-opus-5-5', lastActivityAt: NOW - 3 * 3600e3, turnRunning: false, postTurnSummary: { status_detail: 'Waiting for review' } },
  { sessionId: 'local_b', cwd: '/work/api-server', worktreeName: 'fix-upload', model: 'claude-sonnet-4-5', lastActivityAt: NOW - 60e3, turnRunning: true, lastTurnEdgeAt: NOW - 90e3 },
  { sessionId: 'local_ssh', cwd: '/tmp/x', remoteTarget: { kind: 'ssh', sshHost: 'remote-box', remoteCwd: '/srv/docs-site' }, branch: 'HEAD', createdAt: NOW - 2 * 86400e3 },
  { nope: true }, null, 'junk',
];

test('desktop sessions become cards keyed by their row ids', () => {
  const c = localCards(LOCAL, NOW);
  assert.deepStrictEqual(Object.keys(c), ['local_a', 'local_b', 'local_ssh']);
  assert.deepStrictEqual(c.local_a, { folder: 'demo-app', branch: 'feature/cards', rel: '3h', model: 'Opus 5.5', working: null, summary: 'Waiting for review' });
  assert.strictEqual(c.local_b!.branch, 'fix-upload', 'the worktree name when there is no branch');
  assert.strictEqual(c.local_b!.working, NOW - 90e3, 'a running turn, from its start');
  assert.strictEqual(c.local_ssh!.folder, 'docs-site', 'an SSH session shows its remote folder');
  assert.strictEqual(c.local_ssh!.branch, null, 'a detached HEAD is not a branch');
  assert.strictEqual(c.local_ssh!.rel, '2d');
  assert.deepStrictEqual(localCards('not a list', NOW), {});
});

const CLOUD = {
  data: [
    { id: 'cse_AAA', status: 'active', worker_status: 'idle', last_event_at: new Date(NOW - 5 * 60e3).toISOString(), config: { model: 'claude-opus-5-5', sources: [{ type: 'git_repository', url: 'https://github.com/acme/docs-site', revision: 'main' }] }, status_line: 'Done' },
    { id: 'cse_BBB', status: 'active', worker_status: 'running', updated_at: new Date(NOW - 60e3).toISOString(), config: { sources: [{ type: 'git_repository', url: 'git@github.com:acme/api-server.git', revision: '0123456789abcdef0123456789abcdef01234567' }] }, external_metadata: { last_served_model: 'claude-sonnet-4-5', turn: { started_at: new Date(NOW - 40e3).toISOString() } } },
    { id: 'cse_CCC', worker_status: 'busy', config: {} },
    { noid: 1 },
  ],
};

test('cloud sessions become cards keyed session_<x> for cse_<x>', () => {
  const c = cloudCards(CLOUD, NOW);
  assert.deepStrictEqual(Object.keys(c), ['session_AAA', 'session_BBB', 'session_CCC']);
  assert.deepStrictEqual(c.session_AAA, { folder: 'docs-site', branch: 'main', rel: '5m', model: 'Opus 5.5', working: null, summary: 'Done' });
  assert.strictEqual(c.session_BBB!.folder, 'api-server');
  assert.strictEqual(c.session_BBB!.branch, null, 'a commit hash is not shown as a branch');
  assert.strictEqual(c.session_BBB!.model, 'Sonnet 4.5', 'the model it last answered with');
  assert.strictEqual(c.session_BBB!.working, NOW - 40e3, 'working, from the turn start');
  assert.strictEqual(c.session_CCC!.working, null, 'working without a known start: the app\'s Running label times it');
  assert.strictEqual(c.session_CCC!.folder, '');
  assert.deepStrictEqual(cloudCards({ error: { type: 'x' } }, NOW), {});
  assert.deepStrictEqual(cloudCards(null, NOW), {});
});

// ---- the feed ----
class Clock {
  t = NOW;
  timers = new Map<number, { at: number; fn: () => void }>();
  next = 1;
  setTimeout = (fn: () => void, ms: number) => { const id = this.next++; this.timers.set(id, { at: this.t + ms, fn }); return id; };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
      await flush();
    }
    this.t = end;
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function host(o: { local?: unknown[] | (() => unknown); cloud?: (url: string, init: any) => any; clock: Clock }) {
  const calls: { url: string; init: any }[] = [];
  const listeners = new Map<string, () => void>();
  const h: FeedHost & { visibilityState: string } = {
    visibilityState: 'visible',
    setTimeout: o.clock.setTimeout,
    clearTimeout: o.clock.clearTimeout,
    document: {
      get visibilityState() { return h.visibilityState; },
      addEventListener: (t: string, fn: () => void) => listeners.set(`doc:${t}`, fn),
      removeEventListener: (t: string) => listeners.delete(`doc:${t}`),
    },
    addEventListener: (t: string, fn: () => void) => listeners.set(t, fn),
    removeEventListener: (t: string) => listeners.delete(t),
  };
  if (o.local) h['claude.web'] = { LocalSessions: { getAll: async () => (typeof o.local === 'function' ? o.local() : o.local) } };
  if (o.cloud) h.fetch = async (url: string, init: any) => { calls.push({ url, init }); return o.cloud!(url, init); };
  return { h, calls, listeners };
}
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

test('the feed merges desktop and cloud cards and asks the API the way the app does', async () => {
  const clock = new Clock();
  const { h, calls } = host({ local: LOCAL, cloud: () => okJson(CLOUD), clock });
  const got: Cards[] = [];
  const feed = new SessionFeed(h, (c) => got.push(c), undefined, () => clock.t);
  feed.start();
  await flush(); await flush();
  const last = got.at(-1)!;
  assert.ok(last.local_a && last.session_AAA, 'both sources');
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0]!.url, /^\/v1\/code\/sessions\?limit=50&statuses=active&statuses=idle$/);
  assert.strictEqual(calls[0]!.init.credentials, 'include');
  assert.strictEqual(calls[0]!.init.headers['anthropic-version'], '2023-06-01');
  feed.stop();
});

test('the feed follows resume_token for a few pages at most', async () => {
  const clock = new Clock();
  let n = 0;
  const page = () => okJson({ data: Array.from({ length: 50 }, (_, i) => ({ id: `cse_p${n}_${i}` })), resume_token: `t${++n}` });
  const { h, calls } = host({ cloud: page, clock });
  const got: Cards[] = [];
  const feed = new SessionFeed(h, (c) => got.push(c), undefined, () => clock.t);
  feed.start();
  for (let i = 0; i < 6; i++) await flush();
  assert.strictEqual(calls.length, 3, 'three pages, then it stops asking');
  assert.match(calls[1]!.url, /resume_token=t1/);
  assert.strictEqual(Object.keys(got.at(-1)!).length, 150);
  feed.stop();
});

test('API errors and a missing bridge never throw: the cards just get nothing from that source', async () => {
  for (const cloud of [() => ({ ok: false, status: 400, json: async () => ({ error: {} }) }), () => { throw new Error('offline'); }, () => okJson('not json')]) {
    const clock = new Clock();
    const { h } = host({ cloud, clock });
    const got: Cards[] = [];
    const feed = new SessionFeed(h, (c) => got.push(c), undefined, () => clock.t);
    feed.start();
    await flush(); await flush();
    assert.ok(got.every((c) => Object.keys(c).length === 0));
    feed.stop();
  }
  // no bridge and no fetch at all (a bare page): nothing scheduled, nothing thrown
  const clock = new Clock();
  const feed = new SessionFeed({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, () => assert.fail('no data'), undefined, () => clock.t);
  feed.start();
  await flush();
  assert.strictEqual(clock.timers.size, 0);
  feed.stop();
});

test('errors back off; signed out stops asking until the page is back in view', async () => {
  const clock = new Clock();
  let status = 500;
  const { h, calls, listeners } = host({ cloud: () => ({ ok: status === 200, status, json: async () => CLOUD }), clock });
  const feed = new SessionFeed(h, () => {}, undefined, () => clock.t);
  feed.start();
  await flush();
  assert.strictEqual(calls.length, 1);
  await clock.advance(30_000);
  assert.strictEqual(calls.length, 1, 'after an error it waits longer than the usual 30 s');
  await clock.advance(30_000);
  assert.strictEqual(calls.length, 2);
  status = 401;
  await clock.advance(5 * 60_000);
  const signedOut = calls.length;
  await clock.advance(10 * 60_000);
  assert.strictEqual(calls.length, signedOut, 'no more requests while signed out');
  status = 200;
  listeners.get('focus')!();
  await flush();
  assert.strictEqual(calls.length, signedOut + 1, 'coming back into view tries again');
  feed.stop();
});

test('the feed polls the bridge every few seconds while visible, and stop() ends it all', async () => {
  const clock = new Clock();
  let reads = 0;
  const { h, calls, listeners } = host({ local: () => { reads++; return LOCAL; }, cloud: () => okJson(CLOUD), clock });
  const changes: Cards[] = [];
  const feed = new SessionFeed(h, (c) => changes.push(c), undefined, () => clock.t);
  feed.start();
  await flush();
  await clock.advance(9000);
  assert.strictEqual(reads, 4, 'once at start, then every 3 s');
  h.visibilityState = 'hidden';
  await clock.advance(9000);
  assert.strictEqual(reads, 4, 'not while hidden');
  h.visibilityState = 'visible';
  feed.stop();
  const before = { reads, cloud: calls.length, changes: changes.length };
  await clock.advance(120_000);
  assert.deepStrictEqual({ reads, cloud: calls.length, changes: changes.length }, before, 'nothing after stop');
  assert.strictEqual(clock.timers.size, 0);
  assert.strictEqual(listeners.size, 0, 'listeners removed');
});

test('a read still in flight when the feed stops changes nothing', async () => {
  const clock = new Clock();
  let release: (v: unknown) => void = () => {};
  const { h } = host({ cloud: () => new Promise((r) => { release = r; }), clock });
  const changes: Cards[] = [];
  const feed = new SessionFeed(h, (c) => changes.push(c), undefined, () => clock.t);
  feed.start();
  feed.stop();
  release(okJson(CLOUD));
  await flush(); await flush();
  assert.strictEqual(changes.length, 0);
});

test('unchanged data is not sent again', async () => {
  const clock = new Clock();
  const { h } = host({ local: LOCAL, clock });
  const changes: Cards[] = [];
  const feed = new SessionFeed(h, (c) => changes.push(c), undefined, () => clock.t);
  feed.start();
  await flush();
  await clock.advance(9000);
  assert.strictEqual(changes.length, 1);
  feed.stop();
});
