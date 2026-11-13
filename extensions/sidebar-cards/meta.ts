// Session metadata for the sidebar cards, read from the Claude app's own session files and the matching Claude Code
// session logs. Only display fields are kept: folder, branch, last activity time, model, whether a turn is in
// progress (and since when), the app's after-turn status and its one-line summary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Session {
  folder: string;
  branch: string | null;
  time: number | null;
  model: string | null;
  working: number | null;
  state: AppState;
  summary: string | null;
}
export interface CardData {
  folder: string;
  branch: string | null;
  rel: string;
  model: string | null;
  working: number | null;
  state: AppState;
  summary: string | null;
  label: string | null;
}
export type AppState = 'needs' | 'blocked' | 'failed' | 'review' | null;
type LogEntry = { type?: string; isMeta?: boolean; timestamp?: string; message?: { content?: unknown; stop_reason?: string | null } };

const DEFAULT_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** One Claude Code session log: its git branch and whether a turn is running (tail only; cached by size+mtime). */
export class SessionLog {
  static readonly TAIL = 64 * 1024;
  static readonly LONG_TAIL = 1024 * 1024;
  static readonly STALE_MS = 15 * 60e3;
  private static readonly cache = new Map<string, { key: string; branch: string | null; running: boolean; since: number | null; mtime: number }>();

  static info(projectsRoot: string, cwd: string | null, cliId: string | null, now: number): { branch: string | null; working: number | null } {
    const none = { branch: null, working: null };
    if (!cwd || !cliId) return none;
    const file = path.join(projectsRoot, cwd.replace(/[^A-Za-z0-9]/g, '-'), `${cliId}.jsonl`);
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { return none; }
    const key = `${st.size}:${st.mtimeMs}`;
    let hit = SessionLog.cache.get(file);
    if (!hit || hit.key !== key) {
      let branch: string | null = null;
      let running = false;
      let since: number | null = null;
      try {
        let lines = SessionLog.tail(file, st.size, SessionLog.TAIL);
        const all = [...lines.join('\n').matchAll(/"gitBranch":"((?:[^"\\]|\\.)*)"/g)];
        const last = all.length ? (JSON.parse(`"${all[all.length - 1]![1]}"`) as string) : null;
        branch = last && last !== 'HEAD' ? last : null;
        ({ running, since } = SessionLog.turn(lines));
        if (running && since == null && st.size > SessionLog.TAIL) {
          lines = SessionLog.tail(file, st.size, SessionLog.LONG_TAIL);
          ({ running, since } = SessionLog.turn(lines));
        }
        if (running && since == null) since = st.mtimeMs;
      } catch { branch = null; running = false; since = null; }
      hit = { key, branch, running, since, mtime: st.mtimeMs };
      SessionLog.cache.set(file, hit);
    }
    const fresh = now - hit.mtime < SessionLog.STALE_MS;
    return { branch: hit.branch, working: hit.running && fresh ? hit.since : null };
  }

  private static tail(file: string, size: number, len: number): string[] {
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(len, size);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      const lines = buf.toString('utf8').split('\n');
      if (n < size) lines.shift(); // first line is partial
      return lines;
    } finally { fs.closeSync(fd); }
  }

  private static isToolResult(e: LogEntry): boolean {
    const c = e.message?.content;
    return Array.isArray(c) && c.some((x) => x && (x as { type?: string }).type === 'tool_result');
  }
  private static promptText(e: LogEntry): string {
    const c = e.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
    return '';
  }
  private static isInterrupt(e: LogEntry): boolean { return /^\[Request interrupted/.test(SessionLog.promptText(e)); }

  /** Is the latest turn still running, and when was its prompt sent? */
  private static turn(lines: string[]): { running: boolean; since: number | null } {
    const conv: LogEntry[] = [];
    for (const l of lines) {
      if (!l) continue;
      let e: LogEntry;
      try { e = JSON.parse(l) as LogEntry; } catch { continue; }
      if (e && (e.type === 'user' || e.type === 'assistant')) conv.push(e);
    }
    const last = conv[conv.length - 1];
    if (!last) return { running: false, since: null };
    const running = last.type === 'assistant'
      ? !last.message?.stop_reason || last.message.stop_reason === 'tool_use'
      : SessionLog.isToolResult(last) || !SessionLog.isInterrupt(last);
    if (!running) return { running: false, since: null };
    for (let i = conv.length - 1; i >= 0; i--) {
      const e = conv[i]!;
      if (e.type === 'user' && !SessionLog.isToolResult(e) && !e.isMeta && !SessionLog.isInterrupt(e)) {
        const t = Date.parse(e.timestamp || '');
        return { running: true, since: Number.isFinite(t) ? t : null };
      }
    }
    return { running: true, since: null };
  }
}

