// `cinnamon browser-host`: the program Chrome starts for the Cinnamon extension (native messaging). It reads the same
// config.json, themes and extensions as the desktop app, sends the extension everything to put into claude.ai (the
// core page code, the theme's CSS, the enabled extensions' page code and CSS, settings), sends it again whenever a file
// changes, and saves what the page asks for (a theme pick, an extension switched on or off, a setting). The desktop
// app, if it is running, picks the same changes up from the same files.
//
// In a browser there is no main process: an extension with a main part (the sidebar cards) is listed as desktop-only,
// and a theme with a window material (Glass) gets a dark ground behind its see-through panels instead.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Config } from '../lib/Config';
import { ExtensionCatalog, type ExtensionRoots } from '../lib/ExtensionCatalog';
import { ThemeStore } from '../lib/ThemeStore';
import { Compiler } from '../main/Compiler';
import { signature, wrap } from '../main/ExtensionHost';
import { FileWatcher } from '../main/FileWatcher';
import type { CompiledEntry, SharedState } from '../main/types';
import { GEN_DIR } from './BrowserSetup';
import { coreScript, extensionScript, GenFiles } from './GenFiles';
import { Decoder, framesFor } from './NativeMessaging';
import type { HostState, ToHost, WebExtension, WebExtSummary } from './protocol';

const VALID_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SETTING_BYTES = 20_000;
/** Shown for an extension that needs Claude's main process. */
export const DESKTOP_ONLY = 'desktop app only';
/**
 * Behind a theme made to be see-through over a window material: a browser tab has nothing behind its page, so the
 * panels sit on a dark ground (the backdrop of the desktop's glass, roughly) rather than on white.
 */
export const GLASS_GROUND = `/* Cinnamon in a browser: this theme is see-through over a window material, which a browser tab doesn't have */
html { background: radial-gradient(120% 90% at 20% 0%, #2a2a33 0%, #17171c 55%, #101013 100%) fixed !important; }`;

export interface BrowserHostOptions {
  root: string;
  userDir: string;
  version: string;
  /** The unpacked extension's folder (its manifest.json holds the version on disk). */
  extensionDir: string;
  themeDirs?: string[];
  extRoots?: ExtensionRoots;
  /** argv prefix that compiles extension TypeScript (`[<bun>, 'build']` or `[<cinnamon>, '__compile']`). */
  compiler: string[] | null;
  /** Writes framed bytes to the browser (stdout). */
  write: (bytes: Uint8Array) => void;
  /** Cinnamon's own page code; default: built from core/ (core/render.ts pageCode). */
  pageCode?: () => Promise<{ js: string; css: string }>;
  open?: (dir: string) => void;
  log?: (...a: unknown[]) => void;
}

/** What `cinnamon status` and `doctor` show about the browser part (<your folder>/state/browser.json). */
export interface BrowserStatus {
  connected: string | null;
  extensionVersion: string | null;
  folderVersion: string | null;
  userScripts: boolean | null;
  problem: string | null;
  errors: Record<string, string[]>;
}

export class BrowserHost {
  readonly config: Config;
  private readonly themes: ThemeStore;
  private readonly catalog: ExtensionCatalog;
  private readonly compiler: Compiler;
  private readonly roots: ExtensionRoots;
  private readonly themeDirs: string[];
  private readonly log: (...a: unknown[]) => void;
  private core: { js: string; css: string } | null = null;
  private lastSent = '';
  private watcher: FileWatcher | null = null;
  private folderTimer: ReturnType<typeof setInterval> | null = null;
  private watchState = { watchers: [] } as unknown as SharedState;
  private status: BrowserStatus;
  private queue: Promise<unknown> = Promise.resolve();
  /** The page code, as files in the extension's folder (claude.ai's policy refuses code from strings). */
  private readonly gen: GenFiles;

  constructor(private readonly o: BrowserHostOptions) {
    this.gen = new GenFiles(o.extensionDir, GEN_DIR);
    this.themeDirs = o.themeDirs ?? [path.join(o.root, 'themes'), path.join(o.userDir, 'themes')];
    this.roots = o.extRoots ?? { bundled: path.join(o.root, 'extensions'), user: path.join(o.userDir, 'extensions') };
    this.config = new Config(path.join(o.userDir, 'config.json'));
    this.themes = new ThemeStore(this.themeDirs);
    this.catalog = new ExtensionCatalog(this.roots);
    this.compiler = new Compiler(o.compiler, new Map<string, CompiledEntry>());
    this.log = o.log ?? ((...a) => console.error('cinnamon browser-host:', ...a)); // stderr: stdout is the channel
    this.status = BrowserHost.readStatus(o.userDir);
  }

