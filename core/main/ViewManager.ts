// Claude's web contents: the claude.ai views Cinnamon applies to, the app's own frame page behind them, the
// listeners each one gets (once per app run), and the reload throttle.
import type { Electron, WebContents } from './electron';
import type { Log, SharedState } from './types';

const RELOAD_EVERY_MS = 10_000;

export class ViewManager {
  constructor(private readonly electron: Electron, private readonly state: SharedState, private readonly log: Log) {
    state.lastReload ??= new Map();
  }

  /** A claude.ai view. */
  isTarget(wc: WebContents): boolean {
    return !wc.isDestroyed() && /^https:\/\/claude\.ai\//.test(wc.getURL());
  }

  /** The app's own window page (behind the claude.ai view): it paints a solid backdrop behind the chat area. */
  isFrame(wc: WebContents): boolean {
    return !wc.isDestroyed() && /^file:\/\/.*main_window/.test(wc.getURL());
  }

  all(): WebContents[] { return this.electron.webContents.getAllWebContents(); }
  views(): WebContents[] { return this.all().filter((wc) => this.isTarget(wc)); }
  frames(): WebContents[] { return this.all().filter((wc) => this.isFrame(wc)); }

  /** At most one reload per view every 10 s, so a page that keeps asking for one can't loop. */
  reload(wc: WebContents): void {
    const now = Date.now();
    if (now - (this.state.lastReload.get(wc.id) || 0) < RELOAD_EVERY_MS) { this.log('skipped a reload (one per 10s)'); return; }
    this.state.lastReload.set(wc.id, now);
    wc.reload();
  }

  /**
   * Listens to a view's loads and page messages. The listeners call through the shared state, so later applies
   * replace what they run; each is added once per view (views hooked by an older version still get the page-message
   * listener, which has its own guard).
   */
  hook(wc: WebContents): void {
    const state = this.state;
    const id = wc.id;
    if (!state.dispatchHooked.has(wc)) {
      state.dispatchHooked.add(wc);
      const forget = () => { state.frameKeys?.delete(id); state.keys.delete(id); state.themeKeys.delete(id); state.themeApplied?.delete(id); state.extKeys?.delete(id); state.ran?.delete(id); };
      wc.on('dom-ready', () => { forget(); Promise.resolve(state.applyTo?.(wc)).catch(() => {}); });
      wc.on('destroyed', forget);
    }
    if (!state.messageHooked.has(wc)) {
      state.messageHooked.add(wc);
      wc.on('console-message', (...args: unknown[]) => { Promise.resolve(state.onPageMessage?.(wc, args)).catch(() => {}); });
    }
  }
}
