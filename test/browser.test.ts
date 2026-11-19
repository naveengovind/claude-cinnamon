// Cinnamon on claude.ai in a browser: the Chrome extension (browser/), its native messaging host
// (core/browser/BrowserHost.ts) and `cinnamon browser install` (core/browser/BrowserSetup.ts).
import { Presence } from '../core/lib/Presence';
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { cssPlan, desiredCss, disposeInPage, matchesAny, pageState, pageStateArgs, probe, scriptPlan } from '../browser/apply';
import { coreScript, extensionScript } from '../core/browser/GenFiles';
import { BrowserHost, DESKTOP_ONLY, GLASS_GROUND } from '../core/browser/BrowserHost';
import { BROWSERS, BrowserSetup, extensionIdOf, extensionVersion } from '../core/browser/BrowserSetup';
import { BrowserCommands } from '../core/cli/BrowserCommands';
import { Output } from '../core/cli/Output';
import { Paths } from '../core/cli/Paths';
import { ChunkJoiner, Decoder, frame, framesFor, MAX_TO_BROWSER } from '../core/browser/NativeMessaging';
import { DISPOSED, EXTENSION_ID, HOST_NAME, type HostState } from '../core/browser/protocol';
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

test('the state has the theme\'s CSS and names the page code as files the host wrote into the extension\'s gen/ folder', async () => {
  const h = hostSetup();
  h.setConfig({ theme: 'codex' });
  const s = await h.host.state();
  assert.strictEqual(s.theme.id, 'codex');
  assert.match(s.theme.css, /#111111/);
  assert.strictEqual(s.core.css, '.core{}');
  assert.match(s.core.file, /^gen\/core-[0-9a-f]{16}\.js$/);
  assert.match(fs.readFileSync(path.join(h.extDir, s.core.file), 'utf8'), /\/\*CORE\*\//);
  assert.deepStrictEqual(s.extensions.map((e) => e.id), ['ufo']);
  const ufo = s.extensions[0]!;
  assert.match(ufo.file, /^gen\/ext-ufo-[0-9a-f]{16}\.js$/);
  const code = fs.readFileSync(path.join(h.extDir, ufo.file), 'utf8');
  assert.match(code, /window\.__cinnamon\.api\("ufo"\)/);
  assert.match(code, /\/\*UFO\*\//);
  assert.ok(code.includes(`b.ran["ufo"] === ${JSON.stringify(ufo.sig)}`), 'guarded by its signature');
  assert.strictEqual(ufo.css, '.ufo{}');
  assert.deepStrictEqual(Object.keys(s).sort(), ['core', 'extList', 'extensionVersion', 'extensions', 'settings', 'theme', 'type', 'version']);
  assert.deepStrictEqual(Object.keys(ufo).sort(), ['css', 'file', 'id', 'sig']);
  assert.ok(!JSON.stringify(s).includes('/*UFO*/'), 'no code travels in the message');
});

test('a changed extension gets a new file; files no state names any more are removed (the one before is kept)', async () => {
  const h = hostSetup();
  const first = (await h.host.state()).extensions[0]!.file;
  fs.writeFileSync(path.join(h.root, 'extensions', 'ufo', 'p.js'), '/*UFO v2*/');
  const second = (await h.host.state()).extensions[0]!.file;
  assert.notStrictEqual(second, first);
  assert.ok(fs.existsSync(path.join(h.extDir, first)), 'a tab may still be using the previous state');
  fs.writeFileSync(path.join(h.root, 'extensions', 'ufo', 'p.js'), '/*UFO v3*/');
  const third = (await h.host.state()).extensions[0]!.file;
  assert.ok(!fs.existsSync(path.join(h.extDir, first)));
  assert.ok(fs.existsSync(path.join(h.extDir, second)) && fs.existsSync(path.join(h.extDir, third)));
  const names = fs.readdirSync(path.join(h.extDir, 'gen'));
  assert.ok(names.every((n) => n.endsWith('.js')), 'no temp files left');
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
  await h.host.handle({ type: 'page', msg: { type: 'ext-error', ext: 'ufo', message: 'EvalError from the old version' } });
  assert.deepStrictEqual(BrowserHost.readStatus(h.user).errors.ufo, ['EvalError from the old version']);
  // a newly connecting (fixed) extension starts clean: an old version's problem and page errors aren't shown as current
  await h.host.handle({ type: 'hello', version: '0.4.1.1', userScripts: false });
  assert.strictEqual(BrowserHost.readStatus(h.user).problem, null);
  assert.strictEqual(BrowserHost.readStatus(h.user).errors.ufo, undefined);
  assert.strictEqual(BrowserHost.readStatus(h.user).extensionVersion, '0.4.1.1');
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
const STATE = (exts: { id: string; sig: string; file: string; css: string }[]): HostState => ({
  type: 'state', version: '1', extensionVersion: null, core: { file: 'gen/core-x.js', css: '.core{}' },
  theme: { id: 'codex', css: '.theme{}', themes: [] }, extensions: exts, extList: [], settings: {},
});

test('CSS: changed and new keys go in, then the old text comes out; nothing for an unchanged key', () => {
  const desired = desiredCss(STATE([{ id: 'a', sig: '1', file: '', css: '.a{}' }, { id: 'b', sig: '1', file: '', css: '' }]));
  assert.deepStrictEqual(desired, { core: '.core{}', theme: '.theme{}', 'ext:a': '.a{}' });
  const plan = cssPlan({ core: '.core{}', theme: '.old{}', 'ext:gone': '.g{}' }, desired);
  assert.deepStrictEqual(plan.insert, [['theme', '.theme{}'], ['ext:a', '.a{}']]);
  assert.deepStrictEqual(plan.remove, [['theme', '.old{}'], ['ext:gone', '.g{}']]);
});

test('extensions: changed or turned-off ones are taken out, new or changed ones with page code run', () => {
  const exts = [{ id: 'a', sig: '2', file: 'gen/a.js', css: '' }, { id: 'b', sig: '1', file: 'gen/b.js', css: '' }, { id: 'c', sig: '1', file: 'gen/c.js', css: '' }, { id: 'cssonly', sig: '0', file: '', css: '.x{}' }];
  const plan = scriptPlan({ a: '1', b: '1', gone: '1' }, exts);
  assert.deepStrictEqual(plan.dispose, ['a', 'gone']);
  assert.deepStrictEqual(plan.run.map((e) => e.id), ['a', 'c']);
});

test('the extension works on the pages its manifest matches (any port), and no others', () => {
  assert.ok(matchesAny('https://claude.ai/new', ['https://claude.ai/*']));
  assert.ok(!matchesAny('https://claude.ai.evil.example/', ['https://claude.ai/*']));
  assert.ok(!matchesAny('http://claude.ai/', ['https://claude.ai/*']));
  assert.ok(matchesAny('http://127.0.0.1:8123/x', ['http://127.0.0.1/*']));
  assert.ok(!matchesAny('not a url', ['https://claude.ai/*']));
});

function fakePage() {
  const ctx = vm.createContext({ console });
  vm.runInContext('var window = globalThis; window.__cinnamonBrowser = { ran: {} }; window.count = 0;', ctx);
  return ctx;
}
/** Runs one of the extension's page functions the way executeScript({ func, args }) does: its source, called. */
const inPage = (ctx: vm.Context, fn: (...a: any[]) => unknown, ...args: unknown[]) => vm.runInContext(`(${fn.toString()})(...${JSON.stringify(args)})`, ctx);

test('an extension\'s file runs once per document, even when injected twice; a new version runs', () => {
  const page = fakePage();
  const v1 = extensionScript('ufo', 's1', 'window.count++;');
  vm.runInContext(v1, page);
  vm.runInContext(v1, page);
  assert.strictEqual(vm.runInContext('window.count', page), 1);
  assert.strictEqual(inPage(page, probe), '{"ufo":"s1"}');
  vm.runInContext(extensionScript('ufo', 's2', 'window.count++;'), page);
  assert.strictEqual(vm.runInContext('window.count', page), 2);
});

test('Cinnamon\'s own page code runs once per document', () => {
  const ctx = vm.createContext({});
  vm.runInContext('var window = globalThis; window.n = 0;', ctx);
  const core = coreScript('window.n++;');
  vm.runInContext(core, ctx);
  vm.runInContext(core, ctx);
  assert.strictEqual(vm.runInContext('window.n', ctx), 1);
});

test('the probe says when Cinnamon isn\'t in a document yet', () => {
  const ctx = vm.createContext({});
  vm.runInContext('var window = globalThis;', ctx);
  assert.strictEqual(inPage(ctx, probe), null);
});

test('taking an extension out forgets it only when its clean-up ran', () => {
  const page = fakePage();
  vm.runInContext('window.__cinnamonBrowser.ran = { a: "1", b: "1" }; window.__cinnamon = { dispose: (id) => id === "a" ? "cinnamon:disposed" : false };', page);
  assert.strictEqual(inPage(page, disposeInPage, 'a', DISPOSED), 'cinnamon:disposed');
  assert.strictEqual(inPage(page, disposeInPage, 'b', DISPOSED), false);
  assert.strictEqual(inPage(page, probe), '{"b":"1"}');
});

test('the page state reaches the runtime and the Settings rows', () => {
  const ctx = vm.createContext({});
  vm.runInContext('var window = globalThis; window.got = {}; window.__cinnamon = { setSettings: (s) => { window.got.settings = s; }, setLook: (l) => { window.got.look = l; } }; window.__cmSetThemes = (t) => { window.got.themes = t; }; window.__cmSetExtensions = (e) => { window.got.exts = e; };', ctx);
  const s = { ...STATE([]), settings: { ufo: { speed: 2 } }, extList: [{ id: 'ufo', name: 'UFO', description: '', bundled: true, enabled: true }] };
  assert.strictEqual(inPage(ctx, pageState, ...pageStateArgs(s)), true);
  assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(window.got)', ctx)), {
    settings: { ufo: { speed: 2 } }, look: null, themes: { current: 'codex', themes: [] }, exts: s.extList,
  });
});

test('nothing the extension runs in a page is a string to evaluate', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'browser', 'background.ts'), 'utf8').replace(/\/\/.*$/gm, ''); // code, not comments
  assert.doesNotMatch(bg, /\beval\b|new Function|code:/);
});

