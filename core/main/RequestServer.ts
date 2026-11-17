// Requests from the `cinnamon` command to the Cinnamon running inside Claude, through files: the command writes
// <your folder>/state/requests/<id>.json, this answers in <your folder>/state/responses/<id>.json (plus any file the
// answer names, always in that folder). No debugger, no menu clicks, no macOS permission: Claude capturing its own
// window needs none. One kind so far: a screenshot of Claude's window, for checking themes and extensions.
//
// Only files you can write reach here (the folders are 0700), the answer is only ever written into the responses
// folder, and `"screenshots": false` in config.json turns screenshots off.
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../lib/Config';
import type { WebContents } from './electron';
import type { ViewManager } from './ViewManager';
import type { Log, SharedState } from './types';

const ID = /^[a-z0-9][a-z0-9-]{7,63}$/i;
const POLL_MS = 1000;
const KEEP_MS = 10 * 60_000;
const WIDTH = { min: 200, max: 4000, default: 1600 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Request { id?: unknown; type?: unknown; width?: unknown }
type Answer = { ok: true; png: string; width: number; height: number; url: string } | { ok: false; error: string };

export class RequestServer {
  private busy = false;

  constructor(
    private readonly state: SharedState,
    private readonly views: ViewManager,
    private readonly config: Config,
    private readonly userDir: string,
    private readonly log: Log,
  ) {}

  get requestDir(): string { return path.join(this.userDir, 'state', 'requests'); }
  get responseDir(): string { return path.join(this.userDir, 'state', 'responses'); }

  start(): void {
    this.stop();
    for (const d of [this.requestDir, this.responseDir]) { try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); } catch {} }
    let watcher: fs.FSWatcher | null = null;
    try { watcher = fs.watch(this.requestDir, () => { void this.scan(); }); watcher.on('error', () => {}); } catch {}
    // file events can be dropped: look every second too
    this.state.requests = { watcher, timer: setInterval(() => { void this.scan(); }, POLL_MS) };
    void this.scan();
  }

  stop(): void {
    const r = this.state.requests;
    try { r?.watcher?.close(); } catch {}
    if (r?.timer) clearInterval(r.timer);
    this.state.requests = null;
  }

  /** Answers every waiting request, one at a time. */
  private async scan(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let names: string[] = [];
      try { names = fs.readdirSync(this.requestDir).filter((f) => f.endsWith('.json')); } catch {}
      for (const name of names) {
        const file = path.join(this.requestDir, name);
        let req: Request = {};
        try { req = JSON.parse(fs.readFileSync(file, 'utf8')) as Request; } catch { /* half written: next time */ continue; }
        try { fs.rmSync(file, { force: true }); } catch {}
        if (typeof req.id !== 'string' || !ID.test(req.id) || `${req.id}.json` !== name) continue;
        this.answer(req.id, await this.handle(req.id, req));
      }
      this.prune();
    } finally { this.busy = false; }
  }

  private async handle(id: string, req: Request): Promise<Answer> {
    if (req.type !== 'screenshot') return { ok: false, error: `unknown request ${JSON.stringify(req.type)}` };
    if (this.config.read().screenshots === false) return { ok: false, error: 'screenshots are turned off ("screenshots": false in config.json)' };
    const wc = this.views.views()[0];
    if (!wc) return { ok: false, error: 'no Claude window is open' };
    try {
      const raw = Number(req.width);
      const width = Number.isFinite(raw) ? Math.min(WIDTH.max, Math.max(WIDTH.min, Math.round(raw))) : WIDTH.default;
      let img = await this.capture(wc);
      if (img.getSize().width > width) img = img.resize({ width });
      const png = path.join(this.responseDir, `${id}.png`);
      fs.writeFileSync(png, img.toPNG(), { mode: 0o600 });
      const size = img.getSize();
      let url = '';
      try { url = new URL(wc.getURL()).pathname; } catch {}
      return { ok: true, png, width: size.width, height: size.height, url };
    } catch (e) {
      return { ok: false, error: `capture failed: ${(e as Error).message || e}` };
    }
  }

  /** A window in the background isn't repainted: wake it, let it paint, then capture what is on screen now. */
  private async capture(wc: WebContents) {
    await wc.capturePage(undefined, { stayHidden: false, stayAwake: true });
    wc.invalidate();
    await wait(1200);
    return wc.capturePage(undefined, { stayHidden: false, stayAwake: true });
  }

  private answer(id: string, a: Answer): void {
    try {
      const file = path.join(this.responseDir, `${id}.json`);
      const tmp = `${file}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(a) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) { this.log('request answer:', e); }
  }

  /** Answers nobody collected go after a while. */
  private prune(): void {
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(this.responseDir)) {
        const p = path.join(this.responseDir, f);
        if (now - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true });
      }
    } catch {}
  }
}
