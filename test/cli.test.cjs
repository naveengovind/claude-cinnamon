// The cinnamon command (bin/cinnamon), run against a temporary user folder. Git sources are local repos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cinnamon');

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cli-'));
  return dir;
}
function run(h, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, CINNAMON_HOME: h, CINNAMON_NO_APPLY: '1', NO_COLOR: '1' } });
  return { code: r.status, out: r.stdout + r.stderr };
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
  const { parseSource } = require('../core/cli.cjs');
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
  const r = spawnSync(process.execPath, [BIN, 'apply'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CINNAMON_HOME: h, NO_COLOR: '1' } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /apply finished with status 0/);
  assert.strictEqual(fs.existsSync(path.join(h, 'state', 'applied')), false, 'the "already applied" marker is cleared so the helper re-applies');
});