/** The app's session files (claude-code-sessions/<account>/<org>/local_*.json) → card data. */
export class SessionReader {
  private static readonly NEEDS = new Set(['needs_input', 'need_input', 'awaiting_permission', 'requires_action']);
  private static readonly STATES: Record<string, AppState> = { blocked: 'blocked', failed: 'failed', review_ready: 'review' };

  constructor(private readonly root: string, private readonly projectsRoot = DEFAULT_PROJECTS) {}

  /** The app's own after-turn status, reduced to the chips worth showing. */
  static appState(d: unknown): AppState {
    if (!d || typeof d !== 'object') return null;
    const s = d as { interruptedAwaitingPerson?: unknown; postTurnSummary?: unknown };
    if (s.interruptedAwaitingPerson) return 'needs';
    const p = s.postTurnSummary as { needs_action?: unknown; status_category?: unknown } | undefined;
    if (!p || typeof p !== 'object') return null;
    if (typeof p.needs_action === 'string' && p.needs_action.trim()) return 'needs';
    const cat = typeof p.status_category === 'string' ? p.status_category : '';
    if (SessionReader.NEEDS.has(cat)) return 'needs';
    return SessionReader.STATES[cat] || null;
  }

  static relTime(ms: number, now: number): string {
    const s = Math.max(0, (now - ms) / 1000);
    if (s < 60) return 'now';
    const m = s / 60, h = m / 60, d = h / 24;
    if (h < 1) return `${Math.floor(m)}m`;
    if (d < 1) return `${Math.floor(h)}h`;
    if (d < 14) return `${Math.floor(d)}d`;
    if (d < 63) return `${Math.floor(d / 7)}w`;
    return `${Math.floor(d / 30)}mo`;
  }

  static shortModel(id: string | null | undefined): string | null {
    if (!id) return null;
    const parts = id.replace(/^claude-/, '').split('-').filter((p) => !/^\d{8}$/.test(p));
    const family = parts.shift();
    if (!family) return null;
    const name = family[0]!.toUpperCase() + family.slice(1);
    return parts.length ? `${name} ${parts.join('.')}` : name;
  }

  private static subdirs(dir: string): string[] {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; }
  }

  sessions(now = Date.now()): Record<string, Session> {
    const out: Record<string, Session> = {};
    for (const account of SessionReader.subdirs(this.root)) {
      for (const org of SessionReader.subdirs(account)) {
        let names: string[] = [];
        try { names = fs.readdirSync(org); } catch {}
        for (const name of names) {
          if (!/^local_.+\.json$/.test(name)) continue;
          let d: Record<string, unknown>;
          try { d = JSON.parse(fs.readFileSync(path.join(org, name), 'utf8')) as Record<string, unknown>; } catch { continue; }
          if (!d || typeof d !== 'object') continue;
          const dir = str(d.originCwd) || str(d.cwd);
          const log = SessionLog.info(this.projectsRoot, str(d.cwd), str(d.cliSessionId), now);
          const pts = d.postTurnSummary as { status_detail?: unknown } | undefined;
          const summary = pts && typeof pts === 'object' ? str(pts.status_detail) : null;
          out[name.slice(0, -'.json'.length)] = {
            folder: dir ? path.basename(dir) : '',
            branch: str(d.branch) || log.branch || str(d.worktreeName),
            time: typeof d.lastActivityAt === 'number' ? d.lastActivityAt : null,
            model: str(d.model),
            working: log.working,
            state: SessionReader.appState(d),
            summary: summary ? summary.slice(0, 200) : null,
          };
        }
      }
    }
    return out;
  }

  /** What the page's cards show, with your labels. */
  cards(now: number, labels: Record<string, { label?: string } | undefined> = {}): Record<string, CardData> {
    const out: Record<string, CardData> = {};
    for (const [id, m] of Object.entries(this.sessions(now))) {
      out[id] = {
        folder: m.folder,
        branch: m.branch,
        rel: m.time == null ? '' : SessionReader.relTime(m.time, now),
        model: SessionReader.shortModel(m.model),
        working: m.working,
        state: m.state,
        summary: m.summary,
        label: labels[id]?.label ?? null,
      };
    }
    return out;
  }
}

// Function forms (used by the tests).
export const appState = SessionReader.appState;
export const relTime = SessionReader.relTime;
export const shortModel = SessionReader.shortModel;
export function readSessions(root: string, { projectsRoot = DEFAULT_PROJECTS, now = Date.now() }: { projectsRoot?: string; now?: number } = {}): Record<string, Session> {
  return new SessionReader(root, projectsRoot).sessions(now);
}
export function payload(root: string, now: number, { labels = {}, projectsRoot = DEFAULT_PROJECTS }: { labels?: Record<string, { label?: string } | undefined>; projectsRoot?: string } = {}): Record<string, CardData> {
  return new SessionReader(root, projectsRoot).cards(now, labels);
}
