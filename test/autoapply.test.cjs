const { test, afterEach } = require('bun:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODS = path.join(__dirname, '..');
const LSTART = 'Thu Nov 12 18:03:11 2026';

function setup({ marker, lockPid } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-auto-'));
  const state = path.join(bin, 'state');
  fs.mkdirSync(state);
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(path.join(bin, 'ps'), `#!/bin/bash\necho "${LSTART}"\n`, { mode: 0o755 });
  const apply = path.join(bin, 'apply.sh');
  fs.writeFileSync(apply, `#!/bin/bash\necho "apply held=$CM_LOCK_HELD" >> "${log}"\n`, { mode: 0o755 });
  if (marker) fs.writeFileSync(path.join(state, 'applied'), `${marker}\n`);
  if (lockPid) {
    fs.mkdirSync(path.join(state, 'apply.lock'));
    fs.writeFileSync(path.join(state, 'apply.lock', 'pid'), String(lockPid));
  }
  const run = (pid = '123') => {
    const r = spawnSync('bash', [path.join(MODS, 'core', 'autoapply.sh'), pid], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CM_DIR: MODS, CM_STATE: state, CM_APPLY: apply, CM_LOCK_WAIT: '3' },
      encoding: 'utf8',
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    return { status: r.status, out: r.stdout + r.stderr, calls };
  };
  return { run, state };
}

test('applies to a Claude process that does not have the mods yet', () => {
  const r = setup().run();
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.calls, ['apply held=1']);
});

test('skips a Claude process that already has the mods', () => {
  const r = setup({ marker: `123 ${LSTART}` }).run('123');
  assert.deepStrictEqual(r.calls, []);
});

test('applies again to a new Claude process', () => {
  const r = setup({ marker: `99 ${LSTART}` }).run('123');
  assert.deepStrictEqual(r.calls, ['apply held=1']);
});

test('waits for a run in progress, and gives up after the wait', () => {
  const r = setup({ lockPid: process.pid }).run();
  assert.deepStrictEqual(r.calls, []);
});

test('applies once the run in progress finishes', () => {
  // a detached run (not our child, so it is reaped when it ends) holding the lock for 0.4 s
  const pid = spawnSync('bash', ['-c', '/bin/sleep 0.4 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).stdout.trim();
  const r = setup({ lockPid: pid }).run();
  assert.deepStrictEqual(r.calls, ['apply held=1']);
});

test('takes over a lock left by a run that died', () => {
  const r = setup({ lockPid: 999999 }).run();
  assert.deepStrictEqual(r.calls, ['apply held=1']);
});

test('releases the lock when done', () => {
  const s = setup();
  s.run();
  assert.strictEqual(fs.existsSync(path.join(s.state, 'apply.lock')), false);
});
