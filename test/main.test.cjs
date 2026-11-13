// Tests for core/main.js.tmpl: the script evaluated in Claude's main process. Runs it in a vm with a fake Electron.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { renderMain } = require('../core/render.cjs');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'core', 'main.js.tmpl'), 'utf8');

class FakeWC extends EventEmitter {
  constructor(id, url = 'https://claude.ai/epitaxy') { super(); this.id = id; this.url = url; this.mainFrame = { name: 'main' }; this.js = []; this.css = []; this.removed = []; this.reloads = 0; this.replies = {}; }
  isDestroyed() { return false; }
  getURL() { return this.url; }
  async insertCSS(c) { this.css.push(c); return `k${this.id}-${this.css.length}`; }
  async removeInsertedCSS(k) { this.removed.push(k); }
  reload() { this.reloads++; }
  async executeJavaScript(s) {
    this.js.push(s);
    for (const [needle, reply] of Object.entries(this.replies)) if (s.includes(needle)) return typeof reply === 'function' ? reply() : reply;
    return true;
  }
}

// A BrowserWindow whose setVibrancy lives on the prototype, as in Electron.
class FakeWindowBase { setVibrancy(m) { this.materials.push(m); } }
class FakeWindow extends FakeWindowBase { constructor(id) { super(); this.id = id; this.materials = []; } isDestroyed() { return false; } }

function harness({ seed } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-main-'));
  const userData = path.join(base, 'app'); fs.mkdirSync(path.join(userData, 'claude-code-sessions'), { recursive: true });
  const user = path.join(base, 'user');
  const themes = path.join(base, 'themes'); fs.mkdirSync(themes);
  fs.writeFileSync(path.join(themes, 'codex.json'), JSON.stringify({ name: 'Codex', dark: { background: '#111111' } }));
  fs.writeFileSync(path.join(themes, 'paper.json'), JSON.stringify({ name: 'Paper', dark: { background: '#222222' } }));
  const bundled = path.join(base, 'ext'); fs.mkdirSync(bundled);
  const userExt = path.join(user, 'extensions');
  const app = new EventEmitter();
  app.getPath = () => userData;
  const wc = new FakeWC(1);
  const all = [wc];
  const opened = [];
  const win = new FakeWindow(1);
  const windows = [win];
  const electron = { app, webContents: { getAllWebContents: () => all }, shell: { openPath: async (p) => { opened.push(p); return ''; } },
    BrowserWindow: { getAllWindows: () => windows } };
  const fakeRequire = Object.assign((m) => (m === 'electron' ? electron : require(m)), { cache: require.cache });
  const ctx = vm.createContext({ require: fakeRequire, setTimeout, clearTimeout, setInterval, clearInterval, console });
  if (seed) ctx.__claudeMod = seed(wc);
  const configPath = path.join(user, 'config.json');
  const setConfig = (c) => { fs.mkdirSync(user, { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(c)); };
  const config = () => JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const addExt = (id, manifest, files = {}, root = bundled) => {
    const dir = path.join(root, id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  };
  const run = () => vm.runInContext(renderMain({ template: TEMPLATE, root: ROOT, userDir: user, themeDirs: [themes, path.join(user, 'themes')], extRoots: { bundled, user: userExt } }), ctx);
  const state = () => ctx.__claudeMod;
  const stop = () => {
    const s = ctx.__claudeMod;
    for (const w of s.watchers || []) { try { w.close(); } catch {} }
    clearTimeout(s.reloadDebounce);
    clearInterval(s.pollTimer);
    for (const m of s.mains?.values() || []) m.ctx._cleanup();
  };
  return { app, wc, all, ctx, run, stop, state, configPath, setConfig, config, addExt, user, userExt, opened, bundled, win, windows, themes };
}
const flush = () => new Promise((r) => setTimeout(r, 30));
// File-watcher tests: wait until the condition holds (watch events can be slow when the whole suite runs at once).
async function until(cond, ms = 9000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return cond();
}
const say = (wc, msg) => wc.emit('console-message', { message: `[cinnamon] ${JSON.stringify(msg)}`, frame: wc.mainFrame });
const sayOld = (wc, msg) => wc.emit('console-message', {}, 0, `[cinnamon] ${JSON.stringify(msg)}`);
const ran = (wc, needle) => wc.js.some((s) => s.includes(needle));
const themeCss = (wc) => wc.css.filter((c) => c.includes('--cds-surface-1'));
const last = (wc, fn) => wc.js.filter((s) => s.includes(fn)).at(-1) || '';

// ---- core ----
test('the page runtime and the Settings rows are put into each view', async () => {
  const h = harness();
  try {
    await h.run();
    assert.ok(ran(h.wc, 'window.__cinnamon ??='));
    assert.ok(ran(h.wc, '__cmSetThemes = '));
  } finally { h.stop(); }
});

test('a reload of the page re-applies everything', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: ['p.js'], css: ['s.css'] }, { 'p.js': '/*X-CODE*/', 's.css': '.x{}' });
    await h.run();
    h.wc.js = []; h.wc.css = [];
    h.wc.emit('dom-ready');
    await flush();
    assert.ok(ran(h.wc, '/*X-CODE*/'));
    assert.ok(h.wc.css.includes('.x{}'));
  } finally { h.stop(); }
});

