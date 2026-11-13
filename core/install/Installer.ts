// Installs Cinnamon's login item: Cinnamon Helper, which re-applies Cinnamon every time Claude starts.
// (`cinnamon install` / `cinnamon install --rebuild` / `cinnamon uninstall`; log: <your folder>/logs/helper.log)
// The helper is built into your folder, not the install: an upgrade replaces the install, and a rebuilt helper makes
// macOS ask for Accessibility again — so it is only rebuilt when its source changes.
// The standalone binary (`binary`) brings its helper prebuilt (`prebuiltHelper`, universal and signed) and needs no
// Swift compiler; its login item runs a small script in your folder that hands over to the binary, so replacing the
// binary (an update) never leaves the login item pointing at files that are gone.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Homebrew } from '../standalone/Homebrew';

export interface RunResult { status: number; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[]) => RunResult;
export const runCommand: Runner = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
};

export interface InstallerOptions {
  root: string;
  userDir: string;
  home: string;
  /** PATH, to find where to link the cinnamon command and whether one is already there. */
  pathEnv: string;
  /** Bun's path (its folder goes on the helper's PATH). */
  bun: string;
  uid: number;
  run?: Runner;
  log?: (line: string) => void;
  sleep?: (ms: number) => void;
  /** The standalone binary: linked as the cinnamon command and run by the login item. */
  binary?: string;
  /** The helper app built with the release; `.built-from` beside it holds the hash of the source it was built from. */
  prebuiltHelper?: string;
}

