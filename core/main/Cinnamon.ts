// Cinnamon in Claude's main process. To every claude.ai view, now and on every reload, it applies: the core page code
// (extension runtime + Settings rows) and CSS, the enabled extensions' page code and CSS, and the selected theme. It
// starts the enabled bundled extensions' main parts, and watches config.json, themes and extensions so changes apply
// live.
//
// Robustness: every app hook is optional and failures are caught, so a change in a future app version turns a
// feature off instead of breaking Claude. Event listeners are registered once per app run and always call through
// the shared state, so a re-apply replaces the code they run.
import path from 'node:path';
import { Config } from '../lib/Config';
import { ExtensionCatalog } from '../lib/ExtensionCatalog';
import { ThemeStore } from '../lib/ThemeStore';
import { Compiler } from './Compiler';
import type { BrowserWindow, Electron, WebContents } from './electron';
import { ExtensionHost, fingerprintOf } from './ExtensionHost';
import { FileWatcher } from './FileWatcher';
import { PageChannel } from './PageChannel';
import { SerialQueue } from './SerialQueue';
import { ThemeApplier } from './ThemeApplier';
import { ViewManager } from './ViewManager';
import { WindowMaterial } from './WindowMaterial';
import type { Load, Log, MainConfig, SharedState } from './types';

export interface ApplyResult {
  applied: number[];
  /** The claude.ai views visible now. An empty `applied` is normal when Claude's window hasn't loaded yet: every
   *  view is hooked and gets everything on its next load. */
  views: number[];
  theme: string;
  themeErrors: string[];
  extensions: string[];
  mains: string[];
}

export class Cinnamon {
  private readonly electron: Electron;
  private readonly state: SharedState;
  private readonly log: Log = (...a) => console.warn('cinnamon:', ...a); // not the "[cinnamon] " message prefix
  private readonly queue: SerialQueue;
  private readonly viewsMgr: ViewManager;
  private readonly themes: ThemeApplier;
  private readonly extensions: ExtensionHost;
  private readonly material: WindowMaterial;
  private readonly channel: PageChannel;
  private readonly watcher: FileWatcher;

  /** Synchronous: `load` (the debugger's require) is only usable until the first await. */
  constructor(load: Load, private readonly cfg: MainConfig) {
    this.electron = load('electron') as Electron;
    const themeDirs = cfg.themeDirs || [path.join(cfg.root, 'themes'), path.join(cfg.userDir, 'themes')];
    const extRoots = cfg.extRoots || { bundled: path.join(cfg.root, 'extensions'), user: path.join(cfg.userDir, 'extensions') };
    const config = new Config(path.join(cfg.userDir, 'config.json'));

    // The global's name predates Cinnamon: listeners registered by earlier versions call through it.
    const g = globalThis as unknown as { __claudeMod?: SharedState };
    const state = (g.__claudeMod ??= {} as SharedState);
    Cinnamon.retireOld(state);
    state.keys ??= new Map();
    state.themeKeys ??= new Map();
    state.themeApplied ??= new Map();
    state.extKeys ??= new Map();
    state.ran ??= new Map();
    state.dispatchHooked ??= new WeakSet();
    state.messageHooked ??= new WeakSet();
    state.mains ??= new Map();
    state.frameKeys ??= new Map();
    state.compileCache ??= new Map();
    this.state = state;

    this.queue = new SerialQueue(state, this.log);
    this.viewsMgr = new ViewManager(this.electron, state, this.log);
    this.themes = new ThemeApplier(state, new ThemeStore(themeDirs), config, this.log);
    const compiler = new Compiler(cfg.compiler, state.compileCache);
    this.extensions = new ExtensionHost(state, new ExtensionCatalog(extRoots), config, compiler, this.viewsMgr, this.electron.app, cfg.userDir, load, this.log);
    this.material = new WindowMaterial(this.electron, state, this.viewsMgr, this.log);
    this.channel = new PageChannel(this.electron, state, config, this.viewsMgr, themeDirs[themeDirs.length - 1]!, extRoots, this.log);
    this.watcher = new FileWatcher(state, themeDirs, extRoots, config.file, this.log);
  }

