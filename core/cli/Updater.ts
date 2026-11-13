// `cinnamon update` for the standalone binary. It works in this order:
//   1. Find the latest release. It uses gh when gh is signed in (needed while the repository is private), otherwise curl.
//   2. Download this Mac's build and the release's SHA256SUMS.
//   3. Check the checksum, and check that the new binary runs and reports the release's version.
//   4. Put the new binary in place of this one with a rename, so the command is never half-written.
//   5. Run the new binary's `install`, which updates the helper and login item and applies again.
// If any check fails, nothing is changed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand, type Runner } from '../install/Installer';

export interface UpdaterOptions {
  binary: string;
  version: string;
  arch: 'arm64' | 'x64';
  /** owner/name on GitHub */
  repo: string;
  run?: Runner;
  /** Runs a command with the terminal attached; returns its status. */
  exec?: (cmd: string, args: string[]) => number;
  log?: (line: string) => void;
}

export class Updater {
  private readonly cmd: Runner;
  private readonly exec: (cmd: string, args: string[]) => number;
  private readonly log: (line: string) => void;

  constructor(private readonly o: UpdaterOptions) {
    this.cmd = o.run || runCommand;
    this.exec = o.exec || ((cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1);
    this.log = o.log || ((l) => console.log(l));
  }

  get asset(): string { return `cinnamon-darwin-${this.o.arch}.tar.gz`; }

  private fail(msg: string): number { this.log(msg); return 1; }

  /** The latest release's tag ("v0.2.0"), or null. */
  latest(gh: boolean): string | null {
    const { repo } = this.o;
    if (gh) {
      const r = this.cmd('gh', ['release', 'view', '--repo', repo, '--json', 'tagName', '--jq', '.tagName']);
      return r.status === 0 ? r.stdout.trim() || null : null;
    }
    const r = this.cmd('curl', ['-fsSL', '-o', '/dev/null', '-w', '%{url_effective}', `https://github.com/${repo}/releases/latest`]);
    const m = /\/releases\/tag\/([^/?#\s]+)$/.exec(r.stdout.trim());
    return r.status === 0 && m ? decodeURIComponent(m[1]!) : null;
  }

  private download(gh: boolean, tag: string, dir: string): boolean {
    const { repo } = this.o;
    if (gh) return this.cmd('gh', ['release', 'download', tag, '--repo', repo, '--pattern', this.asset, '--pattern', 'SHA256SUMS', '--dir', dir]).status === 0;
    return [this.asset, 'SHA256SUMS'].every((f) =>
      this.cmd('curl', ['-fsSL', '-o', path.join(dir, f), `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${f}`]).status === 0);
  }

  /** Whether the downloaded tarball matches its line in SHA256SUMS. */
  verify(dir: string): boolean {
    let sums = '';
    try { sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8'); } catch { return false; }
    const want = sums.split('\n').map((l) => l.trim().split(/\s+/)).find(([, name]) => name === this.asset || name === `*${this.asset}`)?.[0];
    if (!want) return false;
    let got = '';
    try { got = createHash('sha256').update(fs.readFileSync(path.join(dir, this.asset))).digest('hex'); } catch { return false; }
    return got === want.toLowerCase();
  }

  private isNewer(latest: string): boolean {
    try { return Bun.semver.order(latest, this.o.version) > 0; } catch { return latest !== this.o.version; }
  }

  run(): number {
    const { binary } = this.o;
    const gh = this.cmd('gh', ['auth', 'status']).status === 0;
    const tag = this.latest(gh);
    if (!tag) return this.fail(gh ? 'Could not find the latest release.' : 'Could not find the latest release. While the repository is private, sign in to GitHub first: gh auth login');
    const latest = tag.replace(/^v/, '');
    if (!this.isNewer(latest)) { this.log(`Cinnamon ${this.o.version} is the latest version.`); return 0; }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinnamon-update-'));
    const next = `${binary}.new`;
    try {
      this.log(`Downloading Cinnamon ${latest}…`);
      if (!this.download(gh, tag, dir)) return this.fail('The download failed; nothing was changed.');
      if (!this.verify(dir)) return this.fail('The download does not match the release checksum; nothing was changed.');
      if (this.cmd('tar', ['-xzf', path.join(dir, this.asset), '-C', dir]).status !== 0) return this.fail('Could not unpack the download; nothing was changed.');
      const fresh = path.join(dir, 'cinnamon');
      if (!fs.existsSync(fresh)) return this.fail('The download holds no cinnamon binary; nothing was changed.');
      fs.chmodSync(fresh, 0o755);
      const v = this.cmd(fresh, ['--version']);
      if (v.status !== 0 || v.stdout.trim() !== latest) return this.fail(`The new binary did not run as Cinnamon ${latest}; nothing was changed.`);
      fs.copyFileSync(fresh, next);
      fs.chmodSync(next, 0o755);
      fs.renameSync(next, binary);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(next, { force: true });
    }
    this.log(`Updated to Cinnamon ${latest}.`);
    return this.exec(binary, ['install']);
  }
}
