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

test('install puts the colors mod where Claude Code loads it in every session, replacing an older copy', () => {
  const s = setup();
  fs.cpSync(path.join(REPO, 'mod'), path.join(s.root, 'mod'), { recursive: true });
  const old = path.join(s.home, '.claude', 'skills', 'cinnamon-colors', 'hooks', 'stale.js');
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, '');
  assert.strictEqual(s.inst.install(), 0, s.logs.join('\n'));
  const dir = path.join(s.home, '.claude', 'skills', 'cinnamon-colors');
  assert.strictEqual(s.inst.modDir, dir);
  assert.ok(fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json')));
  assert.ok(fs.existsSync(path.join(dir, 'hooks', 'register.js')));
  assert.ok(!fs.existsSync(old), 'the old copy is replaced, not merged');
});

test('uninstall removes the colors mod and its look, and says how to drop colors the app keeps', () => {
  const s = setup();
  fs.cpSync(path.join(REPO, 'mod'), path.join(s.root, 'mod'), { recursive: true });
  s.inst.install();
  fs.writeFileSync(path.join(s.inst.modDir, 'look.json'), '{"id":null}\n');
  s.inst.uninstall();
  assert.ok(!fs.existsSync(s.inst.modDir));
  assert.ok(s.logs.some((l) => /Remove colors/.test(l)));
});

test('uninstall leaves a folder of the same name alone when it is not the colors mod', () => {
  const s = setup();
  const other = path.join(s.home, '.claude', 'skills', 'cinnamon-colors');
  fs.mkdirSync(path.join(other, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(other, '.claude-plugin', 'plugin.json'), '{"name":"someone-else"}');
  s.inst.uninstall();
  assert.ok(fs.existsSync(other));
});

test('install without a mod folder (an older install layout) still installs the login item', () => {
  const s = setup();
  assert.strictEqual(s.inst.install(), 0);
  assert.ok(!fs.existsSync(s.inst.modDir));
});

test('reinstalling keeps the look Cinnamon wrote into the mod', () => {
  const s = setup();
  fs.cpSync(path.join(REPO, 'mod'), path.join(s.root, 'mod'), { recursive: true });
  s.inst.install();
  fs.writeFileSync(path.join(s.inst.modDir, 'look.json'), '{"id":"codex:1"}\n');
  s.inst.install();
  assert.strictEqual(fs.readFileSync(path.join(s.inst.modDir, 'look.json'), 'utf8'), '{"id":"codex:1"}\n');
});

test('install puts the cinnamon skill in ~/.claude/skills with this install\'s paths filled in', () => {
  const s = setup();
  fs.cpSync(path.join(REPO, 'skill'), path.join(s.root, 'skill'), { recursive: true });
  assert.strictEqual(s.inst.install(), 0, s.logs.join('\n'));
  const dir = path.join(s.home, '.claude', 'skills', 'cinnamon');
  assert.strictEqual(s.inst.skillDir, dir);
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: cinnamon\n/);
  assert.ok(skill.includes(path.join(s.root, 'bin', 'cinnamon')), 'the command path');
  assert.ok(skill.includes(s.userDir), 'the user folder');
  for (const f of ['SKILL.md', 'themes.md', 'extensions.md']) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /\{\{[A-Z_]+\}\}/, f);
  assert.ok(fs.readFileSync(path.join(dir, 'extensions.md'), 'utf8').includes(path.join(s.root, 'types', 'cinnamon.d.ts')));
});

test('the standalone binary is the command the skill names', () => {
  const s = setup();
  fs.cpSync(path.join(REPO, 'skill'), path.join(s.root, 'skill'), { recursive: true });
  const bin = path.join(s.home, 'opt', 'cinnamon');
  const inst = new Installer({ root: s.root, userDir: s.userDir, home: s.home, pathEnv: '', bun: '/opt/bun/bin/bun', uid: 501, run: () => ({ status: 0, stdout: '', stderr: '' }), log: () => {}, sleep: () => {}, binary: bin });
  (inst as unknown as { installSkill(): void }).installSkill();
  assert.ok(fs.readFileSync(path.join(inst.skillDir, 'SKILL.md'), 'utf8').includes(`Command: \`${bin}\``));
});

test('a skill named cinnamon that Cinnamon did not install is left alone', () => {
  const s = setup();
  fs.cpSync(path.join(REPO, 'skill'), path.join(s.root, 'skill'), { recursive: true });
  const dir = path.join(s.home, '.claude', 'skills', 'cinnamon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: cinnamon\ndescription: mine\n---\n');
  s.inst.install();
  assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /description: mine/);
  s.inst.uninstall();
  assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')));
});

test('uninstall removes the skill Cinnamon installed', () => {
  const s = setup();
  fs.cpSync(path.join(REPO, 'skill'), path.join(s.root, 'skill'), { recursive: true });
  s.inst.install();
  s.inst.uninstall();
  assert.ok(!fs.existsSync(s.inst.skillDir));
});

test('a first install starts on the Ember theme', () => {
  const s = setup();
  s.inst.install();
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s.userDir, 'config.json'), 'utf8')).theme, 'ember');
});

test('reinstalling keeps the theme the person picked', () => {
  const s = setup();
  fs.mkdirSync(s.userDir, { recursive: true });
  fs.writeFileSync(path.join(s.userDir, 'config.json'), '{"theme":"codex"}\n');
  s.inst.install();
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s.userDir, 'config.json'), 'utf8')).theme, 'codex');
});

test('the login item is shown under Cinnamon in Login Items, and asks for Accessibility by default', () => {
  const s = setup();
  assert.strictEqual(s.inst.install(), 0, s.logs.join('\n'));
  const plist = fs.readFileSync(s.inst.plist, 'utf8');
  assert.match(plist, /<key>AssociatedBundleIdentifiers<\/key>\s*<array><string>local\.claude-cinnamon\.app<\/string><\/array>/);
  assert.ok(!plist.includes('--no-accessibility'));
});

test('with "permissions": "none" the helper only watches for Claude and never asks for Accessibility', () => {
  const s = setup();
  fs.mkdirSync(s.userDir, { recursive: true });
  fs.writeFileSync(path.join(s.userDir, 'config.json'), JSON.stringify({ theme: 'ember', permissions: 'none' }));
  assert.strictEqual(s.inst.install(), 0, s.logs.join('\n'));
  assert.match(fs.readFileSync(s.inst.plist, 'utf8'), /<string>watch<\/string>\s*<string>--no-accessibility<\/string>/);
  assert.ok(!s.logs.some((l) => /Accessibility/.test(l)), s.logs.join('\n'));
});
