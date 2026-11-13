// The full-width extension's page code: a "Full" option in Settings → Appearance → Transcript width.
const { test, afterEach } = require('bun:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const RUNTIME = fs.readFileSync(path.join(__dirname, '..', 'core', 'page-runtime.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'full-width', 'page.js'), 'utf8');

// Shaped like the app's Transcript width row and its Base UI popup (Nov 2026).
const ROW = `
  <div role="dialog"><div>
    <div role="group" data-settings-row=""><div data-settings-text=""><span class="settings-row-title">Transcript width</span></div>
      <div data-settings-control=""><div data-cds="Combobox"><button role="combobox" aria-expanded="false" aria-controls="pop">
        <span id="pop-trigger-value">Wide</span><span data-cds="Icon"></span></button></div></div></div>
  </div></div>`;
const POPUP = `
  <div id="pop" role="dialog" data-cds="Combobox"><div role="listbox">
    <div role="option" id="o0" aria-selected="false" title="Narrow"><div><span class="truncate">Narrow</span></div></div>
    <div role="option" id="o1" aria-selected="false" title="Medium"><div><span class="truncate">Medium</span></div></div>
    <div data-selected="" role="option" id="o2" aria-selected="true" title="Wide"><div><span class="truncate">Wide</span></div><span data-selected="" aria-hidden="true">✓</span></div>
  </div></div>`;

const open = [];
afterEach(() => { while (open.length) open.pop().close(); });

function page(settings = {}, body = ROW) {
  const w = new JSDOM(`<body>${body}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true }).window;
  w.__sent = [];
  w.console.debug = (...a) => w.__sent.push(a.join(' '));
  w.eval(RUNTIME);
  w.__cinnamon.setSettings({ 'full-width': settings });
  w.eval(`(() => { const cinnamon = window.__cinnamon.api('full-width'); window.__cinnamon.reset('full-width'); ${PAGE}\n })();`);
  open.push(w);
  return w;
}
const tick = (w) => new Promise((r) => w.requestAnimationFrame(() => setTimeout(r, 0)));
async function openList(w) {
  w.document.body.insertAdjacentHTML('beforeend', POPUP);
  w.document.querySelector('[role=combobox]').setAttribute('aria-expanded', 'true');
  await tick(w);
}
const full = (w) => w.document.querySelector('[data-cinnamon-option]');
const value = (w) => w.document.getElementById('pop-trigger-value').textContent;

test('with Full on, the page is marked full width', () => {
  const w = page({ width: 'full' });
  assert.strictEqual(w.document.documentElement.getAttribute('data-cinnamon-width'), 'full');
});

test('with Full off, the app\'s own width is left alone', () => {
  const w = page({});
  assert.strictEqual(w.document.documentElement.hasAttribute('data-cinnamon-width'), false);
});

test('Full is added to the Transcript width list when it opens, after the app\'s widths', async () => {
  const w = page({});
  await openList(w);
  const opts = [...w.document.querySelectorAll('[role=listbox] [role=option]')].map((o) => o.getAttribute('title'));
  assert.deepStrictEqual(opts, ['Narrow', 'Medium', 'Wide', 'Full']);
  assert.strictEqual(full(w).getAttribute('aria-selected'), 'false');
  assert.strictEqual(full(w).id, '', 'no duplicate id copied from the app\'s option');
  assert.strictEqual(full(w).querySelector('[data-selected]'), null, 'no copied check mark');
});

test('choosing Full saves it, marks the page and shows Full as the value', async () => {
  const w = page({});
  await openList(w);
  full(w).click();
  await tick(w);
  assert.ok(w.__sent.some((s) => s.includes('"type":"ext-setting"') && s.includes('"value":"full"')));
  assert.strictEqual(w.document.documentElement.getAttribute('data-cinnamon-width'), 'full');
  assert.strictEqual(value(w), 'Full');
});

test('while Full is on, Full has the check and the app\'s check is hidden', async () => {
  const w = page({ width: 'full' });
  await openList(w);
  assert.strictEqual(full(w).getAttribute('aria-selected'), 'true');
  assert.ok(full(w).querySelector('[data-cinnamon-check]'));
  assert.ok(w.document.querySelector('[role=listbox]').hasAttribute('data-cinnamon-full'));
});

test('choosing one of the app\'s widths turns Full off', async () => {
  const w = page({ width: 'full' });
  await openList(w);
  w.document.querySelector('[title="Medium"]').click();
  await tick(w);
  assert.ok(w.__sent.some((s) => s.includes('"type":"ext-setting"') && s.includes('"value":null')));
  assert.strictEqual(w.document.documentElement.hasAttribute('data-cinnamon-width'), false);
});

test('Full is shown as the value when Settings opens with Full on', async () => {
  const w = page({ width: 'full' });
  await tick(w);
  assert.strictEqual(value(w), 'Full');
});

test('nothing is added without the Transcript width row', async () => {
  const w = page({}, '<div role="listbox"><div role="option" title="Wide">Wide</div></div>');
  await tick(w);
  assert.strictEqual(full(w), null);
});
