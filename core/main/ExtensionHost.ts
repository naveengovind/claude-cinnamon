// Extensions in the main process: loads the enabled ones (reading or compiling their files), puts their css and page
// code into each claude.ai view, and starts/stops the main parts of bundled ones.
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import type { Config } from '../lib/Config';
import { ExtensionCatalog, type ExtensionEntry } from '../lib/ExtensionCatalog';
import type { Compiler } from './Compiler';
import type { App, WebContents } from './electron';
import { ExtensionContext } from './ExtensionContext';
import type { ViewManager } from './ViewManager';
import type { ExtensionInstance, ExtSummary, Load, LoadedExt, Log, SharedState } from './types';

export const hash = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
const signature = (page: string[]): string => `${page.join('\n/*--*/\n').length}:${hash(page.join('\n'))}`;
/** What tells whether a re-load changed an extension: its page code, its css and its main part. */
export const fingerprintOf = (loaded: Map<string, LoadedExt> | undefined): string =>
  [...(loaded || new Map<string, LoadedExt>())].map(([id, l]) => `${id}:${l.sig}:${l.cssSig}:${l.main || ''}`).join('|');

// Page code runs with its own `cinnamon` api, after its old listeners are dropped; a failure stays inside it.
const wrap = (id: string, code: string): string => `(() => { const cinnamon = window.__cinnamon.api(${JSON.stringify(id)}); window.__cinnamon.reset(${JSON.stringify(id)});
try {
${code}
} catch (e) { console.warn('cinnamon: extension ' + ${JSON.stringify(id)} + ' failed', e); } })();`;

export class ExtensionHost {
  constructor(
    private readonly state: SharedState,
    private readonly catalog: ExtensionCatalog,
    private readonly config: Config,
    private readonly compiler: Compiler,
    private readonly views: ViewManager,
    private readonly app: App,
    private readonly userDir: string,
    private readonly load: Load,
    private readonly log: Log,
  ) {}

  /** Reads the enabled extensions (compiling TypeScript), then swaps them in all at once. */
  async loadAll(): Promise<void> {
    const cfg = this.config.read();
    const list = this.catalog.list();
    const extList: ExtSummary[] = list.map((e) => ({ id: e.id, name: e.name, description: e.description, bundled: e.bundled, enabled: ExtensionCatalog.isEnabled(e, cfg), ...(e.error ? { error: e.error } : {}) }));
    const extLoaded = new Map<string, LoadedExt>();
    for (const e of list) {
      if (e.error) { this.log(`extension ${e.id}:`, e.error); continue; }
      if (!ExtensionCatalog.isEnabled(e, cfg)) continue;
      const l = await this.loadOne(e);
      for (const err of l.errors) this.log(err);
      extLoaded.set(e.id, l);
    }
    this.state.extList = extList;
    this.state.extLoaded = extLoaded;
    this.state.settings = cfg.settings && typeof cfg.settings === 'object' && !Array.isArray(cfg.settings) ? cfg.settings as Record<string, unknown> : {};
  }

  private async loadOne(e: ExtensionEntry): Promise<LoadedExt> {
    const files = ExtensionCatalog.files(e);
    const errors = [...files.errors];
    const read = async (kind: 'page' | 'css', file: string): Promise<string | null> => {
      try { return await this.compiler.load(file, kind === 'css' ? 'page' : kind, e.dir); }
      catch (err) { errors.push(`${e.id}: ${kind} file ${path.relative(e.dir, file)} ${(err as Error).message || err}`); return null; }
    };
    const page: string[] = [];
    const css: string[] = [];
    for (const f of files.page) { const code = await read('page', f); if (code !== null) page.push(code); }
    for (const f of files.css) { const text = await read('css', f); if (text !== null) css.push(text); }
    let main = files.main;
    let mainCode: string | null = null;
    if (main && main.endsWith('.ts')) {
      try { mainCode = await this.compiler.load(main, 'main', e.dir); }
      catch (err) { errors.push(`${e.id}: main file ${path.relative(e.dir, main)} ${(err as Error).message || err}`); main = null; }
    }
    return { page, css, main, mainCode, errors, sig: signature(page), cssSig: hash(css.join('\n/*--*/\n')) };
  }

