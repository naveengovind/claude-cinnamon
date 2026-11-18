// The cinnamon command (bin/cinnamon), run against a temporary user folder. Git sources are local repos.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dir, '..');
const BIN = path.join(ROOT, 'bin', 'cinnamon');

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cli-'));
  return dir;
}
function run(h, ...args) {
  const r = spawnSync(BIN, args, { encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CINNAMON_HOME: h, CINNAMON_NO_APPLY: '1', NO_COLOR: '1' } });
  return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}
const config = (h) => JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8'));
function gitRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-src-'));
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('add', '.'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

test('theme list shows Default and the bundled themes, marking the current one', () => {
  const h = home();
  const r = run(h, 'theme', 'list');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /\* default/);
  assert.match(r.out, /codex\s+Codex/);
  assert.match(r.out, /glass\s+Glass/);
});

test('theme <id> selects it; an unknown id is refused', () => {
  const h = home();
  assert.strictEqual(run(h, 'theme', 'codex').code, 0);
  assert.strictEqual(config(h).theme, 'codex');
  const bad = run(h, 'theme', 'nope');
  assert.notStrictEqual(bad.code, 0);
  assert.strictEqual(config(h).theme, 'codex');
});

test('ext list shows the bundled extensions and whether they are on', () => {
  const h = home();
  const r = run(h, 'ext', 'list');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /on\s+full-width/);
  assert.match(r.out, /on\s+sidebar-cards/);
});

test('ext disable / enable switch an extension in the config', () => {
  const h = home();
  assert.strictEqual(run(h, 'ext', 'disable', 'sidebar-cards').code, 0);
  assert.deepStrictEqual(config(h).extensions, { 'sidebar-cards': false });
  assert.strictEqual(run(h, 'ext', 'enable', 'sidebar-cards').code, 0);
  assert.deepStrictEqual(config(h).extensions, { 'sidebar-cards': true });
  assert.notStrictEqual(run(h, 'ext', 'disable', 'nope').code, 0);
});

test('ext install copies an extension from a git repo, pinned to its commit', () => {
  const h = home();
  const src = gitRepo({ 'manifest.json': JSON.stringify({ name: 'Zen mode', page: ['zen.js'], css: ['zen.css'] }), 'zen.js': '/*zen*/', 'zen.css': '.zen{}', 'README.md': '# zen' });
  const r = run(h, 'ext', 'install', src, '--yes');
  assert.strictEqual(r.code, 0, r.out);
  const id = path.basename(src).toLowerCase();
  const dir = path.join(h, 'extensions', id);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'zen.js'), 'utf8'), '/*zen*/');
  assert.ok(!fs.existsSync(path.join(dir, '.git')));
  const source = JSON.parse(fs.readFileSync(path.join(dir, '.cinnamon-source.json'), 'utf8'));
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  assert.match(run(h, 'ext', 'list').out, new RegExp(`on\\s+${id}`));
});

test('ext install takes the id from the manifest when it has one, and can install a sub-folder', () => {
  const h = home();
  const src = gitRepo({ 'exts/zen/manifest.json': JSON.stringify({ id: 'zen', name: 'Zen', page: ['z.js'] }), 'exts/zen/z.js': '' });
  assert.strictEqual(run(h, 'ext', 'install', `${src}#exts/zen`, '--yes').code, 0);
  assert.ok(fs.existsSync(path.join(h, 'extensions', 'zen', 'manifest.json')));
});

test('ext install warns that a main part is ignored, and refuses folders without a manifest', () => {
  const h = home();
  const withMain = gitRepo({ 'manifest.json': JSON.stringify({ id: 'm', name: 'M', page: ['p.js'], main: 'main.cjs' }), 'p.js': '', 'main.cjs': '' });
  const r = run(h, 'ext', 'install', withMain, '--yes');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /main.*ignored|page only/i);
  const none = gitRepo({ 'README.md': 'hi' });
  assert.notStrictEqual(run(h, 'ext', 'install', none, '--yes').code, 0);
});

