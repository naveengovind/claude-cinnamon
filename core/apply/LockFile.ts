// One apply at a time: a lock folder (state/apply.lock) holding the owner's pid. A lock left by a run that died is
// taken over.
import fs from 'node:fs';
import path from 'node:path';

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

export class LockFile {
  holder: string | null = null;
  private held = false;

  constructor(readonly dir: string, private readonly sleep: (ms: number) => Promise<void>) {}

  /** Takes the lock, waiting up to `waitSeconds` for another run; false if it is still busy. */
  async acquire(waitSeconds: number): Promise<boolean> {
    fs.mkdirSync(path.dirname(this.dir), { recursive: true });
    let waited = 0;
    for (;;) {
      try { fs.mkdirSync(this.dir); break; } catch {}
      let holder = '';
      try { holder = fs.readFileSync(path.join(this.dir, 'pid'), 'utf8').trim(); } catch {}
      this.holder = holder || null;
      if (!holder || !alive(Number(holder))) { fs.rmSync(this.dir, { recursive: true, force: true }); continue; }
      if (waited >= waitSeconds) return false;
      await this.sleep(1000);
      waited++;
    }
    fs.writeFileSync(path.join(this.dir, 'pid'), String(process.pid));
    this.held = true;
    return true;
  }

  release(): void {
    if (this.held) fs.rmSync(this.dir, { recursive: true, force: true });
    this.held = false;
  }
}