// ---- cinnamon browser install / list / uninstall ----
const NMH = (home: string, support: string) => path.join(home, 'Library/Application Support', support, 'NativeMessagingHosts', `${HOST_NAME}.json`);

/** A temp HOME and Applications folder with these browsers' apps "installed". */
function setupIn(apps: string[] = ['Google Chrome']) {
  const base = tmp('cm-browser-setup-');
  const home = path.join(base, 'home');
  const user = path.join(base, 'user');
  const applications = path.join(base, 'Applications');
  fs.mkdirSync(home, { recursive: true });
  for (const a of apps) fs.mkdirSync(path.join(applications, `${a}.app`), { recursive: true });
  const setup = new BrowserSetup({ root: ROOT, userDir: user, home, version: '0.3.4', applications: [applications], log: () => {} });
  return { base, home, user, applications, setup };
}

test('every supported browser has a stable id, the NativeMessagingHosts folder it reads, and its extensions page', () => {
  assert.deepStrictEqual(BROWSERS.map((b) => b.id), ['chrome', 'arc', 'brave', 'edge', 'chromium', 'vivaldi']);
  const s = setupIn([]);
  const by = Object.fromEntries(s.setup.browsers().map((b) => [b.id, b]));
  assert.strictEqual(by.chrome!.hostManifest, NMH(s.home, 'Google/Chrome'));
  assert.strictEqual(by.arc!.hostManifest, NMH(s.home, 'Google/Chrome'), 'Arc reads Chrome\'s folder, not its own');
  assert.strictEqual(by.brave!.hostManifest, NMH(s.home, 'BraveSoftware/Brave-Browser'));
  assert.strictEqual(by.edge!.hostManifest, NMH(s.home, 'Microsoft Edge'));
  assert.strictEqual(by.chromium!.hostManifest, NMH(s.home, 'Chromium'));
  assert.strictEqual(by.vivaldi!.hostManifest, NMH(s.home, 'Vivaldi'));
  assert.deepStrictEqual(Object.fromEntries(s.setup.browsers().map((b) => [b.id, b.extensionsUrl])),
    { chrome: 'chrome://extensions', arc: 'arc://extensions', brave: 'brave://extensions', edge: 'edge://extensions', chromium: 'chrome://extensions', vivaldi: 'chrome://extensions' });
});

