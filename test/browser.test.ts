// Cinnamon on claude.ai in a browser: the Chrome extension (browser/), its native messaging host
// (core/browser/BrowserHost.ts) and `cinnamon browser install` (core/browser/BrowserSetup.ts).
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { cssPlan, desiredCss, disposeSnippet, PROBE, runSnippet, scriptPlan } from '../browser/apply';
import { BrowserHost, DESKTOP_ONLY, GLASS_GROUND } from '../core/browser/BrowserHost';
import { BrowserSetup, extensionIdOf, extensionVersion } from '../core/browser/BrowserSetup';
import { ChunkJoiner, Decoder, frame, framesFor, MAX_TO_BROWSER } from '../core/browser/NativeMessaging';
import { EXTENSION_ID, HOST_NAME, type HostState } from '../core/browser/protocol';
import { ROOT } from './helpers';

const tmp = (p: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

// ---- the extension's identity ----
test('the extension id follows from the key in browser/manifest.json', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'browser', 'manifest.json'), 'utf8'));
  assert.strictEqual(extensionIdOf(manifest.key), EXTENSION_ID);
});

test('the extension version is Cinnamon\'s with a fourth number from the build, within Chrome\'s limits', () => {
  const v = extensionVersion('0.3.4', 'a');
  assert.match(v, /^0\.3\.4\.\d+$/);
  assert.notStrictEqual(v, extensionVersion('0.3.4', 'b'));
  assert.strictEqual(v, extensionVersion('0.3.4', 'a'));
  for (const n of extensionVersion('?', 'x').split('.')) assert.ok(Number(n) >= 0 && Number(n) <= 65535);
  assert.match(extensionVersion('1.2.3-beta.4', 'x'), /^1\.2\.3\.\d+$/);
});

// ---- native messaging ----
test('a framed message is its JSON after a 32-bit little-endian length', () => {
  const f = frame({ a: 1 });
  assert.strictEqual(new DataView(f.buffer).getUint32(0, true), 7);
  assert.strictEqual(new TextDecoder().decode(f.subarray(4)), '{"a":1}');
});

test('the decoder hands out whole messages, however the bytes arrive', () => {
  const d = new Decoder();
  const bytes = new Uint8Array([...frame({ type: 'hello' }), ...frame({ n: 'é' })]);
  const got: unknown[] = [];
  for (let i = 0; i < bytes.length; i += 3) got.push(...d.push(bytes.subarray(i, i + 3)));
  assert.deepStrictEqual(got, [{ type: 'hello' }, { n: 'é' }]);
});

test('a length over the limit ends the stream', () => {
  const bad = new Uint8Array(4);
  new DataView(bad.buffer).setUint32(0, 100 * 1024 * 1024, true);
  assert.throws(() => new Decoder().push(bad), /too long/);
});

test('a message too long for one goes as chunks under the browser\'s limit, and joins back up', () => {
  const big = { type: 'state', css: 'x'.repeat(3 * 1024 * 1024), note: 'ünïcode' };
  const frames = framesFor(big);
  assert.ok(frames.length > 1);
  for (const f of frames) assert.ok(f.length - 4 <= MAX_TO_BROWSER + 4096);
  const d = new Decoder();
  const joiner = new ChunkJoiner();
  let out: unknown = null;
  for (const f of frames) for (const m of d.push(f)) { const r = joiner.add(m); if (r) out = r; }
  assert.deepStrictEqual(out, big);
  assert.deepStrictEqual(new ChunkJoiner().add({ type: 'state' }), { type: 'state' }, 'a whole message passes through');
});

