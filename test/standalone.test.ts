// Standalone mode: the compiled binary's payload, the compiler it names for Claude, the installer's prebuilt helper,
// and the launch script handing over to the binary.
import { test } from 'bun:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderMain } from '../core/render';
import { Payload } from '../core/standalone/Payload';
import { Installer, type RunResult } from '../core/install/Installer';

const ROOT = path.join(import.meta.dir, '..');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function assets() {
  const src = tmp('cm-assets-');
  const files: Record<string, string> = {
    'core/autoapply.sh': '#!/bin/bash\necho hi\n',
    'themes/codex.json': '{"name":"Codex"}',
    'prebuilt/Cinnamon Helper.app/Contents/MacOS/cinnamon-helper': 'binary',
  };
  const map: Record<string, string> = {};
  for (const [rel, body] of Object.entries(files)) { const f = path.join(src, rel.replace(/\//g, '_')); fs.writeFileSync(f, body); map[rel] = f; }
  return map;
}

test('the payload is unpacked once per version, scripts and the helper executable', async () => {
  const user = tmp('cm-user-');
  const dir = await new Payload(assets(), '1.2.3').ensure(user);
  assert.strictEqual(dir, path.join(user, 'app', '1.2.3'));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'themes', 'codex.json'), 'utf8'), '{"name":"Codex"}');
  assert.ok(fs.statSync(path.join(dir, 'core', 'autoapply.sh')).mode & 0o100);
  assert.ok(fs.statSync(path.join(dir, 'prebuilt', 'Cinnamon Helper.app', 'Contents', 'MacOS', 'cinnamon-helper')).mode & 0o100);
  fs.writeFileSync(path.join(dir, 'themes', 'codex.json'), 'changed');
  await new Payload(assets(), '1.2.3').ensure(user);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'themes', 'codex.json'), 'utf8'), 'changed', 'not unpacked again for the same version');
});

test('a new version is unpacked beside the old one, which goes only when pruned (after an install re-applied)', async () => {
  const user = tmp('cm-user-');
  await new Payload(assets(), '1.0.0').ensure(user);
  const next = new Payload(assets(), '1.1.0');
  await next.ensure(user);
  const versions = () => fs.readdirSync(path.join(user, 'app')).filter((n) => !n.startsWith('.')).sort();
  assert.deepStrictEqual(versions(), ['1.0.0', '1.1.0'], 'a running Claude may still use the old files');
  next.prune(user);
  assert.deepStrictEqual(versions(), ['1.1.0']);
});

test('a standalone binary names itself as the compiler for Claude', async () => {
  const before = process.env.CINNAMON_BIN;
  process.env.CINNAMON_BIN = '/x/cinnamon';
  try {
    const script = await renderMain({ root: ROOT, userDir: tmp('cm-u-') });
    assert.match(script, /"compiler":\["\/x\/cinnamon","__compile"\]/);
  } finally {
    if (before === undefined) delete process.env.CINNAMON_BIN; else process.env.CINNAMON_BIN = before;
  }
});

test('the installer uses a prebuilt helper (no Swift compiler), links the binary, and tells the helper about it', () => {
  const base = tmp('cm-inst-');
  const root = path.join(base, 'app');
  fs.mkdirSync(path.join(root, 'core', 'helper'), { recursive: true });
  for (const f of ['main.swift', 'Info.plist']) fs.copyFileSync(path.join(ROOT, 'core', 'helper', f), path.join(root, 'core', 'helper', f));
  const prebuilt = path.join(root, 'prebuilt', 'Cinnamon Helper.app');
  fs.mkdirSync(path.join(prebuilt, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(prebuilt, 'Contents', 'MacOS', 'cinnamon-helper'), 'prebuilt', { mode: 0o755 });
  const home = path.join(base, 'home');
  const binDir = path.join(home, '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const binary = path.join(base, 'cinnamon');
  fs.writeFileSync(binary, 'bin', { mode: 0o755 });
  const calls: string[] = [];
  const run = (cmd: string, args: string[]): RunResult => { calls.push(`${cmd} ${args.join(' ')}`); return { status: cmd === 'launchctl' && args[0] === 'print' ? 1 : 0, stdout: '', stderr: '' }; };
  const inst = new Installer({ root, userDir: path.join(home, 'cfg'), home, pathEnv: binDir, bun: binary, uid: 501, run, log: () => {}, sleep: () => {}, binary, prebuiltHelper: prebuilt });
  fs.writeFileSync(path.join(prebuilt, '..', '.built-from'), `${inst.sourceHash()}\n`);
  assert.strictEqual(inst.install(), 0);
  assert.ok(!calls.some((c) => c.startsWith('swiftc')), 'no compile');
  assert.strictEqual(fs.readFileSync(inst.exe, 'utf8'), 'prebuilt');
  assert.strictEqual(fs.readlinkSync(path.join(binDir, 'cinnamon')), binary);
  assert.match(fs.readFileSync(inst.plist, 'utf8'), /<key>CINNAMON_BIN<\/key><string>[^<]*\/cinnamon<\/string>/);
});

test('the login item runs a script in your folder that hands over to the binary', () => {
  const base = tmp('cm-launch-');
  const binary = path.join(base, 'cinnamon');
  fs.writeFileSync(binary, '#!/bin/bash\necho "binary $*"\n', { mode: 0o755 });
  const inst = new Installer({ root: ROOT, userDir: path.join(base, 'cfg'), home: base, pathEnv: '', bun: binary, uid: 501, run: () => ({ status: 0, stdout: '', stderr: '' }), log: () => {}, binary });
  inst.writeLaunchScript();
  assert.ok(inst.plistText().includes(`<string>--run</string><string>${inst.launchScript}</string>`), 'the plist runs it');
  const r = spawnSync('/bin/bash', [inst.launchScript, '123'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.strictEqual(r.stdout.trim(), 'binary __autoapply 123');
  fs.rmSync(binary);
  const gone = spawnSync('/bin/bash', [inst.launchScript, '123'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.notStrictEqual(gone.status, 0);
  assert.match(gone.stdout, /cinnamon install/);
});

test('installing does not replace the binary when it already sits on PATH under its own name', () => {
  const base = tmp('cm-self-');
  const home = path.join(base, 'home');
  const binDir = path.join(home, '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const binary = path.join(binDir, 'cinnamon');
  fs.writeFileSync(binary, 'the binary', { mode: 0o755 });
  const lines: string[] = [];
  const inst = new Installer({ root: ROOT, userDir: path.join(home, 'cfg'), home, pathEnv: binDir, bun: binary, uid: 501, run: () => ({ status: 0, stdout: '', stderr: '' }), log: (l) => lines.push(l), binary });
  inst.linkCommand();
  assert.strictEqual(fs.readFileSync(binary, 'utf8'), 'the binary');
  assert.ok(!lines.some((l) => /already on your PATH/.test(l)), lines.join('\n'));
});
