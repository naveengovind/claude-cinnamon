// Cinnamon — rows in Claude's Settings → Appearance: "Color scheme" (themes) and "Extensions". Runs in the page.
// Anchor: the settings row ([data-settings-row]) whose label reads "Theme". The rows copy the look of a sibling
// dropdown row when there is one (ids and form inputs stripped), else use a plain row. If the anchor is missing
// (another page, or an app version without it) nothing is added. Choices go to the main process as console
// messages prefixed "[cinnamon] "; it saves them and sends the new state back through __cmSetThemes /
// __cmSetExtensions.

interface ThemeItem { id: string; name: string; error?: string }
interface ExtItem { id: string; name: string; enabled?: boolean; error?: string; description?: string }
type AddItem = (text: string | null, attrs?: Record<string, string>, checked?: boolean | null, onPick?: () => void) => void;
interface RowSpec { attr: string; title: string; valueAttr: string; value(): string; menu(add: AddItem): void }

/** What survives a re-apply of this script (the previous copy's observer is disconnected). */
interface PickerState {
  data: { current: string; themes: ThemeItem[] };
  exts: ExtItem[];
  observer?: MutationObserver;
  queued?: boolean;
  menu?: HTMLElement | null;
  menuFor?: HTMLElement | null;
  closeMenu?: (() => void) | null;
}
interface PageWindow {
  __cmThemePicker?: PickerState;
  __cmSetThemes?: (data: unknown) => void;
  __cmSetExtensions?: (list: unknown) => void;
}

const send = (msg: unknown): void => { try { console.debug(`[cinnamon] ${JSON.stringify(msg)}`); } catch {} };
const leaves = (root: Element): Element[] => [...root.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && e.textContent!.trim());
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), props);

/** The dropdown menu a row opens, inside the row (so the Settings dialog doesn't count clicks on it as outside). */
class RowMenu {
  constructor(private readonly s: PickerState) {}

  toggle(row: HTMLElement, combo: HTMLElement, spec: RowSpec): void {
    const s = this.s;
    const wasThis = s.menu && s.menuFor === row;
    s.closeMenu?.();
    if (wasThis) return;
    const menu = el('div', { className: 'cm-menu cm-menu-anchored' });
    menu.setAttribute('role', 'menu');
    const add: AddItem = (text, attrs = {}, checked = null, onPick = () => {}) => {
      if (text === null) { menu.append(el('div', { className: 'cm-menu-sep' })); return; }
      const item = el('div', { className: 'cm-menu-item' });
      for (const [k, v] of Object.entries(attrs)) item.setAttribute(k, v);
      item.textContent = text;
      if (checked !== null) item.prepend(el('span', { className: 'cm-menu-check', textContent: checked ? '✓' : '' }));
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.getAttribute('aria-disabled') === 'true') return;
        s.closeMenu?.();
        onPick();
      });
      menu.append(item);
    };
    spec.menu(add);
    (row.querySelector('[data-settings-control]') || row).append(menu);
    combo.setAttribute('aria-expanded', 'true');
    const outside = (e: Event) => { if (!menu.contains(e.target as Node) && !combo.contains(e.target as Node)) s.closeMenu?.(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); s.closeMenu?.(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    s.menu = menu;
    s.menuFor = row;
    s.closeMenu = () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc, true);
      menu.remove();
      combo.setAttribute('aria-expanded', 'false');
      s.menu = null;
      s.menuFor = null;
      s.closeMenu = null;
    };
  }
}

class SettingsRows {
  private readonly specs: RowSpec[];
  private readonly menu: RowMenu;

  constructor(private readonly s: PickerState) {
    this.menu = new RowMenu(s);
    this.specs = [
      {
        attr: 'data-cm-theme-row', title: 'Color scheme', valueAttr: 'data-cm-theme-value',
        value: () => (s.data.current === 'default' ? 'Default' : s.data.themes.find((t) => t.id === s.data.current)?.name ?? s.data.current),
        menu: (add) => {
          for (const t of [{ id: 'default', name: 'Default' } as ThemeItem, ...s.data.themes]) {
            const on = t.id === s.data.current;
            add(t.error ? `${t.name} (couldn't load)` : t.name, { 'data-theme': t.id, role: 'menuitemradio', 'aria-checked': String(on), ...(t.error ? { 'aria-disabled': 'true', title: t.error } : {}) }, on,
              () => { if (!t.error && !on) send({ type: 'theme', id: t.id }); });
          }
          add(null);
          add('Open themes folder…', { 'data-action': 'open-themes-folder', role: 'menuitem' }, null, () => send({ type: 'open-themes-folder' }));
        },
      },
      {
        attr: 'data-cm-ext-row', title: 'Extensions', valueAttr: 'data-cm-ext-value',
        value: () => `${s.exts.filter((e) => e.enabled).length} on`,
        menu: (add) => {
          for (const e of s.exts) {
            add(e.error ? `${e.name} (couldn't load)` : e.name, { 'data-ext': e.id, role: 'menuitemcheckbox', 'aria-checked': String(!!e.enabled), title: e.error || e.description || '', ...(e.error ? { 'aria-disabled': 'true' } : {}) }, !!e.enabled,
              () => { if (!e.error) send({ type: 'extension', id: e.id, enabled: !e.enabled }); });
          }
          add(null);
          add('Open extensions folder…', { 'data-action': 'open-extensions-folder', role: 'menuitem' }, null, () => send({ type: 'open-extensions-folder' }));
        },
      },
    ];
  }

