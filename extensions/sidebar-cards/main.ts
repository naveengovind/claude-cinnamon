// Sidebar cards — main part. Sends each claude.ai view the data its cards show (folder, branch, model, age, Working
// timer, app state, your label), refreshed when session files change and every 6s; saves the labels you set in the
// page (collected every 2s) to labels.json in this extension's data folder.
import path from 'node:path';
import { LabelStore } from './labels';
import { SessionReader } from './meta';

/** The part of Cinnamon's extension context this uses (see core/main/ExtensionContext.ts). */
interface Context {
  appDataDir: string;
  dataDir: string;
  views(): unknown[];
  run(wc: unknown, js: string): Promise<unknown>;
  onViewReady(fn: (wc: unknown) => unknown): void;
  watch(p: string, opts: { recursive?: boolean }, fn: () => void): unknown;
  setInterval(fn: () => unknown, ms: number): unknown;
  setTimeout(fn: () => unknown, ms: number): unknown;
  clearTimer(t: unknown): void;
  log(...a: unknown[]): void;
}

export class SidebarCards {
  private readonly reader: SessionReader;
  private readonly labels: LabelStore;
  private debounce: unknown = null;

  constructor(private readonly ctx: Context) {
    const sessionsRoot = path.join(ctx.appDataDir, 'claude-code-sessions');
    this.reader = new SessionReader(sessionsRoot);
    this.labels = new LabelStore(path.join(ctx.dataDir, 'labels.json'));
    ctx.onViewReady((wc) => this.push(wc));
    ctx.watch(sessionsRoot, { recursive: true }, () => {
      if (this.debounce) ctx.clearTimer(this.debounce);
      this.debounce = ctx.setTimeout(this.pushAll, 300);
    });
    ctx.setInterval(this.collectLabels, 2000);
    ctx.setInterval(this.pushAll, 6000);
  }

  /** Never throws: a bad session file or a closed view only skips this push. */
  async push(wc: unknown): Promise<void> {
    let data: string;
    try { data = JSON.stringify(this.reader.cards(Date.now(), this.labels.read())); } catch { return; }
    await this.ctx.run(wc, `window.__cmSetMeta ? (window.__cmSetMeta(${data}), true) : false`);
  }

  readonly pushAll = async (): Promise<void> => { for (const wc of this.ctx.views()) await this.push(wc); };

  readonly collectLabels = async (): Promise<void> => {
    const changes: Record<string, unknown> = {};
    for (const wc of this.ctx.views()) {
      const c = await this.ctx.run(wc, 'window.__cmTakeLabelChanges ? window.__cmTakeLabelChanges() : null');
      if (c && typeof c === 'object') Object.assign(changes, c);
    }
    if (!Object.keys(changes).length) return;
    try { this.labels.apply(changes); } catch (e) { this.ctx.log('could not save labels', e); return; }
    await this.pushAll();
  };
}

export function activate(ctx: Context): SidebarCards {
  return new SidebarCards(ctx);
}
