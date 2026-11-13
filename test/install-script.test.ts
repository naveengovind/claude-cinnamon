// install.sh: downloads this Mac's release build, checks it against SHA256SUMS, puts the binary in place and runs its
// `install`. Here `gh` is a stand-in that copies from a local release folder.
import { test } from 'bun:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dir, '..');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const arch = spawnSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).stdout.trim() === '1' ? 'arm64' : 'x64';

function scenario({ badSum = false } = {}) {
  const base = tmp('cm-ish-');
  const rel = path.join(base, 'release');
  const stage = path.join(base, 'stage');
  const fakeBin = path.join(base, 'fakebin');
  for (const d of [rel, stage, fakeBin]) fs.mkdirSync(d);
  const record = path.join(base, 'ran');
  fs.writeFileSync(path.join(stage, 'cinnamon'), `#!/bin/bash\n[ "$1" = --version ] && { echo 9.9.9; exit 0; }\necho "$0 $*" >> ${JSON.stringify(record)}\n`, { mode: 0o755 });
  const asset = `cinnamon-darwin-${arch}.tar.gz`;
  spawnSync('tar', ['-czf', path.join(rel, asset), '-C', stage, 'cinnamon']);
  const sum = badSum ? 'f'.repeat(64) : createHash('sha256').update(fs.readFileSync(path.join(rel, asset))).digest('hex');
  fs.writeFileSync(path.join(rel, 'SHA256SUMS'), `${sum}  ${asset}\n`);
  // gh: signed in; `release download … --dir D` copies the release folder into D
  fs.writeFileSync(path.join(fakeBin, 'gh'), `#!/bin/bash
[ "$1" = auth ] && exit 0
if [ "$1 $2" = "release download" ]; then
  while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
  cp ${JSON.stringify(rel)}/* "$dir"/; exit 0
fi
exit 1
`, { mode: 0o755 });
  const dest = path.join(base, 'bin');
  const r = spawnSync('/bin/sh', [path.join(ROOT, 'install.sh')], {
    encoding: 'utf8',
    env: { PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: base, CINNAMON_BIN_DIR: dest },
  });
  return { r, dest, record };
}

test('installs the binary into the chosen folder and runs its install', () => {
  const { r, dest, record } = scenario();
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const bin = path.join(dest, 'cinnamon');
  assert.ok(fs.statSync(bin).mode & 0o100);
  assert.strictEqual(fs.readFileSync(record, 'utf8').trim(), `${bin} install`);
  assert.match(r.stdout, /9\.9\.9/);
});

test('a checksum mismatch installs nothing', () => {
  const { r, dest, record } = scenario({ badSum: true });
  assert.notStrictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(dest, 'cinnamon')));
  assert.ok(!fs.existsSync(record));
  assert.match(r.stdout + r.stderr, /checksum/i);
});
