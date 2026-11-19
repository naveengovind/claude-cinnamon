// Cinnamon.app, the menu bar app (app/): a front end to the cinnamon command for people who'd rather not use a
// terminal. `cinnamon app install [--no-open]` puts it in ~/Applications and `cinnamon app uninstall` removes it.
// The app runs the cinnamon command named in its Contents/Resources/cli-path (this install's), so updating the
// command updates what the app does. A standalone binary brings the app prebuilt (universal, signed, `.app-built-from`
// beside it); otherwise it is built here with swiftc, once per source change. Signed ad hoc: without an Apple
// Developer ID it isn't notarized, so a downloaded copy needs right-click → Open the first time.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runCommand, type Runner } from './Installer';

export interface AppInstallerOptions {
  /** Cinnamon's files (app/ and, in a standalone binary, prebuilt/). */
  root: string;
  home: string;
  /** Your folder: an app built here is kept in it. */
  userDir: string;
  version: string;
  /** The cinnamon command the app runs. */
  launcher: string;
  run?: Runner;
  log?: (line: string) => void;
}

export type AppArch = 'arm64' | 'x86_64';

/** The app's Swift sources, sorted. */
export function appSources(root: string): string[] {
  const dir = path.join(root, 'app');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.swift')).sort().map((f) => path.join(dir, f));
}

/** Hash of the app's source (app/*.swift and Info.plist): what `.app-built-from` / `.built-from` record. */
export function appSourceHash(root: string): string {
  const h = createHash('sha256');
  for (const f of [...appSources(root), path.join(root, 'app', 'Info.plist')]) { h.update(path.basename(f)); h.update(fs.readFileSync(f)); }
  return h.digest('hex');
}

export class AppInstaller {
  static readonly BUNDLE_ID = 'local.claude-cinnamon.app';
  static readonly NAME = 'Cinnamon.app';
  /** Swift 5 mode (the app's concurrency is checked, not Swift 6's strict rules), as a SwiftUI app with @main. */
  static readonly SWIFT_FLAGS = ['-swift-version', '5', '-parse-as-library'];
  private readonly run: Runner;
  private readonly log: (line: string) => void;

  constructor(private readonly o: AppInstallerOptions) {
    this.run = o.run || runCommand;
    this.log = o.log || ((l) => console.log(l));
  }

  get dest(): string { return path.join(this.o.home, 'Applications', AppInstaller.NAME); }
  private get prebuilt(): string { return path.join(this.o.root, 'prebuilt', AppInstaller.NAME); }
  private get built(): string { return path.join(this.o.userDir, 'app-build', AppInstaller.NAME); }

  /** An app whose Info.plist names Cinnamon's bundle id (anything else called Cinnamon.app is left alone). */
  static isOurs(app: string): boolean {
    try { return fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8').includes(`<string>${AppInstaller.BUNDLE_ID}</string>`); } catch { return false; }
  }

  private static readText(f: string): string { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } }
  private static hasExe(app: string): boolean { return fs.existsSync(path.join(app, 'Contents', 'MacOS', 'Cinnamon')); }

  /**
   * Builds Cinnamon.app at `app` for `arches` (both: a universal app) and signs it. Returns null, or what went wrong.
   * `work` holds the per-architecture slices.
   */
  static build(root: string, app: string, version: string, arches: AppArch[], run: Runner, work: string): string | null {
    fs.rmSync(app, { recursive: true, force: true });
    const exe = path.join(app, 'Contents', 'MacOS', 'Cinnamon');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
    const plist = fs.readFileSync(path.join(root, 'app', 'Info.plist'), 'utf8').replaceAll('__VERSION__', version.replace(/[^0-9A-Za-z.\-]/g, ''));
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), plist);
    const slices: string[] = [];
    for (const arch of arches) {
      const out = arches.length === 1 ? exe : path.join(work, `cinnamon-app-${arch}`);
      if (arches.length > 1) fs.mkdirSync(work, { recursive: true });
      const r = run('swiftc', ['-O', ...AppInstaller.SWIFT_FLAGS, '-target', `${arch}-apple-macos13`, '-o', out, ...appSources(root)]);
      if (r.status !== 0) return `Could not build Cinnamon.app (${arch}):\n${r.stderr.trim()}`;
      slices.push(out);
    }
    if (slices.length > 1) {
      const r = run('lipo', ['-create', '-output', exe, ...slices]);
      if (r.status !== 0) return `Could not make Cinnamon.app universal:\n${r.stderr.trim()}`;
    }
    const s = AppInstaller.sign(app, run);
    return s;
  }

  /** Ad-hoc signature with the app's bundle id (again after cli-path is written into it). */
  private static sign(app: string, run: Runner): string | null {
    const r = run('codesign', ['--force', '--sign', '-', '--identifier', AppInstaller.BUNDLE_ID, app]);
    return r.status === 0 ? null : `Could not sign Cinnamon.app:\n${r.stderr.trim()}`;
  }

  /** The app to copy: the prebuilt one if it is from this source, else one built here (built now if needed). */
  private source(): string | null {
    const hash = appSourceHash(this.o.root);
    if (AppInstaller.hasExe(this.prebuilt) && AppInstaller.readText(path.join(path.dirname(this.prebuilt), '.app-built-from')) === hash) return this.prebuilt;
    const builtFrom = path.join(path.dirname(this.built), '.built-from');
    if (AppInstaller.hasExe(this.built) && AppInstaller.readText(builtFrom) === hash) return this.built;
    if (this.run('which', ['swiftc']).status !== 0) {
      this.log('Building Cinnamon.app needs the Swift compiler: xcode-select --install (or download the app from the releases page).');
      return null;
    }
    this.log('Building Cinnamon.app…');
    const arch: AppArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    const err = AppInstaller.build(this.o.root, this.built, this.o.version, [arch], this.run, path.join(this.o.userDir, 'app-build', 'work'));
    if (err) { this.log(err); return null; }
    fs.writeFileSync(builtFrom, `${hash}\n`);
    return this.built;
  }

  install({ open = true } = {}): number {
    const { dest } = this;
    if (fs.existsSync(dest) && !AppInstaller.isOurs(dest)) {
      this.log(`${dest} is another app; leaving it alone.`);
      return 1;
    }
    const src = this.source();
    if (!src) return 1;
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
    fs.mkdirSync(path.join(dest, 'Contents', 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'Contents', 'Resources', 'cli-path'), `${this.o.launcher}\n`);
    const err = AppInstaller.sign(dest, this.run);
    if (err) { this.log(err); return 1; }
    this.run('xattr', ['-dr', 'com.apple.quarantine', dest]); // best effort
    this.log(`Installed Cinnamon.app in ${path.dirname(dest)}: its icon is in the menu bar.`);
    if (open) this.run('open', [dest]);
    return 0;
  }

  uninstall(): number {
    const { dest } = this;
    if (!fs.existsSync(dest)) { this.log('Cinnamon.app is not installed.'); return 0; }
    if (!AppInstaller.isOurs(dest)) { this.log(`${dest} is another app; leaving it alone.`); return 1; }
    // quit that copy (a signal, not an Apple Event: no Automation prompt); best effort
    this.run('pkill', ['-f', `${dest}/Contents/MacOS/`]);
    fs.rmSync(dest, { recursive: true, force: true });
    this.log('Removed Cinnamon.app.');
    return 0;
  }
}