test('a new window gets the extensions', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: ['p.js'] }, { 'p.js': '/*X-CODE*/' });
    await h.run();
    const wc2 = new FakeWC(2); h.all.push(wc2);
    h.app.emit('web-contents-created', {}, wc2);
    wc2.emit('dom-ready');
    await flush();
    assert.ok(ran(wc2, '/*X-CODE*/'));
  } finally { h.stop(); }
});

test('views hooked by an older version still get reloads and page messages', async () => {
  const h = harness({ seed: (wc) => ({ keys: new Map(), dispatchHooked: new WeakSet([wc]), dispatchListening: true }) });
  try {
    await h.run();
    say(h.wc, { type: 'theme', id: 'codex' });
    await flush();
    assert.strictEqual(h.config().theme, 'codex');
  } finally { h.stop(); }
});

test('timers left by the version before extensions are stopped', async () => {
  let ticks = 0;
  const h = harness({ seed: () => ({ timer: setInterval(() => ticks++, 5) }) });
  try {
    await h.run();
    const t = ticks;
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(ticks, t);
  } finally { h.stop(); }
});

// ---- extensions ----
test('an enabled extension has its css inserted and its page code run with its own api', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: ['p.js'], css: ['s.css'] }, { 'p.js': '/*X-CODE*/', 's.css': '.x{}' });
    await h.run();
    assert.ok(h.wc.css.includes('.x{}'));
    const code = h.wc.js.find((s) => s.includes('/*X-CODE*/'));
    assert.match(code, /window\.__cinnamon\.api\("x"\)/);
  } finally { h.stop(); }
});

test('an extension turned off in the config is not applied', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: ['p.js'] }, { 'p.js': '/*X-CODE*/' });
    h.setConfig({ extensions: { x: false } });
    await h.run();
    assert.ok(!ran(h.wc, '/*X-CODE*/'));
  } finally { h.stop(); }
});

test('the extension list is sent to the page', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'Nice X', page: [] });
    await h.run();
    assert.match(last(h.wc, '__cmSetExtensions?.('), /"name":"Nice X".*"enabled":true/);
  } finally { h.stop(); }
});

test('turning an extension off from the page saves it and reloads the view', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: ['p.js'] }, { 'p.js': '/*X-CODE*/' });
    await h.run();
    say(h.wc, { type: 'extension', id: 'x', enabled: false });
    await flush();
    assert.deepStrictEqual(h.config().extensions, { x: false });
    assert.strictEqual(h.wc.reloads, 1);
  } finally { h.stop(); }
});

