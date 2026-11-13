// Installs Cinnamon's login item: Cinnamon Helper, which re-applies Cinnamon every time Claude starts.
// (`cinnamon install` / `cinnamon install --rebuild` / `cinnamon uninstall`; log: <your folder>/logs/helper.log)
// The helper is built into your folder, not the install: an upgrade replaces the install, and a rebuilt helper makes
// macOS ask for Accessibility again — so it is only rebuilt when its source changes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  private get launcher(): string { return path.join(this.o.root, 'bin', 'cinnamon'); }
  private get linkCandidates(): string[] { return ['/opt/homebrew/bin', '/usr/local/bin', path.join(this.o.home, '.local', 'bin'), path.join(this.o.home, 'bin')]; }

  /** Hash of the helper's source: a rebuild only happens when it changes. */
  sourceHash(): string {
    const h = createHash('sha256');
    for (const f of ['main.swift', 'Info.plist']) h.update(fs.readFileSync(path.join(this.o.root, 'core', 'helper', f)));
    return h.digest('hex');
  }

  private stop(label: string): void {
    this.run('launchctl', ['bootout', `${this.domain}/${label}`]);
    for (let i = 0; i < 25; i++) { if (this.run('launchctl', ['print', `${this.domain}/${label}`]).status !== 0) break; this.sleep(200); }
  }

  private isExecutable(f: string): boolean { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } }
  private readText(f: string): string { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } }

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
    <string>--run</string><string>${xml(path.join(o.root, 'core', 'autoapply.sh'))}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(path.dirname(o.bun))}:/opt/homebrew/bin:/usr/local/bin:${xml(o.home)}/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CINNAMON_HOME</key><string>${xml(o.userDir)}</string>
    <key>CINNAMON_ROOT</key><string>${xml(o.root)}</string>
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

  /** The `cinnamon` command on PATH that isn't this install's own link, if any. */
  private otherCinnamon(): string | null {
    for (const d of this.o.pathEnv.split(':').filter(Boolean)) {
      const f = path.join(d, 'cinnamon');
      if (!this.isExecutable(f)) continue;
      let target = '';
      try { target = fs.readlinkSync(f); } catch {}
      return target === this.launcher ? null : f;
    }
    return null;
  }

  private linkCommand(): void {
    const other = this.otherCinnamon();
    if (other) { this.log(`The cinnamon command is already on your PATH (${other}).`); return; }
    const onPath = new Set(this.o.pathEnv.split(':'));
    const dir = this.linkCandidates.find((d) => { if (!onPath.has(d)) return false; try { fs.accessSync(d, fs.constants.W_OK); return fs.statSync(d).isDirectory(); } catch { return false; } });
    if (!dir) { this.log(`Add Cinnamon to your PATH to use the cinnamon command:  export PATH="${path.join(this.o.root, 'bin')}:$PATH"`); return; }
    const link = path.join(dir, 'cinnamon');
    fs.rmSync(link, { force: true });
    fs.symlinkSync(this.launcher, link);
    this.log(`Linked the cinnamon command into ${dir}.`);
  }

  install({ rebuild = false } = {}): number {
    const { o } = this;
    if (!this.buildHelper(rebuild)) return 1;
    for (const d of [path.join(o.userDir, 'logs'), path.join(o.userDir, 'themes'), path.join(o.userDir, 'extensions'), path.dirname(this.plist)]) fs.mkdirSync(d, { recursive: true });
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
    for (const d of this.linkCandidates) {
      const link = path.join(d, 'cinnamon');
      try { if (fs.readlinkSync(link) === this.launcher) fs.rmSync(link); } catch {}
    }
    this.log('Removed the login item and the cinnamon command. Claude goes back to normal at its next launch.');
    this.log(`Your settings stay in ${this.o.userDir}. You can also remove Cinnamon Helper from`);
    this.log('System Settings > Privacy & Security > Accessibility.');
    return 0;
  }
}
