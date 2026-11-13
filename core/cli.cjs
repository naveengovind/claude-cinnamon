// cinnamon — command-line tool for Cinnamon (themes and extensions for the Claude desktop app, macOS).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline');
const themes = require('./theme.cjs');
const exts = require('./extensions.cjs');

const ROOT = path.join(__dirname, '..');
const USER = process.env.CINNAMON_HOME || path.join(os.homedir(), '.config', 'claude-cinnamon');
const P = {
  config: path.join(USER, 'config.json'),
  themes: path.join(USER, 'themes'),
  extensions: path.join(USER, 'extensions'),
  logs: path.join(USER, 'logs', 'helper.log'),
  applied: path.join(USER, 'state', 'applied'),
};
const BUNDLED = { themes: path.join(ROOT, 'themes'), extensions: path.join(ROOT, 'extensions') };
const LABEL = 'local.claude-cinnamon.helper';

const color = !process.env.NO_COLOR && process.stdout.isTTY;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c(1); const dim = c(2); const green = c(32); const red = c(31); const yellow = c(33);
const say = (...a) => console.log(...a);
const fail = (msg) => { console.error(red(`✗ ${msg}`)); return 1; };

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const claudePid = () => (sh('pgrep', ['-x', 'Claude']).stdout || '').trim().split('\n')[0] || null;

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const logSize = () => { try { return fs.statSync(P.logs).size; } catch { return 0; } };
function logSince(start) {
  try {
    const fd = fs.openSync(P.logs, 'r');
    const len = Math.max(0, fs.fstatSync(fd).size - start);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    return buf.toString();
  } catch { return ''; }
}

// Follow Cinnamon Helper's log until it reports the apply it is doing. The helper holds the Accessibility
// permission, so applying through it means your terminal never needs that permission.
function followHelper(start, { notAllowedOk = false } = {}) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const text = logSince(start);
    const done = text.match(/apply finished with status (\d+)/);
    if (done) { say(dim(text.trimEnd())); return Number(done[1]); }
    if (/Accessibility NOT allowed/.test(text)) {
      say(yellow('Cinnamon Helper is not allowed to use Accessibility yet: System Settings → Privacy & Security → Accessibility → turn on Cinnamon Helper.'));
      say(dim('It applies on its own as soon as you allow it.'));
      return notAllowedOk ? 0 : 1;
    }
    pause(400);
  }
  return fail('Cinnamon Helper did not report back within 2 minutes (see: cinnamon logs)');
}

function applyNow(extra = []) {
  if (process.env.CINNAMON_NO_APPLY) return 0;
  if (!claudePid()) { say(dim('Claude is not running; Cinnamon applies itself the next time it starts.')); return 0; }
  if (extra.includes('--keep') || !loginItemLoaded()) {
    return sh('bash', [path.join(ROOT, 'core', 'apply.sh'), ...extra], { stdio: 'inherit' }).status ?? 1;
  }
  fs.rmSync(P.applied, { force: true }); // so the helper applies again to this Claude
  const start = logSize();
  const k = sh('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${LABEL}`]);
  if (k.status !== 0) return fail(`could not restart Cinnamon Helper: ${(k.stderr || '').trim()}`);
  return followHelper(start);
}
const liveNote = () => say(dim('Applies within a second if Claude is running with Cinnamon.'));

async function confirm(question, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) { console.error(yellow('Not asking without a terminal; add --yes to go ahead.')); return false; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`${question} [y/N] `, r));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// ------------------------------------------------------------------ sources (GitHub / git / local)
/** "owner/repo", "github:owner/repo#sub", "https://github.com/o/r/tree/<ref>/<sub>", any git URL or path ("#sub" optional). */
function parseSource(raw) {
  let s = String(raw).trim();
  let sub = '';
  const hash = s.indexOf('#');
  if (hash !== -1) { sub = s.slice(hash + 1); s = s.slice(0, hash); }
  const gh = s.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (gh && !s.startsWith('.') && !s.startsWith('/')) return { url: `https://github.com/${gh[1]}/${gh[2]}.git`, ref: null, sub };
  const web = s.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/);
  if (web) return { url: `https://github.com/${web[1]}/${web[2]}.git`, ref: web[3] || null, sub: sub || web[4] || '' };
  return { url: s, ref: null, sub };
}

