// Where the sidebar cards get their data: only what the page itself can reach, in plain TypeScript (no files, no
// Node, no main process), so the same code runs in the desktop app and on claude.ai in a browser, on any platform.
//
//   • Sessions the desktop app runs (on this computer or over SSH): the app's own bridge in the page,
//     window['claude.web'].LocalSessions.getAll(). Only the desktop app has it.
//   • Cloud sessions: claude.ai's own API, GET /v1/code/sessions (same origin, the person's own session cookies),
//     which the desktop app and the website both use. Its ids are cse_<x>; the sidebar row for one is
//     code:session_<x>.
//
// Both are asked gently: the bridge every few seconds and the API every half minute, only while the page is visible,
// backing off after errors. A source that isn't there (no bridge in a browser, no network) just gives nothing; the
// cards then show what the app's own row shows.

export interface Card {
  folder?: string;
  branch?: string | null;
  rel?: string;
  model?: string | null;
  /** When the current turn started (ms), or null when none is running. */
  working?: number | null;
  summary?: string | null;
}
export type Cards = Record<string, Card>;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "now", "5m", "3h", "2d", "3w", "4mo". */
export function relTime(ms: number, now: number): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (h < 1) return `${Math.floor(m)}m`;
  if (d < 1) return `${Math.floor(h)}h`;
  if (d < 14) return `${Math.floor(d)}d`;
  if (d < 63) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

/** claude-opus-5-5 → "Opus 5.5"; claude-sonnet-4-5-20250929 → "Sonnet 4.5". */
export function shortModel(id: string | null | undefined): string | null {
  if (!id) return null;
  const parts = id.replace(/^claude-/, '').replace(/\[.*\]$/, '').split('-').filter((p) => p && !/^\d{8}$/.test(p));
  const family = parts.shift();
  if (!family) return null;
  const name = family[0]!.toUpperCase() + family.slice(1);
  return parts.length ? `${name} ${parts.join('.')}` : name;
}

/** The last part of a path, whichever separator it uses (POSIX or Windows). */
export function baseName(p: string | null | undefined): string {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

/** A repository's name from its URL (https or ssh form): https://host/owner/name.git → "name". */
export function repoName(url: string | null | undefined): string {
  if (!url) return '';
  return baseName(url.replace(/\.git$/, '').replace(/^[^:]+:(?!\/\/)/, '/'));
}

/** A git revision worth showing: a branch name, not a bare commit hash. */
const branchOf = (rev: string | null): string | null => (rev && !/^[0-9a-f]{7,40}$/i.test(rev) && rev !== 'HEAD' ? rev : null);

/** Cards for the sessions the desktop app's bridge lists (keys are their ids: local_<x>). */
export function localCards(list: unknown, now: number): Cards {
  const out: Cards = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const s = obj(item);
    const id = s && str(s.sessionId);
    if (!s || !id) continue;
    const remote = obj(s.remoteTarget);
    const dir = (remote && str(remote.remoteCwd)) || str(s.originCwd) || str(s.cwd) || str(s.worktreePath);
    const at = num(s.lastActivityAt) ?? num(s.createdAt);
    const pts = obj(s.postTurnSummary);
    const summary = pts && str(pts.status_detail);
    out[id] = {
      folder: baseName(dir),
      branch: branchOf(str(s.branch)) || str(s.worktreeName),
      rel: at == null ? '' : relTime(at, now),
      model: shortModel(str(s.model)),
      // a running turn: its start is the session's last turn edge
      working: s.turnRunning === true ? (num(s.lastTurnEdgeAt) ?? null) : null,
      summary: summary ? summary.slice(0, 200) : null,
    };
  }
  return out;
}

/** The worker states that mean a cloud session is working on a turn. */
const CLOUD_WORKING = new Set(['running', 'busy', 'working', 'processing', 'executing', 'thinking']);

/** Cards for cloud sessions from GET /v1/code/sessions (keys are the sidebar's: session_<x> for cse_<x>). */
export function cloudCards(body: unknown, now: number): Cards {
  const out: Cards = {};
  const data = obj(body)?.data;
  if (!Array.isArray(data)) return out;
  for (const item of data) {
    const s = obj(item);
    const id = s && str(s.id);
    if (!s || !id) continue;
    const config = obj(s.config);
    const meta = obj(s.external_metadata);
    const sources = Array.isArray(config?.sources) ? config!.sources.map(obj).filter((x): x is Obj => !!x) : [];
    const repo = sources.find((x) => x.type === 'git_repository') || sources[0];
    const at = Date.parse(str(s.last_event_at) || str(s.updated_at) || str(s.created_at) || '');
    const turn = obj(meta?.turn);
    const turnStart = Date.parse(str(turn?.started_at) || '');
    out[`session_${id.replace(/^cse_/, '')}`] = {
      folder: repoName(repo && str(repo.url)),
      branch: branchOf(repo ? str(repo.revision) || str(repo.branch) : null),
      rel: Number.isFinite(at) ? relTime(at, now) : '',
      model: shortModel(str(meta?.last_served_model) || str(config?.model)),
      working: CLOUD_WORKING.has(String(s.worker_status)) ? (Number.isFinite(turnStart) ? turnStart : null) : null,
      summary: str(s.status_line)?.slice(0, 200) ?? null,
    };
  }
  return out;
}

