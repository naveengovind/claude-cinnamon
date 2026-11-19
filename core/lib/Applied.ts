// Whether Cinnamon is on in a running Claude. Two records, both in <your folder>/state/:
//   applied — "<pid> <start time>", written by the apply when it finishes (removed by `cinnamon install`, so the
//             helper applies the new version again)
//   live    — "<pid>", written by Cinnamon's own code inside Claude when it starts: it stays true while that Claude
//             runs, whatever happened to the marker
import fs from 'node:fs';
import path from 'node:path';

const firstWord = (file: string): string | null => {
  try { return fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0] || null; } catch { return null; }
};

export function isApplied(userDir: string, claudePid: string | null): boolean {
  if (!claudePid) return false;
  const state = path.join(userDir, 'state');
  return firstWord(path.join(state, 'applied')) === claudePid || firstWord(path.join(state, 'live')) === claudePid;
}

/** Called inside Claude's main process once Cinnamon is running there. */
export function markLive(userDir: string, pid = (globalThis as { process?: { pid?: number } }).process?.pid): void {
  if (!pid) return;
  try {
    const dir = path.join(userDir, 'state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'live'), `${pid}\n`);
  } catch {}
}