test('ext install refuses an id that a bundled extension uses', () => {
  const h = home();
  const src = gitRepo({ 'manifest.json': JSON.stringify({ id: 'sidebar-cards', name: 'Impostor', page: [] }) });
  assert.notStrictEqual(run(h, 'ext', 'install', src, '--yes').code, 0);
});

test('without --yes and no terminal to ask, nothing is installed', () => {
  const h = home();
  const src = gitRepo({ 'manifest.json': JSON.stringify({ id: 'q', name: 'Q', page: [] }) });
  assert.notStrictEqual(run(h, 'ext', 'install', src).code, 0);
  assert.ok(!fs.existsSync(path.join(h, 'extensions', 'q')));
});

test('ext remove deletes an installed extension but never a bundled one', () => {
  const h = home();
  const src = gitRepo({ 'manifest.json': JSON.stringify({ id: 'gone', name: 'Gone', page: [] }) });
  run(h, 'ext', 'install', src, '--yes');
  assert.strictEqual(run(h, 'ext', 'remove', 'gone').code, 0);
  assert.ok(!fs.existsSync(path.join(h, 'extensions', 'gone')));
  assert.notStrictEqual(run(h, 'ext', 'remove', 'sidebar-cards').code, 0);
});

test('theme install copies theme files from a git repo, checking each one', () => {
  const h = home();
  const src = gitRepo({ 'themes/dusk.json': JSON.stringify({ name: 'Dusk', dark: { background: '#101018' } }), 'themes/bad.json': '{ nope', 'README.md': '' });
  const r = run(h, 'theme', 'install', src, '--yes');
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(h, 'themes', 'dusk.json')));
  assert.ok(!fs.existsSync(path.join(h, 'themes', 'bad.json')));
  assert.match(run(h, 'theme', 'list').out, /dusk\s+Dusk/);
});

test('GitHub shorthand and URLs are understood', () => {
  const { parseSource } = require('../core/cli/SourceFetcher');
  assert.deepStrictEqual(parseSource('owner/repo'), { url: 'https://github.com/owner/repo.git', ref: null, sub: '' });
  assert.deepStrictEqual(parseSource('https://github.com/owner/repo'), { url: 'https://github.com/owner/repo.git', ref: null, sub: '' });
  assert.deepStrictEqual(parseSource('https://github.com/owner/repo/tree/dev/extensions/zen'), { url: 'https://github.com/owner/repo.git', ref: 'dev', sub: 'extensions/zen' });
  assert.deepStrictEqual(parseSource('github:owner/repo#extensions/zen'), { url: 'https://github.com/owner/repo.git', ref: null, sub: 'extensions/zen' });
});

test('unknown commands print help and fail', () => {
  const r = run(home(), 'frobnicate');
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /usage/i);
});

test('ext install refuses a source that contains links', () => {
  const h = home();
  const src = gitRepo({ 'manifest.json': JSON.stringify({ id: 'l', name: 'L', page: ['p.js'] }) });
  fs.symlinkSync('/etc/hosts', path.join(src, 'p.js'));
  spawnSync('git', ['add', '.'], { cwd: src }); spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'link'], { cwd: src });
  const r = run(h, 'ext', 'install', src, '--yes');
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /link/i);
  assert.ok(!fs.existsSync(path.join(h, 'extensions', 'l')));
});

test('theme install skips files with problems and json that is not a theme', () => {
  const h = home();
  const src = gitRepo({ 'good.json': JSON.stringify({ name: 'Good', dark: { background: '#101010' } }), 'odd.json': JSON.stringify({ name: 'Odd', dark: { backgroud: '#101010' } }), 'tsconfig.json': JSON.stringify({ compilerOptions: {} }) });
  const r = run(h, 'theme', 'install', src, '--yes');
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(fs.readdirSync(path.join(h, 'themes')).sort(), ['good.json']);
});

