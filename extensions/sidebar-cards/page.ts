/// <reference path="../../types/cinnamon.d.ts" />
// Sidebar session cards. Runs inside the claude.ai page (an extension's page code).
// Adds a context line (.cm-top: folder · age or Working timer) and a detail line (.cm-bottom: branch · model) to each
// code-session row (on this Mac, SSH and cloud). It creates, updates and removes only its own `cm-` nodes; on app nodes it only sets data-cm-card. The main part (main.ts) sends
// the data it reads from session files via __cmSetMeta; a session with none here (cloud) gets the place the app shows.
// Working follows the app's own Running status (any kind of session), or a turn running in the session's log, timed
// from the log's prompt when there is one and otherwise from when the app first showed it running.

interface Card { folder?: string; branch?: string | null; rel?: string; model?: string | null; working?: number | null; summary?: string | null }
interface Line { sig: string; build(): HTMLElement }
interface CardsState {
  meta: Record<string, Card>;
  observer: MutationObserver | null;
  list: Element | null;
  queued: boolean;
  relist?: number;
  ticker?: number;
  /** session id → when the app first showed it Running (kept across page loads in localStorage). */
  runningSince?: Record<string, number>;
  /** Taken out (hot reload or turned off): a frame already queued does nothing. */
  disposed?: boolean;
}
interface CardsWindow {
  __cmState?: CardsState;
  __cmTick?: () => void;
  __cmSetMeta?: (meta: Record<string, Card> | null) => void;
  __cmStats?: () => { rows: number; decorated: number; duplicates: number };
}

const ROW = '[data-testid="sidebar-recents"] [data-row-key^="code:"]';
const SINCE_KEY = 'cinnamon.sidebar-cards.running-since';
const EMPTY: Card = { folder: '', branch: null, rel: '', model: null, working: null, summary: null };

/** What the app itself shows on a row: whether the session is running, and the place it adds after the title. */
function appRow(r: Element): { running: boolean; place: string } {
  const status = r.querySelector('[data-session-status]')?.textContent?.trim() || '';
  // by its label: the app's pulsing dot also marks other states (an unread response)
  const running = status === 'Running' || !!r.querySelector('[data-row-decoration] [role="img"][aria-label="Running"]');
  const place = [...r.querySelectorAll('[data-row-label] [data-find-omitted]:not([data-session-status])')]
    .map((e) => (e.textContent || '').trim()).filter(Boolean).join(' ');
  return { running, place };
}
const LIST = '[data-testid="sidebar-recents"]';
const OURS = '.cm-top, .cm-bottom';
const SVG_NS = 'http://www.w3.org/2000/svg';

const span = (cls: string, text?: string | null): HTMLSpanElement => {
  const n = document.createElement('span');
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const elapsed = (since: number): string => {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

function branchIcon(): HTMLSpanElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', width: '12', height: '12', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  const p = document.createElementNS(SVG_NS, 'path');
  for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', d: 'M5 3v10M5 9.5c0-2.5 6-1.5 6-4.5M11 5V3' })) p.setAttribute(k, v);
  s.append(p);
  for (const [cx, cy] of [[5, 3], [5, 13], [11, 3]] as const) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy)); c.setAttribute('r', '1.4'); c.setAttribute('fill', 'currentColor');
    s.append(c);
  }
  const g = span('cm-branch');
  g.append(s);
  return g;
}

/** Puts the two lines on each code-session row and keeps them current. */
class CardDecorator {
  constructor(private readonly state: CardsState, private readonly win: Window & CardsWindow) {}

  private topLine(m: Card): Line {
    const sig = JSON.stringify([m.folder || '', m.rel || '', m.working || 0, m.summary || '']);
    return { sig, build: () => {
      const n = document.createElement('div');
      n.className = 'cm-top';
      const l = span('cm-left');
      l.append(span('cm-text', m.folder || ''));
      const r = span('cm-meta');
      if (m.working) {
        const wk = span('cm-working');
        wk.dataset.since = String(m.working);
        wk.append(span('cm-spin'), span('cm-elapsed', `Working ${elapsed(m.working)}`));
        r.append(wk);
      } else {
        const t = span('cm-right cm-time', m.rel || '');
        if (m.summary) t.title = m.summary;
        r.append(t);
      }
      n.append(l, r);
      return n;
    } };
  }

  private bottomLine(m: Card): Line | null {
    if (!m.branch && !m.model) return null;
    const sig = JSON.stringify([m.branch || '', m.model || '']);
    return { sig, build: () => {
      const n = document.createElement('div');
      n.className = 'cm-bottom';
      n.setAttribute('aria-hidden', 'true');
      const l = span('cm-left');
      if (m.branch) l.append(branchIcon());
      l.append(span('cm-text', m.branch || ''));
      n.append(l, span('cm-right', m.model || ''));
      return n;
    } };
  }

  private place(button: Element, cls: string, wanted: Line | null, first: boolean): void {
    const existing = [...button.children].filter((c) => c.classList.contains(cls)) as HTMLElement[];
    existing.slice(1).forEach((c) => c.remove());
    const cur = existing[0];
    if (!wanted) { cur?.remove(); return; }
    const inPlace = first ? button.firstElementChild === cur : button.lastElementChild === cur;
    if (cur && cur.dataset.cmSig === wanted.sig && inPlace) return;
    cur?.remove();
    const n = wanted.build();
    n.dataset.cmSig = wanted.sig;
    if (first) button.prepend(n); else button.append(n);
  }

