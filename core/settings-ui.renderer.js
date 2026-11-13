// Cinnamon — rows in Claude's Settings → Appearance: "Color scheme" (themes) and "Extensions". Runs in the page.
// Anchor: the settings row ([data-settings-row]) whose label reads "Theme". The rows copy the look of a sibling
// dropdown row when there is one (ids and form inputs stripped), else use a plain row. If the anchor is missing
// (another page, or an app version without it) nothing is added. Choices go to the main process as console
// messages prefixed "[cinnamon] "; it saves them and sends the new state back through __cmSetThemes /
// __cmSetExtensions.
(() => {
  const S = (window.__cmThemePicker ??= {});
  try { S.observer?.disconnect(); } catch {}
  S.data ??= { current: 'default', themes: [] };
  S.exts ??= [];
  S.closeMenu?.();

  const send = (msg) => { try { console.debug(`[cinnamon] ${JSON.stringify(msg)}`); } catch {} };
  const leaves = (root) => [...root.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && e.textContent.trim());
  const ours = (n) => !!(n && n.nodeType === 1 && n.closest('[data-cm-theme-row], [data-cm-ext-row], .cm-menu'));

  // The rows, in order after the Theme row.
  const ROWS = [
    {
      attr: 'data-cm-theme-row', title: 'Color scheme', valueAttr: 'data-cm-theme-value',
      value: () => (S.data.current === 'default' ? 'Default' : S.data.themes.find((t) => t.id === S.data.current)?.name ?? S.data.current),
      menu: (add) => {
        for (const t of [{ id: 'default', name: 'Default' }, ...S.data.themes]) {
          const on = t.id === S.data.current;
          add(t.error ? `${t.name} (couldn't load)` : t.name, { 'data-theme': t.id, role: 'menuitemradio', 'aria-checked': String(on), ...(t.error ? { 'aria-disabled': 'true', title: t.error } : {}) }, on,
            () => { if (!t.error && !on) send({ type: 'theme', id: t.id }); });
        }
        add(null);
        add('Open themes folder…', { 'data-action': 'open-themes-folder', role: 'menuitem' }, null, () => send({ type: 'open-themes-folder' }));
      },
    },
    {
      attr: 'data-cm-ext-row', title: 'Extensions', valueAttr: 'data-cm-ext-value',
      value: () => `${S.exts.filter((e) => e.enabled).length} on`,
      menu: (add) => {
        for (const e of S.exts) {
          add(e.error ? `${e.name} (couldn't load)` : e.name, { 'data-ext': e.id, role: 'menuitemcheckbox', 'aria-checked': String(!!e.enabled), title: e.error || e.description || '', ...(e.error ? { 'aria-disabled': 'true' } : {}) }, !!e.enabled,
            () => { if (!e.error) send({ type: 'extension', id: e.id, enabled: !e.enabled }); });
        }
        add(null);
        add('Open extensions folder…', { 'data-action': 'open-extensions-folder', role: 'menuitem' }, null, () => send({ type: 'open-extensions-folder' }));
      },
    },
  ];
  const ROW_ATTRS = ROWS.map((r) => r.attr);
  const isOurs = (r) => ROW_ATTRS.some((a) => r.hasAttribute(a));

  function isThemeRow(r) {
    if (isOurs(r)) return false;
    const text = r.querySelector('[data-settings-text]') || r;
    return leaves(text).some((e) => e.textContent.trim() === 'Theme' && !e.closest('[data-settings-control]'));
  }

  function buildRow(themeRow, spec) {
    const model = [...themeRow.parentElement.children].find(
      (r) => r !== themeRow && r.matches('[data-settings-row]') && !isOurs(r) && r.querySelector('[role="combobox"]'),
    );
    let row;
    let combo;
    if (model) {
      row = model.cloneNode(true);
      for (const el of [row, ...row.querySelectorAll('*')]) {
        for (const a of ['id', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'for', 'name']) el.removeAttribute(a);
      }
      row.querySelectorAll('input, select, textarea').forEach((e) => e.remove());
      const textBox = row.querySelector('[data-settings-text]') || row.firstElementChild;
      const [title, ...rest] = leaves(textBox);
      rest.forEach((e) => e.remove()); // descriptions
      if (title) title.textContent = spec.title;
      combo = row.querySelector('[role="combobox"]');
      (leaves(combo)[0] || combo).setAttribute(spec.valueAttr, '');
      title?.after(Object.assign(document.createElement('span'), { className: 'cm-badge', textContent: 'Cinnamon' }));
    } else {
      row = document.createElement('div');
      row.setAttribute('data-settings-row', '');
      row.className = 'cm-settings-row';
      const text = Object.assign(document.createElement('div'), { className: 'cm-settings-text' });
      text.append(Object.assign(document.createElement('span'), { textContent: spec.title }),
        Object.assign(document.createElement('span'), { className: 'cm-badge', textContent: 'Cinnamon' }));
      const control = document.createElement('div');
      control.setAttribute('data-settings-control', '');
      combo = Object.assign(document.createElement('button'), { type: 'button', className: 'cm-settings-combo' });
      combo.setAttribute('role', 'combobox');
      const value = document.createElement('span');
      value.setAttribute(spec.valueAttr, '');
      combo.append(value, Object.assign(document.createElement('span'), { className: 'cm-chev', textContent: '⌄' }));
      control.append(combo);
      row.append(text, control);
    }
    row.setAttribute(spec.attr, '');
    // the menu opens below the dropdown: anchor it to this row's control area
    const control = row.querySelector('[data-settings-control]') || combo.parentElement;
    control.style.position = 'relative';
    if (!control.hasAttribute('data-settings-control')) control.setAttribute('data-settings-control', '');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', spec.title);
    combo.setAttribute('aria-haspopup', 'menu');
    combo.setAttribute('aria-expanded', 'false');
    combo.setAttribute('aria-label', spec.title);
    combo.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(row, combo, spec); });
    return row;
  }

  function showValue(row, spec) {
    const v = row.querySelector(`[${spec.valueAttr}]`);
    if (v) v.textContent = spec.value();
  }

  function toggleMenu(row, combo, spec) {
    const wasThis = S.menu && S.menuFor === row;
    S.closeMenu?.();
    if (wasThis) return;
    const menu = document.createElement('div');
    menu.className = 'cm-menu cm-menu-anchored';
    menu.setAttribute('role', 'menu');
    const add = (text, attrs, checked, onPick) => {
      if (text === null) { menu.append(Object.assign(document.createElement('div'), { className: 'cm-menu-sep' })); return; }
      const el = document.createElement('div');
      el.className = 'cm-menu-item';
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.textContent = text;
      if (checked !== null) el.prepend(Object.assign(document.createElement('span'), { className: 'cm-menu-check', textContent: checked ? '✓' : '' }));
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (el.getAttribute('aria-disabled') === 'true') return;
        S.closeMenu();
        onPick();
      });
      menu.append(el);
    };
    spec.menu(add);
    // Inside the row (so the Settings dialog doesn't treat clicks on it as clicks outside the dialog)
    (row.querySelector('[data-settings-control]') || row).append(menu);
    combo.setAttribute('aria-expanded', 'true');
    const outside = (e) => { if (!menu.contains(e.target) && !combo.contains(e.target)) S.closeMenu(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); S.closeMenu(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    S.menu = menu;
    S.menuFor = row;
    S.closeMenu = () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc, true);
      menu.remove();
      combo.setAttribute('aria-expanded', 'false');
      S.menu = null;
      S.menuFor = null;
      S.closeMenu = null;
    };
  }

  function ensure() {
    S.queued = false;
    try {
      for (const themeRow of [...document.querySelectorAll('[data-settings-row]')].filter(isThemeRow)) {
        let prev = themeRow;
        for (const spec of ROWS) {
          const next = prev.nextElementSibling;
          if (next && next.hasAttribute(spec.attr)) { showValue(next, spec); prev = next; continue; }
          themeRow.parentElement.querySelectorAll(`:scope > [${spec.attr}]`).forEach((r) => r.remove());
          const row = buildRow(themeRow, spec);
          showValue(row, spec);
          prev.after(row);
          prev = row;
        }
      }
    } catch (e) { /* never break the page */ }
  }
  const schedule = () => { if (!S.queued) { S.queued = true; requestAnimationFrame(ensure); } };
  const refresh = () => { S.closeMenu?.(); for (const spec of ROWS) document.querySelectorAll(`[${spec.attr}]`).forEach((r) => showValue(r, spec)); schedule(); };

  window.__cmSetThemes = (data) => {
    if (!data || !Array.isArray(data.themes)) return;
    S.data = { current: typeof data.current === 'string' ? data.current : 'default', themes: data.themes.filter((t) => t && typeof t.id === 'string') };
    refresh();
  };
  window.__cmSetExtensions = (list) => {
    if (!Array.isArray(list)) return;
    S.exts = list.filter((e) => e && typeof e.id === 'string');
    refresh();
  };

  S.observer = new MutationObserver((muts) => {
    for (const m of muts) {
      // skip changes inside our own rows/menu and our own insertions; a removal of our row must re-add it
      if (ours(m.target) || (m.removedNodes.length === 0 && [...m.addedNodes].every(ours))) continue;
      schedule();
      return;
    }
  });
  S.observer.observe(document.body, { childList: true, subtree: true });
  schedule();
})();
