// Window material (glass themes). The app picks its own material and may change it; while a theme's material is
// on, the app's calls are held back and remembered, and that material is restored when the theme goes. While a
// material is on, the app's frame page (file://…main_window) has its backdrop cleared so the glass shows through.
import type { BrowserWindow, Electron, WebContents } from './electron';
import type { ViewManager } from './ViewManager';
import type { Log, SharedState } from './types';

export const FRAME_CLEAR = 'html, body, body::before, body::after { background: transparent !important; background-color: transparent !important; }';

export class WindowMaterial {
  constructor(
    private readonly electron: Electron,
    private readonly state: SharedState,
    private readonly views: ViewManager,
    private readonly log: Log,
  ) {}

  /** Replaces the window's setVibrancy with one that remembers the app's choice and enforces the theme's. */
  wrap(win: BrowserWindow): void {
    if (!win || win.isDestroyed?.() || win.__cinnamonWrapped) return;
    const proto = Object.getPrototypeOf(win) as BrowserWindow;
    if (typeof proto.setVibrancy !== 'function') return;
    win.__cinnamonWrapped = true;
    const state = this.state; // the wrapper outlives this apply: it reads the shared state only
    win.setVibrancy = function (material: string | null, ...rest: unknown[]) {
      state.appMaterials ??= new WeakMap();
      state.appMaterials.set(win, material);
      const forced = state.windowMaterial;
      return proto.setVibrancy.call(win, forced ?? material, ...rest);
    };
  }

  /** A new window gets the wrapper and, while a theme's material is on, that material. */
  onWindowCreated(win: BrowserWindow): void {
    try {
      this.state.wrapWindow?.(win);
      if (this.state.windowMaterial) (Object.getPrototypeOf(win) as BrowserWindow).setVibrancy.call(win, this.state.windowMaterial);
    } catch {}
  }

  /** Clears (or restores) the frame page's backdrop to match whether a material is on. */
  async applyFrame(wc: WebContents): Promise<void> {
    const state = this.state;
    const want = !!state.windowMaterial;
    const have = state.frameKeys.get(wc.id);
    if (want && !have) { const k = await wc.insertCSS(FRAME_CLEAR).catch(() => null); if (k) state.frameKeys.set(wc.id, k); }
    else if (!want && have) { state.frameKeys.delete(wc.id); await wc.removeInsertedCSS(have).catch(() => {}); }
  }

  /** Puts the theme's material on every window, or gives the app's own back when the theme has none. */
  async apply(): Promise<void> {
    const state = this.state;
    const want = state.theme?.window?.vibrancy ?? null;
    if (want === (state.windowMaterial ?? null)) { for (const f of this.views.frames()) await this.applyFrame(f); return; }
    const prev = state.windowMaterial ?? null;
    state.windowMaterial = want;
    let appAsked: string | null = null;
    if (!want) { // restore the app's own: what it last asked for, else what its page says it uses
      for (const wc of this.views.views()) {
        appAsked = (await wc.executeJavaScript('document.documentElement.dataset.sidebarVibrancy || null').catch(() => null)) as string | null;
        if (appAsked) break;
      }
    }
    for (const win of this.electron.BrowserWindow?.getAllWindows?.() || []) {
      try {
        this.wrap(win);
        const proto = Object.getPrototypeOf(win) as BrowserWindow;
        if (want) proto.setVibrancy.call(win, want);
        else if (prev) proto.setVibrancy.call(win, state.appMaterials?.get(win) ?? appAsked ?? null);
      } catch (e) { this.log('window material:', e); }
    }
    for (const f of this.views.frames()) await this.applyFrame(f);
  }

  /** A frame-clearing rule inserted by hand before this was built in. */
  async clearLegacyFrameKey(): Promise<void> {
    if (!this.state.frameKey) return;
    for (const f of this.views.frames()) await f.removeInsertedCSS(this.state.frameKey).catch(() => {});
    this.state.frameKey = null;
  }
}
