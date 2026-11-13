// The AutoApplier (what Cinnamon Helper runs at each Claude launch) with a fake Applier.
import { test } from 'bun:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Applier } from '../core/apply/Applier';
import { AutoApplier } from '../core/apply/AutoApplier';
import type { System } from '../core/apply/System';

const LSTART = 'Thu Nov 12 18:03:11 2026';

function setup({ marker, lockPid, lockWait = 3 }: { marker?: string; lockPid?: number | string; lockWait?: number } = {}) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-auto-'));
  if (marker) fs.writeFileSync(path.join(state, 'applied'), `${marker}\n`);
  if (lockPid) {
    fs.mkdirSync(path.join(state, 'apply.lock'));
    fs.writeFileSync(path.join(state, 'apply.lock', 'pid'), String(lockPid));
  }
  const calls: string[] = [];
  const sys = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), log: () => {} } as unknown as System;
  const applier = {
    stamp: (pid: string) => `${pid} ${LSTART}`,
    run: async ({ lockHeld }: { lockHeld?: boolean }) => { calls.push(`apply held=${lockHeld ? 1 : ''}`); return 0; },
  } as unknown as Applier;
  const run = (pid = '123') => new AutoApplier(sys, applier, state, lockWait).run(pid);
  return { run, state, calls };
}

test('applies to a Claude process that does not have the mods yet', async () => {
  const s = setup();
  assert.strictEqual(await s.run(), 0);
  assert.deepStrictEqual(s.calls, ['apply held=1']);
});

test('skips a Claude process that already has the mods', async () => {
  const s = setup({ marker: `123 ${LSTART}` });
  await s.run('123');
  assert.deepStrictEqual(s.calls, []);
});

test('applies again to a new Claude process', async () => {
  const s = setup({ marker: `99 ${LSTART}` });
  await s.run('123');
  assert.deepStrictEqual(s.calls, ['apply held=1']);
});

test('waits for a run in progress, and gives up after the wait', async () => {
  const s = setup({ lockPid: process.pid, lockWait: 1 });
  assert.strictEqual(await s.run(), 0);
  assert.deepStrictEqual(s.calls, []);
});

test('applies once the run in progress finishes', async () => {
  // a detached run (not our child, so it is reaped when it ends) holding the lock for 0.4 s
  const pid = spawnSync('bash', ['-c', '/bin/sleep 0.4 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).stdout.trim();
  const s = setup({ lockPid: pid });
  await s.run();
  assert.deepStrictEqual(s.calls, ['apply held=1']);
});

test('takes over a lock left by a run that died', async () => {
  const s = setup({ lockPid: 999999 });
  await s.run();
  assert.deepStrictEqual(s.calls, ['apply held=1']);
});

test('releases the lock when done', async () => {
  const s = setup();
  await s.run();
  assert.strictEqual(fs.existsSync(path.join(s.state, 'apply.lock')), false);
});
