// Who has Cinnamon running right now, for `cinnamon status` and the menu bar app.
//   Claude:      core/lib/Applied.ts (state/live, written by Cinnamon inside Claude)
//   a browser:   state/presence/browser-<id>.json, written by the connection process (`cinnamon browser-host`) that
//                the browser starts for the extension. It knows the browser from its parent process, records the
//                first and the latest connection, and holds its own pid while the extension is connected; the
//                browser ends that process when the extension disconnects (or sleeps with no claude.ai tab open).
import fs from 'node:fs';
import path from 'node:path';

export interface BrowserPresence {
  /** The connection process while connected; null after it ended. */
  pid: number | null;
  firstConnected: string;
  lastConnected: string;
  extensionVersion: string | null;
}

/** What `status --json` says about one browser. */
export type BrowserLink = 'connected' | 'idle' | 'never';

export const isAlive = (pid: number | null | undefined): boolean => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

export class Presence {
  constructor(private readonly userDir: string) {}

  private file(id: string): string { return path.join(this.userDir, 'state', 'presence', `browser-${id}.json`); }

  read(id: string): BrowserPresence | null {
    try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as BrowserPresence; } catch { return null; }
  }

  /** connected: its connection process is running now; idle: it connected before (the extension is loaded). */
  link(id: string): BrowserLink {
    const p = this.read(id);
    if (!p) return 'never';
    return isAlive(p.pid) ? 'connected' : 'idle';
  }

  connected(id: string, extensionVersion: string | null, pid = process.pid, now = new Date()): void {
    const prev = this.read(id);
    this.write(id, { pid, firstConnected: prev?.firstConnected ?? now.toISOString(), lastConnected: now.toISOString(), extensionVersion });
  }

  disconnected(id: string, pid = process.pid): void {
    const prev = this.read(id);
    if (prev && prev.pid === pid) this.write(id, { ...prev, pid: null });
  }

  forget(id: string): void { fs.rmSync(this.file(id), { force: true }); }

  private write(id: string, p: BrowserPresence): void {
    const f = this.file(id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(p)}\n`);
    fs.renameSync(`${f}.tmp`, f);
  }

  /** The browser whose app a process path belongs to (`…/Arc.app/Contents/MacOS/Arc` → arc). */
  static browserOf(command: string, browsers: readonly { id: string; app: string }[]): string | null {
    return browsers.find((b) => command.includes(`/${b.app}.app/`))?.id ?? null;
  }
}
