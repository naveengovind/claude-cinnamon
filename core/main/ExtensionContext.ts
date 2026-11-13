// The `ctx` a bundled extension's main part gets in activate(ctx). Everything it starts through ctx (timers,
// watchers) is stopped when the extension stops, and every callback is guarded so a failure is logged, never thrown
// into Claude. The members are own properties (not prototype methods) so they can be passed around unbound.
import fs from 'node:fs';
import path from 'node:path';
import type { WebContents } from './electron';
import type { Log } from './types';

type Timer = ReturnType<typeof setTimeout>;
type Callback = (...args: any[]) => unknown;

export class ExtensionContext {
  readonly dataDir: string;
  readonly _ready: Callback[] = [];
  private readonly timers = new Set<Timer>();
  private readonly watchers: fs.FSWatcher[] = [];

  constructor(
    readonly id: string,
    userDir: string,
    readonly appDataDir: string,
    readonly views: () => WebContents[],
    private readonly logger: Log,
  ) {
    this.dataDir = path.join(userDir, 'data', id);
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch {}
  }

  private readonly guard = (fn: Callback): Callback => (...a: unknown[]) => {
    try { return Promise.resolve(fn(...a)).catch((e) => this.logger(this.id, e)); } catch (e) { this.logger(this.id, e); }
  };

  /** Runs page code in a view; resolves to undefined if the view is gone or the code throws. */
  readonly run = (wc: WebContents, js: string): Promise<unknown> => wc.executeJavaScript(js).catch(() => undefined);
  /** Called with each claude.ai view once Cinnamon has applied to it (at start and after each load). */
  readonly onViewReady = (fn: Callback): void => { this._ready.push(this.guard(fn)); };
  readonly setInterval = (fn: Callback, ms: number): Timer => { const t = setInterval(this.guard(fn), ms); this.timers.add(t); return t; };
  readonly setTimeout = (fn: Callback, ms: number): Timer => { const t = setTimeout(this.guard(fn), ms); this.timers.add(t); return t; };
  readonly clearTimer = (t: Timer): void => { clearInterval(t); clearTimeout(t); this.timers.delete(t); };
  readonly watch = (p: string, opts: fs.WatchOptions, fn: Callback): fs.FSWatcher | null => {
    try { const w = fs.watch(p, opts, this.guard(fn)); w.on('error', () => {}); this.watchers.push(w); return w; } catch { return null; }
  };
  readonly log = (...a: unknown[]): void => { this.logger(this.id, ...a); };
  readonly _cleanup = (): void => {
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    this.timers.clear();
    for (const w of this.watchers) { try { w.close(); } catch {} }
  };
}
