const { test, afterEach } = require('bun:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listExtensions, isEnabled, loadExtension } = require('../core/extensions.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ext-'));
function ext(root, id, manifest, files = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  return dir;
}

test('extensions are listed from the bundled and the user folder, sorted by name', () => {
  const b = tmp(); const u = tmp();
  ext(b, 'sidebar-cards', { name: 'Sidebar cards', page: ['page.js'] }, { 'page.js': '' });
  ext(u, 'zen', { name: 'A zen mode', css: ['zen.css'] }, { 'zen.css': '' });
  const list = listExtensions({ bundled: b, user: u });
  assert.deepStrictEqual(list.map((e) => [e.id, e.name, e.bundled]), [['zen', 'A zen mode', false], ['sidebar-cards', 'Sidebar cards', true]]);
});

test('a user extension cannot replace a bundled one with the same id', () => {
  const b = tmp(); const u = tmp();
  ext(b, 'sidebar-cards', { name: 'Sidebar cards' });
  ext(u, 'sidebar-cards', { name: 'Impostor' });
  const list = listExtensions({ bundled: b, user: u });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'Sidebar cards');
});

test('a broken manifest is listed with an error instead of breaking the list', () => {
  const b = tmp();
  ext(b, 'broken', '{ nope');
  ext(b, 'ok', { name: 'OK' });
  const list = listExtensions({ bundled: b, user: tmp() });
  assert.ok(list.find((e) => e.id === 'broken').error);
  assert.ok(!list.find((e) => e.id === 'ok').error);
});

test('extensions are on unless the config turns them off, or the manifest says off by default', () => {
  assert.strictEqual(isEnabled({ id: 'a', manifest: {} }, {}), true);
  assert.strictEqual(isEnabled({ id: 'a', manifest: { enabledByDefault: false } }, {}), false);
  assert.strictEqual(isEnabled({ id: 'a', manifest: {} }, { extensions: { a: false } }), false);
  assert.strictEqual(isEnabled({ id: 'a', manifest: { enabledByDefault: false } }, { extensions: { a: true } }), true);
  assert.strictEqual(isEnabled({ id: 'a', manifest: {}, error: 'x' }, {}), false);
});

test('loading reads the page scripts and css in manifest order', () => {
  const b = tmp();
  ext(b, 'x', { name: 'X', page: ['a.js', 'b.js'], css: ['s.css'], main: 'main.cjs' }, { 'a.js': 'A', 'b.js': 'B', 's.css': 'S', 'main.cjs': '' });
  const [e] = listExtensions({ bundled: b, user: tmp() });
  const l = loadExtension(e);
  assert.deepStrictEqual(l.page, ['A', 'B']);
  assert.deepStrictEqual(l.css, ['S']);
  assert.strictEqual(l.main, path.join(b, 'x', 'main.cjs'));
  assert.deepStrictEqual(l.errors, []);
});

test('downloaded (user) extensions may not run code in the main process', () => {
  const u = tmp();
  ext(u, 'x', { name: 'X', page: ['a.js'], main: 'main.cjs' }, { 'a.js': 'A', 'main.cjs': '' });
  const [e] = listExtensions({ bundled: tmp(), user: u });
  const l = loadExtension(e);
  assert.strictEqual(l.main, null);
  assert.deepStrictEqual(l.page, ['A']);
  assert.match(l.errors.join(), /main/);
});

test('files outside the extension folder are refused', () => {
  const b = tmp();
  fs.writeFileSync(path.join(b, 'secret.js'), 'S');
  ext(b, 'x', { name: 'X', page: ['../secret.js', '/etc/hosts', 'ok.js'], css: ['nope.txt'] }, { 'ok.js': 'OK' });
  const [e] = listExtensions({ bundled: b, user: tmp() });
  const l = loadExtension(e);
  assert.deepStrictEqual(l.page, ['OK']);
  assert.deepStrictEqual(l.css, []);
  assert.strictEqual(l.errors.length, 3);
});

test('a missing file is reported, the rest still load', () => {
  const b = tmp();
  ext(b, 'x', { name: 'X', page: ['gone.js', 'ok.js'] }, { 'ok.js': 'OK' });
  const l = loadExtension(listExtensions({ bundled: b, user: tmp() })[0]);
  assert.deepStrictEqual(l.page, ['OK']);
  assert.match(l.errors[0], /gone\.js/);
});

test('a file that is a link to somewhere outside the extension is refused', () => {
  const b = tmp();
  const secret = path.join(tmp(), 'id_rsa');
  fs.writeFileSync(secret, 'SECRET');
  ext(b, 'x', { name: 'X', page: ['p.js', 'ok.js'], css: ['s.css'] }, { 'ok.js': 'OK' });
  fs.symlinkSync(secret, path.join(b, 'x', 'p.js'));
  fs.symlinkSync(secret, path.join(b, 'x', 's.css'));
  const l = loadExtension(listExtensions({ bundled: b, user: tmp() })[0]);
  assert.deepStrictEqual(l.page, ['OK']);
  assert.deepStrictEqual(l.css, []);
  assert.strictEqual(l.errors.length, 2);
});
