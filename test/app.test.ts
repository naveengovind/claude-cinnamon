// The menu bar app (app/, core/install/AppInstaller.ts): `cinnamon app install` / `app uninstall` into a temporary
// home with a recorded runner, and the Swift sources compiling for real when a Swift compiler is here.
import { test } from 'bun:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppInstaller, appSourceHash } from '../core/install/AppInstaller';
import type { RunResult } from '../core/install/Installer';

const REPO = path.join(import.meta.dir, '..');

function setup({ prebuilt = 'none' }: { prebuilt?: 'none' | 'same' | 'stale' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-app-'));
  const root = path.join(base, 'root');
  fs.cpSync(path.join(REPO, 'app'), path.join(root, 'app'), { recursive: true });
  const home = path.join(base, 'home');
  const userDir = path.join(home, '.config', 'claude-cinnamon');
  fs.mkdirSync(userDir, { recursive: true });
  const calls: string[] = [];
  const run = (cmd: string, args: string[]): RunResult => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'swiftc') { const out = args[args.indexOf('-o') + 1]!; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, 'exe', { mode: 0o755 }); }
    if (cmd === 'lipo') { const out = args[args.indexOf('-output') + 1]!; fs.writeFileSync(out, 'universal', { mode: 0o755 }); }
    return { status: 0, stdout: '', stderr: '' };
  };
  if (prebuilt !== 'none') {
    const app = path.join(root, 'prebuilt', 'Cinnamon.app');
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Cinnamon'), 'prebuilt', { mode: 0o755 });
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<plist><dict><key>CFBundleIdentifier</key><string>${AppInstaller.BUNDLE_ID}</string></dict></plist>`);
    fs.writeFileSync(path.join(root, 'prebuilt', '.app-built-from'), prebuilt === 'same' ? `${appSourceHash(root)}\n` : 'x\n');
  }
  const logs: string[] = [];
  const launcher = path.join(base, 'bin', 'cinnamon');
  const inst = new AppInstaller({ root, home, userDir, version: '9.9.9', launcher, run, log: (l) => logs.push(l) });
  return { inst, calls, logs, root, home, userDir, launcher };
}

test('app install puts Cinnamon.app in ~/Applications, pointed at this cinnamon command, signed and opened', () => {
  const s = setup({ prebuilt: 'same' });
  assert.strictEqual(s.inst.install(), 0);
  const dest = path.join(s.home, 'Applications', 'Cinnamon.app');
  assert.strictEqual(s.inst.dest, dest);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'Contents', 'MacOS', 'Cinnamon'), 'utf8'), 'prebuilt');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'Contents', 'Resources', 'cli-path'), 'utf8').trim(), s.launcher);
  assert.ok(s.calls.includes(`codesign --force --sign - --identifier ${AppInstaller.BUNDLE_ID} ${dest}`), s.calls.join('\n'));
  assert.ok(s.calls.includes(`open ${dest}`));
  assert.ok(!s.calls.some((c) => c.startsWith('swiftc')), 'a prebuilt app from this source needs no compiler');
});

test('app install --no-open leaves it closed', () => {
  const s = setup({ prebuilt: 'same' });
  assert.strictEqual(s.inst.install({ open: false }), 0);
  assert.ok(!s.calls.some((c) => c.startsWith('open ')));
});

test('without a prebuilt app from this source, app install builds one with swiftc (once)', () => {
  const s = setup({ prebuilt: 'stale' });
  assert.strictEqual(s.inst.install({ open: false }), 0);
  const builds = s.calls.filter((c) => c.startsWith('swiftc'));
  assert.strictEqual(builds.length, 1);
  assert.match(builds[0]!, /-parse-as-library/);
  assert.match(builds[0]!, /-apple-macos13/);
  for (const f of fs.readdirSync(path.join(s.root, 'app')).filter((f) => f.endsWith('.swift'))) assert.ok(builds[0]!.includes(f), f);
  const plist = fs.readFileSync(path.join(s.inst.dest, 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, /<string>9\.9\.9<\/string>/);
  assert.match(plist, new RegExp(AppInstaller.BUNDLE_ID.replace(/\./g, '\\.')));
  // again: the build from this source is reused
  s.calls.length = 0;
  assert.strictEqual(s.inst.install({ open: false }), 0);
  assert.ok(!s.calls.some((c) => c.startsWith('swiftc')));
});

test('app install says what to do without a Swift compiler or a prebuilt app', () => {
  const s = setup();
  const noSwift = new AppInstaller({ root: s.root, home: s.home, userDir: s.userDir, version: '1', launcher: s.launcher, log: (l) => s.logs.push(l),
    run: (cmd, args) => (cmd === 'which' && args[0] === 'swiftc' ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: '', stderr: '' }) });
  assert.strictEqual(noSwift.install({ open: false }), 1);
  assert.match(s.logs.join('\n'), /xcode-select --install/);
  assert.ok(!fs.existsSync(noSwift.dest));
});

test('app install never replaces another app called Cinnamon', () => {
  const s = setup({ prebuilt: 'same' });
  const other = path.join(s.home, 'Applications', 'Cinnamon.app', 'Contents');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.example.cinnamon</string></dict></plist>');
  assert.strictEqual(s.inst.install({ open: false }), 1);
  assert.match(fs.readFileSync(path.join(other, 'Info.plist'), 'utf8'), /com\.example\.cinnamon/);
  assert.strictEqual(s.inst.uninstall(), 1);
  assert.ok(fs.existsSync(other));
});

test('app uninstall quits and removes Cinnamon.app', () => {
  const s = setup({ prebuilt: 'same' });
  s.inst.install({ open: false });
  assert.strictEqual(s.inst.uninstall(), 0);
  assert.ok(!fs.existsSync(s.inst.dest));
  assert.ok(s.calls.some((c) => c.startsWith('osascript') && c.includes(AppInstaller.BUNDLE_ID)));
  assert.strictEqual(s.inst.uninstall(), 0, 'nothing to remove is fine');
});

test('the app\'s source hash changes with its Swift files', () => {
  const s = setup();
  const before = appSourceHash(s.root);
  fs.appendFileSync(path.join(s.root, 'app', 'MenuView.swift'), '\n// changed\n');
  assert.notStrictEqual(appSourceHash(s.root), before);
});

const hasSwift = spawnSync('which', ['swiftc']).status === 0;
test.skipIf(!hasSwift)('the Swift app type-checks for macOS 13', () => {
  const sources = fs.readdirSync(path.join(REPO, 'app')).filter((f) => f.endsWith('.swift')).map((f) => path.join(REPO, 'app', f));
  const r = spawnSync('swiftc', ['-typecheck', ...AppInstaller.SWIFT_FLAGS, '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13`, ...sources], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /warning:/, r.stderr);
}, 120_000);
