// Applies Cinnamon to the running Claude: Cinnamon Helper presses Claude's own Developer > Enable Main Process
// Debugger (Developer Mode must be on), the bundled main-process script is evaluated through the debugger, and the
// debugger is turned off again — even if applying fails — unless `keep`. Turning the debugger on makes Claude open
// chrome://inspect in Google Chrome; Cinnamon Helper closes that tab as soon as it appears (with Accessibility, the
// permission it already has: no Automation), and the previous app is brought back. In `manual` mode (no Accessibility) nothing is pressed: it waits for you to turn the debugger on.
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

/** Answers at once unless Claude's main thread is held up (a modal dialog). */
export const PING_JS = '1';

export interface ApplierDeps {
  /** The script to evaluate in Claude's main process. */
  render(): Promise<string>;
  /** Evaluates code in Claude's main process; resolves to its value, rejects on an exception or time-out. */
  evaluate(code: string): Promise<unknown>;
}

export interface ApplierOptions {
  root: string;
  stateDir: string;
  pressTimeout?: number;
  lockWait?: number;
  /** No Accessibility: nothing is pressed; Cinnamon waits for you to choose Developer → Enable Main Process Debugger. */
  manual?: boolean;
  /** Seconds manual mode waits for that, at most (default a day; it stops when Claude quits). */
  manualWait?: number;
  /** How many debugger time-outs (30 s each) to wait through for Claude to answer (default 10). */
  readyTries?: number;
  /** Close the chrome://inspect tab Claude opens (Cinnamon Helper does it with Accessibility). On unless false. */
  closeChromeTab?: boolean;
}

/** What manual mode asks you to do, in the log (and so in `cinnamon apply`). */
export const MANUAL_ASK = "waiting for you: in Claude, choose Developer → Enable Main Process Debugger";

export class Applier {
  constructor(private readonly sys: System, private readonly opts: ApplierOptions, private readonly deps: ApplierDeps = Applier.defaultDeps(opts.root)) {}

  static defaultDeps(root: string): ApplierDeps {
    return {
      render: () => renderMain({ root }),
      evaluate: (code) => new InspectorClient(PORT).evaluate(code),
    };
  }

  /** `cinnamon-helper inspect-tabs` output: is Chrome running, and its chrome://inspect tab count (-1: unknown). */
  static inspectTabs(out: string): { running: boolean; count: number } | null {
    try {
      const v = JSON.parse(out) as { running?: unknown; count?: unknown };
      return typeof v.running === 'boolean' && typeof v.count === 'number' ? { running: v.running, count: v.count } : null;
    } catch { return null; }
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
          if (this.opts.manual) {
            sys.log(MANUAL_ASK);
            const tries = Math.ceil((this.opts.manualWait ?? 24 * 3600) * 2);
            for (let i = 0; i < tries && !owner; i++) {
              await sys.sleep(500);
              if (sys.claudePid() !== claude) { sys.log('Claude quit before its debugger was turned on.'); return 1; }
              owner = sys.listener(PORT);
            }
            if (!owner) { sys.log("Claude's debugger was not turned on; Cinnamon applies the next time you turn it on (or run: cinnamon apply)."); return 1; }
            // without Accessibility nothing closes the chrome://inspect tab Claude opens
          } else {
            if (!sys.helperExists()) { sys.log("Cinnamon Helper isn't built yet; run: cinnamon install"); return 1; }
            // what Chrome has before the press, so only the tab Claude opens is closed (and Chrome quit only if Claude started it)
            const chrome = this.opts.closeChromeTab === false ? null : Applier.inspectTabs(sys.helper(['inspect-tabs']).stdout);
            const front = sys.helper(['front']).stdout.trim();
            const press = sys.helper(['press', claude, '--timeout', String(this.opts.pressTimeout ?? 60)]);
            if (press.status !== 0) return press.status;
            closer = (async () => {
              if (chrome && chrome.count >= 0) {
                const r = await sys.helperAsync(['close-inspect-tab', '--known', String(chrome.count), '--claude', claude, ...(chrome.running ? [] : ['--launched'])]);
                sys.log(`chrome: ${r.stdout.trim() || `exit ${r.status}`}`);
              }
              if (front) sys.helper(['activate', front]);
            })();
            if (front) sys.log(`front app before the press: pid ${front}`);
            for (let i = 0; i < 40; i++) { owner = sys.listener(PORT); if (owner) break; await sys.sleep(250); }
          }
          if (owner !== claude) { sys.log(`Claude's debugger did not come up on port ${PORT} (listener: ${owner || 'none'}).`); return 1; }
        }
        // Without Google Chrome, Claude shows "Inspector session is active" instead of opening the tab; its main process
        // may not answer until that dialog is closed. Wait for it rather than give up.
        let ready = false;
        for (let i = 0; i < (this.opts.readyTries ?? 10) && !ready; i++) {
          try { await this.deps.evaluate(PING_JS); ready = true; }
          catch (e) {
            if (i === 0) sys.log(`Claude isn't answering yet (${String((e as Error).message || e)}). If it shows "Inspector session is active", click OK.`);
          }
        }
        if (!ready) { sys.log("Claude's main process never answered through its debugger."); return 1; }
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