test('turning an extension on applies it without a reload', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: ['p.js'] }, { 'p.js': '/*X-CODE*/' });
    h.setConfig({ extensions: { x: false } });
    await h.run();
    say(h.wc, { type: 'extension', id: 'x', enabled: true });
    await flush();
    assert.ok(ran(h.wc, '/*X-CODE*/'));
    assert.strictEqual(h.wc.reloads, 0);
  } finally { h.stop(); }
});

test('switching the theme does not re-run extension code or reload', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: ['p.js'] }, { 'p.js': '/*X-CODE*/' });
    await h.run();
    h.wc.js = [];
    say(h.wc, { type: 'theme', id: 'codex' });
    await new Promise((r) => setTimeout(r, 500)); // past the config watcher too
    assert.ok(!ran(h.wc, '/*X-CODE*/'));
    assert.strictEqual(h.wc.reloads, 0);
  } finally { h.stop(); }
});

test('an extension setting from the page is saved and sent back to the pages', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', page: [] });
    await h.run();
    say(h.wc, { type: 'ext-setting', ext: 'x', key: 'width', value: 'full' });
    await flush();
    assert.deepStrictEqual(h.config().settings, { x: { width: 'full' } });
    assert.match(last(h.wc, 'setSettings('), /"x":\{"width":"full"\}/);
  } finally { h.stop(); }
});

test('settings for unknown extensions or with odd keys are ignored', async () => {
  const h = harness();
  try {
    await h.run();
    say(h.wc, { type: 'ext-setting', ext: 'nope', key: 'k', value: 1 });
    say(h.wc, { type: 'extension', id: 'nope', enabled: false });
    await flush();
    assert.strictEqual(fs.existsSync(h.configPath), false);
  } finally { h.stop(); }
});

test('a bundled main part starts with its context, gets messages, and is stopped on re-apply', async () => {
  const h = harness();
  try {
    const log = path.join(h.user, 'main.log');
    h.addExt('x', { name: 'X', page: [], main: 'main.cjs' }, { 'main.cjs': `
      const fs = require('fs');
      module.exports = { activate(ctx) {
        fs.appendFileSync(${JSON.stringify(log)}, 'start ' + ctx.id + ' ' + fs.existsSync(ctx.dataDir) + '\\n');
        return { onMessage(msg, data) { fs.appendFileSync(${JSON.stringify(log)}, 'msg ' + msg + ' ' + data + '\\n'); },
                 deactivate() { fs.appendFileSync(${JSON.stringify(log)}, 'stop\\n'); } };
      } };` });
    await h.run();
    say(h.wc, { type: 'ext', ext: 'x', msg: 'hello', data: 7 });
    await flush();
    await h.run();
    assert.deepStrictEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['start x true', 'msg hello 7', 'stop', 'start x true']);
  } finally { h.stop(); }
});

test('a main part\'s timers are cleared when it is stopped', async () => {
  const h = harness();
  try {
    const log = path.join(h.user, 'tick.log');
    h.addExt('x', { name: 'X', main: 'main.cjs' }, { 'main.cjs': `
      module.exports = { activate(ctx) { ctx.setInterval(() => require('fs').appendFileSync(${JSON.stringify(log)}, '.'), 5); } };` });
    await h.run();
    say(h.wc, { type: 'extension', id: 'x', enabled: false });
    await flush();
    const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').length : 0;
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').length : 0, n);
  } finally { h.stop(); }
});

test('a failing main part never rejects the apply', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', main: 'main.cjs' }, { 'main.cjs': "module.exports = { activate() { throw new Error('boom'); } };" });
    await assert.doesNotReject(h.run());
  } finally { h.stop(); }
});

test('a downloaded extension never gets a main part', async () => {
  const h = harness();
  try {
    const log = path.join(h.user, 'evil.log');
    h.addExt('dl', { name: 'DL', page: ['p.js'], main: 'main.cjs' }, { 'p.js': '/*DL*/', 'main.cjs': `require('fs').writeFileSync(${JSON.stringify(log)}, 'ran')` }, h.userExt);
    await h.run();
    assert.ok(ran(h.wc, '/*DL*/'));
    assert.strictEqual(fs.existsSync(log), false);
  } finally { h.stop(); }
});

