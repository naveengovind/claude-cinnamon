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

test('rows without meta get card styling only; label rows are untouched', () => {
  const w = page();
  w.__cmSetMeta(META);
  const x = w.document.querySelector('[data-row-key="code:local_x"] [data-row]');
  assert.ok(x.hasAttribute('data-cm-card'));
  assert.strictEqual(x.querySelector('.cm-top'), null);
  assert.strictEqual(w.document.querySelector('[data-row-key^="label:"] [data-row]').hasAttribute('data-cm-card'), false);
  assert.deepStrictEqual({ ...w.__cmStats() }, { rows: 2, decorated: 1, duplicates: 0 });
});

test('re-applying the script and meta never duplicates lines', () => {
  const w = page();
  w.__cmSetMeta(META);
  w.eval(SRC);
  w.__cmSetMeta(META);
  assert.deepStrictEqual({ ...w.__cmStats() }, { rows: 2, decorated: 1, duplicates: 0 });
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

// ---- status chips, working badge, your labels ----
const M = (extra) => ({ local_a: { folder: 'acme', branch: 'main', rel: '3h', model: 'Opus 5.5', working: null, state: null, summary: null, label: null, ...extra } });
const chip = (w) => btn(w, 'a').querySelector('.cm-top .cm-chip');

test('your label shows as a chip', () => {
  const w = page();
  w.__cmSetMeta(M({ label: 'doing' }));
  assert.strictEqual(chip(w).dataset.kind, 'doing');
  assert.strictEqual(chip(w).textContent, 'In progress');
});

test("the app's attention state shows when you have no label, and your label wins", () => {
  const w = page();
  w.__cmSetMeta(M({ state: 'needs' }));
  assert.strictEqual(chip(w).textContent, 'Needs you');
  w.__cmSetMeta(M({ state: 'needs', label: 'done' }));
  assert.strictEqual(chip(w).textContent, 'Done');
});

test('no label and no state shows the faint add chip', () => {
  const w = page();
  w.__cmSetMeta(M({}));
  assert.strictEqual(chip(w).dataset.kind, 'add');
});

test('a working session shows Working with elapsed time instead of the age, keeping its chip', () => {
  const w = page();
  w.__cmSetMeta(M({ working: Date.now() - 12_000, label: 'todo' }));
  const top = btn(w, 'a').querySelector('.cm-top');
  assert.match(top.querySelector('.cm-working').textContent, /Working 1[12]s/);
  assert.strictEqual(top.querySelector('.cm-time'), null);
  assert.strictEqual(chip(w).textContent, 'To do');
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

test('clicking the chip opens the label menu and does not open the session', () => {
  const w = page();
  w.__cmSetMeta(M({}));
  let opened = 0;
  btn(w, 'a').addEventListener('click', () => opened++);
  chip(w).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(opened, 0);
  const items = [...w.document.querySelectorAll('.cm-menu [data-label]')].map((n) => n.textContent);
  assert.deepStrictEqual(items, ['To do', 'In progress', 'Done', 'Clear']);
});

test('choosing a label shows it, queues it for saving once, and survives a stale push', () => {
  const w = page();
  w.__cmSetMeta(M({}));
  chip(w).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  w.document.querySelector('.cm-menu [data-label="done"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(chip(w).textContent, 'Done');
  assert.strictEqual(w.document.querySelector('.cm-menu'), null);
  assert.deepStrictEqual({ ...w.__cmTakeLabelChanges() }, { local_a: 'done' });
  assert.deepStrictEqual({ ...w.__cmTakeLabelChanges() }, {});
  w.__cmSetMeta(M({ label: null }));
  assert.strictEqual(chip(w).textContent, 'Done');
});

test('Clear removes your label', () => {
  const w = page();
  w.__cmSetMeta(M({ label: 'todo' }));
  chip(w).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  w.document.querySelector('.cm-menu [data-label="clear"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(chip(w).dataset.kind, 'add');
  assert.deepStrictEqual({ ...w.__cmTakeLabelChanges() }, { local_a: null });
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