  /** The current theme list, extension list and settings, for the page's Settings rows and extension runtime. */
  async pushPageState(wc: WebContents): Promise<void> {
    const state = this.state;
    const data = JSON.stringify({ current: state.theme!.current, themes: state.theme!.themes });
    const js = `(() => { window.__cinnamon?.setSettings(${JSON.stringify(state.settings)}); window.__cmSetThemes?.(${data}); window.__cmSetExtensions?.(${JSON.stringify(state.extList)}); return true; })()`;
    await wc.executeJavaScript(js).catch(() => {});
  }

  /**
   * Runs page code of enabled extensions not yet run in this view and swaps in their css; returns true if the view
   * needs a reload instead (an extension was turned off, or its code changed: page code can't be un-run).
   */
  async applyTo(wc: WebContents): Promise<boolean> {
    const state = this.state;
    const loaded = state.extLoaded!;
    const ran = state.ran.get(wc.id) || new Map<string, string>();
    state.ran.set(wc.id, ran);
    for (const [id, sig] of ran) {
      const l = loaded.get(id);
      if (!l || l.sig !== sig) return true;
    }
    const had = state.extKeys.get(wc.id) || new Map<string, string[]>();
    const next = new Map<string, string[]>();
    for (const [id, l] of loaded) {
      const keys: string[] = [];
      for (const css of l.css) { const k = await wc.insertCSS(css).catch(() => null); if (k) keys.push(k); }
      next.set(id, keys);
      if (!ran.has(id) && l.page.length) { // css-only extensions are never recorded, so turning them off needs no reload
        for (const code of l.page) await wc.executeJavaScript(wrap(id, code)).catch(() => {});
        ran.set(id, l.sig);
      }
    }
    state.extKeys.set(wc.id, next);
    for (const keys of had.values()) for (const k of keys) await wc.removeInsertedCSS(k).catch(() => {});
    return false;
  }

  stopMains(): void {
    for (const [id, m] of this.state.mains) {
      try { m.instance?.deactivate?.(); } catch (e) { this.log(`extension ${id} stop:`, e); }
      try { m.ctx._cleanup(); } catch {}
    }
    this.state.mains.clear();
  }

  startMains(): void {
    for (const [id, l] of this.state.extLoaded!) {
      if (!l.main) continue;
      const ctx = new ExtensionContext(id, this.userDir, this.app.getPath('userData'), () => this.views.views(), this.log);
      try {
        const mod = l.mainCode === null ? this.require(l.main) : this.evaluate(l.main, l.mainCode);
        const api = (mod?.activate ? mod : mod?.default) as { activate?(ctx: ExtensionContext): ExtensionInstance } | undefined;
        const instance = api?.activate?.(ctx) || {};
        this.state.mains.set(id, { instance, ctx });
      } catch (e) { this.log(`extension ${id} failed to start:`, e); ctx._cleanup(); }
    }
  }

  /** Tells the main parts a view is ready (after Cinnamon applied to it). */
  async viewReady(wc: WebContents): Promise<void> {
    for (const { ctx } of this.state.mains.values()) for (const fn of ctx._ready) await fn(wc);
  }

  // A .cjs main part: a fresh copy through the debugger's require each time it starts.
  private require(file: string): any {
    delete this.load.cache[file];
    return this.load(file);
  }

  // A compiled (TypeScript) main part: run as a CommonJS module of the main process, requiring from its own folder.
  private evaluate(file: string, code: string): any {
    const fn = vm.runInThisContext(`(function (exports, require, module, __filename, __dirname) {${code}\n})`, { filename: file }) as
      (exports: unknown, require: NodeJS.Require, module: { exports: unknown }, filename: string, dirname: string) => void;
    const module = { exports: {} as unknown };
    fn.call(module.exports, module.exports, createRequire(file), module, file, path.dirname(file));
    return module.exports;
  }
}