test('the default browser is Chrome when installed, else the first one found; none when there is none', () => {
  assert.strictEqual(setupIn(['Arc', 'Google Chrome']).setup.defaultBrowser()?.id, 'chrome');
  assert.strictEqual(setupIn(['Brave Browser', 'Arc']).setup.defaultBrowser()?.id, 'arc');
  assert.strictEqual(setupIn([]).setup.defaultBrowser(), null);
  assert.match(setupIn([]).setup.pick(null) as string, /no supported browser/);
  assert.match(setupIn(['Arc']).setup.pick('brave') as string, /Brave isn't installed/);
  assert.match(setupIn(['Arc']).setup.pick('netscape') as string, /unknown browser "netscape"/);
  assert.strictEqual((setupIn(['Arc']).setup.pick('ARC') as { id: string }).id, 'arc');
});

test('install builds the extension folder with everything its manifest names, and registers the host in that browser only', async () => {
  const s = setupIn(['Google Chrome', 'Brave Browser']);
  const { version, browsers } = await s.setup.install('brave');
  assert.deepStrictEqual(browsers, ['brave']);
  const dir = s.setup.extensionDir;
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.version, version);
  assert.match(version, /^0\.3\.4\.\d+$/);
  assert.strictEqual(extensionIdOf(m.key), EXTENSION_ID);
  assert.ok(fs.existsSync(path.join(dir, m.background.service_worker)));
  for (const cs of m.content_scripts) for (const js of cs.js) assert.ok(fs.existsSync(path.join(dir, js)), js);
  assert.ok(m.permissions.includes('nativeMessaging'));
  const hostManifest = JSON.parse(fs.readFileSync(NMH(s.home, 'BraveSoftware/Brave-Browser'), 'utf8'));
  assert.strictEqual(hostManifest.name, HOST_NAME);
  assert.strictEqual(hostManifest.path, s.setup.hostScript);
  assert.deepStrictEqual(hostManifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
  assert.ok(!fs.existsSync(NMH(s.home, 'Google/Chrome')), 'Chrome was not picked');
  assert.ok(fs.statSync(path.join(dir, 'gen')).isDirectory(), 'the folder the host writes page code into');
  const script = fs.readFileSync(s.setup.hostScript, 'utf8');
  assert.match(script, /browser-host/);
  assert.ok(script.includes(`CINNAMON_HOME='${s.user}'`));
  assert.ok(fs.statSync(s.setup.hostScript).mode & 0o100, 'executable');
  // a second browser keeps the first
  assert.deepStrictEqual((await s.setup.install('chrome')).browsers, ['chrome', 'brave']);
  assert.deepStrictEqual(s.setup.browsers().filter((b) => b.registered).map((b) => b.id), ['chrome', 'brave']);
});

test('Arc gets the host manifest in Chrome\'s folder (the one it reads); only Arc counts as set up', async () => {
  const s = setupIn(['Google Chrome', 'Arc']);
  await s.setup.install('arc');
  assert.strictEqual(JSON.parse(fs.readFileSync(NMH(s.home, 'Google/Chrome'), 'utf8')).path, s.setup.hostScript);
  assert.ok(!fs.existsSync(NMH(s.home, 'Arc/User Data')), 'nothing in the folder Arc doesn\'t read');
  assert.deepStrictEqual(s.setup.browsers().filter((b) => b.registered).map((b) => b.id), ['arc']);
});

test('Chrome and Arc share one manifest: taking Cinnamon out of one leaves it for the other', async () => {
  const s = setupIn(['Google Chrome', 'Arc']);
  await s.setup.install('chrome');
  await s.setup.install('arc');
  assert.deepStrictEqual(s.setup.uninstall(['arc']), [], 'Chrome still reads it');
  assert.ok(fs.existsSync(NMH(s.home, 'Google/Chrome')));
  assert.deepStrictEqual(s.setup.browsers().filter((b) => b.registered).map((b) => b.id), ['chrome']);
  await s.setup.install('arc');
  assert.deepStrictEqual(s.setup.uninstall(['chrome']), []);
  assert.deepStrictEqual(s.setup.browsers().filter((b) => b.registered).map((b) => b.id), ['arc']);
  assert.deepStrictEqual(s.setup.uninstall(['arc']), [NMH(s.home, 'Google/Chrome'), s.setup.dir], 'the last one takes it');
});

test('a 0.4.0 setup for Arc (manifest in Arc\'s own folder) moves to Chrome\'s folder on refresh', async () => {
  const s = setupIn(['Google Chrome', 'Arc']);
  await s.setup.install('arc');
  // as 0.4.0 left it: no record, the manifest only in Arc's own folder
  fs.rmSync(s.setup.registryFile);
  fs.rmSync(NMH(s.home, 'Google/Chrome'));
  fs.mkdirSync(path.dirname(NMH(s.home, 'Arc/User Data')), { recursive: true });
  fs.writeFileSync(NMH(s.home, 'Arc/User Data'), JSON.stringify(s.setup.hostManifest()));
  assert.deepStrictEqual(s.setup.browsers().filter((b) => b.registered).map((b) => b.id), ['arc']);
  await s.setup.refresh();
  assert.ok(fs.existsSync(NMH(s.home, 'Google/Chrome')));
  assert.ok(!fs.existsSync(NMH(s.home, 'Arc/User Data')), 'the useless copy goes');
  assert.deepStrictEqual(s.setup.browsers().filter((b) => b.registered).map((b) => b.id), ['arc']);
});

test('the standalone binary\'s host runs the binary itself', () => {
  const s = setupIn();
  const bin = path.join(s.base, 'brew', 'opt', 'cinnamon', 'bin', 'cinnamon');
  const setup = new BrowserSetup({ root: ROOT, userDir: s.user, home: s.home, version: '1', binary: bin });
  const text = setup.hostScriptText();
  assert.ok(text.includes(`export CINNAMON_BIN='${bin}'`));
  assert.ok(text.includes(`exec '${bin}' browser-host`));
});

test('refresh rebuilds only a browser part that is set up, in place, re-registering the same browsers and keeping gen/', async () => {
  const s = setupIn(['Google Chrome', 'Brave Browser']);
  assert.strictEqual(await s.setup.refresh(), null);
  assert.ok(!fs.existsSync(s.setup.extensionDir));
  await s.setup.install('brave');
  fs.writeFileSync(path.join(s.setup.extensionDir, 'stale.js'), '');
  fs.writeFileSync(path.join(s.setup.extensionDir, 'gen', 'core-1.js'), '');
  fs.writeFileSync(NMH(s.home, 'BraveSoftware/Brave-Browser'), JSON.stringify({ name: HOST_NAME, path: '/old/place' }));
  assert.match((await s.setup.refresh())!, /^0\.3\.4\./);
  assert.ok(!fs.existsSync(path.join(s.setup.extensionDir, 'stale.js')), 'files from an older build go');
  assert.ok(fs.existsSync(path.join(s.setup.extensionDir, 'gen', 'core-1.js')), 'the host\'s page code stays');
  assert.strictEqual(JSON.parse(fs.readFileSync(NMH(s.home, 'BraveSoftware/Brave-Browser'), 'utf8')).path, s.setup.hostScript);
  assert.ok(!fs.existsSync(NMH(s.home, 'Google/Chrome')));
});

test('uninstall from one browser keeps the others; the last one, or all, takes the folder too; another program\'s file stays', async () => {
  const s = setupIn(['Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge']);
  await s.setup.install('chrome');
  await s.setup.install('brave');
  const edge = NMH(s.home, 'Microsoft Edge');
  fs.mkdirSync(path.dirname(edge), { recursive: true });
  fs.writeFileSync(edge, JSON.stringify({ name: 'something.else' }));
  assert.deepStrictEqual(s.setup.uninstall(['brave']), [NMH(s.home, 'BraveSoftware/Brave-Browser')]);
  assert.ok(fs.existsSync(s.setup.dir), 'Chrome still has it');
  assert.deepStrictEqual(s.setup.uninstall(['chrome']), [NMH(s.home, 'Google/Chrome'), s.setup.dir]);
  await s.setup.install('arc');
  await s.setup.install('brave');
  assert.deepStrictEqual(s.setup.uninstall('all'), [NMH(s.home, 'Google/Chrome'), NMH(s.home, 'BraveSoftware/Brave-Browser'), s.setup.dir]);
  assert.ok(fs.existsSync(edge), 'not Cinnamon\'s');
});

// ---- the cinnamon browser command ----
function cli(apps: string[]) {
  const s = setupIn(apps);
  const said: string[] = [];
  const opened: [string, string][] = [];
  const copied: string[] = [];
  const revealed: string[] = [];
  const out = new Output();
  out.say = (...a: unknown[]) => { said.push(a.join(' ')); };
  out.fail = (m: string) => { said.push(`FAIL ${m}`); return 1; };
  const paths = new Paths({ CINNAMON_HOME: s.user, CINNAMON_ROOT: ROOT, CINNAMON_VERSION: '0.3.4' } as NodeJS.ProcessEnv);
  const cmd = new BrowserCommands(paths, out, { home: s.home, applications: [s.applications], openApp: (a, u) => opened.push([a, u]), copy: (t) => copied.push(t), reveal: (d) => revealed.push(d) });
  return { ...s, cmd, said, opened, copied, revealed };
}

test('`browser list --json` lists every supported browser, installed or not, with whether Cinnamon is registered', async () => {
  const c = cli(['Arc', 'Brave Browser']);
  await c.cmd.run(['install', '--browser', 'arc', '--no-open']);
  c.said.length = 0;
  assert.strictEqual(await c.cmd.run(['list', '--json']), 0);
  const l = JSON.parse(c.said.join('\n'));
  assert.deepStrictEqual(Object.keys(l), ['schema', 'extensionId', 'extensionDir', 'extensionBuilt', 'default', 'browsers']);
  assert.strictEqual(l.schema, 1);
  assert.strictEqual(l.extensionId, EXTENSION_ID);
  assert.strictEqual(l.extensionBuilt, true);
  assert.strictEqual(l.default, 'arc');
  assert.deepStrictEqual(Object.keys(l.browsers[0]), ['id', 'name', 'installed', 'registered', 'extensionsUrl', 'hostManifest', 'link', 'lastConnected', 'extensionVersion']);
  assert.deepStrictEqual(l.browsers.map((b: { id: string; installed: boolean; registered: boolean }) => [b.id, b.installed, b.registered]),
    [['chrome', false, false], ['arc', true, true], ['brave', true, false], ['edge', false, false], ['chromium', false, false], ['vivaldi', false, false]]);
});

test('`browser list --json` tells a set-up browser whose extension never connected from one that is connected', async () => {
  const c = cli(['Arc', 'Brave Browser']);
  await c.cmd.run(['install', '--browser', 'arc', '--no-open']);
  await c.cmd.run(['install', '--browser', 'brave', '--no-open']);
  new Presence(c.user).connected('brave', '0.4.4.1', process.pid);
  c.said.length = 0;
  await c.cmd.run(['list', '--json']);
  const l = JSON.parse(c.said.join('\n'));
  const by = (id: string) => l.browsers.find((b: { id: string }) => b.id === id);
  assert.strictEqual(by('arc').link, 'never', 'set up is not the same as loaded');
  assert.strictEqual(by('brave').link, 'connected');
  assert.strictEqual(by('brave').extensionVersion, '0.4.4.1');
});

test('`browser install --browser arc` opens Arc\'s own extensions page and puts the folder path on the clipboard', async () => {
  const c = cli(['Google Chrome', 'Arc']);
  assert.strictEqual(await c.cmd.run(['install', '--browser=arc']), 0);
  assert.deepStrictEqual(c.opened, [['Arc', 'arc://extensions']]);
  assert.deepStrictEqual(c.copied, [c.setup.extensionDir]);
  assert.ok(c.said.some((l) => l.includes('One-time setup in Arc')));
});

test('`browser install` shows the extension folder in Finder, ready to drag onto the extensions page', async () => {
  const c = cli(['Google Chrome']);
  assert.strictEqual(await c.cmd.run(['install']), 0);
  assert.deepStrictEqual(c.revealed, [c.setup.extensionDir]);
  assert.ok(c.said.some((l) => /Drag/.test(l) && /onto/.test(l)), c.said.join('\n'));
  const quiet = cli(['Google Chrome']);
  assert.strictEqual(await quiet.cmd.run(['install', '--no-open']), 0);
  assert.deepStrictEqual(quiet.revealed, [], 'nothing opens with --no-open');
});

test('`browser install` without --browser picks Chrome; an unknown or missing browser fails with the reason', async () => {
  const c = cli(['Google Chrome', 'Arc']);
  assert.strictEqual(await c.cmd.run(['install']), 0);
  assert.deepStrictEqual(c.opened, [['Google Chrome', 'chrome://extensions']]);
  assert.strictEqual(await c.cmd.run(['install', '--browser', 'vivaldi']), 1);
  assert.ok(c.said.some((l) => /FAIL Vivaldi isn't installed/.test(l)));
  assert.strictEqual(await c.cmd.run(['install', '--browser']), 1);
});

test('`browser uninstall --browser <id>` removes one; plain `uninstall` (or --all) removes everything', async () => {
  const c = cli(['Google Chrome', 'Arc']);
  await c.cmd.run(['install', '--browser', 'chrome', '--no-open']);
  await c.cmd.run(['install', '--browser', 'arc', '--no-open']);
  await c.cmd.run(['uninstall', '--browser', 'arc']);
  assert.deepStrictEqual(c.setup.browsers().filter((b) => b.registered).map((b) => b.id), ['chrome']);
  await c.cmd.run(['uninstall']);
  assert.deepStrictEqual(c.setup.browsers().filter((b) => b.registered).map((b) => b.id), []);
  assert.ok(!fs.existsSync(c.setup.dir));
});

