// The sidebar-cards extension's main part (extensions/sidebar-cards/main.cjs), with a fake extension context.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAIN = path.join(__dirname, '..', 'extensions', 'sidebar-cards', 'main.cjs');

function fakeCtx({ labelChanges = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cards-'));
  const appDataDir = path.join(base, 'app');
  fs.mkdirSync(path.join(appDataDir, 'claude-code-sessions'), { recursive: true });
  const view = { id: 1, js: [], changes: labelChanges };
  const intervals = [];
  const ready = [];
  const ctx = {
    id: 'sidebar-cards',
    dataDir: path.join(base, 'data'),
    appDataDir,
    views: () => [view],
    run: async (wc, js) => { wc.js.push(js); if (js.includes('__cmTakeLabelChanges')) { const c = wc.changes; wc.changes = null; return c; } return true; },
    onViewReady: (fn) => ready.push(fn),
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    setTimeout: (fn) => { fn(); return 0; },
    clearTimer: () => {},
    watch: () => null,
    log: () => {},
  };
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  return { ctx, view, intervals, ready };
}
const load = () => { delete require.cache[MAIN]; return require(MAIN); };
const pushes = (view) => view.js.filter((s) => s.includes('__cmSetMeta('));

test('a view gets the session data when it is ready', async () => {
  const f = fakeCtx();
  load().activate(f.ctx);
  for (const fn of f.ready) await fn(f.view);
  assert.strictEqual(pushes(f.view).length, 1);
});

test('labels set in the page are saved in the extension data folder and pushed back', async () => {
  const f = fakeCtx({ labelChanges: { local_x: 'done' } });
  const dir = path.join(f.ctx.appDataDir, 'claude-code-sessions', 'acct', 'org');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local_x.json'), JSON.stringify({ cwd: '/tmp/proj', lastActivityAt: Date.now() }));
  load().activate(f.ctx);
  const collect = f.intervals.find((i) => i.ms === 2000);
  await collect.fn();
  const saved = JSON.parse(fs.readFileSync(path.join(f.ctx.dataDir, 'labels.json'), 'utf8'));
  assert.strictEqual(saved.local_x.label, 'done');
  assert.ok(pushes(f.view).some((s) => s.includes('"label":"done"')));
});

test('no label changes means no write', async () => {
  const f = fakeCtx();
  load().activate(f.ctx);
  await f.intervals.find((i) => i.ms === 2000).fn();
  assert.strictEqual(fs.existsSync(path.join(f.ctx.dataDir, 'labels.json')), false);
});

test('the data is refreshed every 6 seconds for the Working timers', async () => {
  const f = fakeCtx();
  load().activate(f.ctx);
  const refresh = f.intervals.find((i) => i.ms === 6000);
  await refresh.fn();
  assert.strictEqual(pushes(f.view).length, 1);
});

test('broken session data never throws out of the extension', async () => {
  const f = fakeCtx();
  fs.writeFileSync(path.join(f.ctx.appDataDir, 'claude-code-sessions', 'local_bad.json'), '{ nope');
  load().activate(f.ctx);
  for (const fn of f.ready) await assert.doesNotReject(Promise.resolve(fn(f.view)));
});
