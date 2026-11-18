import { test, afterEach } from 'bun:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { pageCode } from './helpers';

const SRC = await pageCode('core/page/runtime.ts');
const open = [];
afterEach(() => { while (open.length) open.pop().close(); });

function page() {
  const w = new JSDOM('<body></body>', { runScripts: 'outside-only' }).window;
  w.__sent = [];
  w.console.debug = (...a) => w.__sent.push(a.join(' '));
  w.eval(SRC);
  open.push(w);
  return w;
}
const sent = (w) => w.__sent.filter((s) => s.startsWith('[cinnamon] ')).map((s) => JSON.parse(s.slice(11)));

test('an extension can send a message to its main part', () => {
  const w = page();
  w.__cinnamon.api('x').send('ping', { a: 1 });
  assert.deepStrictEqual(sent(w), [{ type: 'ext', ext: 'x', msg: 'ping', data: { a: 1 } }]);
});

test('settings pushed by Cinnamon are readable per extension', () => {
  const w = page();
  w.__cinnamon.setSettings({ x: { width: 'full' } });
  assert.strictEqual(w.__cinnamon.api('x').settings.get('width'), 'full');
  assert.strictEqual(w.__cinnamon.api('y').settings.get('width'), undefined);
});

test('setting a value updates it at once, saves it through Cinnamon and tells listeners', () => {
  const w = page();
  const api = w.__cinnamon.api('x');
  const seen = [];
  api.settings.onChange((s) => seen.push(s.width));
  api.settings.set('width', 'full');
  assert.strictEqual(api.settings.get('width'), 'full');
  assert.deepStrictEqual(sent(w), [{ type: 'ext-setting', ext: 'x', key: 'width', value: 'full' }]);
  assert.deepStrictEqual(seen, ['full']);
});

test('listeners hear settings pushed later, and a throwing listener does not stop the others', () => {
  const w = page();
  const api = w.__cinnamon.api('x');
  const seen = [];
  api.settings.onChange(() => { throw new Error('boom'); });
  api.settings.onChange((s) => seen.push(s.width));
  w.__cinnamon.setSettings({ x: { width: 'wide' } });
  assert.deepStrictEqual(seen, ['wide']);
});

test('re-running an extension starts it with no old listeners', () => {
  const w = page();
  const seen = [];
  w.__cinnamon.api('x').settings.onChange(() => seen.push('old'));
  w.__cinnamon.reset('x');
  w.__cinnamon.api('x').settings.onChange(() => seen.push('new'));
  w.__cinnamon.setSettings({ x: {} });
  assert.deepStrictEqual(seen, ['new']);
});

test('loading the runtime twice keeps the settings it already had', () => {
  const w = page();
  w.__cinnamon.setSettings({ x: { width: 'full' } });
  w.eval(SRC);
  assert.strictEqual(w.__cinnamon.api('x').settings.get('width'), 'full');
});

// The Code tab handoff: Cinnamon's theme colors step aside only where the app paints the current look.
const LOOK = { dark: { '--cds-gray-0': '#ffffff', '--cds-gray-500': '#6b6b6b', '--cds-gray-900': '#111111' } };
function palette(w, vars, { mode = 'dark', mod = true } = {}) {
  const h = w.document.documentElement;
  h.setAttribute('data-mode', mode);
  if (mod) h.setAttribute('data-cds-theme', 'mod-palette'); else h.removeAttribute('data-cds-theme');
  h.setAttribute('style', Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('; '));
}
const marked = (w) => w.document.documentElement.getAttribute('data-cinnamon-code-tab');

test('the Code tab is marked when the app paints the current look', () => {
  const w = page();
  palette(w, LOOK.dark);
  w.__cinnamon.setLook(LOOK);
  assert.strictEqual(marked(w), 'mod');
});

test('a mod palette that is not the current look (an older one) is not marked: Cinnamon paints over it', () => {
  const w = page();
  palette(w, { ...LOOK.dark, '--cds-gray-900': '#0f1626' });
  w.__cinnamon.setLook(LOOK);
  assert.strictEqual(marked(w), null);
});

