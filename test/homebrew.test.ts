// Homebrew installs of the standalone binary: Homebrew runs it from a versioned Cellar folder that the next upgrade
// removes, so the login item must name the opt/ link instead; updating goes through brew; and the formula is made
// from a release's checksums.
import { test } from 'bun:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Homebrew } from '../core/standalone/Homebrew';
import { Installer } from '../core/install/Installer';
import { readSums, renderFormula } from '../scripts/formula';

const ROOT = path.join(import.meta.dir, '..');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A fake Homebrew prefix with cinnamon <version> installed: Cellar/, the opt/ link and a brew command. */
function prefix(version = '0.2.0') {
  const p = fs.realpathSync(tmp('cm-hb-'));
  const keg = path.join(p, 'Cellar', 'cinnamon', version);
  fs.mkdirSync(path.join(keg, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(p, 'opt'));
  fs.mkdirSync(path.join(p, 'bin'));
  fs.symlinkSync(keg, path.join(p, 'opt', 'cinnamon'));
  const log = path.join(p, 'calls.log');
  fs.writeFileSync(path.join(p, 'bin', 'brew'), `#!/bin/bash\necho "brew $*" >> "${log}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(keg, 'bin', 'cinnamon'), `#!/bin/bash\necho "cinnamon $*" >> "${log}"\n`, { mode: 0o755 });
  return { p, keg, log, cellarBin: path.join(keg, 'bin', 'cinnamon'), optBin: path.join(p, 'opt', 'cinnamon', 'bin', 'cinnamon') };
}

test('a binary in the Cellar is named by its opt/ link, which survives upgrades', () => {
  const h = prefix();
  assert.strictEqual(Homebrew.stablePath(h.cellarBin), h.optBin);
  assert.strictEqual(Homebrew.stablePath('/Users/x/.local/bin/cinnamon'), '/Users/x/.local/bin/cinnamon');
});

test('a Cellar path is kept when there is no opt/ link to use instead', () => {
  const p = '/nowhere/Cellar/cinnamon/0.2.0/bin/cinnamon';
  assert.strictEqual(Homebrew.stablePath(p), p);
});

test('a Homebrew install is recognised from its Cellar or opt/ path, and only with a brew next to it', () => {
  const h = prefix();
  assert.strictEqual(Homebrew.prefixOf(h.cellarBin), h.p);
  assert.strictEqual(Homebrew.prefixOf(h.optBin), h.p);
  assert.strictEqual(Homebrew.prefixOf('/nowhere/opt/cinnamon/bin/cinnamon'), null);
  assert.strictEqual(Homebrew.prefixOf(path.join(h.p, 'opt', 'other', 'bin', 'cinnamon')), null);
  assert.strictEqual(Homebrew.prefixOf('/Users/x/.local/bin/cinnamon'), null);
  assert.strictEqual(Homebrew.prefixOf(null), null);
});

test('update in a Homebrew install of the binary runs brew upgrade, then the new version\'s install', () => {
  const h = prefix();
  const r = spawnSync(path.join(ROOT, 'bin', 'cinnamon'), ['update'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, CINNAMON_HOME: tmp('cm-hb-home-'), CINNAMON_BIN: h.optBin, CINNAMON_VERSION: '0.2.0', NO_COLOR: '1' },
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(fs.readFileSync(h.log, 'utf8').trim().split('\n'), ['brew upgrade naveengovind/tap/cinnamon', 'cinnamon install']);
});

test('uninstalling a Homebrew install points to brew uninstall for the command itself', () => {
  const h = prefix();
  const home = tmp('cm-hb-u-');
  const logs: string[] = [];
  const inst = new Installer({ root: ROOT, userDir: path.join(home, 'cfg'), home, pathEnv: '', bun: process.execPath, uid: 501, binary: h.optBin, run: () => ({ status: 1, stdout: '', stderr: '' }), log: (l) => logs.push(l), sleep: () => {} });
  inst.uninstall();
  assert.ok(logs.some((l) => l.includes('brew uninstall cinnamon')), logs.join('\n'));
  assert.ok(!logs.some((l) => l.includes(`rm ${h.optBin}`)));
});

const SUMS = { arm64: 'a'.repeat(64), x64: 'b'.repeat(64) };

test('the formula installs this release\'s binary for the Mac\'s architecture', () => {
  const f = renderFormula({ version: '1.2.3', repo: 'owner/repo', sha256: SUMS });
  assert.match(f, /version "1\.2\.3"/);
  assert.match(f, /on_arm do\s+url "https:\/\/github\.com\/owner\/repo\/releases\/download\/v1\.2\.3\/cinnamon-darwin-arm64\.tar\.gz"\s+sha256 "a{64}"/);
  assert.match(f, /on_intel do\s+url "https:\/\/github\.com\/owner\/repo\/releases\/download\/v1\.2\.3\/cinnamon-darwin-x64\.tar\.gz"\s+sha256 "b{64}"/);
  assert.match(f, /bin\.install "cinnamon"/);
  assert.doesNotMatch(f, /depends_on "[^"]*bun/);
});

test('the formula is valid Ruby', () => {
  if (!fs.existsSync('/usr/bin/ruby')) return;
  const file = path.join(tmp('cm-rb-'), 'cinnamon.rb');
  fs.writeFileSync(file, renderFormula({ version: '1.2.3', repo: 'owner/repo', sha256: SUMS }));
  const r = spawnSync('/usr/bin/ruby', ['-c', file], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('checksums are read from a release\'s SHA256SUMS', () => {
  const file = path.join(tmp('cm-sums-'), 'SHA256SUMS');
  fs.writeFileSync(file, `${SUMS.arm64}  cinnamon-darwin-arm64.tar.gz\n${SUMS.x64}  cinnamon-darwin-x64.tar.gz\n`);
  assert.deepStrictEqual(readSums(file), SUMS);
  fs.writeFileSync(file, `${SUMS.arm64}  cinnamon-darwin-arm64.tar.gz\n`);
  assert.throws(() => readSums(file), /x64/);
});