/** Hash of the helper's source (core/helper): what `.built-from` beside a built helper records. */
export function helperSourceHash(root: string): string {
  const h = createHash('sha256');
  for (const f of ['main.swift', 'Info.plist']) h.update(fs.readFileSync(path.join(root, 'core', 'helper', f)));
  return h.digest('hex');
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export class Installer {
  static readonly LABEL = 'local.claude-cinnamon.helper';
  static readonly OLD_LABEL = 'local.claude-desktop-mods.helper'; // the helper's name before Cinnamon
  private readonly run: Runner;
  private readonly log: (line: string) => void;
  private readonly sleep: (ms: number) => void;

  constructor(private readonly o: InstallerOptions) {
    this.run = o.run || runCommand;
    this.log = o.log || ((l) => console.log(l));
    this.sleep = o.sleep || pause;
  }

  get app(): string { return path.join(this.o.userDir, 'helper', 'Cinnamon Helper.app'); }
  get exe(): string { return path.join(this.app, 'Contents', 'MacOS', 'cinnamon-helper'); }
  get plist(): string { return path.join(this.o.home, 'Library', 'LaunchAgents', `${Installer.LABEL}.plist`); }
  private get domain(): string { return `gui/${this.o.uid}`; }
  /** What the login item runs when Claude starts: the install's script, or (standalone) the one in your folder. */
  get launchScript(): string { return this.o.binary ? path.join(this.o.userDir, 'helper', 'autoapply.sh') : path.join(this.o.root, 'core', 'autoapply.sh'); }
  private get launcher(): string { return this.o.binary || path.join(this.o.root, 'bin', 'cinnamon'); }
  /** Where the command may be linked: your own bin folders, never Homebrew's (its `brew link` would then fail). */
  private get linkCandidates(): string[] { return [path.join(this.o.home, '.local', 'bin'), path.join(this.o.home, 'bin')]; }
  /** Earlier versions also linked into these; uninstall still removes such a link. */
  private get oldLinkDirs(): string[] { return ['/opt/homebrew/bin', '/usr/local/bin']; }

  /** Hash of the helper's source: a rebuild only happens when it changes. */
  sourceHash(): string { return helperSourceHash(this.o.root); }

  private stop(label: string): void {
    this.run('launchctl', ['bootout', `${this.domain}/${label}`]);
    for (let i = 0; i < 25; i++) { if (this.run('launchctl', ['print', `${this.domain}/${label}`]).status !== 0) break; this.sleep(200); }
  }

  private isExecutable(f: string): boolean { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } }
  private readText(f: string): string { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } }
  private same(a: string, b: string): boolean { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } }

  /** Standalone: copies the release's helper into place, if it was built from this source. */
  private copyPrebuilt(hash: string, builtFrom: string): boolean {
    const pre = this.o.prebuiltHelper;
    if (!pre || this.readText(path.join(path.dirname(pre), '.built-from')) !== hash) return false;
    if (!this.isExecutable(path.join(pre, 'Contents', 'MacOS', 'cinnamon-helper'))) return false;
    fs.rmSync(this.app, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(this.app), { recursive: true });
    fs.cpSync(pre, this.app, { recursive: true, verbatimSymlinks: true });
    this.run('xattr', ['-dr', 'com.apple.quarantine', this.app]); // best effort: nothing to remove when not downloaded by a browser
    fs.writeFileSync(builtFrom, `${hash}\n`);
    this.log('Installed Cinnamon Helper.');
    return true;
  }

  /** Standalone: the script the login item runs, handing over to the binary. */
  writeLaunchScript(): void {
    const bin = this.o.binary;
    if (!bin) return;
    fs.mkdirSync(path.dirname(this.launchScript), { recursive: true });
    fs.writeFileSync(this.launchScript, `#!/bin/bash
# Run by Cinnamon Helper each time Claude starts (written by \`cinnamon install\`): hands over to the cinnamon binary.
installed=${shQuote(bin)}
bin="\${CINNAMON_BIN:-$installed}"
[ -x "$bin" ] || { echo "Cinnamon: $bin is missing. Reinstall Cinnamon, then run: cinnamon install"; exit 1; }
exec "$bin" __autoapply "$@"
`, { mode: 0o755 });
  }

  /** Builds (or moves into place) the helper; returns false with a message if it can't. */
  buildHelper(rebuild = false): boolean {
    const hash = this.sourceHash();
    const builtFrom = path.join(this.o.userDir, 'helper', '.built-from');
    // a helper built by an earlier version inside the install: move it (same build, so the permission still holds)
    const oldApp = path.join(this.o.root, 'build', 'Cinnamon Helper.app');
    if (!this.isExecutable(this.exe) && this.isExecutable(path.join(oldApp, 'Contents', 'MacOS', 'cinnamon-helper')) && this.readText(path.join(this.o.root, 'build', '.built-from')) === hash) {
      fs.mkdirSync(path.dirname(this.app), { recursive: true });
      fs.renameSync(oldApp, this.app);
      fs.writeFileSync(builtFrom, `${hash}\n`);
    }
    if (this.isExecutable(this.exe) && this.readText(builtFrom) === hash && !rebuild) return true;
    if (this.copyPrebuilt(hash, builtFrom)) return true;
    if (this.run('which', ['swiftc']).status !== 0) { this.log('Cinnamon needs the Swift compiler to build its helper: xcode-select --install'); return false; }
    this.log('Building Cinnamon Helper…');
    fs.mkdirSync(path.dirname(this.exe), { recursive: true });
    fs.copyFileSync(path.join(this.o.root, 'core', 'helper', 'Info.plist'), path.join(this.app, 'Contents', 'Info.plist'));
    const b = this.run('swiftc', ['-O', '-o', this.exe, path.join(this.o.root, 'core', 'helper', 'main.swift')]);
    if (b.status !== 0) { this.log(`Could not build Cinnamon Helper:\n${b.stderr.trim()}`); return false; }
    const s = this.run('codesign', ['--force', '--sign', '-', '--identifier', Installer.LABEL, this.app]);
    if (s.status !== 0) { this.log(`Could not sign Cinnamon Helper:\n${s.stderr.trim()}`); return false; }
    fs.writeFileSync(builtFrom, `${hash}\n`);
    return true;
  }

  plistText(): string {
    const { o } = this;
    const log = path.join(o.userDir, 'logs', 'helper.log');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${Installer.LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(this.exe)}</string>
    <string>watch</string>
    <string>--bundle-id</string><string>com.anthropic.claudefordesktop</string>
    <string>--run</string><string>${xml(this.launchScript)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(path.dirname(o.bun))}:/opt/homebrew/bin:/usr/local/bin:${xml(o.home)}/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CINNAMON_HOME</key><string>${xml(o.userDir)}</string>
${o.binary ? `    <key>CINNAMON_BIN</key><string>${xml(o.binary)}</string>` : `    <key>CINNAMON_ROOT</key><string>${xml(o.root)}</string>`}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
  }

  /** The first `cinnamon` command on PATH, if any. */
  private onPath(): string | null {
    for (const d of this.o.pathEnv.split(':').filter(Boolean)) {
      const f = path.join(d, 'cinnamon');
      if (this.isExecutable(f)) return f;
    }
    return null;
  }

  linkCommand(): void {
    const found = this.onPath();
    if (found && this.same(found, this.launcher)) return; // this install's command already
    if (found) { this.log(`The cinnamon command is already on your PATH (${found}).`); return; }
    const onPath = new Set(this.o.pathEnv.split(':'));
    const dir = this.linkCandidates.find((d) => { if (!onPath.has(d)) return false; try { fs.accessSync(d, fs.constants.W_OK); return fs.statSync(d).isDirectory(); } catch { return false; } });
    if (!dir) { this.log(`Add Cinnamon to your PATH to use the cinnamon command:  export PATH="${path.join(this.o.root, 'bin')}:$PATH"`); return; }
    const link = path.join(dir, 'cinnamon');
    if (path.resolve(link) === path.resolve(this.launcher)) return; // never replace the binary with a link to itself
    fs.rmSync(link, { force: true });
    fs.symlinkSync(this.launcher, link);
    this.log(`Linked the cinnamon command into ${dir}.`);
  }

  install({ rebuild = false } = {}): number {
    const { o } = this;
    if (!this.buildHelper(rebuild)) return 1;
    for (const d of [path.join(o.userDir, 'logs'), path.join(o.userDir, 'themes'), path.join(o.userDir, 'extensions'), path.dirname(this.plist)]) fs.mkdirSync(d, { recursive: true });
    this.writeLaunchScript();
    fs.writeFileSync(this.plist, this.plistText());
    if (this.run('plutil', ['-lint', this.plist]).status !== 0) { fs.rmSync(this.plist, { force: true }); this.log(`Could not write a valid login item (${this.plist}).`); return 1; }
    // The helper from before Cinnamon (if any) goes; this one replaces it.
    const old = path.join(path.dirname(this.plist), `${Installer.OLD_LABEL}.plist`);
    if (fs.existsSync(old)) {
      this.stop(Installer.OLD_LABEL);
      fs.rmSync(old, { force: true });
      this.log(`Removed the old login item (${Installer.OLD_LABEL}).`);
    }
    this.stop(Installer.LABEL);
    const b = this.run('launchctl', ['bootstrap', this.domain, this.plist]);
    if (b.status !== 0) { this.log(`Could not start the login item: ${b.stderr.trim()}`); return 1; }
    this.linkCommand();
    this.log('Cinnamon Helper is running and will start at every login.');
    this.log('If macOS asks, allow Cinnamon Helper under System Settings > Privacy & Security > Accessibility.');
    return 0;
  }

  uninstall(): number {
    this.stop(Installer.LABEL);
    fs.rmSync(this.plist, { force: true });
    for (const d of [...this.linkCandidates, ...this.oldLinkDirs]) {
      const link = path.join(d, 'cinnamon');
      try { if (fs.readlinkSync(link) === this.launcher) fs.rmSync(link); } catch {}
    }
    if (this.o.binary) fs.rmSync(this.launchScript, { force: true });
    this.log(`Removed the login item${this.o.binary ? '' : ' and the cinnamon command'}. Claude goes back to normal at its next launch.`);
    if (this.o.binary) this.log(`To remove the cinnamon command too: ${Homebrew.prefixOf(this.o.binary) ? 'brew uninstall cinnamon' : `rm ${shQuote(this.o.binary)}`}`);
    this.log(`Your settings stay in ${this.o.userDir}. You can also remove Cinnamon Helper from`);
    this.log('System Settings > Privacy & Security > Accessibility.');
    return 0;
  }
}