test('no mod palette, or no look, means no mark', () => {
  const w = page();
  palette(w, LOOK.dark, { mod: false });
  w.__cinnamon.setLook(LOOK);
  assert.strictEqual(marked(w), null);
  palette(w, LOOK.dark);
  w.__cinnamon.setLook(null);
  assert.strictEqual(marked(w), null);
});

test('the mark follows the app: it is checked again when the page changes', async () => {
  const w = page();
  palette(w, LOOK.dark, { mod: false });
  w.__cinnamon.setLook(LOOK);
  assert.strictEqual(marked(w), null);
  palette(w, LOOK.dark);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(marked(w), 'mod');
});

test('a mode the look does not cover is not marked', () => {
  const w = page();
  palette(w, LOOK.dark, { mode: 'light' });
  w.__cinnamon.setLook(LOOK);
  assert.strictEqual(marked(w), null);
});

// Hot reload: an extension that registers clean-up can be taken out of the page and run again, with no reload.
test('dispose runs an extension\'s clean-up (newest first), forgets it and its listeners, and says it did', () => {
  const w = page();
  const api = w.__cinnamon.api('x');
  const order = [];
  api.onDispose(() => order.push('a'));
  api.onDispose(() => order.push('b'));
  api.settings.onChange(() => order.push('listener'));
  assert.strictEqual(w.__cinnamon.dispose('x'), 'cinnamon:disposed');
  assert.deepStrictEqual(order, ['b', 'a']);
  w.__cinnamon.setSettings({ x: { a: 1 } });
  assert.deepStrictEqual(order, ['b', 'a'], 'its listeners are gone');
  assert.strictEqual(w.__cinnamon.dispose('x'), false, 'nothing left to dispose');
});

test('an extension without clean-up cannot be disposed (Cinnamon reloads the window instead)', () => {
  const w = page();
  w.__cinnamon.api('x').settings.onChange(() => {});
  assert.strictEqual(w.__cinnamon.dispose('x'), false);
});

test('a failing clean-up does not stop the others', () => {
  const w = page();
  const api = w.__cinnamon.api('x');
  let ran = false;
  api.onDispose(() => { ran = true; });
  api.onDispose(() => { throw new Error('boom'); });
  assert.strictEqual(w.__cinnamon.dispose('x'), 'cinnamon:disposed');
  assert.ok(ran);
});

test('clean-up survives the runtime being loaded again (each apply)', () => {
  const w = page();
  let ran = false;
  w.__cinnamon.api('x').onDispose(() => { ran = true; });
  w.eval(SRC);
  assert.strictEqual(w.__cinnamon.dispose('x'), 'cinnamon:disposed');
  assert.ok(ran);
});

// ---- claude.ai in a browser: core/browser/page.ts gives the runtime the extension's channel ----
const BROWSER_SRC = await pageCode('core/browser/page.ts');

test('in a browser, messages go to the Cinnamon extension (posted to the page\'s own window), not to the console', async () => {
  const w = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://claude.ai/new' }).window;
  open.push(w);
  w.__sent = [];
  w.console.debug = (...a) => w.__sent.push(a.join(' '));
  w.eval(BROWSER_SRC);
  w.eval(SRC);
  const posted = [];
  w.addEventListener('message', (e) => posted.push({ data: e.data }));
  w.__cinnamon.api('x').settings.set('k', 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(sent(w), []);
  assert.strictEqual(posted.length, 1);
  assert.deepStrictEqual(posted[0].data, { 'cinnamon:to-host': true, msg: { type: 'ext-setting', ext: 'x', key: 'k', value: 1 } });
  // (jsdom leaves the event's source and origin empty; in Chrome they are the page's own window and origin)
  assert.deepStrictEqual(w.__cinnamonBrowser, { ran: {} });
});

test('loading the browser channel again keeps what the document already runs', () => {
  const w = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://claude.ai/new' }).window;
  open.push(w);
  w.eval(BROWSER_SRC);
  w.__cinnamonBrowser.ran.ufo = 's1';
  w.eval(BROWSER_SRC);
  assert.deepStrictEqual(w.__cinnamonBrowser.ran, { ufo: 's1' });
});