  get statusFile(): string { return path.join(this.o.userDir, 'state', 'browser.json'); }

  static readStatus(userDir: string): BrowserStatus {
    const blank: BrowserStatus = { connected: null, extensionVersion: null, folderVersion: null, userScripts: null, problem: null, errors: {} };
    try { return { ...blank, ...(JSON.parse(fs.readFileSync(path.join(userDir, 'state', 'browser.json'), 'utf8')) as Partial<BrowserStatus>) }; } catch { return blank; }
  }

  /** The version of the unpacked extension on disk, or null. */
  folderVersion(): string | null {
    try { return String((JSON.parse(fs.readFileSync(path.join(this.o.extensionDir, 'manifest.json'), 'utf8')) as { version?: unknown }).version ?? '') || null; } catch { return null; }
  }

  /** Everything the extension puts into claude.ai now. */
  async state(): Promise<HostState> {
    this.core ??= await (this.o.pageCode ?? (async () => (await import('../render')).pageCode(this.o.root, { browser: true })))();
    const theme = this.themes.resolve(this.config);
    const cfg = this.config.read();
    const extList: WebExtSummary[] = [];
    const extensions: WebExtension[] = [];
    const errors: Record<string, string[]> = {};
    for (const e of this.catalog.list()) {
      const enabled = ExtensionCatalog.isEnabled(e, cfg);
      const files = e.error ? null : ExtensionCatalog.files(e);
      const unavailable = files?.main ? DESKTOP_ONLY : undefined;
      extList.push({ id: e.id, name: e.name, description: e.description, bundled: e.bundled, enabled, ...(e.error ? { error: e.error } : {}), ...(unavailable ? { unavailable } : {}) });
      if (!files || !enabled || unavailable) continue;
      const errs = [...files.errors];
      const page: string[] = [];
      const css: string[] = [];
      for (const f of files.page) {
        try { page.push(await this.compiler.load(f, 'page', e.dir)); } catch (err) { errs.push(`${e.id}: page file ${path.relative(e.dir, f)} ${(err as Error).message || err}`); }
      }
      for (const f of files.css) {
        try { css.push(fs.readFileSync(f, 'utf8')); } catch (err) { errs.push(`${e.id}: css file ${path.relative(e.dir, f)} ${(err as Error).message || err}`); }
      }
      if (errs.length) errors[e.id] = errs;
      const sig = signature(page);
      const file = page.length ? this.gen.write(`ext-${e.id}`, extensionScript(e.id, sig, page.map((c) => wrap(e.id, c)).join('\n;\n'))) : '';
      extensions.push({ id: e.id, sig, file, css: css.join('\n') });
    }
    this.status.errors = errors;
    for (const err of theme.errors) this.log('theme:', err);
    const settings = cfg.settings && typeof cfg.settings === 'object' && !Array.isArray(cfg.settings) ? cfg.settings as Record<string, unknown> : {};
    const coreFile = this.gen.write('core', coreScript(this.core.js));
    this.gen.prune([coreFile, ...extensions.map((x) => x.file).filter(Boolean)]);
    return {
      type: 'state',
      version: this.o.version,
      extensionVersion: this.folderVersion(),
      core: { file: coreFile, css: this.core.css },
      theme: { id: theme.current, css: theme.window ? `${theme.css}\n${GLASS_GROUND}` : theme.css, themes: theme.themes },
      extensions,
      extList,
      settings,
    };
  }

  /** Sends the state unless the browser already has exactly this one (`force`: send anyway, as on connect). */
  async push(force = false): Promise<void> {
    const s = await this.state();
    const json = JSON.stringify(s);
    if (!force && json === this.lastSent) return;
    this.lastSent = json;
    for (const f of framesFor(s)) this.o.write(f);
    this.saveStatus();
  }