test('a #folder that is a link out of the source is refused', () => {
  const h = home();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-out-'));
  fs.writeFileSync(path.join(outside, 'manifest.json'), JSON.stringify({ id: 'o', name: 'O', page: [] }));
  const src = gitRepo({ 'README.md': '' });
  fs.symlinkSync(outside, path.join(src, 'out'));
  spawnSync('git', ['add', '.'], { cwd: src }); spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'link'], { cwd: src });
  assert.notStrictEqual(run(h, 'ext', 'install', `${src}#out`, '--yes').code, 0);
  assert.ok(!fs.existsSync(path.join(h, 'extensions', 'o')));
});

test('cinnamon apply asks the login helper to apply, and reports its result', () => {
  const h = home();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bin-'));
  const sh = (n, body) => fs.writeFileSync(path.join(bin, n), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  sh('pgrep', 'echo 123');
  sh('launchctl', `case "$1" in print) exit 0 ;; kickstart) mkdir -p "${h}/logs"; echo "2026-01-01 00:00:00 apply finished with status 0" >> "${h}/logs/helper.log" ;; esac`);
  fs.mkdirSync(path.join(h, 'state'), { recursive: true });
  fs.writeFileSync(path.join(h, 'state', 'applied'), '123 x');
  const r = spawnSync(BIN, ['apply'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`, CINNAMON_HOME: h, NO_COLOR: '1' } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /apply finished with status 0/);
  assert.strictEqual(fs.existsSync(path.join(h, 'state', 'applied')), false, 'the "already applied" marker is cleared so the helper re-applies');
});

test('doctor counts Accessibility as allowed once the helper logs that it was granted', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(h, 'logs', 'helper.log'), [
    '2026-01-01 00:00:00 watching com.anthropic.claudefordesktop; Accessibility NOT allowed yet: …',
    '2026-01-01 00:00:09 Accessibility allowed',
    '2026-01-01 00:00:09 apply finished with status 0',
  ].join('\n'));
  const r = run(h, 'doctor');
  assert.match(r.out, /✓ helper may use Accessibility/);
});

test('the cinnamon launcher works through a link, as when it is linked into PATH', () => {
  const h = home();
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-link-'));
  fs.symlinkSync(BIN, path.join(linkDir, 'cinnamon'));
  const r = spawnSync(path.join(linkDir, 'cinnamon'), ['theme'], { encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CINNAMON_HOME: h, NO_COLOR: '1' } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /codex/);
});

test('update in a Homebrew install runs brew upgrade', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-brew-'));
  spawnSync('sh', ['-c', `cd "${ROOT}" && tar -c --exclude .git --exclude node_modules . | tar -x -C "${copy}"`]);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bin-'));
  const log = path.join(bin, 'brew.log');
  fs.writeFileSync(path.join(bin, 'brew'), `#!/bin/bash\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  const r = spawnSync(path.join(copy, 'bin', 'cinnamon'), ['update'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`, CINNAMON_HOME: home(), CINNAMON_ROOT: copy, CINNAMON_NO_APPLY: '1', NO_COLOR: '1' } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(log, 'utf8'), /upgrade naveengovind\/tap\/cinnamon/);
});

test('switching to a theme with rejected keys or values says which, so they can be fixed', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(h, 'themes', 'bad.json'), JSON.stringify({ name: 'Bad', dark: { background: 'url(x)', nope: '#fff', text: '#eee' } }));
  const r = run(h, 'theme', 'bad');
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /dark\.background: rejected value/);
  assert.match(r.out, /unknown color key "nope"/);
});

test('doctor names rejected keys and values in any theme', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(h, 'themes', 'bad.json'), JSON.stringify({ name: 'Bad', dark: { nope: '#fff' }, window: { vibrancy: 'shiny' } }));
  const r = run(h, 'doctor');
  assert.match(r.out, /theme bad: dark: unknown color key "nope"/);
  assert.match(r.out, /theme bad: .*window\.vibrancy/);
});