// ---- the host ----
function hostSetup() {
  const base = tmp('cm-browser-');
  const root = path.join(base, 'root');
  const user = path.join(base, 'user');
  const themes = path.join(root, 'themes');
  const bundled = path.join(root, 'extensions');
  fs.mkdirSync(themes, { recursive: true });
  fs.mkdirSync(path.join(user, 'extensions'), { recursive: true });
  fs.writeFileSync(path.join(themes, 'codex.json'), JSON.stringify({ name: 'Codex', dark: { background: '#111111' } }));
  fs.writeFileSync(path.join(themes, 'glass.json'), JSON.stringify({ name: 'Glass', window: { vibrancy: 'under-window' }, dark: { background: 'transparent' } }));
  const ext = (id: string, manifest: object, files: Record<string, string>) => {
    fs.mkdirSync(path.join(bundled, id), { recursive: true });
    fs.writeFileSync(path.join(bundled, id, 'manifest.json'), JSON.stringify(manifest));
    for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(bundled, id, f), t);
  };
  ext('ufo', { name: 'UFO', page: ['p.js'], css: ['s.css'] }, { 'p.js': '/*UFO*/', 's.css': '.ufo{}' });
  ext('cards', { name: 'Cards', page: ['p.js'], main: 'm.cjs' }, { 'p.js': '/*CARDS*/', 'm.cjs': 'module.exports={}' });
  ext('off', { name: 'Off', page: ['p.js'], enabledByDefault: false }, { 'p.js': '/*OFF*/' });
  const extDir = path.join(user, 'browser', 'extension');
  const written: Uint8Array[] = [];
  const opened: string[] = [];
  const host = new BrowserHost({
    root, userDir: user, version: '0.3.4', extensionDir: extDir, compiler: null,
    write: (b) => written.push(b), pageCode: async () => ({ js: '/*CORE*/', css: '.core{}' }), open: (d) => opened.push(d), log: () => {},
  });
  const states = (): HostState[] => {
    const d = new Decoder();
    const j = new ChunkJoiner();
    const out: HostState[] = [];
    for (const b of written) for (const m of d.push(b)) { const r = j.add(m) as HostState | null; if (r?.type === 'state') out.push(r); }
    return out;
  };
  const config = () => JSON.parse(fs.readFileSync(path.join(user, 'config.json'), 'utf8'));
  const setConfig = (c: object) => fs.writeFileSync(path.join(user, 'config.json'), JSON.stringify(c));
  return { base, root, user, host, written, states, config, setConfig, opened, extDir };
}

