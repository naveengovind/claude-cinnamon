// Cinnamon page runtime: the small API every extension's page code gets as `cinnamon`. Runs in the claude.ai page
// before any extension. Messages go to the main process as console messages prefixed "[cinnamon] " (in a browser,
// through the Cinnamon extension instead: core/browser/page.ts).
//   cinnamon.send(type, data)           → the extension's main part (bundled extensions) receives it
//   cinnamon.settings.get(key) / .set(key, value) / .all() / .onChange(fn)
//                                        → per-extension settings, saved in ~/.config/claude-cinnamon/config.json
//   cinnamon.onDispose(fn)              → clean-up (observers, timers, listeners, added elements). An extension that
//                                         registers any is hot-reloaded: when its code changes or it is turned off,
//                                         Cinnamon runs these and swaps it in place instead of reloading the window.
// Loading it again (each apply) keeps the settings and listeners it had.
//
// It also hands the Code tab's colors over to Claude Code's theme API (see core/lib/CodeTabLook.ts): when the app
// paints a mod palette (data-cds-theme="mod-palette" on the root) and that palette is the current look, the root gets
// data-cinnamon-code-tab="mod" and Cinnamon's theme colors step aside there. A palette that isn't the current look
// (an older one the app still holds, say while only SSH sessions are open) gets no mark, so Cinnamon paints over it.
// The palette is recognized by a few of the app's gray-scale variables, which Cinnamon's own CSS never sets.

type Settings = Record<string, unknown>;
/** Per mode: app variable → the value the current look gives it. */
type LookPrint = Partial<Record<'dark' | 'light', Record<string, string>>>;
type Listener = (settings: Settings) => void;
type Disposer = () => void;
/** What dispose returns when it took an extension out (anything else: the window must be reloaded). */
const DISPOSED = 'cinnamon:disposed';

interface PageWindow { __cinnamon?: CinnamonRuntime; __cmLookWatch?: { observer: MutationObserver; timer: number } }
const page = window as unknown as PageWindow;
/** Always the runtime loaded most recently, so api objects handed out earlier never use a stale one. */
const current = (): CinnamonRuntime => page.__cinnamon!;

class ExtensionSettings {
  constructor(private readonly id: string) {}
  get(key: string): unknown { return (current().settings[this.id] || {})[key]; }
  all(): Settings { return { ...(current().settings[this.id] || {}) }; }
  set(key: string, value: unknown): void {
    const rt = current();
    (rt.settings[this.id] ??= {})[key] = value;
    rt.send({ type: 'ext-setting', ext: this.id, key, value });
    rt.notify(this.id);
  }
  onChange(fn: Listener): void { if (typeof fn === 'function') (current().listeners[this.id] ??= []).push(fn); }
}

class ExtensionApi {
  readonly settings: ExtensionSettings;
  constructor(readonly id: string) { this.settings = new ExtensionSettings(id); }
  send(msg: string, data?: unknown): void { current().send({ type: 'ext', ext: this.id, msg, data }); }
  onDispose(fn: Disposer): void { if (typeof fn === 'function') (current().disposers[this.id] ??= []).push(fn); }
}

const MOD_PALETTE = 'mod-palette';
const MARK = 'data-cinnamon-code-tab';
const norm = (v: string): string => v.trim().toLowerCase();

class CinnamonRuntime {
  settings: Record<string, Settings>;
  listeners: Record<string, Listener[]>;
  disposers: Record<string, Disposer[]>;
  look: LookPrint | null;

  constructor(previous?: Partial<CinnamonRuntime>) {
    this.settings = previous?.settings ?? {};
    this.listeners = previous?.listeners ?? {};
    this.disposers = previous?.disposers ?? {};
    this.look = previous?.look ?? null;
  }

  /** The current look's print (null: the theme has none, so Cinnamon paints the Code tab too). */
  setLook(print: unknown): void {
    this.look = print && typeof print === 'object' ? (print as LookPrint) : null;
    CinnamonRuntime.watchLook();
    this.checkLook();
  }

  /** Whether the app paints the current look right now; marks the root for Cinnamon's theme CSS. */
  checkLook(): void {
    try {
      const root = document.documentElement;
      let mark = false;
      if (this.look && root.getAttribute('data-cds-theme') === MOD_PALETTE) {
        const m = root.getAttribute('data-mode');
        const mode = m === 'light' || m === 'dark' ? m : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const print = this.look[mode];
        if (print && Object.keys(print).length) {
          const cs = getComputedStyle(root);
          mark = Object.entries(print).every(([name, value]) => norm(cs.getPropertyValue(name)) === norm(value));
        }
      }
      if (mark) { if (root.getAttribute(MARK) !== 'mod') root.setAttribute(MARK, 'mod'); }
      else if (root.hasAttribute(MARK)) root.removeAttribute(MARK);
    } catch {}
  }

  /** Re-checks when the app changes the root (theme, mode) and, for palette changes it makes in place, every second. */
  private static watchLook(): void {
    if (page.__cmLookWatch) return;
    const check = () => current().checkLook();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-cds-theme', 'data-mode', 'style'] });
    page.__cmLookWatch = { observer, timer: window.setInterval(check, 1000) };
  }

  /** To Cinnamon: through the browser extension's channel on claude.ai in a browser (core/browser/page.ts), else as a
   *  console message the desktop app's main process reads. */
  send(msg: unknown): void {
    try {
      const viaBrowser = (window as unknown as { __cinnamonSend?: (m: unknown) => void }).__cinnamonSend;
      if (typeof viaBrowser === 'function') viaBrowser(msg);
      else console.debug(`[cinnamon] ${JSON.stringify(msg)}`);
    } catch {}
  }

  notify(id: string): void {
    for (const fn of this.listeners[id] || []) { try { fn({ ...(this.settings[id] || {}) }); } catch {} }
  }

  setSettings(all: unknown): void {
    this.settings = all && typeof all === 'object' ? (all as Record<string, Settings>) : {};
    for (const id of Object.keys(this.listeners)) this.notify(id);
  }

  reset(id: string): void { this.listeners[id] = []; }

  /**
   * Takes an extension's page code out: runs its clean-up, newest first, and forgets its listeners. Only for an
   * extension that registered clean-up (returns DISPOSED); otherwise false, and Cinnamon reloads the window.
   */
  dispose(id: string): string | false {
    const fns = this.disposers[id] || [];
    if (!fns.length) return false;
    delete this.disposers[id];
    for (const fn of [...fns].reverse()) { try { fn(); } catch (e) { console.warn(`cinnamon: extension ${id} clean-up failed`, e); } }
    this.listeners[id] = [];
    return DISPOSED;
  }

  api(id: string): ExtensionApi { return new ExtensionApi(id); }
}

page.__cinnamon = new CinnamonRuntime(page.__cinnamon);

export {}; // a module: its names stay its own (Bun wraps it for the page)
