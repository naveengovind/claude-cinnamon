// The files a standalone binary carries (Cinnamon's sources, themes, extensions and the prebuilt helper), unpacked
// into <your folder>/app/<version> the first time that version runs. Unpacking goes to a temporary folder that is
// renamed into place, so a version folder is either complete or absent, and two commands starting at once can't
// leave a half-written one. Older versions stay until `prune` (after an install, which re-applies Cinnamon with the
// new files): a running Claude keeps using its folder until then.
import fs from 'node:fs';
import path from 'node:path';

/** Files to mark executable: scripts and the helper's program. */
const EXECUTABLE = /(\.sh$|\/Contents\/MacOS\/)/;
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;

export class Payload {
  /** @param files payload path ("core/render.ts") → where the binary keeps it (an embedded file's path) */
  constructor(private readonly files: Record<string, string>, readonly version: string) {
    if (!VERSION.test(version)) throw new Error(`bad version: ${version}`);
  }

  dir(userDir: string): string { return path.join(userDir, 'app', this.version); }

  /** The unpacked folder for this version, unpacking it first if needed. */
  async ensure(userDir: string): Promise<string> {
    const dest = this.dir(userDir);
    if (fs.existsSync(dest)) return dest;
    const app = path.dirname(dest);
    fs.mkdirSync(app, { recursive: true });
    const work = fs.mkdtempSync(path.join(app, `.unpack-${this.version}-`));
    try {
      for (const [rel, src] of Object.entries(this.files)) {
        const out = path.resolve(work, rel);
        if (!out.startsWith(work + path.sep)) throw new Error(`bad payload path: ${rel}`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, await Bun.file(src).bytes(), { mode: EXECUTABLE.test(`/${rel}`) ? 0o755 : 0o644 });
      }
      try { fs.renameSync(work, dest); } catch (e) {
        if (!fs.existsSync(dest)) throw e; // else another command unpacked it first
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    return dest;
  }

  /** Removes the other versions' folders (and unpacks that never finished). */
  prune(userDir: string): void {
    const app = path.join(userDir, 'app');
    let names: string[] = [];
    try { names = fs.readdirSync(app); } catch { return; }
    for (const n of names) {
      if (n === this.version) continue;
      const stale = n.startsWith('.unpack-') && Date.now() - fs.statSync(path.join(app, n)).mtimeMs > 10 * 60_000;
      if (VERSION.test(n) || stale) fs.rmSync(path.join(app, n), { recursive: true, force: true });
    }
  }
}
