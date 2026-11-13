const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'settings-ui.renderer.js'), 'utf8');

// Shaped like Claude's Settings → Appearance (Nov 2026): rows in a dividers group, the second one a Combobox row.
const SETTINGS = `
  <div role="dialog"><div class="settings-group-dividers" id="group">
    <div role="group" data-settings-row="" data-settings-item="" class="flex items-center justify-between gap-lg py-md" id="theme-row">
      <div data-settings-text=""><div id="t1" class="text-body text-primary"><span class="settings-row-title">Theme</span></div></div>
      <div data-settings-control=""><div role="radiogroup"><button role="radio">System</button></div></div>
    </div>
    <div role="group" aria-labelledby="t2" data-settings-row="" data-settings-item="" class="flex items-center justify-between gap-lg py-md">
      <div data-settings-text=""><div id="t2" class="text-body text-primary"><span class="settings-row-title">Interface font</span></div>
        <div id="d2" class="sr-only">Font for the whole interface</div></div>
      <div data-settings-control=""><div data-cds="Combobox" class="group/cbx inline-flex">
        <button type="button" role="combobox" id="c2-trigger" aria-expanded="false" aria-labelledby="t2" aria-describedby="d2">
          <span id="c2-trigger-value" class="min-w-0 flex-1 truncate">Default · System</span><span data-cds="Icon"></span></button>
      </div><input id="c2-hidden" value="system"></div>
    </div>
  </div></div>`;

const THEMES = { current: 'codex', themes: [{ id: 'codex', name: 'Codex' }, { id: 'broken', name: 'broken', error: 'bad json' }, { id: 'paper', name: 'Paper' }] };

const open = [];
test.afterEach(() => { while (open.length) open.pop().close(); });

function page(body = SETTINGS) {
  const dom = new JSDOM(`<body>${body}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__sent = [];
  w.console.debug = (...a) => w.__sent.push(a.join(' '));
  w.eval(SRC);
  open.push(w);
  return w;
}
const tick = (w) => new Promise((r) => w.requestAnimationFrame(() => setTimeout(r, 0)));
const row = (w) => w.document.querySelector('[data-cm-theme-row]');
const sent = (w) => w.__sent.filter((s) => s.startsWith('[cinnamon] ')).map((s) => JSON.parse(s.slice(11)));

test('adds a Color scheme row right after the Theme row, built from one of the app\'s dropdown rows', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  await tick(w);
  const r = row(w);
  assert.ok(r, 'row added');
  assert.strictEqual(w.document.getElementById('theme-row').nextElementSibling, r);
  assert.match(r.textContent, /Color scheme/);
  assert.ok(r.querySelector('[role="combobox"]'));
  assert.strictEqual(r.querySelector('[data-cm-theme-value]').textContent, 'Codex');
  assert.strictEqual(r.querySelector('input'), null, 'the app\'s hidden form input is not copied');
  for (const id of ['t2', 'd2', 'c2-trigger', 'c2-trigger-value', 'c2-hidden']) assert.strictEqual(w.document.querySelectorAll(`#${id}`).length, 1, `no duplicate #${id}`);
});

test('shows Default when no theme is selected', async () => {
  const w = page();
  w.__cmSetThemes({ current: 'default', themes: THEMES.themes });
  await tick(w);
  assert.strictEqual(row(w).querySelector('[data-cm-theme-value]').textContent, 'Default');
});

test('the menu lists Default and every theme, with a check on the current one', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  await tick(w);
  row(w).querySelector('[role="combobox"]').click();
  const items = [...w.document.querySelectorAll('.cm-menu [data-theme]')];
  assert.deepStrictEqual(items.map((i) => i.dataset.theme), ['default', 'codex', 'broken', 'paper']);
  assert.deepStrictEqual(items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.dataset.theme), ['codex']);
  assert.ok(w.document.querySelector('.cm-menu [data-action="open-themes-folder"]'));
});

test('choosing a theme tells Cinnamon and closes the menu', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  await tick(w);
  row(w).querySelector('[role="combobox"]').click();
  w.document.querySelector('.cm-menu [data-theme="paper"]').click();
  assert.deepStrictEqual(sent(w), [{ type: 'theme', id: 'paper' }]);
  assert.strictEqual(w.document.querySelector('.cm-menu'), null);
});

test('a theme that failed to load is shown but cannot be picked', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  await tick(w);
  row(w).querySelector('[role="combobox"]').click();
  w.document.querySelector('.cm-menu [data-theme="broken"]').click();
  assert.deepStrictEqual(sent(w), []);
});