/** What the feed needs from the page (a window, or a fake in tests). */
export interface FeedHost {
  'claude.web'?: { LocalSessions?: { getAll?: () => unknown } };
  fetch?: (url: string, init?: Obj) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
  document?: { visibilityState?: string; addEventListener?(t: string, fn: () => void): void; removeEventListener?(t: string, fn: () => void): void };
  addEventListener?(t: string, fn: () => void): void;
  removeEventListener?(t: string, fn: () => void): void;
}

export interface FeedTiming { localMs: number; cloudMs: number; maxBackoffMs: number; minRefreshMs: number }
export const TIMING: FeedTiming = { localMs: 3000, cloudMs: 30_000, maxBackoffMs: 5 * 60_000, minRefreshMs: 10_000 };
const CLOUD_PAGE = 50;
const CLOUD_PAGES = 3;
export const CLOUD_URL = '/v1/code/sessions';

/**
 * Keeps the cards' data current from both sources. `onChange` gets the merged cards whenever either source changes
 * them. stop() ends every timer and listener, and a request still in flight then changes nothing.
 */
export class SessionFeed {
  private local: Cards = {};
  private cloud: Cards = {};
  private sent = '';
  private stopped = false;
  private localTimer: unknown = null;
  private cloudTimer: unknown = null;
  private cloudBackoff = 0;
  private cloudBlocked = false; // signed out (401/403): wait for the page to come back into view
  private lastCloud = 0;

  constructor(private readonly host: FeedHost, private readonly onChange: (cards: Cards) => void, private readonly timing: FeedTiming = TIMING, private readonly now = () => Date.now()) {}

  private get visible(): boolean { return (this.host.document?.visibilityState ?? 'visible') === 'visible'; }
  private get bridge(): (() => unknown) | null {
    const fn = this.host['claude.web']?.LocalSessions?.getAll;
    return typeof fn === 'function' ? fn.bind(this.host['claude.web']!.LocalSessions) : null;
  }

  private emit(): void {
    if (this.stopped) return;
    const merged = { ...this.cloud, ...this.local };
    const text = JSON.stringify(merged);
    if (text === this.sent) return;
    this.sent = text;
    this.onChange(merged);
  }

  /** One read of the desktop app's sessions. */
  async refreshLocal(): Promise<void> {
    const get = this.bridge;
    if (!get || this.stopped) return;
    try {
      const list = await get();
      if (this.stopped) return;
      this.local = localCards(list, this.now());
      this.emit();
    } catch {} // the app was busy or changed: the next read tries again
  }

  /** One read of the cloud sessions (a few pages at most). */
  async refreshCloud(): Promise<void> {
    const fetchFn = this.host.fetch;
    if (typeof fetchFn !== 'function' || this.stopped || this.cloudBlocked) return;
    this.lastCloud = this.now();
    const data: unknown[] = [];
    let token: string | null = null;
    try {
      for (let page = 0; page < CLOUD_PAGES; page++) {
        const q = new URLSearchParams({ limit: String(CLOUD_PAGE) });
        q.append('statuses', 'active');
        q.append('statuses', 'idle');
        if (token) q.set('resume_token', token);
        const r = await fetchFn.call(this.host, `${CLOUD_URL}?${q}`, { credentials: 'include', headers: { 'anthropic-version': '2023-06-01' } });
        if (this.stopped) return;
        if (r.status === 401 || r.status === 403) { this.cloudBlocked = true; return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = obj(await r.json());
        if (this.stopped) return;
        if (Array.isArray(body?.data)) data.push(...body!.data);
        token = str(body?.resume_token);
        if (!token || !Array.isArray(body?.data) || body!.data.length < CLOUD_PAGE) break;
      }
      this.cloudBackoff = 0;
      this.cloud = cloudCards({ data }, this.now());
      this.emit();
    } catch {
      this.cloudBackoff = Math.min(this.timing.maxBackoffMs, this.cloudBackoff ? this.cloudBackoff * 2 : this.timing.cloudMs * 2);
    }
  }

  private scheduleLocal(): void {
    if (this.stopped || !this.bridge) return;
    this.localTimer = this.host.setTimeout(async () => {
      if (this.visible) await this.refreshLocal();
      this.scheduleLocal();
    }, this.timing.localMs);
  }

  private scheduleCloud(): void {
    if (this.stopped || typeof this.host.fetch !== 'function') return;
    this.cloudTimer = this.host.setTimeout(async () => {
      if (this.visible) await this.refreshCloud();
      this.scheduleCloud();
    }, this.cloudBackoff || this.timing.cloudMs);
  }

  /** Back in view: read again now (not more often than every few seconds), and retry after a sign-in. */
  private readonly onVisible = (): void => {
    if (this.stopped || !this.visible) return;
    void this.refreshLocal();
    if (this.now() - this.lastCloud >= this.timing.minRefreshMs) { this.cloudBlocked = false; void this.refreshCloud(); }
  };

  start(): void {
    this.stopped = false;
    this.host.document?.addEventListener?.('visibilitychange', this.onVisible);
    this.host.addEventListener?.('focus', this.onVisible);
    // the next read is timed from when the first one ends (so a first error already backs off)
    void this.refreshLocal().then(() => this.scheduleLocal());
    void this.refreshCloud().then(() => this.scheduleCloud());
  }

  stop(): void {
    this.stopped = true;
    if (this.localTimer != null) this.host.clearTimeout(this.localTimer);
    if (this.cloudTimer != null) this.host.clearTimeout(this.cloudTimer);
    this.localTimer = this.cloudTimer = null;
    this.host.document?.removeEventListener?.('visibilitychange', this.onVisible);
    this.host.removeEventListener?.('focus', this.onVisible);
  }
}
