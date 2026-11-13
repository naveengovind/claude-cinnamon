// Messages from Claude's page: console messages prefixed "[cinnamon] " (no changes to the app's own IPC).
// Only Claude's own top-level page may talk to Cinnamon: embedded frames (artifacts, previews) and messages whose
// frame is unknown are ignored. (Electron's older positional signature carries no frame at all and is accepted.)
import fs from 'node:fs';
import type { Config } from '../lib/Config';
import type { ExtensionRoots } from '../lib/ExtensionCatalog';
import type { Electron, WebContents, WebFrameMain } from './electron';
import type { ViewManager } from './ViewManager';
import type { Log, SharedState } from './types';

const PREFIX = '[cinnamon] ';
const VALID_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SETTING_BYTES = 20_000;

type Message =
  | { type: 'theme'; id: string }
  | { type: 'open-themes-folder' }
  | { type: 'open-extensions-folder' }
  | { type: 'extension'; id: string; enabled: boolean }
  | { type: 'ext-setting'; ext: string; key: string; value: unknown }
  | { type: 'ext'; ext: string; msg: string; data: unknown };

export class PageChannel {
  constructor(
    private readonly electron: Electron,
    private readonly state: SharedState,
    private readonly config: Config,
    private readonly views: ViewManager,
    private readonly userThemesDir: string,
    private readonly extRoots: ExtensionRoots,
    private readonly log: Log,
  ) {}

  /** The text of a console message from the top page, or null. */
  static read(wc: WebContents, args: unknown[]): string | null {
    const ev = args[0] as { message?: unknown; frame?: WebFrameMain | null } | undefined;
    if (typeof ev?.message === 'string') {
      const f = ev.frame;
      if (!f || (f !== wc.mainFrame && f.parent !== null)) return null;
      return ev.message;
    }
    return typeof args[2] === 'string' ? args[2] : null;
  }

  static parse(raw: string | null): Message | null {
    if (!raw || !raw.startsWith(PREFIX)) return null;
    try {
      const m = JSON.parse(raw.slice(PREFIX.length)) as unknown;
      return m && typeof m === 'object' ? (m as Message) : null;
    } catch { return null; }
  }

  async handle(wc: WebContents, args: unknown[]): Promise<void> {
    const m = PageChannel.parse(PageChannel.read(wc, args));
    if (!m) return;
    const known = (id: unknown) => typeof id === 'string' && (this.state.extList || []).some((e) => e.id === id && !e.error);
    switch (m.type) {
      case 'theme':
        if (typeof m.id === 'string') await this.state.setTheme?.(m.id);
        break;
      case 'open-themes-folder':
        await this.open(this.userThemesDir);
        break;
      case 'open-extensions-folder':
        await this.open(this.extRoots.user);
        break;
      case 'extension': {
        if (!known(m.id) || typeof m.enabled !== 'boolean') return;
        const extensions = { ...((this.config.read().extensions as Record<string, unknown>) || {}), [m.id]: m.enabled };
        this.config.write({ extensions });
        await this.state.reloadAll?.();
        break;
      }
      case 'ext-setting': {
        if (!known(m.ext) || typeof m.key !== 'string' || !VALID_KEY.test(m.key)) return;
        const value = JSON.stringify(m.value ?? null);
        if (value.length > MAX_SETTING_BYTES) return;
        const all = { ...((this.config.read().settings as Record<string, Record<string, unknown>>) || {}) };
        all[m.ext] = { ...(all[m.ext] || {}), [m.key]: JSON.parse(value) as unknown };
        this.config.write({ settings: all });
        this.state.settings = all;
        for (const v of this.views.views()) await v.executeJavaScript(`window.__cinnamon?.setSettings(${JSON.stringify(all)})`).catch(() => {});
        break;
      }
      case 'ext': {
        const main = this.state.mains.get(m.ext);
        if (main?.instance?.onMessage && typeof m.msg === 'string') {
          try { await main.instance.onMessage(m.msg, m.data, wc); } catch (e) { this.log(`extension ${m.ext} message:`, e); }
        }
        break;
      }
      default:
    }
  }

  private async open(dir: string): Promise<void> {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    await this.electron.shell.openPath(dir).catch(() => {});
  }
}
