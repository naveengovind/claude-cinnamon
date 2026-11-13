// Sidebar session cards. Runs inside the claude.ai page (an extension's page code).
// Adds a context line (.cm-top: folder · status chip · age or Working timer) and a detail line (.cm-bottom: branch ·
// model) to each code-session row, plus a small label menu (.cm-menu). It creates, updates and removes only its own
// `cm-` nodes; on app nodes it only sets data-cm-card. The main part (main.ts) sends the data via __cmSetMeta.

interface Card { folder?: string; branch?: string | null; rel?: string; model?: string | null; working?: number | null; state?: string | null; summary?: string | null; label?: string | null }
interface Line { sig: string; build(): HTMLElement }
interface CardsState {
  meta: Record<string, Card>;
  observer: MutationObserver | null;
  list: Element | null;
  queued: boolean;
  pending: Record<string, string | null>;
  overrides: Record<string, { label: string | null; until: number }>;
  outside?: (e: Event) => void;
  escape?: (e: KeyboardEvent) => void;
  relist?: number;
  ticker?: number;
}
interface CardsWindow {
  __cmState?: CardsState;
  __cmTick?: () => void;
  __cmSetMeta?: (meta: Record<string, Card> | null) => void;
  __cmTakeLabelChanges?: () => Record<string, string | null>;
  __cmStats?: () => { rows: number; decorated: number; duplicates: number };
}

const ROW = '[data-testid="sidebar-recents"] [data-row-key^="code:local_"]';
const LIST = '[data-testid="sidebar-recents"]';
const OURS = '.cm-top, .cm-bottom, .cm-menu';
const LABELS: Record<string, string> = { todo: 'To do', doing: 'In progress', done: 'Done' };
const STATES: Record<string, string> = { needs: 'Needs you', blocked: 'Blocked', failed: 'Failed', review: 'Review' };
const OVERRIDE_MS = 15_000;
const SVG_NS = 'http://www.w3.org/2000/svg';

const span = (cls: string, text?: string | null): HTMLSpanElement => {
  const n = document.createElement('span');
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const stop = (e: Event): void => { e.stopPropagation(); e.preventDefault(); };
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

/** The label menu a chip opens (To do / In progress / Done / Clear). */
class LabelMenu {
  constructor(private readonly state: CardsState, private readonly onPick: (id: string, label: string | null) => void) {}

  close(): void {
    document.querySelectorAll('.cm-menu').forEach((n) => n.remove());
    if (this.state.outside) document.removeEventListener('pointerdown', this.state.outside, true);
    if (this.state.escape) document.removeEventListener('keydown', this.state.escape, true);
  }

  open(anchor: HTMLElement, id: string): void {
    this.close();
    const menu = document.createElement('div');
    menu.className = 'cm-menu';
    menu.setAttribute('role', 'menu');
    for (const [value, text] of [...Object.entries(LABELS), ['clear', 'Clear']] as [string, string][]) {
      const item = document.createElement('div');
      item.className = 'cm-menu-item';
      item.setAttribute('role', 'menuitem');
      item.dataset.label = value;
      item.textContent = text;
      item.addEventListener('pointerdown', stop);
      item.addEventListener('click', (e) => { stop(e); this.onPick(id, value === 'clear' ? null : value); });
      menu.append(item);
    }
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.left = `${Math.round(r.left)}px`;
    document.body.append(menu);
    this.state.outside = (e: Event) => { if (!menu.contains(e.target as Node)) this.close(); };
    this.state.escape = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('pointerdown', this.state.outside, true);
    document.addEventListener('keydown', this.state.escape, true);
  }
}

/** Puts the two lines on each code-session row and keeps them current. */
class CardDecorator {
  private readonly menu: LabelMenu;

  constructor(private readonly state: CardsState, private readonly win: Window & CardsWindow) {
    this.menu = new LabelMenu(state, (id, label) => this.setLabel(id, label));
  }

  private labelOf(id: string, m: Card): string | null {
    const o = this.state.overrides[id];
    if (o && o.until > Date.now()) return o.label;
    return m.label ?? null;
  }

  private chipFor(id: string, m: Card): [string, string] {
    const label = this.labelOf(id, m);
    if (label && LABELS[label]) return [label, LABELS[label]!];
    if (m.state && STATES[m.state]) return [m.state, STATES[m.state]!];
    return ['add', '+'];
  }

  private makeChip(id: string, kind: string, text: string): HTMLSpanElement {
    const c = span('cm-chip', text);
    c.dataset.kind = kind;
    c.dataset.id = id;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', kind === 'add' ? 'Set label' : `Label: ${text}`);
    for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick']) c.addEventListener(ev, stop);
    c.addEventListener('click', (e) => { stop(e); this.menu.open(c, id); });
    return c;
  }

  private topLine(id: string, m: Card): Line {
    const [kind, text] = this.chipFor(id, m);
    const sig = JSON.stringify([m.folder || '', m.rel || '', kind, m.working || 0, m.summary || '']);
    return { sig, build: () => {
      const n = document.createElement('div');
      n.className = 'cm-top';
      const l = span('cm-left');
      l.append(span('cm-text', m.folder || ''));
      const r = span('cm-meta');
      r.append(this.makeChip(id, kind, text));
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
    for (const r of document.querySelectorAll(ROW)) {
      const card = r.querySelector('[data-row]');
      const button = r.querySelector('[data-row-main-button]');
      if (!card || !button) continue;
      if (!card.hasAttribute('data-cm-card')) card.setAttribute('data-cm-card', '');
      const id = r.getAttribute('data-row-key')!.slice('code:'.length);
      const m = this.state.meta[id];
      this.place(button, 'cm-top', m ? this.topLine(id, m) : null, true);
      this.place(button, 'cm-bottom', m ? this.bottomLine(m) : null, false);
    }
    this.watch();
  };

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

  private setLabel(id: string, label: string | null): void {
    this.state.pending[id] = label;
    this.state.overrides[id] = { label, until: Date.now() + OVERRIDE_MS };
    this.menu.close();
    this.decorate();
  }

  /** Ticks the Working timers. */
  static tick(): void {
    for (const n of document.querySelectorAll<HTMLElement>('.cm-working[data-since]')) {
      const t = n.querySelector('.cm-elapsed');
      const text = `Working ${elapsed(Number(n.dataset.since))}`;
      if (t && t.textContent !== text) t.textContent = text;
    }
  }

  start(): void {
    const { state, win } = this;
    // The list itself can be replaced (mode switch, navigation): re-find it periodically.
    if (!state.relist) state.relist = win.setInterval(() => { if (!state.list || !state.list.isConnected) { state.list = null; this.schedule(); } }, 2000);
    if (!state.ticker) state.ticker = win.setInterval(() => win.__cmTick && win.__cmTick(), 1000);
    win.__cmTick = CardDecorator.tick;
    win.__cmSetMeta = (meta) => { state.meta = meta || {}; this.decorate(); };
    win.__cmTakeLabelChanges = () => { const out = state.pending; state.pending = {}; return out; };
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
  const state = (win.__cmState ??= { meta: {}, observer: null, list: null, queued: false, pending: {}, overrides: {} });
  state.pending ??= {};
  state.overrides ??= {};
  new CardDecorator(state, win).start();
}

export {}; // a module: its names stay its own (Bun wraps it for the page)
