// Talking to Cinnamon Helper (the login item that holds the Accessibility permission): is it loaded, restart it so
// it applies again, and follow its log until it reports back. Applying through the helper means your terminal never
// needs that permission.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import type { Output } from './Output';
import { Paths } from './Paths';

const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
export const sh = (cmd: string, args: string[], opts: Parameters<typeof spawnSync>[2] = {}): SpawnSyncReturns<string> =>
  spawnSync(cmd, args, { encoding: 'utf8', ...opts }) as SpawnSyncReturns<string>;

export class HelperClient {
  constructor(private readonly paths: Paths, private readonly out: Output) {}

  /** Your Claude's main process, if it is running. */
  static claudePid(): string | null {
    return (sh('pgrep', ['-u', String(process.getuid!()), '-x', 'Claude']).stdout || '').trim().split('\n')[0] || null;
  }

  loaded(): boolean { return sh('launchctl', ['print', `gui/${process.getuid!()}/${Paths.LABEL}`]).status === 0; }

  logSize(): number { try { return fs.statSync(this.paths.logs).size; } catch { return 0; } }

  logSince(start: number): string {
    try {
      const fd = fs.openSync(this.paths.logs, 'r');
      const len = Math.max(0, fs.fstatSync(fd).size - start);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      fs.closeSync(fd);
      return buf.toString();
    } catch { return ''; }
  }

  /** Restarts the helper so it applies again to the running Claude; returns the exit code from its log. */
  applyAgain(): number {
    fs.rmSync(this.paths.applied, { force: true }); // so the helper applies again to this Claude
    const start = this.logSize();
    const k = sh('launchctl', ['kickstart', '-k', `gui/${process.getuid!()}/${Paths.LABEL}`]);
    if (k.status !== 0) return this.out.fail(`could not restart Cinnamon Helper: ${(k.stderr || '').trim()}`);
    return this.follow(start);
  }

  /** Follows the helper's log from `start` until it reports the apply it is doing. */
  follow(start: number, { notAllowedOk = false } = {}): number {
    const out = this.out;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const text = this.logSince(start);
      const done = text.match(/apply finished with status (\d+)/);
      if (done) { out.say(out.dim(text.trimEnd())); return Number(done[1]); }
      if (/Accessibility NOT allowed/.test(text)) {
        out.say(out.yellow('Cinnamon Helper is not allowed to use Accessibility yet: System Settings → Privacy & Security → Accessibility → turn on Cinnamon Helper.'));
        out.say(out.dim('It applies on its own as soon as you allow it.'));
        return notAllowedOk ? 0 : 1;
      }
      pause(400);
    }
    return out.fail('Cinnamon Helper did not report back within 2 minutes (see: cinnamon logs)');
  }
}
