// Applies Cinnamon to the running Claude: Cinnamon Helper presses Claude's own Developer > Enable Main Process
// Debugger (Developer Mode must be on), the bundled main-process script is evaluated through the debugger, and the
// debugger is turned off again — even if applying fails — unless `keep`. Turning the debugger on makes Claude open
// chrome://inspect in Google Chrome; that tab is closed as soon as it appears and the previous app is brought back.
// Only one apply runs at a time (state/apply.lock); a caller that already holds the lock passes `lockHeld`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InspectorClient } from '../InspectorClient';
import { renderMain } from '../render';
import { LockFile } from './LockFile';
import type { System } from './System';

export const PORT = 9229;
/** Closes Claude's inspector and clears the menu's checkmark (Claude only updates it when the item is clicked). */
export const CLOSE_JS = `require('inspector').close();
try {
  const walk = (m) => m && m.items.forEach((i) => { if (i.label === 'Enable Main Process Debugger') i.checked = false; walk(i.submenu); });
  walk(require('electron').Menu.getApplicationMenu());
} catch {}
'closed'`;

export interface ApplierDeps {
  /** The script to evaluate in Claude's main process. */
  render(): Promise<string>;
  /** Evaluates code in Claude's main process; resolves to its value, rejects on an exception or time-out. */
  evaluate(code: string): Promise<unknown>;
  /** Plain JavaScript of core/apply/chrome-tab.ts, as a file osascript can run. */
  chromeScript(): string;
}

export interface ApplierOptions {
  root: string;
  stateDir: string;
  pressTimeout?: number;
  lockWait?: number;
}

export class Applier {
  constructor(private readonly sys: System, private readonly opts: ApplierOptions, private readonly deps: ApplierDeps = Applier.defaultDeps(opts.root)) {}

  static defaultDeps(root: string): ApplierDeps {
    let chrome: string | null = null;
    return {
      render: () => renderMain({ root }),
      evaluate: (code) => new InspectorClient(PORT).evaluate(code),
      chromeScript: () => {
        if (chrome) return chrome;
        const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(fs.readFileSync(path.join(root, 'core', 'apply', 'chrome-tab.ts'), 'utf8'));
        chrome = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cinnamon-')), 'chrome-tab.js');
        fs.writeFileSync(chrome, js);
        return chrome;
      },
    };
  }

  /** The marker of which Claude process has Cinnamon: "<pid> <start time>". */
  stamp(pid: string): string { return `${pid} ${this.sys.lstart(pid)}`.trim(); }
  get markerFile(): string { return path.join(this.opts.stateDir, 'applied'); }

  async run({ keep = false, lockHeld = false } = {}): Promise<number> {
    const { sys } = this;
    const claude = sys.claudePid();
    if (!claude) { sys.log('Claude is not running'); return 1; }
    const lock = lockHeld ? null : new LockFile(path.join(this.opts.stateDir, 'apply.lock'), (ms) => sys.sleep(ms));
    if (lock && !(await lock.acquire(this.opts.lockWait ?? 90))) {
      sys.log(`Another apply is still running (pid ${lock.holder}); try again in a moment.`);
      return 1;
    }
    let closer: Promise<void> | null = null;
    try {
      let owner = sys.listener(PORT);
      if (owner && owner !== claude) {
        sys.log(`Port ${PORT} is in use by another process (pid ${owner}), not Claude (pid ${claude}); not applying.`);
        return 1;
      }
      try {
        if (!owner) {
          if (!sys.helperExists()) { sys.log("Cinnamon Helper isn't built yet; run: cinnamon install"); return 1; }
          const chrome = this.deps.chromeScript();
          const snapshot = sys.osascript(['-l', 'JavaScript', chrome, 'snapshot']);
          const front = sys.helper(['front']).stdout.trim();
          const press = sys.helper(['press', claude, '--timeout', String(this.opts.pressTimeout ?? 60)]);
          if (press.status !== 0) return press.status;
          closer = (async () => {
            sys.log(`chrome: ${await sys.osascriptAsync(['-l', 'JavaScript', chrome, 'cleanup', snapshot])}`);
            if (front) sys.helper(['activate', front]);
          })();
          if (front) sys.log(`front app before the press: pid ${front}`);
          for (let i = 0; i < 40; i++) { owner = sys.listener(PORT); if (owner) break; await sys.sleep(250); }
          if (owner !== claude) { sys.log(`Claude's debugger did not come up on port ${PORT} (listener: ${owner || 'none'}).`); return 1; }
        }
        let value: unknown;
        try { value = await this.deps.evaluate(await this.deps.render()); }
        catch (e) { sys.log(String((e as Error).message || e)); return 1; }
        sys.log(JSON.stringify(value, null, 1));
        fs.mkdirSync(this.opts.stateDir, { recursive: true });
        fs.writeFileSync(this.markerFile, `${this.stamp(claude)}\n`);
        return 0;
      } finally {
        // only ever close Claude's own inspector — first, so it is never left on while waiting for anything else
        if (!keep && sys.listener(PORT) === claude) await this.deps.evaluate(CLOSE_JS).catch(() => {});
        if (closer) await closer;
      }
    } finally {
      lock?.release();
    }
  }
}