function fetchSource(raw) {
  const local = fs.existsSync(raw) && fs.statSync(raw).isDirectory() ? raw : null;
  const src = local ? { url: local, ref: null, sub: '' } : parseSource(raw);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinnamon-src-'));
  const isGit = !local || fs.existsSync(path.join(local, '.git'));
  let commit = null;
  if (isGit) {
    const args = ['clone', '--quiet', '--depth', '1', ...(src.ref ? ['--branch', src.ref] : []), '--', src.url, tmp];
    const r = sh('git', args);
    if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`could not fetch ${src.url}: ${(r.stderr || '').trim()}`); }
    commit = (sh('git', ['-C', tmp, 'rev-parse', 'HEAD']).stdout || '').trim() || null;
  } else {
    fs.cpSync(local, tmp, { recursive: true });
  }
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  // the #folder must really be inside the download (checked through links too)
  const realTmp = fs.realpathSync(tmp);
  let dir;
  try { dir = fs.realpathSync(path.resolve(tmp, src.sub || '.')); } catch { cleanup(); throw new Error(`no folder "${src.sub}" in ${src.url}`); }
  if (dir !== realTmp && !dir.startsWith(realTmp + path.sep)) { cleanup(); throw new Error(`"${src.sub}" leads outside ${src.url} (a link?)`); }
  return { ...src, tmp, dir, commit, cleanup };
}

const copyTree = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (f) => path.basename(f) !== '.git' });
// Links in a download could point anywhere on this Mac; installs refuse them.
function findLinks(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) out.push(path.relative(dir, p));
      else if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}
const sanitizeId = (s) => String(s).toLowerCase().replace(/\.git$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);

