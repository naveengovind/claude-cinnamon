// Sidebar session cards. Evaluated inside the claude.ai page by apply.sh.
// Adds a context line (.cm-top: folder · status chip · age or Working timer) and a detail line
// (.cm-bottom: branch · model) to each code-session row, plus a small label menu (.cm-menu).
// It creates, updates and removes only its own `cm-` nodes; on app nodes it only sets data-cm-card.
(() => {
  const w = window;
  const ROW = '[data-testid="sidebar-recents"] [data-row-key^="code:local_"]';
  const LIST = '[data-testid="sidebar-recents"]';
  const OURS = '.cm-top, .cm-bottom, .cm-menu';
  const LABELS = { todo: 'To do', doing: 'In progress', done: 'Done' };
  const STATES = { needs: 'Needs you', blocked: 'Blocked', failed: 'Failed', review: 'Review' };
  const OVERRIDE_MS = 15_000;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const state = (w.__cmState ??= { meta: {}, observer: null, list: null, queued: false });
  state.pending ??= {};
  state.overrides ??= {};

  const span = (cls, text) => {
    const n = document.createElement('span');
    n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function branchIcon() {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('width', '12');
    s.setAttribute('height', '12');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.4');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('d', 'M5 3v10M5 9.5c0-2.5 6-1.5 6-4.5M11 5V3');
    s.append(p);
    for (const [cx, cy] of [[5, 3], [5, 13], [11, 3]]) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '1.4'); c.setAttribute('fill', 'currentColor');
      s.append(c);
    }
    const g = span('cm-branch');
    g.append(s);
    return g;
  }

  const elapsed = (since) => {
    const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  function labelOf(id, m) {
    const o = state.overrides[id];
    if (o && o.until > Date.now()) return o.label;
    return m.label ?? null;
  }

  function chipFor(id, m) {
    const label = labelOf(id, m);
    if (label && LABELS[label]) return [label, LABELS[label]];
    if (m.state && STATES[m.state]) return [m.state, STATES[m.state]];
    return ['add', '+'];
  }

  function stop(e) { e.stopPropagation(); e.preventDefault(); }

  function makeChip(id, kind, text) {
    const c = span('cm-chip', text);
    c.dataset.kind = kind;
    c.dataset.id = id;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', kind === 'add' ? 'Set label' : `Label: ${text}`);
    for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick']) c.addEventListener(ev, stop);
    c.addEventListener('click', (e) => { stop(e); openMenu(c, id); });
    return c;
  }

  function topLine(id, m) {
    const [kind, text] = chipFor(id, m);
    const sig = JSON.stringify([m.folder || '', m.rel || '', kind, m.working || 0, m.summary || '']);
    return { sig, build() {
      const n = document.createElement('div');
      n.className = 'cm-top';
      const l = span('cm-left');
      l.append(span('cm-text', m.folder || ''));
      const r = span('cm-meta');
      r.append(makeChip(id, kind, text));
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

  function bottomLine(m) {
    if (!m.branch && !m.model) return null;
    const sig = JSON.stringify([m.branch || '', m.model || '']);
    return { sig, build() {
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

  function place(button, cls, wanted, first) {
    const existing = [...button.children].filter((c) => c.classList.contains(cls));
    existing.slice(1).forEach((c) => c.remove());
    const cur = existing[0];
    if (!wanted) { cur?.remove(); return; }
    const inPlace = first ? button.firstElementChild === cur : button.lastElementChild === cur;
    if (cur && cur.dataset.cmSig === wanted.sig && inPlace) return;
    cur?.remove();
    const n = wanted.build();
    n.dataset.cmSig = wanted.sig;
    first ? button.prepend(n) : button.append(n);
  }

  function decorate() {
    state.queued = false;
    for (const r of document.querySelectorAll(ROW)) {
      const card = r.querySelector('[data-row]');
      const button = r.querySelector('[data-row-main-button]');
      if (!card || !button) continue;
      if (!card.hasAttribute('data-cm-card')) card.setAttribute('data-cm-card', '');
      const id = r.getAttribute('data-row-key').slice('code:'.length);
      const m = state.meta[id];
      place(button, 'cm-top', m ? topLine(id, m) : null, true);
      place(button, 'cm-bottom', m ? bottomLine(m) : null, false);
    }
    watch();
  }

  function schedule() {
    if (state.queued) return;
    state.queued = true;
    w.requestAnimationFrame(decorate);
  }

  const isOurs = (n) => {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(el && el.closest && el.closest(OURS));
  };

  function watch() {
    const list = document.querySelector(LIST);
    if (!list || list === state.list) return;
    state.observer?.disconnect();
    state.list = list;
    state.observer = new MutationObserver((records) => {
      const foreign = records.some((rec) => !isOurs(rec.target) && ![...rec.addedNodes, ...rec.removedNodes].every(isOurs));
      if (foreign) schedule();
    });
    state.observer.observe(list, { childList: true, subtree: true });
  }

  // ---- label menu ----
  function closeMenu() {
    document.querySelectorAll('.cm-menu').forEach((n) => n.remove());
    document.removeEventListener('pointerdown', state.outside, true);
    document.removeEventListener('keydown', state.escape, true);
  }

  function setLabel(id, label) {
    state.pending[id] = label;
    state.overrides[id] = { label, until: Date.now() + OVERRIDE_MS };
    closeMenu();
    decorate();
  }

  function openMenu(anchor, id) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'cm-menu';
    menu.setAttribute('role', 'menu');
    for (const [value, text] of [...Object.entries(LABELS), ['clear', 'Clear']]) {
      const item = document.createElement('div');
      item.className = 'cm-menu-item';
      item.setAttribute('role', 'menuitem');
      item.dataset.label = value;
      item.textContent = text;
      item.addEventListener('pointerdown', stop);
      item.addEventListener('click', (e) => { stop(e); setLabel(id, value === 'clear' ? null : value); });
      menu.append(item);
    }
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.left = `${Math.round(r.left)}px`;
    document.body.append(menu);
    state.outside = (e) => { if (!menu.contains(e.target)) closeMenu(); };
    state.escape = (e) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('pointerdown', state.outside, true);
    document.addEventListener('keydown', state.escape, true);
  }

  // ---- ticking Working timers ----
  function tick() {
    for (const n of document.querySelectorAll('.cm-working[data-since]')) {
      const t = n.querySelector('.cm-elapsed');
      const text = `Working ${elapsed(Number(n.dataset.since))}`;
      if (t && t.textContent !== text) t.textContent = text;
    }
  }

  // The list itself can be replaced (mode switch, navigation): re-find it periodically.
  if (!state.relist) state.relist = w.setInterval(() => { if (!state.list || !state.list.isConnected) { state.list = null; schedule(); } }, 2000);
  if (!state.ticker) state.ticker = w.setInterval(() => w.__cmTick && w.__cmTick(), 1000);

  w.__cmTick = tick;
  w.__cmSetMeta = (meta) => {
    // a pushed working start time also refreshes existing timers' data-since via the line signature
    state.meta = meta || {};
    decorate();
  };
  w.__cmTakeLabelChanges = () => {
    const out = state.pending;
    state.pending = {};
    return out;
  };
  w.__cmStats = () => {
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
  decorate();
})();