test('ext list and doctor show the errors Claude recorded for an extension', () => {
  const h = home();
  const dir = path.join(h, 'extensions', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'Demo', page: ['p.js'] }));
  fs.writeFileSync(path.join(dir, 'p.js'), '');
  fs.mkdirSync(path.join(h, 'state'), { recursive: true });
  fs.writeFileSync(path.join(h, 'state', 'extension-errors.json'), JSON.stringify({ demo: ['TypeError: boom'] }));
  assert.match(run(h, "ext").out, /demo[\s\S]*TypeError: boom/);
  assert.match(run(h, 'doctor').out, /extension demo: TypeError: boom/);
});

test('switching to a theme that stacks see-through colors notes which ones, and how to fix it', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(h, 'themes', 'haze.json'), JSON.stringify({ name: 'Haze', dark: { background: '#1a0902a6', panel: '#1d0a028c', sidebar: '#140600b3', text: '#fff' } }));
  const r = run(h, 'theme', 'haze');
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /note: dark: background and panel are both see-through/);
  assert.doesNotMatch(r.out, /sidebar/, 'the sidebar sits beside the chat area, not on it');
});

test('a theme that tints once gets no note', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(h, 'themes', 'clean.json'), JSON.stringify({ name: 'Clean', dark: { background: 'transparent', panel: 'transparent', popover: '#222222f0' } }));
  assert.doesNotMatch(run(h, 'theme', 'clean').out, /note:/);
});

// cinnamon screenshot: a request file the Cinnamon running in Claude answers (here, the test answers it).
test('screenshot asks the Cinnamon in Claude for a picture and saves it where asked', async () => {
  const h = home();
  const out = path.join(h, 'shot.png');
  const { spawn } = await import('node:child_process');
  const p = spawn(BIN, ['screenshot', '--out', out, '--width', '800'], { env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CINNAMON_HOME: h, CINNAMON_NO_APPLY: '1', NO_COLOR: '1', CINNAMON_SCREENSHOT_TIMEOUT_MS: '8000' } });
  let text = '';
  p.stdout.on('data', (d) => { text += d; });
  p.stderr.on('data', (d) => { text += d; });
  const reqDir = path.join(h, 'state', 'requests');
  let req = null;
  for (let i = 0; i < 100 && !req; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try { const f = fs.readdirSync(reqDir).find((x) => x.endsWith('.json')); if (f) req = JSON.parse(fs.readFileSync(path.join(reqDir, f), 'utf8')); } catch {}
  }
  assert.ok(req, 'a request was written');
  assert.strictEqual(req.type, 'screenshot');
  assert.strictEqual(req.width, 800);
  assert.strictEqual(fs.statSync(reqDir).mode & 0o777, 0o700, 'only you can write requests');
  const resDir = path.join(h, 'state', 'responses');
  fs.mkdirSync(resDir, { recursive: true });
  fs.writeFileSync(path.join(resDir, `${req.id}.png`), 'PNG');
  fs.writeFileSync(path.join(resDir, `${req.id}.json`), JSON.stringify({ ok: true, png: path.join(resDir, `${req.id}.png`), width: 800, height: 500 }));
  const code = await new Promise((r) => p.on('close', r));
  assert.strictEqual(code, 0, text);
  assert.strictEqual(fs.readFileSync(out, 'utf8'), 'PNG');
  assert.match(text, /shot\.png/);
});

test('screenshot says what to do when nothing answers', () => {
  const h = home();
  const r = spawnSync(BIN, ['screenshot'], { encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CINNAMON_HOME: h, CINNAMON_NO_APPLY: '1', NO_COLOR: '1', CINNAMON_SCREENSHOT_TIMEOUT_MS: '600' } });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /cinnamon (status|apply)/);
  assert.deepStrictEqual(fs.readdirSync(path.join(h, 'state', 'requests')), [], 'an unanswered request is taken back');
});

