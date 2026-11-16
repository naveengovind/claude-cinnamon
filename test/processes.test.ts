// pidOf finds a process even when it's an ancestor of the caller, as Claude is for a Claude Code session in the app.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dir, '..');

test('pidOf finds a process the caller runs inside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-proc-'));
  const name = `CinnamonAncestor${process.pid}`;
  const shell = path.join(dir, name);
  fs.copyFileSync('/bin/sh', shell);
  fs.chmodSync(shell, 0o755);
  const script = `import { pidOf } from ${JSON.stringify(path.join(ROOT, 'core', 'lib', 'Processes.ts'))}; console.log(pidOf(${JSON.stringify(name)}) ?? 'none');`;
  // the shell named `name` runs bun, which looks for it: an ancestor, as Claude is for a session's commands
  const r = spawnSync(shell, ['-c', `echo $$; ${JSON.stringify(process.execPath)} -e ${JSON.stringify(script).replace(/\$/g, '\\$')}`], { encoding: 'utf8' });
  const [shellPid, found] = r.stdout.trim().split('\n');
  assert.ok(shellPid && /^\d+$/.test(shellPid), r.stdout + r.stderr);
  assert.strictEqual(found, shellPid, r.stdout + r.stderr);
});