  private isOurs(r: Element): boolean { return this.specs.some((spec) => r.hasAttribute(spec.attr)); }
  private ours = (n: Node | null): boolean => !!(n && n.nodeType === 1 && (n as Element).closest('[data-cm-theme-row], [data-cm-ext-row], .cm-menu'));

  private isThemeRow(r: Element): boolean {
    if (this.isOurs(r)) return false;
    const text = r.querySelector('[data-settings-text]') || r;
    return leaves(text).some((e) => e.textContent!.trim() === 'Theme' && !e.closest('[data-settings-control]'));
  }

  private build(themeRow: Element, spec: RowSpec): HTMLElement {
    const model = [...themeRow.parentElement!.children].find(
      (r) => r !== themeRow && r.matches('[data-settings-row]') && !this.isOurs(r) && r.querySelector('[role="combobox"]'),
    );
    let row: HTMLElement;
    let combo: HTMLElement;
    if (model) {
      row = model.cloneNode(true) as HTMLElement;
      for (const node of [row, ...row.querySelectorAll('*')]) {
        for (const a of ['id', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'for', 'name']) node.removeAttribute(a);
      }
      row.querySelectorAll('input, select, textarea').forEach((e) => e.remove());
      const textBox = row.querySelector('[data-settings-text]') || row.firstElementChild!;
      const [title, ...rest] = leaves(textBox);
      rest.forEach((e) => e.remove()); // descriptions
      if (title) title.textContent = spec.title;
      combo = row.querySelector('[role="combobox"]') as HTMLElement;
      (leaves(combo)[0] || combo).setAttribute(spec.valueAttr, '');
      title?.after(el('span', { className: 'cm-badge', textContent: 'Cinnamon' }));
    } else {
      row = el('div', { className: 'cm-settings-row' });
      row.setAttribute('data-settings-row', '');
      const text = el('div', { className: 'cm-settings-text' });
      text.append(el('span', { textContent: spec.title }), el('span', { className: 'cm-badge', textContent: 'Cinnamon' }));
      const control = el('div');
      control.setAttribute('data-settings-control', '');
      combo = el('button', { type: 'button', className: 'cm-settings-combo' });
      combo.setAttribute('role', 'combobox');
      const value = el('span');
      value.setAttribute(spec.valueAttr, '');
      combo.append(value, el('span', { className: 'cm-chev', textContent: '⌄' }));
      control.append(combo);
      row.append(text, control);
    }
    row.setAttribute(spec.attr, '');
    // the menu opens below the dropdown: anchor it to this row's control area
    const control = (row.querySelector('[data-settings-control]') || combo.parentElement!) as HTMLElement;
    control.style.position = 'relative';
    if (!control.hasAttribute('data-settings-control')) control.setAttribute('data-settings-control', '');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', spec.title);
    combo.setAttribute('aria-haspopup', 'menu');
    combo.setAttribute('aria-expanded', 'false');
    combo.setAttribute('aria-label', spec.title);
    combo.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.menu.toggle(row, combo, spec); });
    return row;
  }

  private showValue(row: Element, spec: RowSpec): void {
    const v = row.querySelector(`[${spec.valueAttr}]`);
    if (v) v.textContent = spec.value();
  }

  ensure = (): void => {
    this.s.queued = false;
    try {
      for (const themeRow of [...document.querySelectorAll('[data-settings-row]')].filter((r) => this.isThemeRow(r))) {
        let prev: Element = themeRow;
        for (const spec of this.specs) {
          const next = prev.nextElementSibling;
          if (next && next.hasAttribute(spec.attr)) { this.showValue(next, spec); prev = next; continue; }
          themeRow.parentElement!.querySelectorAll(`:scope > [${spec.attr}]`).forEach((r) => r.remove());
          const row = this.build(themeRow, spec);
          this.showValue(row, spec);
          prev.after(row);
          prev = row;
        }
      }
    } catch { /* never break the page */ }
  };

  schedule = (): void => { if (!this.s.queued) { this.s.queued = true; requestAnimationFrame(this.ensure); } };

  refresh(): void {
    this.s.closeMenu?.();
    for (const spec of this.specs) document.querySelectorAll(`[${spec.attr}]`).forEach((r) => this.showValue(r, spec));
    this.schedule();
  }

  start(page: PageWindow): void {
    const s = this.s;
    page.__cmSetThemes = (data: unknown) => {
      const d = data as { current?: unknown; themes?: unknown } | null;
      if (!d || !Array.isArray(d.themes)) return;
      s.data = { current: typeof d.current === 'string' ? d.current : 'default', themes: (d.themes as ThemeItem[]).filter((t) => t && typeof t.id === 'string') };
      this.refresh();
    };
    page.__cmSetExtensions = (list: unknown) => {
      if (!Array.isArray(list)) return;
      s.exts = (list as ExtItem[]).filter((e) => e && typeof e.id === 'string');
      this.refresh();
    };
    s.observer = new MutationObserver((muts) => {
      for (const m of muts) {
        // skip changes inside our own rows/menu and our own insertions; a removal of our row must re-add it
        if (this.ours(m.target) || (m.removedNodes.length === 0 && [...m.addedNodes].every(this.ours))) continue;
        this.schedule();
        return;
      }
    });
    s.observer.observe(document.body, { childList: true, subtree: true });
    this.schedule();
  }
}

{
  const page = window as unknown as PageWindow;
  const s = (page.__cmThemePicker ??= { data: { current: 'default', themes: [] }, exts: [] });
  try { s.observer?.disconnect(); } catch {}
  s.data ??= { current: 'default', themes: [] };
  s.exts ??= [];
  s.closeMenu?.();
  new SettingsRows(s).start(page);
}

export {}; // a module: its names stay its own (Bun wraps it for the page)