  /** What versions before extensions left running. */
  private static retireOld(state: SharedState): void {
    try { state.watcher?.close(); } catch {}
    if (state.timer) clearInterval(state.timer);
    if (state.debounce) clearTimeout(state.debounce);
    state.watcher = null;
    state.timer = null;
    for (const w of state.themeWatchers || []) { try { w.close(); } catch {} }
    state.themeWatchers = null;
  }

  async start(): Promise<ApplyResult> {
    const state = this.state;
    state.applyTo = (wc) => this.queue.run(() => this.applyTo(wc));
    state.hook = (wc) => this.viewsMgr.hook(wc);
    state.reloadAll = () => this.queue.run(() => this.reloadAll());
    state.setTheme = (id) => this.themes.setTheme(id);
    state.onPageMessage = (wc, args) => this.channel.handle(wc, args);
    state.wrapWindow = (win) => this.material.wrap(win);
    const app = this.electron.app;
    if (!state.dispatchListening) {
      state.dispatchListening = true;
      app.on('web-contents-created', (_e, wc) => state.hook?.(wc));
    }
    if (!state.windowListening) {
      state.windowListening = true;
      app.on('browser-window-created', (_e, win: BrowserWindow) => {
        try {
          state.wrapWindow?.(win);
          if (state.windowMaterial) (Object.getPrototypeOf(win) as BrowserWindow).setVibrancy.call(win, state.windowMaterial);
        } catch {}
      });
    }

    await this.material.clearLegacyFrameKey();
    this.extensions.stopMains();
    this.themes.load();
    await this.extensions.loadAll();
    this.extensions.startMains();
    state.windowMaterial = state.windowMaterial ?? null;
    await this.material.apply();
    this.watcher.start(() => state.reloadAll?.());

    // Fresh apply: everything is re-run in each open view.
    const applied: number[] = [];
    await this.queue.run(async () => {
      for (const wc of this.viewsMgr.all()) {
        this.viewsMgr.hook(wc);
        if (!this.viewsMgr.isTarget(wc)) continue;
        state.ran.delete(wc.id);
        state.themeApplied.delete(wc.id);
        await this.applyTo(wc);
        applied.push(wc.id);
      }
    });
    return {
      applied,
      views: this.viewsMgr.views().map((w) => w.id),
      theme: state.theme!.current,
      themeErrors: state.theme!.errors,
      extensions: [...state.extLoaded!.keys()],
      mains: [...state.mains.keys()],
    };
  }

  /** A fresh page (or the frame page): everything of ours goes in again. */
  private async applyTo(wc: WebContents): Promise<void> {
    const state = this.state;
    if (this.viewsMgr.isFrame(wc)) { state.frameKeys.delete(wc.id); return this.material.applyFrame(wc); }
    if (!this.viewsMgr.isTarget(wc)) return;
    // Nothing of ours is in a fresh page any more. (Listeners from older versions don't reset this themselves.)
    state.ran.delete(wc.id);
    state.themeApplied.delete(wc.id);
    state.extKeys.delete(wc.id);
    const old = state.keys.get(wc.id);
    state.keys.delete(wc.id);
    if (this.cfg.page.css.trim()) { const k = await wc.insertCSS(this.cfg.page.css).catch(() => null); if (k) state.keys.set(wc.id, k); }
    if (old) await wc.removeInsertedCSS(old).catch(() => {});
    await wc.executeJavaScript(this.cfg.page.js).catch(() => {});
    await this.extensions.pushPageState(wc); // settings before extension code runs
    if (await this.extensions.applyTo(wc)) { this.viewsMgr.reload(wc); return; }
    await this.themes.applyTo(wc);
    await this.extensions.pushPageState(wc);
    await this.extensions.viewReady(wc);
  }

  /** After a config / theme / extension change: theme first, then extensions (reloading views that need it). */
  private async reloadAll(): Promise<void> {
    const state = this.state;
    const before = fingerprintOf(state.extLoaded);
    this.themes.load();
    await this.extensions.loadAll();
    const extChanged = before !== fingerprintOf(state.extLoaded);
    if (extChanged) { this.extensions.stopMains(); this.extensions.startMains(); }
    await this.material.apply();
    for (const wc of this.viewsMgr.views()) {
      await this.themes.applyTo(wc);
      if (extChanged && await this.extensions.applyTo(wc)) { this.viewsMgr.reload(wc); continue; }
      await this.extensions.pushPageState(wc);
      if (extChanged) await this.extensions.viewReady(wc);
    }
  }
}