test('a refused backdrop is named by theme <id> and doctor', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(h, 'themes', 'bd.json'), JSON.stringify({ name: 'Bd', dark: { background: '#111' }, backdrop: { svg: '<svg onload="x()"></svg>' } }));
  assert.match(run(h, 'theme', 'bd').out, /not applied: backdrop: svg may not have scripts/);
  assert.match(run(h, 'doctor').out, /theme bd: backdrop: svg may not have scripts/);
});

// ---- --json: what the menu bar app reads ----
const json = (h, ...args) => { const r = run(h, ...args, '--json'); assert.ok(r.code === 0 || r.code === 1, r.out); return JSON.parse(r.stdout); };

test('theme list --json gives the current theme and every theme, Default first', () => {
  const h = home();
  run(h, 'theme', 'codex');
  const r = json(h, 'theme', 'list');
  assert.strictEqual(r.current, 'codex');
  assert.deepStrictEqual(r.themes[0], { id: 'default', name: 'Default', description: "Claude's own colors", bundled: true });
  const codex = r.themes.find((t) => t.id === 'codex');
  assert.strictEqual(codex.name, 'Codex');
  assert.strictEqual(codex.bundled, true);
});

test('ext list --json gives each extension with whether it is on', () => {
  const h = home();
  run(h, 'ext', 'disable', 'full-width');
  const r = json(h, 'ext', 'list');
  const fw = r.extensions.find((e) => e.id === 'full-width');
  assert.strictEqual(fw.enabled, false);
  assert.strictEqual(fw.bundled, true);
  assert.strictEqual(typeof fw.name, 'string');
  assert.deepStrictEqual(fw.errors, []);
  assert.strictEqual(r.extensions.find((e) => e.id === 'sidebar-cards').enabled, true);
});

test('status --json describes the setup', () => {
  const h = home();
  run(h, 'theme', 'codex');
  const r = json(h, 'status');
  assert.strictEqual(r.theme, 'codex');
  assert.strictEqual(r.user, h);
  assert.strictEqual(typeof r.version, 'string');
  assert.strictEqual(typeof r.helper.running, 'boolean');
  assert.strictEqual(typeof r.claude.running, 'boolean');
  assert.strictEqual(typeof r.claude.installed, 'boolean');
  assert.ok(r.extensions.includes('sidebar-cards'));
});

test('doctor --json lists each check by id, with its fix', () => {
  const h = home();
  const r = json(h, 'doctor');
  assert.strictEqual(typeof r.ok, 'boolean');
  assert.strictEqual(r.problems, r.checks.filter((c) => !c.ok).length);
  const ids = r.checks.map((c) => c.id);
  for (const id of ['claude', 'helper', 'accessibility', 'developer-mode', 'mod', 'skill']) assert.ok(ids.includes(id), `${id} in ${ids}`);
  const helper = r.checks.find((c) => c.id === 'helper');
  if (!helper.ok) assert.strictEqual(helper.fix, 'cinnamon install');
});

test('cinnamon app explains itself, and uninstall with nothing installed is fine', () => {
  const h = home();
  const usage = run(h, 'app');
  assert.notStrictEqual(usage.code, 0);
  assert.match(usage.out, /cinnamon app install \[--no-open\]/);
  const r = spawnSync(BIN, ['app', 'uninstall'], { encoding: 'utf8', env: { ...process.env, HOME: h, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CINNAMON_HOME: h, NO_COLOR: '1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /not installed/);
  assert.match(run(h, 'help').out, /cinnamon app install/);
});

test('without --json the output stays for people', () => {
  const h = home();
  assert.match(run(h, 'theme', 'list').out, /\* default/);
  assert.throws(() => JSON.parse(run(h, 'status').out));
});
