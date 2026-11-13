// Sources for `cinnamon theme|ext install`: "owner/repo", "github:owner/repo#sub",
// "https://github.com/o/r/tree/<ref>/<sub>", any git URL or folder ("#sub" optional). Git sources are cloned (your
// normal git credentials work), pinned to the commit; the "#folder" must really be inside the download.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Source { url: string; ref: string | null; sub: string }
export interface FetchedSource extends Source { tmp: string; dir: string; commit: string | null; cleanup(): void }

export class SourceFetcher {
  static parse(raw: string): Source {
    let s = String(raw).trim();
    let sub = '';
    const hash = s.indexOf('#');
    if (hash !== -1) { sub = s.slice(hash + 1); s = s.slice(0, hash); }
    const gh = s.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (gh && !s.startsWith('.') && !s.startsWith('/')) return { url: `https://github.com/${gh[1]}/${gh[2]}.git`, ref: null, sub };
    const web = s.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/);
    if (web) return { url: `https://github.com/${web[1]}/${web[2]}.git`, ref: web[3] || null, sub: sub || web[4] || '' };
    return { url: s, ref: null, sub };
  }

  /** Lowercase letters, digits, . _ - (at most 64). */
  static sanitizeId(s: string): string {
    return String(s).toLowerCase().replace(/\.git$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);
  }

  /** Links in a download could point anywhere on this Mac; installs refuse them. */
  static findLinks(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) out.push(path.relative(dir, p));
        else if (e.isDirectory()) walk(p);
      }
    };
    walk(dir);
    return out;
  }

  static copyTree(from: string, to: string): void {
    fs.cpSync(from, to, { recursive: true, filter: (f) => path.basename(f) !== '.git' });
  }

  fetch(raw: string): FetchedSource {
    const local = fs.existsSync(raw) && fs.statSync(raw).isDirectory() ? raw : null;
    const src: Source = local ? { url: local, ref: null, sub: '' } : SourceFetcher.parse(raw);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinnamon-src-'));
    const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    const isGit = !local || fs.existsSync(path.join(local, '.git'));
    let commit: string | null = null;
    if (isGit) {
      const r = spawnSync('git', ['clone', '--quiet', '--depth', '1', ...(src.ref ? ['--branch', src.ref] : []), '--', src.url, tmp], { encoding: 'utf8' });
      if (r.status !== 0) { cleanup(); throw new Error(`could not fetch ${src.url}: ${(r.stderr || '').trim()}`); }
      commit = (spawnSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim() || null;
    } else {
      fs.cpSync(local!, tmp, { recursive: true });
    }
    const realTmp = fs.realpathSync(tmp);
    let dir: string;
    try { dir = fs.realpathSync(path.resolve(tmp, src.sub || '.')); } catch { cleanup(); throw new Error(`no folder "${src.sub}" in ${src.url}`); }
    if (dir !== realTmp && !dir.startsWith(realTmp + path.sep)) { cleanup(); throw new Error(`"${src.sub}" leads outside ${src.url} (a link?)`); }
    return { ...src, tmp, dir, commit, cleanup };
  }
}

export const parseSource = SourceFetcher.parse;