  readonly decorate = (): void => {
    this.state.queued = false;
    if (this.state.disposed) return;
    for (const r of document.querySelectorAll(ROW)) {
      const card = r.querySelector('[data-row]');
      const button = r.querySelector('[data-row-main-button]');
      if (!card || !button) continue;
      if (!card.hasAttribute('data-cm-card')) card.setAttribute('data-cm-card', '');
      const id = r.getAttribute('data-row-key')!.slice('code:'.length);
      const app = appRow(r);
      const m = { ...(this.state.meta[id] || EMPTY) };
      if (!m.folder) m.folder = app.place;
      m.working = this.workingSince(id, app.running, m.working);
      this.place(button, 'cm-top', this.topLine(m), true);
      this.place(button, 'cm-bottom', this.bottomLine(m), false);
    }
    this.watch();
  };

  /** When the session's current turn started, or null when it isn't running. */
  private workingSince(id: string, appRunning: boolean, fromLog: number | null | undefined): number | null {
    const since = (this.state.runningSince ??= CardDecorator.loadSince());
    if (!appRunning) {
      if (id in since) { delete since[id]; CardDecorator.saveSince(since); }
      return fromLog || null;
    }
    if (fromLog) return fromLog;
    if (!(id in since)) { since[id] = Date.now(); CardDecorator.saveSince(since); }
    return since[id]!;
  }

  private static loadSince(): Record<string, number> {
    try { const v = JSON.parse(localStorage.getItem(SINCE_KEY) || '{}') as unknown; return v && typeof v === 'object' ? v as Record<string, number> : {}; } catch { return {}; }
  }

  private static saveSince(since: Record<string, number>): void {
    try { localStorage.setItem(SINCE_KEY, JSON.stringify(since)); } catch {}
  }

  readonly schedule = (): void => {
    if (this.state.queued) return;
    this.state.queued = true;
    this.win.requestAnimationFrame(this.decorate);
  };

  private static isOurs(n: Node | null): boolean {
    const el = n && (n.nodeType === 1 ? (n as Element) : n.parentElement);
    return !!(el && el.closest && el.closest(OURS));
  }

  /** Observes the session list (re-found when the app replaces it). */
  private watch(): void {
    const list = document.querySelector(LIST);
    const state = this.state;
    if (!list || list === state.list) return;
    state.observer?.disconnect();
    state.list = list;
    state.observer = new MutationObserver((records) => {
      const foreign = records.some((rec) => !CardDecorator.isOurs(rec.target) && ![...rec.addedNodes, ...rec.removedNodes].every(CardDecorator.isOurs));
      if (foreign) this.schedule();
    });
    state.observer.observe(list, { childList: true, subtree: true });
  }

  /** Ticks the Working timers. */
  static tick(): void {
    for (const n of document.querySelectorAll<HTMLElement>('.cm-working[data-since]')) {
      const t = n.querySelector('.cm-elapsed');
      const text = `Working ${elapsed(Number(n.dataset.since))}`;
      if (t && t.textContent !== text) t.textContent = text;
    }
  }

  /** Takes the cards out of the page (hot reload or turned off). The data stays, so a new run shows it at once. */
  dispose(): void {
    const { state, win } = this;
    state.disposed = true;
    state.observer?.disconnect();
    state.observer = null;
    state.list = null;
    state.queued = false;
    if (state.relist) win.clearInterval(state.relist);
    if (state.ticker) win.clearInterval(state.ticker);
    state.relist = undefined;
    state.ticker = undefined;
    document.querySelectorAll(OURS).forEach((n) => n.remove());
    document.querySelectorAll('[data-cm-card]').forEach((n) => n.removeAttribute('data-cm-card'));
    delete win.__cmTick;
    delete win.__cmSetMeta;
    delete win.__cmStats;
  }

  start(): void {
    const { state, win } = this;
    state.disposed = false;
    // The list itself can be replaced (mode switch, navigation): re-find it periodically.
    if (!state.relist) state.relist = win.setInterval(() => { if (!state.list || !state.list.isConnected) { state.list = null; this.schedule(); } }, 2000);
    if (!state.ticker) state.ticker = win.setInterval(() => win.__cmTick && win.__cmTick(), 1000);
    win.__cmTick = CardDecorator.tick;
    win.__cmSetMeta = (meta) => { state.meta = meta || {}; this.decorate(); };
    win.__cmStats = () => {
      const rows = document.querySelectorAll(ROW);
      let decorated = 0, duplicates = 0;
      for (const r of rows) {
        const b = r.querySelector('[data-row-main-button]');
        if (!b) continue;
        const t = b.querySelectorAll('.cm-top').length, u = b.querySelectorAll('.cm-bottom').length;
        if (t || u) decorated++;
        if (t > 1 || u > 1) duplicates++;
      }
      return { rows: rows.length, decorated, duplicates };
    };
    this.decorate();
  }
}

{
  const win = window as Window & CardsWindow;
  const state = (win.__cmState ??= { meta: {}, observer: null, list: null, queued: false });
  const cards = new CardDecorator(state, win);
  cards.start();
  if (typeof cinnamon !== 'undefined') cinnamon.onDispose(() => cards.dispose()); // hot-reloadable
}

export {}; // a module: its names stay its own (Bun wraps it for the page)
