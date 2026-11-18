// The page code the extension runs in claude.ai, written as files into the extension's own folder (gen/). claude.ai's
// Content-Security-Policy (script-src 'nonce-…' 'strict-dynamic', no 'unsafe-eval') refuses code from a string, but a
// file of the extension's that it injects (chrome.scripting.executeScript({ files }) or chrome.userScripts.execute) is
// the extension's own script, which the page's policy doesn't govern. Names carry a hash of the contents, so a change
// is a new file; files no state names any more are removed.
//
// Each file guards itself so it runs once per document: the core page code by its hash, an extension by its id and
// signature in window.__cinnamonBrowser.ran (core/browser/page.ts), checked and marked in the same step.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const q = (s: string): string => JSON.stringify(s);
const short = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Cinnamon's own page code (channel, runtime, Settings rows), run once per document. */
export function coreScript(js: string): string {
  const h = short(js);
  return `(() => { if (window.__cinnamonCore === ${q(h)}) return; window.__cinnamonCore = ${q(h)};
${js}
})();
`;
}

/** An extension's page code (already wrapped for the runtime), run unless this document runs that version already. */
export function extensionScript(id: string, sig: string, wrapped: string): string {
  return `(() => { const b = window.__cinnamonBrowser; if (!b || b.ran[${q(id)}] === ${q(sig)}) return; b.ran[${q(id)}] = ${q(sig)};
${wrapped}
})();
`;
}

export class GenFiles {
  /** Paths (relative to the extension folder) written for the last two states: a tab may still be using the older one. */
  private recent: Set<string>[] = [];

  /** @param extensionDir the unpacked extension's folder; files go in its gen/ folder */
  constructor(private readonly extensionDir: string, private readonly dir = 'gen') {}

  /** Writes a script (unless it is there already) and returns its path in the extension, such as gen/core-1a2b….js. */
  write(name: string, contents: string): string {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
    const rel = `${this.dir}/${safe}-${short(contents)}.js`;
    const file = path.join(this.extensionDir, rel);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, contents);
      fs.renameSync(tmp, file);
    }
    return rel;
  }

  /** After a state is built from `used`: removes scripts neither it nor the one before it names. */
  prune(used: Iterable<string>): void {
    this.recent = [new Set(used), ...this.recent].slice(0, 2);
    const keep = new Set(this.recent.flatMap((s) => [...s]));
    const dir = path.join(this.extensionDir, this.dir);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) if (!keep.has(`${this.dir}/${n}`)) fs.rmSync(path.join(dir, n), { force: true });
  }
}