test('the state has the theme\'s CSS, the core page code and the enabled extensions, wrapped for the runtime', async () => {
  const h = hostSetup();
  h.setConfig({ theme: 'codex' });
  const s = await h.host.state();
  assert.strictEqual(s.theme.id, 'codex');
  assert.match(s.theme.css, /#111111/);
  assert.deepStrictEqual(s.core, { js: '/*CORE*/', css: '.core{}' });
  assert.deepStrictEqual(s.extensions.map((e) => e.id), ['ufo']);
  assert.match(s.extensions[0]!.code, /window\.__cinnamon\.api\("ufo"\)/);
  assert.match(s.extensions[0]!.code, /\/\*UFO\*\//);
  assert.strictEqual(s.extensions[0]!.css, '.ufo{}');
});

test('an extension with a main part is listed as desktop-only and its code is not sent', async () => {
  const h = hostSetup();
  const s = await h.host.state();
  const cards = s.extList.find((e) => e.id === 'cards')!;
  assert.strictEqual(cards.unavailable, DESKTOP_ONLY);
  assert.ok(!s.extensions.some((e) => e.id === 'cards'));
  assert.ok(!s.extensions.some((e) => e.id === 'off'), 'off by default stays off');
});

test('a theme made for a window material gets a dark ground in the browser', async () => {
  const h = hostSetup();
  h.setConfig({ theme: 'glass' });
  const s = await h.host.state();
  assert.ok(s.theme.css.endsWith(GLASS_GROUND));
  h.setConfig({ theme: 'codex' });
  assert.ok(!(await h.host.state()).theme.css.includes(GLASS_GROUND));
});

test('hello sends the state and records the connection for status and doctor', async () => {
  const h = hostSetup();
  await h.host.handle({ type: 'hello', version: '0.3.4.9', userScripts: true });
  assert.strictEqual(h.states().length, 1);
  const st = BrowserHost.readStatus(h.user);
  assert.ok(st.connected);
  assert.strictEqual(st.extensionVersion, '0.3.4.9');
  assert.strictEqual(st.userScripts, true);
  await h.host.handle({ type: 'status', userScripts: false, problem: 'claude.ai refused it' });
  assert.strictEqual(BrowserHost.readStatus(h.user).problem, 'claude.ai refused it');
});

test('the state carries the version of the extension folder on disk, so the extension can update itself', async () => {
  const h = hostSetup();
  assert.strictEqual((await h.host.state()).extensionVersion, null);
  fs.mkdirSync(h.extDir, { recursive: true });
  fs.writeFileSync(path.join(h.extDir, 'manifest.json'), JSON.stringify({ version: '0.3.5.2' }));
  assert.strictEqual((await h.host.state()).extensionVersion, '0.3.5.2');
});

test('a theme picked in the page is saved and the new state sent; an unknown theme is ignored', async () => {
  const h = hostSetup();
  h.setConfig({ theme: 'codex' });
  await h.host.handle({ type: 'hello', version: 'x', userScripts: true });
  await h.host.handle({ type: 'page', msg: { type: 'theme', id: 'glass' } });
  assert.strictEqual(h.config().theme, 'glass');
  assert.strictEqual(h.states().at(-1)!.theme.id, 'glass');
  await h.host.handle({ type: 'page', msg: { type: 'theme', id: 'nope' } });
  assert.strictEqual(h.config().theme, 'glass');
  await h.host.handle({ type: 'page', msg: { type: 'theme', id: 'default' } });
  assert.strictEqual(h.config().theme, 'default');
});

test('extensions switched in the page are saved, except desktop-only ones; settings are saved too', async () => {
  const h = hostSetup();
  await h.host.handle({ type: 'page', msg: { type: 'extension', id: 'off', enabled: true } });
  assert.strictEqual(h.config().extensions.off, true);
  assert.ok((await h.host.state()).extensions.some((e) => e.id === 'off'));
  await h.host.handle({ type: 'page', msg: { type: 'extension', id: 'cards', enabled: false } });
  assert.strictEqual(h.config().extensions.cards, undefined);
  await h.host.handle({ type: 'page', msg: { type: 'ext-setting', ext: 'ufo', key: 'speed', value: 2 } });
  assert.deepStrictEqual(h.config().settings, { ufo: { speed: 2 } });
  await h.host.handle({ type: 'page', msg: { type: 'ext-setting', ext: 'ufo', key: 'bad key!', value: 1 } });
  await h.host.handle({ type: 'page', msg: { type: 'ext-setting', ext: 'nope', key: 'k', value: 1 } });
  assert.deepStrictEqual(h.config().settings, { ufo: { speed: 2 } });
});

test('page errors are recorded per extension, and the folder buttons open the user folders', async () => {
  const h = hostSetup();
  await h.host.handle({ type: 'page', msg: { type: 'ext-error', ext: 'ufo', message: 'boom' } });
  assert.deepStrictEqual(BrowserHost.readStatus(h.user).errors.ufo, ['boom']);
  await h.host.handle({ type: 'page', msg: { type: 'open-extensions-folder' } });
  await h.host.handle({ type: 'page', msg: { type: 'open-themes-folder' } });
  assert.deepStrictEqual(h.opened, [path.join(h.user, 'extensions'), path.join(h.user, 'themes')]);
});

test('the host speaks native messaging on its input and output until the browser closes it', async () => {
  const h = hostSetup();
  async function* input() { yield frame({ type: 'hello', version: 'x', userScripts: false }); }
  await h.host.serve(input());
  const s = h.states();
  assert.strictEqual(s.length, 1);
  assert.deepStrictEqual(s[0]!.extensions.map((e) => e.id), ['ufo']);
});

test('a file change sends the new state (theme edited on disk)', async () => {
  const h = hostSetup();
  h.setConfig({ theme: 'codex' });
  await h.host.handle({ type: 'hello', version: 'x', userScripts: true });
  h.host.watch();
  try {
    fs.writeFileSync(path.join(h.root, 'themes', 'codex.json'), JSON.stringify({ name: 'Codex', dark: { background: '#222222' } }));
    const end = Date.now() + 9000;
    while (Date.now() < end && !h.states().some((s) => s.theme.css.includes('#222222'))) await new Promise((r) => setTimeout(r, 50));
    assert.ok(h.states().some((s) => s.theme.css.includes('#222222')));
  } finally { h.host.stop(); }
});

// ---- what the extension does in a page ----
const STATE = (exts: { id: string; sig: string; code: string; css: string }[]): HostState => ({
  type: 'state', version: '1', extensionVersion: null, core: { js: '', css: '.core{}' },
  theme: { id: 'codex', css: '.theme{}', themes: [] }, extensions: exts, extList: [], settings: {},
});

test('CSS: changed and new keys go in, then the old text comes out; nothing for an unchanged key', () => {
  const desired = desiredCss(STATE([{ id: 'a', sig: '1', code: '', css: '.a{}' }, { id: 'b', sig: '1', code: '', css: '' }]));
  assert.deepStrictEqual(desired, { core: '.core{}', theme: '.theme{}', 'ext:a': '.a{}' });
  const plan = cssPlan({ core: '.core{}', theme: '.old{}', 'ext:gone': '.g{}' }, desired);
  assert.deepStrictEqual(plan.insert, [['theme', '.theme{}'], ['ext:a', '.a{}']]);
  assert.deepStrictEqual(plan.remove, [['theme', '.old{}'], ['ext:gone', '.g{}']]);
});

test('extensions: changed or turned-off ones are taken out, new or changed ones run', () => {
  const exts = [{ id: 'a', sig: '2', code: 'x', css: '' }, { id: 'b', sig: '1', code: 'y', css: '' }, { id: 'c', sig: '1', code: 'z', css: '' }];
  const plan = scriptPlan({ a: '1', b: '1', gone: '1' }, exts);
  assert.deepStrictEqual(plan.dispose, ['a', 'gone']);
  assert.deepStrictEqual(plan.run.map((e) => e.id), ['a', 'c']);
});

function fakePage() {
  const ctx = vm.createContext({ console });
  vm.runInContext('var window = globalThis; window.__cinnamonBrowser = { ran: {} }; window.count = 0;', ctx);
  return ctx;
}

test('an extension\'s code runs once per document, even when asked twice', () => {
  const page = fakePage();
  const snippet = runSnippet({ id: 'ufo', sig: 's1', code: 'window.count++;', css: '' });
  assert.strictEqual(vm.runInContext(snippet, page), 'ran');
  assert.strictEqual(vm.runInContext(snippet, page), 'skip');
  assert.strictEqual(vm.runInContext('window.count', page), 1);
  assert.strictEqual(vm.runInContext(PROBE, page), '{"ufo":"s1"}');
  assert.strictEqual(vm.runInContext(runSnippet({ id: 'ufo', sig: 's2', code: 'window.count++;', css: '' }), page), 'ran', 'a new version runs');
});

test('the probe says when Cinnamon isn\'t in a document yet', () => {
  const ctx = vm.createContext({});
  vm.runInContext('var window = globalThis;', ctx);
  assert.strictEqual(vm.runInContext(PROBE, ctx), null);
});

test('taking an extension out forgets it only when its clean-up ran', () => {
  const page = fakePage();
  vm.runInContext('window.__cinnamonBrowser.ran = { a: "1", b: "1" }; window.__cinnamon = { dispose: (id) => id === "a" ? "cinnamon:disposed" : false };', page);
  assert.strictEqual(vm.runInContext(disposeSnippet('a'), page), 'cinnamon:disposed');
  assert.strictEqual(vm.runInContext(disposeSnippet('b'), page), false);
  assert.strictEqual(vm.runInContext(PROBE, page), '{"b":"1"}');
});

// ---- cinnamon browser install ----
function setupIn() {
  const base = tmp('cm-browser-setup-');
  const home = path.join(base, 'home');
  const user = path.join(base, 'user');
  fs.mkdirSync(home, { recursive: true });
  const setup = new BrowserSetup({ root: ROOT, userDir: user, home, version: '0.3.4', log: () => {} });
  return { base, home, user, setup };
}

test('install builds the extension folder with everything its manifest names, and the host Chrome starts', async () => {
  const s = setupIn();
  const { version, browsers } = await s.setup.install();
  const dir = s.setup.extensionDir;
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.version, version);
  assert.match(version, /^0\.3\.4\.\d+$/);
  assert.strictEqual(extensionIdOf(m.key), EXTENSION_ID);
  assert.ok(fs.existsSync(path.join(dir, m.background.service_worker)));
  for (const cs of m.content_scripts) for (const js of cs.js) assert.ok(fs.existsSync(path.join(dir, js)), js);
  assert.ok(m.permissions.includes('nativeMessaging'));
  assert.deepStrictEqual(browsers, ['Google Chrome']);
  const hostManifest = JSON.parse(fs.readFileSync(path.join(s.home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts', `${HOST_NAME}.json`), 'utf8'));
  assert.strictEqual(hostManifest.name, HOST_NAME);
  assert.strictEqual(hostManifest.path, s.setup.hostScript);
  assert.deepStrictEqual(hostManifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
  const script = fs.readFileSync(s.setup.hostScript, 'utf8');
  assert.match(script, /browser-host/);
  assert.match(script, new RegExp(`CINNAMON_HOME='${s.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.ok(fs.statSync(s.setup.hostScript).mode & 0o100, 'executable');
});

test('other Chromium browsers get the host manifest only when they are installed', async () => {
  const s = setupIn();
  fs.mkdirSync(path.join(s.home, 'Library/Application Support/Arc/User Data'), { recursive: true });
  const { browsers } = await s.setup.install();
  assert.deepStrictEqual(browsers, ['Google Chrome', 'Arc']);
  assert.ok(!fs.existsSync(path.join(s.home, 'Library/Application Support/BraveSoftware')));
});

test('the standalone binary\'s host runs the binary itself', () => {
  const s = setupIn();
  const setup = new BrowserSetup({ root: ROOT, userDir: s.user, home: s.home, version: '1', binary: '/opt/homebrew/opt/cinnamon/bin/cinnamon' });
  const text = setup.hostScriptText();
  assert.match(text, /export CINNAMON_BIN='\/opt\/homebrew\/opt\/cinnamon\/bin\/cinnamon'/);
  assert.match(text, /exec '\/opt\/homebrew\/opt\/cinnamon\/bin\/cinnamon' browser-host/);
});

test('refresh rebuilds only a browser part that is set up, in place', async () => {
  const s = setupIn();
  assert.strictEqual(await s.setup.refresh(), null);
  assert.ok(!fs.existsSync(s.setup.extensionDir));
  await s.setup.install();
  fs.writeFileSync(path.join(s.setup.extensionDir, 'stale.js'), '');
  assert.match((await s.setup.refresh())!, /^0\.3\.4\./);
  assert.ok(!fs.existsSync(path.join(s.setup.extensionDir, 'stale.js')), 'files from an older build go');
});

test('uninstall removes the folder and Cinnamon\'s host manifests, and leaves another program\'s file alone', async () => {
  const s = setupIn();
  await s.setup.install();
  const brave = path.join(s.home, 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts', `${HOST_NAME}.json`);
  fs.mkdirSync(path.dirname(brave), { recursive: true });
  fs.writeFileSync(brave, JSON.stringify({ name: 'something.else' }));
  const removed = s.setup.uninstall();
  assert.ok(!fs.existsSync(s.setup.dir));
  assert.ok(!fs.existsSync(path.join(s.home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts', `${HOST_NAME}.json`)));
  assert.ok(fs.existsSync(brave));
  assert.strictEqual(removed.length, 2);
});
