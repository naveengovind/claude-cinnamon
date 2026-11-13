const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODS = path.join(__dirname, '..');
const CLAUDE = '123';
const LSTART = 'Thu Nov 12 18:03:11 2026';

// Stand-ins for the commands apply.sh uses, so no real app, debugger or browser is touched.
// `listener` is the pid answering on the debugger port before the run ('' = nothing listening).
function fakeBin({ mainExit = 0, listener = '', running = true, pressExit = 0 } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bin-'));
  const log = path.join(bin, 'calls.log');
  const port = path.join(bin, 'listener');
  if (listener) fs.writeFileSync(port, listener);
  const sh = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  sh('pgrep', running ? `echo ${CLAUDE}` : 'exit 1');
  sh('lsof', `[ -f "${port}" ] && cat "${port}"; exit 0`);
  sh('ps', `echo "${LSTART}"`);
  sh('sleep', 'exit 0');
  // osascript -l JavaScript <script> <mode> [snapshot]
  sh('osascript', `echo "chrome $4" >> "${log}"; [ "$4" = snapshot ] && echo '{"running":true,"ids":[]}'; [ "$4" = cleanup ] && { /bin/sleep 1; echo "chrome cleanup done" >> "${log}"; }; exit 0`);
  // the real apply takes a moment (node startup, evaluating in Claude): model that with a real sleep
  const slowMain = `/bin/sleep 0.3; `;
  sh('peekaboo', `echo peekaboo >> "${log}"; echo ${CLAUDE} > "${port}"`);
  sh('helper', `
case "$1" in
  press) echo "press $2" >> "${log}"; [ ${pressExit} = 0 ] || exit ${pressExit}; echo ${CLAUDE} > "${port}" ;;
  front) echo 77 ;;
  activate) echo "activate $2" >> "${log}" ;;
esac`);
  sh('node', `
case "$1" in
  *render.cjs) exec "${process.execPath}" "$@" ;;
  *cdp.mjs)
    if grep -q "inspector').close" "$2"; then echo close >> "${log}"; exit 0; fi
    ${slowMain}echo main >> "${log}"; exit ${mainExit} ;;
esac
exec "${process.execPath}" "$@"`);
  return { bin, log };
}

function runApply(opts = {}, args = []) {
  const { bin, log } = fakeBin(opts);
  const stateDir = opts.stateDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cm-state-'));
  const helper = opts.noHelper ? path.join(bin, 'missing-helper') : path.join(bin, 'helper');
  const r = spawnSync('bash', [path.join(MODS, 'core', 'apply.sh'), ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CM_DIR: MODS, CM_STATE: stateDir, CM_HELPER: helper, CM_LOCK_WAIT: '1', ...(opts.env || {}) },
    encoding: 'utf8',
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  const markerFile = path.join(stateDir, 'applied');
  const marker = fs.existsSync(markerFile) ? fs.readFileSync(markerFile, 'utf8').trim() : null;
  return { status: r.status, out: r.stdout + r.stderr, calls, marker, stateDir };
}
const before = (calls, a, b) => calls.indexOf(a) !== -1 && calls.indexOf(a) < calls.indexOf(b);

test('the debugger is closed even when applying fails', () => {
  const r = runApply({ mainExit: 1 });
  assert.notStrictEqual(r.status, 0);
  assert.ok(before(r.calls, 'main', 'close'), r.calls.join(','));
});

test('the debugger is closed after a successful apply', () => {
  const r = runApply();
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(before(r.calls, 'main', 'close'), r.calls.join(','));
});

test('--keep leaves the debugger open', () => {
  const r = runApply({}, ['--keep']);
  assert.ok(r.calls.includes('main'));
  assert.ok(!r.calls.includes('close'));
});

test('nothing runs when Claude is not running', () => {
  const r = runApply({ running: false });
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(r.calls, []);
});

test('refuses when another process owns the debugger port', () => {
  const r = runApply({ listener: '999' });
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(r.calls, [], 'must not press, evaluate in, or close a foreign inspector');
  assert.match(r.out, /999/);
});

test('when Claude\'s debugger is already open, nothing is pressed and Chrome is left alone', () => {
  const r = runApply({ listener: CLAUDE });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.calls, ['main', 'close']);
});

test('the helper presses the menu item for this Claude process', () => {
  const r = runApply();
  assert.ok(r.calls.includes(`press ${CLAUDE}`), r.calls.join(','));
  assert.ok(!r.calls.includes('peekaboo'));
});

test('without the helper built, apply says to run cinnamon install and presses nothing', () => {
  const r = runApply({ noHelper: true });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.out, /cinnamon install/);
  assert.ok(!r.calls.includes('peekaboo'));
});

test('the debugger is closed before waiting for the Chrome tab to be closed', () => {
  const r = runApply();
  assert.ok(before(r.calls, 'close', 'chrome cleanup done'), r.calls.join(','));
});

test('another apply in progress makes this one wait, then give up without pressing', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-state-'));
  fs.mkdirSync(path.join(stateDir, 'apply.lock'));
  fs.writeFileSync(path.join(stateDir, 'apply.lock', 'pid'), String(process.pid));
  const r = runApply({ stateDir });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.out, /another apply/i);
  assert.deepStrictEqual(r.calls, []);
});

test('the lock is released afterwards, and skipped when the caller already holds it', () => {
  const r = runApply();
  assert.strictEqual(fs.existsSync(path.join(r.stateDir, 'apply.lock')), false);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-state-'));
  fs.mkdirSync(path.join(stateDir, 'apply.lock'));
  fs.writeFileSync(path.join(stateDir, 'apply.lock', 'pid'), String(process.pid));
  const held = runApply({ stateDir, env: { CM_LOCK_HELD: '1' } });
  assert.strictEqual(held.status, 0, held.out);
});

test('after a press, the inspect tab Chrome opened is cleaned up and the previous app is brought back', () => {
  const r = runApply();
  const c = r.calls;
  assert.ok(before(c, 'chrome snapshot', `press ${CLAUDE}`), c.join(','));
  assert.ok(before(c, `press ${CLAUDE}`, 'chrome cleanup'), c.join(','));
  assert.ok(before(c, 'chrome cleanup', 'activate 77'), c.join(','));
});

test('the Chrome tab is closed right after the press, without waiting for the mods to be applied', () => {
  const r = runApply();
  assert.ok(before(r.calls, 'chrome cleanup', 'main'), r.calls.join(','));
});

test('Chrome is cleaned up even when applying fails', () => {
  const r = runApply({ mainExit: 1 });
  assert.ok(r.calls.includes('chrome cleanup'), r.calls.join(','));
});

test('a failed press leaves Chrome alone (Claude never opened anything in it)', () => {
  const r = runApply({ pressExit: 2 });
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.calls.includes(`press ${CLAUDE}`), r.calls.join(','));
  assert.ok(!r.calls.includes('chrome cleanup'), r.calls.join(','));
  assert.ok(!r.calls.includes('main'));
});

test('a successful apply records which Claude process has the mods', () => {
  const r = runApply();
  assert.strictEqual(r.marker, `${CLAUDE} ${LSTART}`);
});

test('a failed apply records nothing', () => {
  const r = runApply({ mainExit: 1 });
  assert.strictEqual(r.marker, null);
});