// ------------------------------------------------------------------ themes
function themeList() {
  const cfg = themes.readConfig(P.config);
  const list = themes.listThemes([BUNDLED.themes, P.themes]);
  const mark = (id) => (cfg.theme === id ? green('*') : ' ');
  say(`${mark('default')} ${'default'.padEnd(16)} Default ${dim('(Claude\'s own colours)')}`);
  for (const t of list) say(`${mark(t.id)} ${t.id.padEnd(16)} ${t.name}${t.error ? red(`  (couldn't load: ${t.error})`) : ''}${t.description ? dim(`  ${t.description}`) : ''}`);
  return 0;
}

function themeSet(id) {
  const list = themes.listThemes([BUNDLED.themes, P.themes]);
  if (id !== 'default' && !list.some((t) => t.id === id && !t.error)) return fail(`no theme "${id}" (see: cinnamon theme list)`);
  themes.writeConfig(P.config, { theme: id });
  say(green(`✓ theme: ${id}`));
  liveNote();
  return 0;
}

async function themeInstall(raw, yes) {
  let src;
  try { src = fetchSource(raw); } catch (e) { return fail(e.message); }
  try {
    let dir = src.dir;
    const jsonIn = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json'); } catch { return []; } };
    if (!jsonIn(dir).length && jsonIn(path.join(dir, 'themes')).length) dir = path.join(dir, 'themes');
    const good = [];
    for (const f of jsonIn(dir)) {
      if (fs.lstatSync(path.join(dir, f)).isSymbolicLink()) { say(yellow(`! ${f}: a link, skipped`)); continue; }
      let t;
      try { t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { say(yellow(`! ${f}: not valid JSON, skipped`)); continue; }
      if (!t || typeof t !== 'object' || Array.isArray(t) || !(t.dark || t.light || t.css)) { say(dim(`  ${f}: not a theme, skipped`)); continue; }
      const { errors } = themes.themeCss(t);
      if (errors.length) { say(yellow(`! ${f}: skipped (${errors.join('; ')})`)); continue; }
      good.push({ f, name: t.name || f });
    }
    if (!good.length) return fail('no theme files (*.json) found');
    say(`${bold('Themes')} from ${src.url}${src.commit ? dim(` @ ${src.commit.slice(0, 12)}`) : ''}:`);
    for (const g of good) say(`  ${g.f.replace(/\.json$/, '').padEnd(16)} ${g.name}`);
    say(dim('  Themes only change colours and styles; they can\'t run code or load anything from the internet.'));
    if (!(await confirm('Install these themes?', yes))) return 1;
    fs.mkdirSync(P.themes, { recursive: true });
    for (const g of good) fs.copyFileSync(path.join(dir, g.f), path.join(P.themes, sanitizeId(g.f.replace(/\.json$/, '')) + '.json'));
    say(green(`✓ installed ${good.length} theme${good.length > 1 ? 's' : ''}`), dim('(pick one in Settings → Appearance → Color scheme, or: cinnamon theme <id>)'));
    return 0;
  } finally { src.cleanup(); }
}

function themeRemove(id) {
  const f = path.join(P.themes, `${sanitizeId(id)}.json`);
  if (!fs.existsSync(f)) return fail(`no installed theme "${id}" (bundled themes can't be removed)`);
  fs.rmSync(f);
  if (themes.readConfig(P.config).theme === id) themes.writeConfig(P.config, { theme: 'default' });
  say(green(`✓ removed theme ${id}`));
  return 0;
}

// ------------------------------------------------------------------ extensions
const allExts = () => exts.listExtensions({ bundled: BUNDLED.extensions, user: P.extensions });

function extList() {
  const cfg = themes.readConfig(P.config);
  for (const e of allExts()) {
    const on = exts.isEnabled(e, cfg);
    say(`${on ? green('on ') : dim('off')}  ${e.id.padEnd(18)} ${e.name}${e.bundled ? dim(' (built in)') : ''}${e.error ? red(`  (couldn't load: ${e.error})`) : ''}`);
  }
  return 0;
}

function extSwitch(id, enabled) {
  const e = allExts().find((x) => x.id === id);
  if (!e) return fail(`no extension "${id}" (see: cinnamon ext list)`);
  if (e.error) return fail(`${id} couldn't load: ${e.error}`);
  const cfg = themes.readConfig(P.config);
  themes.writeConfig(P.config, { extensions: { ...(cfg.extensions || {}), [id]: enabled } });
  say(green(`✓ ${id} ${enabled ? 'on' : 'off'}`));
  liveNote();
  return 0;
}

async function extInstall(raw, yes) {
  let src;
  try { src = fetchSource(raw); } catch (e) { return fail(e.message); }
  try {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(src.dir, 'manifest.json'), 'utf8')); } catch { return fail(`no manifest.json in ${src.url}${src.sub ? `#${src.sub}` : ''}`); }
    const links = findLinks(src.dir);
    if (links.length) return fail(`refusing to install: it contains links (${links.slice(0, 3).join(', ')}), which could point at other files on this Mac`);
    const id = sanitizeId(manifest.id || (src.sub ? path.basename(src.sub) : path.basename(src.url)));
    if (!id) return fail('could not work out an id for this extension (add "id" to its manifest)');
    if (fs.existsSync(path.join(BUNDLED.extensions, id))) return fail(`"${id}" is the name of a built-in extension; pick another id in its manifest`);
    const loaded = exts.loadExtension({ id, dir: src.dir, bundled: false, manifest });
    say(`${bold(manifest.name || id)} ${dim(`(${id})`)}${manifest.version ? dim(` v${manifest.version}`) : ''}`);
    if (manifest.description) say(`  ${manifest.description}`);
    say(`  from ${src.url}${src.sub ? `#${src.sub}` : ''}${src.commit ? dim(` @ ${src.commit.slice(0, 12)}`) : ''}`);
    say(`  page code: ${loaded.page.length} file(s), styles: ${loaded.css.length} file(s)`);
    for (const err of loaded.errors) say(yellow(`  ! ${err}`));
    if (manifest.main !== undefined) say(yellow('  ! its "main" part is ignored: downloaded extensions run in the page only'));
    say(yellow('  It runs inside Claude\'s window and can read anything shown there. Only install extensions you trust.'));
    if (!(await confirm(`Install ${id}?`, yes))) return 1;
    const dest = path.join(P.extensions, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(P.extensions, { recursive: true });
    copyTree(src.dir, dest);
    fs.writeFileSync(path.join(dest, '.cinnamon-source.json'), `${JSON.stringify({ source: raw, url: src.url, ref: src.ref, sub: src.sub, commit: src.commit, installedAt: new Date().toISOString() }, null, 2)}\n`);
    say(green(`✓ installed ${id}`));
    liveNote();
    return 0;
  } finally { src.cleanup(); }
}

function extRemove(id) {
  const e = allExts().find((x) => x.id === id);
  if (!e) return fail(`no extension "${id}"`);
  if (e.bundled) return fail(`${id} is built in; turn it off instead: cinnamon ext disable ${id}`);
  fs.rmSync(e.dir, { recursive: true, force: true });
  const cfg = themes.readConfig(P.config);
  if (cfg.extensions && id in cfg.extensions) { const rest = { ...cfg.extensions }; delete rest[id]; themes.writeConfig(P.config, { extensions: rest }); }
  say(green(`✓ removed ${id}`));
  return 0;
}

// ------------------------------------------------------------------ install / status / doctor
function install() {
  for (const d of [USER, P.themes, P.extensions]) fs.mkdirSync(d, { recursive: true });
  fs.rmSync(P.applied, { force: true }); // the helper applies to a running Claude as soon as it starts
  const start = logSize();
  const r = sh('bash', [path.join(ROOT, 'core', 'install.sh'), ...process.argv.slice(3)], { stdio: 'inherit' });
  if (r.status !== 0) return r.status ?? 1;
  if (process.env.CINNAMON_NO_APPLY || !claudePid()) return 0;
  return followHelper(start, { notAllowedOk: true });
}

function loginItemLoaded() {
  return sh('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]).status === 0;
}

function status() {
  const pid = claudePid();
  const cfg = themes.readConfig(P.config);
  let applied = 'no';
  try {
    const [apid] = fs.readFileSync(P.applied, 'utf8').trim().split(' ');
    applied = pid && apid === pid ? green('yes') : yellow('not to this Claude process');
  } catch {}
  const on = allExts().filter((e) => exts.isEnabled(e, cfg)).map((e) => e.id);
  say(`${bold('Cinnamon')} ${dim(ROOT)}`);
  say(`  your files   ${USER}`);
  say(`  login item   ${loginItemLoaded() ? green('running') : yellow('not installed (cinnamon install)')}`);
  say(`  Claude       ${pid ? `running (pid ${pid})` : dim('not running')}`);
  say(`  applied      ${pid ? applied : dim('-')}`);
  say(`  theme        ${cfg.theme}`);
  say(`  extensions   ${on.join(', ') || dim('none')}`);
  return 0;
}

function doctor() {
  let bad = 0;
  const check = (ok, text, fix) => { say(`${ok ? green('✓') : red('✗')} ${text}${!ok && fix ? dim(`  → ${fix}`) : ''}`); if (!ok) bad++; };
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  check(nodeMajor >= 22, `Node ${process.versions.node}`, 'Node 22 or newer is needed (brew install node)');
  check(fs.existsSync('/Applications/Claude.app'), 'Claude.app is in /Applications');
  const ver = sh('defaults', ['read', '/Applications/Claude.app/Contents/Info.plist', 'CFBundleShortVersionString']).stdout?.trim();
  if (ver) say(dim(`  Claude ${ver}`));
  check(sh('which', ['swiftc']).status === 0, 'Swift compiler (to build the helper)', 'xcode-select --install');
  check(loginItemLoaded(), 'login item running', 'cinnamon install');
  const helper = path.join(ROOT, 'build', 'Cinnamon Helper.app');
  check(fs.existsSync(helper), 'helper app built', 'cinnamon install');
  let log = '';
  try { log = fs.readFileSync(P.logs, 'utf8'); } catch {}
  const lastStart = log.lastIndexOf('watching ');
  const recent = lastStart === -1 ? '' : log.slice(lastStart);
  check(!/NOT allowed/.test(recent.split('\n')[0] || ''), 'helper may use Accessibility', 'System Settings → Privacy & Security → Accessibility → turn on the helper');
  check(!/never appeared/.test(recent), 'Developer menu found at the last launch', 'in Claude: Help → Troubleshooting → Enable Developer Mode');
  const finished = [...recent.matchAll(/apply finished with status (\d+)/g)].pop();
  if (finished) check(finished[1] === '0', `last automatic apply ${finished[1] === '0' ? 'succeeded' : 'failed'}`, 'cinnamon logs');
  for (const t of themes.listThemes([BUNDLED.themes, P.themes])) if (t.error) check(false, `theme ${t.id}: ${t.error}`);
  for (const e of allExts()) if (e.error) check(false, `extension ${e.id}: ${e.error}`);
  say(bad ? red(`${bad} problem${bad > 1 ? 's' : ''}`) : green('All good.'));
  return bad ? 1 : 0;
}

function logs() {
  try { const lines = fs.readFileSync(P.logs, 'utf8').trimEnd().split('\n'); say(lines.slice(-60).join('\n')); return 0; }
  catch { return fail(`no log yet (${P.logs})`); }
}

function update() {
  const r = sh('git', ['-C', ROOT, 'pull', '--ff-only'], { stdio: 'inherit' });
  if (r.status !== 0) return fail('git pull failed');
  return install();
}

const HELP = `${bold('cinnamon')} — themes and extensions for the Claude desktop app (macOS)

usage:
  cinnamon install                 build the helper and add the login item (re-applies at every Claude launch)
  cinnamon uninstall               remove the login item
  cinnamon apply [--keep]          apply now (--keep leaves Claude's debugger on)
  cinnamon status                  what is installed and applied
  cinnamon doctor                  check the setup and explain any problem
  cinnamon logs                    the helper's recent log
  cinnamon update                  pull the latest Cinnamon and re-install

  cinnamon theme [list]            themes (* = current)
  cinnamon theme <id>              use a theme ("default" = Claude's own colours)
  cinnamon theme install <source>  add themes from GitHub / git / a folder
  cinnamon theme remove <id>       remove an installed theme

  cinnamon ext [list]              extensions and whether they are on
  cinnamon ext enable|disable <id>
  cinnamon ext install <source>    add an extension from GitHub / git / a folder
  cinnamon ext remove <id>         remove an installed extension

  <source>: owner/repo, https://github.com/owner/repo[/tree/<branch>/<folder>], any git URL or local folder,
            optionally followed by #<folder>. Add --yes to skip the confirmation.

Your settings, themes and extensions: ${USER}`;

async function main(argv) {
  const yes = argv.includes('--yes') || argv.includes('-y');
  const args = argv.filter((a) => a !== '--yes' && a !== '-y');
  const [cmd, sub, arg] = args;
  switch (cmd) {
    case 'apply': return applyNow(args.includes('--keep') ? ['--keep'] : []);
    case 'install': return install();
    case 'uninstall': return sh('bash', [path.join(ROOT, 'core', 'install.sh'), '--uninstall'], { stdio: 'inherit' }).status ?? 1;
    case 'status': return status();
    case 'doctor': return doctor();
    case 'logs': return logs();
    case 'update': return update();
    case 'theme':
    case 'themes':
      if (!sub || sub === 'list') return themeList();
      if (sub === 'install') return arg ? themeInstall(arg, yes) : fail('usage: cinnamon theme install <source>');
      if (sub === 'remove') return arg ? themeRemove(arg) : fail('usage: cinnamon theme remove <id>');
      return themeSet(sub);
    case 'ext':
    case 'extension':
    case 'extensions':
      if (!sub || sub === 'list') return extList();
      if (sub === 'enable' || sub === 'disable') return arg ? extSwitch(arg, sub === 'enable') : fail(`usage: cinnamon ext ${sub} <id>`);
      if (sub === 'install') return arg ? extInstall(arg, yes) : fail('usage: cinnamon ext install <source>');
      if (sub === 'remove') return arg ? extRemove(arg) : fail('usage: cinnamon ext remove <id>');
      return fail(`unknown: cinnamon ext ${sub}\n\n${HELP}`);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      say(HELP);
      return cmd === undefined ? 1 : 0;
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

module.exports = { main, parseSource };
