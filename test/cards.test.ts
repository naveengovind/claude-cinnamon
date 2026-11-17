import { test, afterEach } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { pageCode } from './helpers';

const SRC = await pageCode('extensions/sidebar-cards/page.ts');

const row = (id, title) => `
  <div data-row-key="code:local_${id}">
    <div><div data-row>
      <button data-row-main-button><span data-row-label>${title}</span></button>
      <div data-row-controls><button aria-label="More options">…</button></div>
    </div></div>
  </div>`;

const open = [];
afterEach(() => { while (open.length) open.pop().close(); });

function page() {
  const dom = new JSDOM(`<body><div data-testid="sidebar-recents">
    <div data-group-section="project-acme-xyz/acme">
      <div data-row-key="label:project-acme-xyz/acme"><div data-row><button data-row-main-button>acme</button></div></div>
      ${row('a', 'Title A')}
      ${row('x', 'No meta')}
    </div></div></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(SRC);
  open.push(dom.window);
  return dom.window;
}

const META = { local_a: { folder: 'acme', branch: 'claude/test-3cda1d', rel: '8d', model: 'Opus 5.5' } };
const tick = (w) => new Promise((r) => w.requestAnimationFrame(() => setTimeout(r, 0)));
const btn = (w, id) => w.document.querySelector(`[data-row-key="code:local_${id}"] [data-row-main-button]`);

test('decorates code rows with meta lines in order', () => {
  const w = page();
  w.__cmSetMeta(META);
  const b = btn(w, 'a');
  assert.strictEqual(b.firstElementChild.className, 'cm-top');
  assert.strictEqual(b.lastElementChild.className, 'cm-bottom');
  assert.match(b.querySelector('.cm-top').textContent, /acme.*8d/);
  assert.match(b.querySelector('.cm-bottom').textContent, /claude\/test-3cda1d.*Opus 5\.5/);
});

test('a row with no data still gets a card (and no detail line); label rows are untouched', () => {
  const w = page();
  w.__cmSetMeta(META);
  const x = w.document.querySelector('[data-row-key="code:local_x"] [data-row]');
  assert.ok(x.hasAttribute('data-cm-card'));
  assert.ok(x.querySelector('.cm-top'));
  assert.strictEqual(x.querySelector('.cm-bottom'), null);
  assert.strictEqual(w.document.querySelector('[data-row-key^="label:"] [data-row]').hasAttribute('data-cm-card'), false);
  assert.deepStrictEqual({ ...w.__cmStats() }, { rows: 2, decorated: 2, duplicates: 0 });
});

test('re-applying the script and meta never duplicates lines', () => {
  const w = page();
  w.__cmSetMeta(META);
  w.eval(SRC);
  w.__cmSetMeta(META);
  assert.deepStrictEqual({ ...w.__cmStats() }, { rows: 2, decorated: 2, duplicates: 0 });
});

test('meta updates replace text in place', () => {
  const w = page();
  w.__cmSetMeta(META);
  w.__cmSetMeta({ local_a: { ...META.local_a, rel: '9d' } });
  assert.match(btn(w, 'a').querySelector('.cm-top').textContent, /9d/);
  assert.strictEqual(btn(w, 'a').querySelectorAll('.cm-top').length, 1);
});

test('a row re-rendered by the app gets its lines back once', async () => {
  const w = page();
  w.__cmSetMeta(META);
  const old = btn(w, 'a');
  const fresh = w.document.createElement('button');
  fresh.setAttribute('data-row-main-button', '');
  fresh.innerHTML = '<span data-row-label>Title A renamed</span>';
  old.replaceWith(fresh);
  await tick(w);
  await tick(w);
  assert.strictEqual(fresh.querySelectorAll('.cm-top').length, 1);
  assert.strictEqual(fresh.querySelectorAll('.cm-bottom').length, 1);
});

// ---- the Working badge and the summary tooltip ----
const M = (extra) => ({ local_a: { folder: 'acme', branch: 'main', rel: '3h', model: 'Opus 5.5', working: null, state: null, summary: null, label: null, ...extra } });

test('a working session shows Working with elapsed time instead of the age', () => {
  const w = page();
  w.__cmSetMeta(M({ working: Date.now() - 12_000 }));
  const top = btn(w, 'a').querySelector('.cm-top');
  assert.match(top.querySelector('.cm-working').textContent, /Working 1[12]s/);
  assert.strictEqual(top.querySelector('.cm-time'), null);
});

test('no status chips or label picker: the app\'s own status (needs you, review…) is not repeated', () => {
  const w = page();
  w.__cmSetMeta(M({ state: 'needs', label: 'todo' }));
  assert.strictEqual(w.document.querySelector('.cm-chip, .cm-menu, [aria-label="Set label"]'), null);
});

test('elapsed time ticks without rebuilding the line', () => {
  const w = page();
  w.__cmSetMeta(M({ working: Date.now() - 65_000 }));
  const line = btn(w, 'a').querySelector('.cm-top');
  w.__cmSetMeta(M({ working: Date.now() - 125_000 }));
  w.__cmTick();
  assert.match(btn(w, 'a').querySelector('.cm-working').textContent, /Working 2m 0[45]s/);
  assert.ok(line.isConnected === false || btn(w, 'a').querySelectorAll('.cm-top').length === 1);
});

test("the app's one-line summary is the time's tooltip", () => {
  const w = page();
  w.__cmSetMeta(M({ summary: 'fork ready; no changes' }));
  assert.strictEqual(btn(w, 'a').querySelector('.cm-time').title, 'fork ready; no changes');
});

test('missing branch shows model only; values are text, not HTML', () => {
  const w = page();
  w.__cmSetMeta({ local_a: { folder: '<img src=x onerror=1>', branch: null, rel: 'now', model: 'Opus 5.5' } });
  const b = btn(w, 'a');
  assert.strictEqual(b.querySelector('img'), null);
  assert.match(b.querySelector('.cm-top').textContent, /<img src=x onerror=1>/);
  assert.strictEqual(b.querySelector('.cm-bottom .cm-branch'), null);
  assert.match(b.querySelector('.cm-bottom').textContent, /Opus 5\.5/);
});

// Hot reload: the cards take themselves out completely, and come back when run again.
function pageWithRuntime() {
  const RUNTIME_SRC = RUNTIME;
  const dom = new JSDOM(`<body><div data-testid="sidebar-recents">${row('a', 'Title A')}</div></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(RUNTIME_SRC);
  const run = () => w.eval(`(() => { const cinnamon = window.__cinnamon.api('sidebar-cards'); window.__cinnamon.reset('sidebar-cards'); ${SRC}\n })();`);
  run();
  open.push(w);
  return { w, run };
}
const RUNTIME = await pageCode('core/page/runtime.ts');

test('disposing the cards removes every card line, timer and hook it added', () => {
  const { w } = pageWithRuntime();
  w.__cmSetMeta(META);
  assert.ok(w.document.querySelector('.cm-top'));
  const state = w.__cmState;
  assert.ok(state.relist && state.ticker);
  assert.strictEqual(w.__cinnamon.dispose('sidebar-cards'), 'cinnamon:disposed');
  assert.strictEqual(w.document.querySelectorAll('.cm-top, .cm-bottom, [data-cm-card]').length, 0);
  assert.strictEqual(state.relist, undefined);
  assert.strictEqual(state.ticker, undefined);
  assert.strictEqual(state.observer, null);
  assert.strictEqual(w.__cmSetMeta, undefined);
});

test('after a hot reload the cards come back with the data they had', () => {
  const { w, run } = pageWithRuntime();
  w.__cmSetMeta(META);
  w.__cinnamon.dispose('sidebar-cards');
  run();
  assert.ok(w.document.querySelector('[data-row-key="code:local_a"] .cm-top'));
});

test('a redraw queued before the cards were taken out does not bring them back', async () => {
  const { w } = pageWithRuntime();
  w.__cmSetMeta(META);
  w.document.querySelector('[data-testid="sidebar-recents"]').insertAdjacentHTML('beforeend', row('b', 'Title B')); // queues a redraw
  w.__cinnamon.dispose('sidebar-cards');
  await tick(w);
  assert.strictEqual(w.document.querySelectorAll('.cm-top, .cm-bottom').length, 0);
});

// ---- every kind of session: cloud rows, and the app's own Running status (local, SSH and cloud alike) ----
// Shaped like the app's rows (Nov 2026): the status is a hidden "Running" next to the title and a pulse icon.
const runningBits = `<span data-find-omitted data-session-status> Running</span>`;
const pulse = `<span data-row-decoration><span aria-hidden="true"><span role="img" aria-label="Running"><span><span data-cds="Pulse"></span></span></span></span></span>`;
const appRow = (key, title, { place = '', running = false } = {}) => `
  <div data-row-key="code:${key}">
    <div><div data-row>
      <button data-row-main-button><span data-row-label="iconless"><span dir="auto"><span><span>${title}${place ? `<span data-find-omitted> ${place}</span>` : ''}${running ? runningBits : ''}</span></span></span></span><span></span></button>
      ${running ? pulse : ''}
      <div data-row-controls><button aria-label="More options">…</button></div>
    </div></div>
  </div>`;
function listPage(rows) {
  const dom = new JSDOM(`<body><div data-testid="sidebar-recents">${rows.join('')}</div></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(SRC);
  open.push(dom.window);
  return dom.window;
}
const top = (w, key) => w.document.querySelector(`[data-row-key="code:${key}"] .cm-top`);

test('a cloud session gets a card, with the place the app shows for it', () => {
  const w = listPage([appRow('session_01AbC', 'Test', { place: 'Cloud' })]);
  w.__cmSetMeta({});
  assert.ok(top(w, 'session_01AbC'), 'a card');
  assert.match(top(w, 'session_01AbC').textContent, /Cloud/);
});

test('a session the app shows as Running is Working, even with no data from its transcript (SSH, cloud)', () => {
  const w = listPage([appRow('session_01AbC', 'Test', { place: 'Cloud', running: true }), appRow('local_ssh', 'On a remote host', { running: true })]);
  w.__cmSetMeta({ local_ssh: { folder: 'acme', branch: 'main', rel: '2d', model: 'Opus 5.5', working: null, state: null, summary: null, label: null } });
  assert.match(top(w, 'session_01AbC').querySelector('.cm-working').textContent, /Working 0s/);
  assert.match(top(w, 'local_ssh').querySelector('.cm-working').textContent, /Working/);
  assert.strictEqual(top(w, 'local_ssh').querySelector('.cm-time'), null);
});

test('Working counts from the prompt time when the transcript has it', () => {
  const w = listPage([appRow('local_a', 'A', { running: true })]);
  w.__cmSetMeta({ local_a: { folder: 'acme', branch: null, rel: '1h', model: null, working: Date.now() - 42_000, state: null, summary: null, label: null } });
  assert.match(top(w, 'local_a').querySelector('.cm-working').textContent, /Working 4[12]s/);
});

test('Working keeps counting from when it started, across redraws, and stops when the app does', async () => {
  const w = listPage([appRow('session_01AbC', 'Test', { place: 'Cloud', running: true })]);
  w.__cmSetMeta({});
  const since = Number(top(w, 'session_01AbC').querySelector('.cm-working').dataset.since);
  await new Promise((r) => setTimeout(r, 30));
  w.__cmSetMeta({});
  assert.strictEqual(Number(top(w, 'session_01AbC').querySelector('.cm-working').dataset.since), since, 'same start');
  // the app says it finished
  w.document.querySelector('[data-session-status]').remove();
  w.document.querySelector('[data-row-decoration]').remove();
  await tick(w);
  assert.strictEqual(top(w, 'session_01AbC').querySelector('.cm-working'), null);
});

test('the place text the app adds is not mistaken for the running status', () => {
  const w = listPage([appRow('session_01AbC', 'remote-box', { place: 'acme · Offline' })]);
  w.__cmSetMeta({});
  assert.match(top(w, 'session_01AbC').textContent, /acme · Offline/);
  assert.strictEqual(top(w, 'session_01AbC').querySelector('.cm-working'), null);
});

test('an unread response is not Working, although the app uses the same pulsing dot for it', () => {
  const unread = `<div data-row-key="code:local_u"><div><div data-row>
      <button data-row-main-button><span data-row-label="iconless"><span dir="auto"><span><span>Done thing<span data-find-omitted data-session-status> Unread response</span></span></span></span></span><span></span></button>
      <span data-row-decoration><span aria-hidden="true"><span role="img" aria-label="Unread response"><span><span data-cds="Pulse"></span></span></span></span></span>
      <div data-row-controls><button aria-label="More options">…</button></div>
    </div></div></div>`;
  const w = listPage([unread]);
  w.__cmSetMeta({ local_u: { folder: 'acme', branch: null, rel: '3m', model: null, working: null, summary: null } });
  assert.strictEqual(top(w, 'local_u').querySelector('.cm-working'), null);
  assert.match(top(w, 'local_u').textContent, /3m/);
});