  /** One message from the extension. Runs one at a time. */
  handle(msg: unknown): Promise<void> { return this.serial(() => this.handleNow(msg as ToHost)); }

  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.queue.then(fn).catch((e) => this.log(e));
    this.queue = run;
    return run;
  }

  private async handleNow(m: ToHost): Promise<void> {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'hello':
        this.status.connected = new Date().toISOString();
        this.status.extensionVersion = typeof m.version === 'string' ? m.version : null;
        this.status.userScripts = typeof m.userScripts === 'boolean' ? m.userScripts : null;
        await this.push(true);
        return;
      case 'status':
        this.status.userScripts = typeof m.userScripts === 'boolean' ? m.userScripts : this.status.userScripts;
        this.status.problem = typeof m.problem === 'string' ? m.problem.slice(0, 500) : null;
        this.saveStatus();
        return;
      case 'page':
        if (await this.fromPage(m.msg as Record<string, unknown>)) await this.push();
        return;
      default:
    }
  }

  /** A message from claude.ai's page (same kinds as the desktop's PageChannel). True when something changed. */
  private async fromPage(m: Record<string, unknown> | null): Promise<boolean> {
    if (!m || typeof m !== 'object') return false;
    const cfg = this.config.read();
    const list = this.catalog.list();
    const known = (id: unknown) => typeof id === 'string' && list.some((e) => e.id === id && !e.error);
    switch (m.type) {
      case 'theme': {
        if (typeof m.id !== 'string') return false;
        if (m.id !== 'default' && !this.themes.list().some((t) => t.id === m.id && !t.error)) return false;
        this.config.write({ theme: m.id });
        return true;
      }
      case 'extension': {
        if (!known(m.id) || typeof m.enabled !== 'boolean') return false;
        const e = list.find((x) => x.id === m.id)!;
        if (ExtensionCatalog.files(e).main) return false; // desktop-only: switched in the desktop app
        this.config.write({ extensions: { ...((cfg.extensions as Record<string, unknown>) || {}), [m.id as string]: m.enabled } });
        return true;
      }
      case 'ext-setting': {
        if (!known(m.ext) || typeof m.key !== 'string' || !VALID_KEY.test(m.key)) return false;
        const value = JSON.stringify(m.value ?? null);
        if (value.length > MAX_SETTING_BYTES) return false;
        const all = { ...((cfg.settings as Record<string, Record<string, unknown>>) || {}) };
        all[m.ext as string] = { ...(all[m.ext as string] || {}), [m.key]: JSON.parse(value) as unknown };
        this.config.write({ settings: all });
        return true;
      }
      case 'ext-error': {
        if (!known(m.ext) || typeof m.message !== 'string') return false;
        const errs = (this.status.errors[m.ext as string] ??= []);
        const text = m.message.slice(0, 1000);
        if (errs.length < 10 && !errs.includes(text)) { errs.push(text); this.saveStatus(); }
        return false;
      }
      case 'open-themes-folder':
      case 'open-extensions-folder': {
        const dir = m.type === 'open-themes-folder' ? this.themeDirs[this.themeDirs.length - 1]! : this.roots.user;
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        (this.o.open ?? ((d: string) => { spawn('open', [d], { stdio: 'ignore', detached: true }).unref(); }))(dir);
        return false;
      }
      default:
        return false;
    }
  }

  private saveStatus(): void {
    try {
      this.status.folderVersion = this.folderVersion();
      fs.mkdirSync(path.dirname(this.statusFile), { recursive: true });
      const tmp = `${this.statusFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(this.status, null, 2)}\n`);
      fs.renameSync(tmp, this.statusFile);
    } catch (e) { this.log('status:', e); }
  }

  /** Watches the files (and the extension folder, for its version) and pushes what changed. */
  watch(): void {
    const ext = { bundled: this.roots.bundled, user: this.roots.user };
    this.watcher = new FileWatcher(this.watchState, this.themeDirs, ext, this.config.file, this.log);
    this.watcher.start(() => this.serial(() => this.push()));
    let folder = this.folderVersion();
    this.folderTimer = setInterval(() => { const now = this.folderVersion(); if (now !== folder) { folder = now; void this.serial(() => this.push()); } }, 4000);
  }

  stop(): void {
    this.watcher?.stop();
    if (this.folderTimer) clearInterval(this.folderTimer);
    this.folderTimer = null;
  }

  /** Reads framed messages from `input` until it ends (the browser closed the port). */
  async serve(input: AsyncIterable<Uint8Array>): Promise<void> {
    const decoder = new Decoder();
    this.watch();
    try {
      for await (const chunk of input) for (const m of decoder.push(chunk)) await this.handle(m);
    } finally { this.stop(); }
  }
}
