const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'page-runtime.js'), 'utf8');
const open = [];
test.afterEach(() => { while (open.length) open.pop().close(); });

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
