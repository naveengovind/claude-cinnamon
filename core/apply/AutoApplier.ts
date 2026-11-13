// What Cinnamon Helper runs each time Claude starts (with Claude's pid): takes the apply lock (waiting for an apply
// already running), skips a Claude process that already has Cinnamon, else applies with the lock held.
import fs from 'node:fs';
import path from 'node:path';
import type { Applier } from './Applier';
import { LockFile } from './LockFile';
import type { System } from './System';

const now = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export class AutoApplier {
  constructor(private readonly sys: System, private readonly applier: Applier, private readonly stateDir: string, private readonly lockWait = 90) {}

  async run(pid: string): Promise<number> {
    const { sys } = this;
    const lock = new LockFile(path.join(this.stateDir, 'apply.lock'), (ms) => sys.sleep(ms));
    if (!(await lock.acquire(this.lockWait))) {
      sys.log(`${now()} another apply is still running (pid ${lock.holder}); giving up for Claude pid ${pid}`);
      return 0;
    }
    try {
      let marker = '';
      try { marker = fs.readFileSync(path.join(this.stateDir, 'applied'), 'utf8').trim(); } catch {}
      if (marker === this.applier.stamp(pid)) return 0;
      sys.log(`${now()} applying to Claude (pid ${pid})`);
      const status = await this.applier.run({ lockHeld: true });
      sys.log(`${now()} apply finished with status ${status}`);
      return status;
    } finally {
      lock.release();
    }
  }
}