test('Open themes folder asks Cinnamon to open it', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  await tick(w);
  row(w).querySelector('[role="combobox"]').click();
  w.document.querySelector('.cm-menu [data-action="open-themes-folder"]').click();
  assert.deepStrictEqual(sent(w), [{ type: 'open-themes-folder' }]);
});

test('the row comes back after the app re-renders the page, without duplicates', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  await tick(w);
  row(w).remove();
  await tick(w);
  assert.ok(row(w));
  w.document.getElementById('group').appendChild(w.document.createElement('div'));
  await tick(w);
  assert.strictEqual(w.document.querySelectorAll('[data-cm-theme-row]').length, 1);
});

test('a new theme list updates the shown name', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  await tick(w);
  w.__cmSetThemes({ ...THEMES, current: 'paper' });
  assert.strictEqual(row(w).querySelector('[data-cm-theme-value]').textContent, 'Paper');
});

test('nothing is added on pages without the Theme setting', async () => {
  const w = page('<div role="dialog"><div data-settings-row=""><span class="settings-row-title">Branch prefix</span></div></div>');
  w.__cmSetThemes(THEMES);
  await tick(w);
  assert.strictEqual(row(w), null);
});

test('without a dropdown row to copy, a plain row is still added', async () => {
  const w = page(`<div role="dialog"><div id="g">
    <div role="group" data-settings-row="" id="theme-row"><div data-settings-text=""><span class="settings-row-title">Theme</span></div></div></div></div>`);
  w.__cmSetThemes(THEMES);
  await tick(w);
  const r = row(w);
  assert.ok(r);
  assert.strictEqual(w.document.getElementById('theme-row').nextElementSibling, r);
  assert.ok(r.querySelector('[role="combobox"]'));
});

// ---- Extensions row ----
const EXTS = [
  { id: 'full-width', name: 'Full width', enabled: true, bundled: true },
  { id: 'sidebar-cards', name: 'Sidebar cards', enabled: false, bundled: true },
  { id: 'broken', name: 'broken', enabled: false, error: 'bad manifest' },
];
const extRow = (w) => w.document.querySelector('[data-cm-ext-row]');

test('an Extensions row follows the Color scheme row and says how many are on', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  w.__cmSetExtensions(EXTS);
  await tick(w);
  assert.strictEqual(row(w).nextElementSibling, extRow(w));
  assert.match(extRow(w).textContent, /Extensions/);
  assert.strictEqual(extRow(w).querySelector('[data-cm-ext-value]').textContent, '1 on');
});

test('the Extensions menu lists each extension with a check when on; clicking one switches it', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  w.__cmSetExtensions(EXTS);
  await tick(w);
  extRow(w).querySelector('[role="combobox"]').click();
  const items = [...w.document.querySelectorAll('.cm-menu [data-ext]')];
  assert.deepStrictEqual(items.map((i) => [i.dataset.ext, i.getAttribute('aria-checked')]), [['full-width', 'true'], ['sidebar-cards', 'false'], ['broken', 'false']]);
  w.document.querySelector('.cm-menu [data-ext="sidebar-cards"]').click();
  assert.deepStrictEqual(sent(w), [{ type: 'extension', id: 'sidebar-cards', enabled: true }]);
});

test('an extension that failed to load cannot be switched on', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  w.__cmSetExtensions(EXTS);
  await tick(w);
  extRow(w).querySelector('[role="combobox"]').click();
  w.document.querySelector('.cm-menu [data-ext="broken"]').click();
  assert.deepStrictEqual(sent(w), []);
});

test('Open extensions folder asks Cinnamon to open it', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  w.__cmSetExtensions(EXTS);
  await tick(w);
  extRow(w).querySelector('[role="combobox"]').click();
  w.document.querySelector('.cm-menu [data-action="open-extensions-folder"]').click();
  assert.deepStrictEqual(sent(w), [{ type: 'open-extensions-folder' }]);
});

test('only one menu is open at a time', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  w.__cmSetExtensions(EXTS);
  await tick(w);
  row(w).querySelector('[role="combobox"]').click();
  extRow(w).querySelector('[role="combobox"]').click();
  assert.strictEqual(w.document.querySelectorAll('.cm-menu').length, 1);
  assert.ok(w.document.querySelector('.cm-menu [data-ext]'));
});

test('every row anchors its menu to itself (its control area is positioned)', async () => {
  const w = page();
  w.__cmSetThemes(THEMES);
  w.__cmSetExtensions(EXTS);
  await tick(w);
  for (const r of [row(w), extRow(w)]) {
    const control = r.querySelector('[data-settings-control]');
    assert.strictEqual(control.style.position, 'relative', r.getAttribute('aria-label'));
  }
});
