// The Installer with a fake command runner and a temporary home: no real login item, helper build or link.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Installer, type RunResult } from '../core/install/Installer';

const REPO = path.join(import.meta.dir, '..');

function setup({ loaded = false, pathDirs = ['local'], builtHash }: { loaded?: boolean; pathDirs?: string[]; builtHash?: 'same' | 'other' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-inst-'));
  const root = path.join(base, 'Cinnamon & co'); // a name that needs XML escaping
  fs.mkdirSync(path.join(root, 'core', 'helper'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  for (const f of ['main.swift', 'Info.plist']) fs.copyFileSync(path.join(REPO, 'core', 'helper', f), path.join(root, 'core', 'helper', f));
  fs.writeFileSync(path.join(root, 'bin', 'cinnamon'), '#!/bin/sh\n', { mode: 0o755 });
  const home = path.join(base, 'home');
  const userDir = path.join(home, '.config', 'claude-cinnamon');
  // 'local' is ~/.local/bin, one of the places the command is linked into
  const dirs = pathDirs.map((d) => (d === 'local' ? path.join(home, '.local', 'bin') : path.join(base, d)));
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  const calls: string[] = [];
  let agentLoaded = loaded;
  const run = (cmd: string, args: string[]): RunResult => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'launchctl' && args[0] === 'print') return { status: agentLoaded ? 0 : 1, stdout: '', stderr: '' };
    if (cmd === 'launchctl' && args[0] === 'bootout') agentLoaded = false;
    if (cmd === 'launchctl' && args[0] === 'bootstrap') agentLoaded = true;
    if (cmd === 'swiftc') { const out = args[args.indexOf('-o') + 1]!; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, 'bin', { mode: 0o755 }); }
    return { status: 0, stdout: '', stderr: '' };
  };
  const logs: string[] = [];
  const inst = new Installer({ root, userDir, home, pathEnv: dirs.join(':'), bun: '/opt/bun/bin/bun', uid: 501, run, log: (l) => logs.push(l), sleep: () => {} });
  if (builtHash) {
    fs.mkdirSync(path.dirname(inst.exe), { recursive: true });
    fs.writeFileSync(inst.exe, 'old', { mode: 0o755 });
    fs.writeFileSync(path.join(userDir, 'helper', '.built-from'), builtHash === 'same' ? inst.sourceHash() : 'x');
  }
  return { inst, calls, logs, root, home, userDir, dirs };
}

test('install builds and signs the helper, writes and starts the login item, and links the command', () => {
  const s = setup();
  assert.strictEqual(s.inst.install(), 0, s.logs.join('\n'));
  assert.ok(s.calls.some((c) => c.startsWith('swiftc -O -o ')));
  assert.ok(s.calls.some((c) => c.startsWith('codesign --force --sign - --identifier local.claude-cinnamon.helper')));
  assert.ok(s.calls.includes(`launchctl bootstrap gui/501 ${s.inst.plist}`));
  const plist = fs.readFileSync(s.inst.plist, 'utf8');
  assert.match(plist, /Cinnamon &amp; co\/core\/autoapply\.sh/, 'paths are XML-escaped');
  assert.match(plist, /<key>CINNAMON_ROOT<\/key><string>[^<]*Cinnamon &amp; co<\/string>/);
  assert.match(plist, /<key>PATH<\/key><string>\/opt\/bun\/bin:/);
  assert.strictEqual(fs.readlinkSync(path.join(s.dirs[0]!, 'cinnamon')), path.join(s.root, 'bin', 'cinnamon'));
});

test('the helper is not rebuilt when its source has not changed (so macOS does not ask again)', () => {
  const s = setup({ builtHash: 'same' });
  s.inst.install();
  assert.ok(!s.calls.some((c) => c.startsWith('swiftc')));
});

test('the helper is rebuilt when its source changed, or with rebuild', () => {
  const changed = setup({ builtHash: 'other' });
  changed.inst.install();
  assert.ok(changed.calls.some((c) => c.startsWith('swiftc')));
  const forced = setup({ builtHash: 'same' });
  forced.inst.install({ rebuild: true });
  assert.ok(forced.calls.some((c) => c.startsWith('swiftc')));
});

test('the login item from before Cinnamon is removed', () => {
  const s = setup();
  const old = path.join(s.home, 'Library', 'LaunchAgents', `${Installer.OLD_LABEL}.plist`);
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, '<plist/>');
  s.inst.install();
  assert.strictEqual(fs.existsSync(old), false);
  assert.ok(s.calls.includes(`launchctl bootout gui/501/${Installer.OLD_LABEL}`));
});

test('a cinnamon command already on PATH (Homebrew\'s) is left alone', () => {
  const s = setup({ pathDirs: ['brew', 'local'] });
  fs.writeFileSync(path.join(s.dirs[0]!, 'cinnamon'), '#!/bin/sh\n', { mode: 0o755 });
  s.inst.install();
  assert.ok(!fs.existsSync(path.join(s.dirs[1]!, 'cinnamon')));
  assert.ok(s.logs.some((l) => /already on your PATH/.test(l)));
});

test('uninstall stops the helper and removes the login item and only its own link', () => {
  const s = setup();
  s.inst.install();
  const ours = path.join(s.dirs[0]!, 'cinnamon');
  assert.ok(fs.existsSync(ours));
  assert.strictEqual(s.inst.uninstall(), 0);
  assert.strictEqual(fs.existsSync(s.inst.plist), false);
  assert.ok(s.calls.includes(`launchctl bootout gui/501/${Installer.LABEL}`));
});