test('Open extensions folder opens the user extensions folder', async () => {
  const h = harness();
  try {
    await h.run();
    say(h.wc, { type: 'open-extensions-folder' });
    await flush();
    assert.deepStrictEqual(h.opened, [h.userExt]);
  } finally { h.stop(); }
});

// ---- themes ----
test('the configured theme is inserted into each view', async () => {
  const h = harness();
  try {
    h.setConfig({ theme: 'codex' });
    await h.run();
    assert.strictEqual(themeCss(h.wc).length, 1);
    assert.match(themeCss(h.wc)[0], /#111111/);
  } finally { h.stop(); }
});

test('with no config, no theme css is inserted', async () => {
  const h = harness();
  try {
    await h.run();
    assert.deepStrictEqual(themeCss(h.wc), []);
    assert.match(last(h.wc, '__cmSetThemes?.('), /"current":"default".*"name":"Codex"/);
  } finally { h.stop(); }
});

test('picking a theme saves it and swaps the theme css, new before old is removed', async () => {
  const h = harness();
  try {
    h.setConfig({ theme: 'codex' });
    await h.run();
    const firstKey = h.state().themeKeys.get(1);
    say(h.wc, { type: 'theme', id: 'paper' });
    await flush();
    assert.strictEqual(h.config().theme, 'paper');
    assert.match(themeCss(h.wc).at(-1), /#222222/);
    assert.ok(h.wc.removed.includes(firstKey));
    assert.match(last(h.wc, '__cmSetThemes?.('), /"current":"paper"/);
  } finally { h.stop(); }
});

test('picks also arrive through the older console-message signature', async () => {
  const h = harness();
  try {
    await h.run();
    sayOld(h.wc, { type: 'theme', id: 'codex' });
    await flush();
    assert.strictEqual(h.config().theme, 'codex');
  } finally { h.stop(); }
});

test('an unknown theme id or other console output is ignored', async () => {
  const h = harness();
  try {
    await h.run();
    say(h.wc, { type: 'theme', id: '../../etc' });
    h.wc.emit('console-message', { message: 'hello', frame: h.wc.mainFrame });
    h.wc.emit('console-message', { message: '[cinnamon] {not json', frame: h.wc.mainFrame });
    await flush();
    assert.strictEqual(fs.existsSync(h.configPath), false);
  } finally { h.stop(); }
});

test('Open themes folder opens the user themes folder', async () => {
  const h = harness();
  try {
    await h.run();
    say(h.wc, { type: 'open-themes-folder' });
    await flush();
    assert.deepStrictEqual(h.opened, [path.join(h.user, 'themes')]);
  } finally { h.stop(); }
});

test('editing config.json applies the new theme', async () => {
  const h = harness();
  try {
    await h.run();
    h.setConfig({ theme: 'paper' });
    assert.ok(await until(() => /#222222/.test(themeCss(h.wc).at(-1) || '')), 'theme css applied after the config edit');
  } finally { h.stop(); }
});

test('a theme file added to the user folder shows up in the page list', async () => {
  const h = harness();
  try {
    await h.run();
    fs.writeFileSync(path.join(h.user, 'themes', 'mine.json'), JSON.stringify({ name: 'Mine', dark: { background: '#333333' } }));
    assert.ok(await until(() => /"name":"Mine"/.test(last(h.wc, '__cmSetThemes?.('))), 'new theme listed');
  } finally { h.stop(); }
});

// ---- window material (glass) ----
test('a theme with a window material puts it on the windows; switching away restores the app\'s own', async () => {
  const h = harness();
  try {
    fs.writeFileSync(path.join(h.themes, 'glass.json'), JSON.stringify({ name: 'Glass', window: { vibrancy: 'under-window' }, dark: { background: '#00000033' } }));
    h.wc.replies['dataset.sidebarVibrancy'] = 'sidebar';
    h.setConfig({ theme: 'glass' });
    await h.run();
    assert.deepStrictEqual(h.win.materials, ['under-window']);
    say(h.wc, { type: 'theme', id: 'codex' });
    await flush();
    assert.deepStrictEqual(h.win.materials, ['under-window', 'sidebar']);
  } finally { h.stop(); }
});

test('while a theme\'s material is on, the app\'s own material changes are held back and remembered', async () => {
  const h = harness();
  try {
    fs.writeFileSync(path.join(h.themes, 'glass.json'), JSON.stringify({ name: 'Glass', window: { vibrancy: 'under-window' }, dark: { background: '#00000033' } }));
    h.setConfig({ theme: 'glass' });
    await h.run();
    h.win.setVibrancy('popover'); // the app asks for another material
    assert.deepStrictEqual(h.win.materials, ['under-window', 'under-window']);
    say(h.wc, { type: 'theme', id: 'default' });
    await flush();
    assert.strictEqual(h.win.materials.at(-1), 'popover');
    h.win.setVibrancy('sidebar'); // with no theme material, the app's calls go straight through
    assert.strictEqual(h.win.materials.at(-1), 'sidebar');
  } finally { h.stop(); }
});

test('themes without a window material leave the window alone', async () => {
  const h = harness();
  try {
    h.setConfig({ theme: 'codex' });
    await h.run();
    assert.deepStrictEqual(h.win.materials, []);
  } finally { h.stop(); }
});

test('a glass theme also clears the app frame page behind the chat, and switching away restores it', async () => {
  const h = harness();
  try {
    const frame = new FakeWC(9, 'file:///Applications/Claude.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html');
    h.all.push(frame);
    fs.writeFileSync(path.join(h.themes, 'glass.json'), JSON.stringify({ name: 'Glass', window: { vibrancy: 'under-window' }, dark: { background: 'transparent' } }));
    h.setConfig({ theme: 'glass' });
    await h.run();
    assert.strictEqual(frame.css.length, 1);
    assert.match(frame.css[0], /body::before[^{]*\{[^}]*transparent/);
    const key = h.state().frameKeys.get(9);
    say(h.wc, { type: 'theme', id: 'codex' });
    await flush();
    assert.ok(frame.removed.includes(key));
    frame.emit('dom-ready'); // a reload of the frame page with no glass theme gets nothing
    await flush();
    assert.strictEqual(frame.css.length, 1);
  } finally { h.stop(); }
});

test('the frame page is cleared again after it reloads while a glass theme is on', async () => {
  const h = harness();
  try {
    const frame = new FakeWC(9, 'file:///x/app.asar/.vite/renderer/main_window/index.html');
    h.all.push(frame);
    fs.writeFileSync(path.join(h.themes, 'glass.json'), JSON.stringify({ name: 'Glass', window: { vibrancy: 'under-window' }, dark: {} }));
    h.setConfig({ theme: 'glass' });
    await h.run();
    frame.emit('dom-ready');
    await flush();
    assert.strictEqual(frame.css.length, 2);
  } finally { h.stop(); }
});

test('page messages from embedded frames (artifacts, iframes) are ignored; the top page is listened to', async () => {
  const h = harness();
  try {
    await h.run();
    h.wc.emit('console-message', { message: `[cinnamon] ${JSON.stringify({ type: 'theme', id: 'codex' })}`, frame: { name: 'iframe' } });
    await flush();
    assert.strictEqual(fs.existsSync(h.configPath), false);
    h.wc.emit('console-message', { message: `[cinnamon] ${JSON.stringify({ type: 'theme', id: 'codex' })}`, frame: h.wc.mainFrame });
    await flush();
    assert.strictEqual(h.config().theme, 'codex');
  } finally { h.stop(); }
});

// ---- views hooked by an older script (its dom-ready listener only clears the css key) ----
function oldScriptSeed(wc) {
  const st = { keys: new Map(), dispatchHooked: new WeakSet([wc]), dispatchListening: true };
  wc.on('dom-ready', () => { st.keys.delete(wc.id); Promise.resolve(st.applyTo?.(wc)).catch(() => {}); });
  return st;
}

test('a page reload in a view hooked by an older script still re-applies the theme and extensions', async () => {
  const h = harness({ seed: oldScriptSeed });
  try {
    h.addExt('x', { name: 'X', page: ['p.js'] }, { 'p.js': '/*X-CODE*/' });
    h.setConfig({ theme: 'codex' });
    await h.run();
    h.wc.js = []; h.wc.css = [];
    h.wc.emit('dom-ready');
    await flush();
    assert.ok(ran(h.wc, '/*X-CODE*/'), 'extension code re-run after the reload');
    assert.strictEqual(themeCss(h.wc).length, 1, 'theme css re-inserted after the reload');
  } finally { h.stop(); }
});

test('turning an extension off reloads the view once, not over and over', async () => {
  const h = harness({ seed: oldScriptSeed });
  try {
    h.addExt('x', { name: 'X', page: ['p.js'] }, { 'p.js': '/*X-CODE*/' });
    await h.run();
    h.wc.reload = function () { this.reloads++; setTimeout(() => this.emit('dom-ready'), 5); };
    say(h.wc, { type: 'extension', id: 'x', enabled: false });
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(h.wc.reloads, 1);
  } finally { h.stop(); }
});

test('a message whose frame is unknown is ignored', async () => {
  const h = harness();
  try {
    await h.run();
    h.wc.emit('console-message', { message: `[cinnamon] ${JSON.stringify({ type: 'theme', id: 'codex' })}`, frame: null });
    await flush();
    assert.strictEqual(fs.existsSync(h.configPath), false);
  } finally { h.stop(); }
});

test('a change to an extension\'s css applies live', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', css: ['s.css'] }, { 's.css': '.old{}' });
    await h.run();
    fs.writeFileSync(path.join(h.bundled, 'x', 's.css'), '.new{}');
    assert.ok(await until(() => h.wc.css.includes('.new{}')), 'new css inserted');
    assert.strictEqual(h.wc.reloads, 0);
  } finally { h.stop(); }
});

test('turning off an extension that only has css removes it without a reload', async () => {
  const h = harness();
  try {
    h.addExt('x', { name: 'X', css: ['s.css'] }, { 's.css': '.x{}' });
    await h.run();
    say(h.wc, { type: 'extension', id: 'x', enabled: false });
    await flush();
    assert.strictEqual(h.wc.reloads, 0);
    assert.ok(h.wc.removed.length >= 1);
  } finally { h.stop(); }
});

test('quick theme switches end with exactly the last theme in place', async () => {
  const h = harness();
  try {
    h.setConfig({ theme: 'codex' });
    await h.run();
    say(h.wc, { type: 'theme', id: 'paper' });
    say(h.wc, { type: 'theme', id: 'codex' });
    say(h.wc, { type: 'theme', id: 'paper' });
    await new Promise((r) => setTimeout(r, 700));
    const inserted = h.wc.css.map((c, i) => [c, `k1-${i + 1}`]).filter(([c]) => c.includes('--cds-surface-1')).map(([, k]) => k);
    const live = inserted.filter((k) => !h.wc.removed.includes(k));
    assert.strictEqual(live.length, 1, `live theme css keys: ${live}`);
    assert.match(h.wc.css[Number(live[0].split('-')[1]) - 1], /#222222/);
  } finally { h.stop(); }
});

test('the apply result lists the claude.ai views it could see, for diagnosing an empty apply', async () => {
  const h = harness();
  try {
    const r = await h.run();
    assert.deepStrictEqual([...r.views], [1]); // copied: the result comes from the vm's own realm
    assert.deepStrictEqual([...r.applied], [1]);
  } finally { h.stop(); }
});
