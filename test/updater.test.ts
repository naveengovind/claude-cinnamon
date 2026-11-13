// `cinnamon update` for the standalone binary: latest release → checksum → replace the binary → its install.
import { test } from 'bun:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunResult } from '../core/install/Installer';
import { Updater } from '../core/cli/Updater';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ASSET = 'cinnamon-darwin-arm64.tar.gz';

/** A release folder: the tarball holding a new `cinnamon`, and SHA256SUMS (optionally wrong). */
function release(newVersion: string, { badSum = false } = {}) {
  const dir = tmp('cm-rel-');
  const stage = tmp('cm-stage-');
  fs.writeFileSync(path.join(stage, 'cinnamon'), `#!/bin/bash\necho ${newVersion}\n`, { mode: 0o755 });
  spawnSync('tar', ['-czf', path.join(dir, ASSET), '-C', stage, 'cinnamon']);
  const sum = badSum ? '0'.repeat(64) : createHash('sha256').update(fs.readFileSync(path.join(dir, ASSET))).digest('hex');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${sum}  ${ASSET}\n${'1'.repeat(64)}  cinnamon-darwin-x64.tar.gz\n`);
  return dir;
}

function setup(latest: string, rel: string) {
  const base = tmp('cm-upd-');
  const binary = path.join(base, 'cinnamon');
  fs.writeFileSync(binary, '#!/bin/bash\necho 0.1.0\n', { mode: 0o755 });
  const calls: string[] = [];
  const execs: string[][] = [];
  const run = (cmd: string, args: string[]): RunResult => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'gh' && args[0] === 'auth') return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'gh' && args[1] === 'view') return { status: 0, stdout: `${latest}\n`, stderr: '' };
    if (cmd === 'gh' && args[1] === 'download') {
      const dir = args[args.indexOf('--dir') + 1]!;
      for (const f of fs.readdirSync(rel)) fs.copyFileSync(path.join(rel, f), path.join(dir, f));
      return { status: 0, stdout: '', stderr: '' };
    }
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
  const lines: string[] = [];
  const updater = new Updater({ binary, version: '0.1.0', arch: 'arm64', repo: 'o/r', run, exec: (cmd, args) => { execs.push([cmd, ...args]); return 0; }, log: (l) => lines.push(l) });
  return { binary, calls, execs, lines, updater };
}

test('a newer release replaces the binary and runs its install', () => {
  const { binary, execs, updater } = setup('v0.2.0', release('0.2.0'));
  assert.strictEqual(updater.run(), 0);
  assert.match(fs.readFileSync(binary, 'utf8'), /echo 0\.2\.0/);
  assert.ok(fs.statSync(binary).mode & 0o100);
  assert.deepStrictEqual(execs, [[binary, 'install']]);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(binary)), ['cinnamon'], 'no leftovers beside it');
});

test('a checksum mismatch leaves the binary alone', () => {
  const { binary, execs, lines, updater } = setup('v0.2.0', release('0.2.0', { badSum: true }));
  assert.notStrictEqual(updater.run(), 0);
  assert.match(fs.readFileSync(binary, 'utf8'), /echo 0\.1\.0/);
  assert.deepStrictEqual(execs, []);
  assert.ok(lines.some((l) => /checksum/i.test(l)), lines.join('\n'));
});

test('the latest version already: nothing is downloaded', () => {
  const { calls, execs, lines, updater } = setup('v0.1.0', release('0.1.0'));
  assert.strictEqual(updater.run(), 0);
  assert.ok(!calls.some((c) => c.includes('download')));
  assert.deepStrictEqual(execs, []);
  assert.ok(lines.some((l) => /latest/.test(l)));
});
