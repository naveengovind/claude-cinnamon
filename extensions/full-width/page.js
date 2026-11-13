// Full width — adds "Full" to Settings → Appearance → Transcript width, next to the app's own widths.
// The choice is saved as this extension's `width` setting; width.css does the rest when the page is marked
// data-cinnamon-width="full". Anchors: the settings row labelled "Transcript width", its combobox and the listbox
// its popup holds (Base UI, linked by aria-controls). Missing anchors → nothing is added.
const S = (window.__cinnamonFullWidth ??= {});
try { S.observer?.disconnect(); } catch {}
const root = document.documentElement;
const isFull = () => cinnamon.settings.get('width') === 'full';
const leaves = (el) => [...el.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && e.textContent.trim());

function widthCombos() {
  return [...document.querySelectorAll('[data-settings-row]')]
    .filter((r) => leaves(r).some((e) => e.textContent.trim() === 'Transcript width' && !e.closest('[data-settings-control]')))
    .map((r) => r.querySelector('[role="combobox"]'))
    .filter(Boolean);
}
const valueOf = (combo) => combo.querySelector('[id$="-trigger-value"]') || leaves(combo)[0];

function showValue(combo) {
  const v = valueOf(combo);
  if (!v) return;
  if (isFull()) {
    if (v.textContent !== 'Full') { v.dataset.cinnamonApp = v.textContent; v.textContent = 'Full'; }
  } else if (v.textContent === 'Full' && v.dataset.cinnamonApp) {
    v.textContent = v.dataset.cinnamonApp;
    delete v.dataset.cinnamonApp;
  }
}

function closeList(combo) {
  const target = document.getElementById(combo.getAttribute('aria-controls') || '') || document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function decorateList(combo) {
  const popup = document.getElementById(combo.getAttribute('aria-controls') || '');
  const list = popup && popup.querySelector('[role="listbox"]');
  if (!list) return;
  let opt = list.querySelector('[data-cinnamon-option]');
  if (!opt) {
    const model = [...list.querySelectorAll('[role="option"]')].pop();
    if (!model) return;
    opt = model.cloneNode(true);
    for (const el of [opt, ...opt.querySelectorAll('*')]) {
      for (const a of ['id', 'data-selected', 'data-highlighted', 'aria-selected']) el.removeAttribute(a);
    }
    opt.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove()); // the copied check mark
    const label = leaves(opt)[0] || opt;
    label.textContent = 'Full';
    opt.setAttribute('title', 'Full');
    opt.setAttribute('data-cinnamon-option', '');
    opt.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cinnamon.settings.set('width', 'full');
      closeList(combo);
    });
    list.append(opt);
  }
  if (!list.__cinnamonListening) {
    list.__cinnamonListening = true;
    // picking one of the app's widths turns Full off (capture: before the app closes the list)
    list.addEventListener('click', (e) => {
      const o = e.target.closest('[role="option"]');
      if (o && !o.hasAttribute('data-cinnamon-option') && isFull()) cinnamon.settings.set('width', null);
    }, true);
  }
  opt.setAttribute('aria-selected', String(isFull()));
  list.toggleAttribute('data-cinnamon-full', isFull());
  const check = opt.querySelector('[data-cinnamon-check]');
  if (isFull() && !check) {
    const c = Object.assign(document.createElement('span'), { className: 'cinnamon-check', textContent: '✓' });
    c.setAttribute('data-cinnamon-check', '');
    c.setAttribute('aria-hidden', 'true');
    opt.append(c);
  } else if (!isFull() && check) check.remove();
}

function sync() {
  S.queued = false;
  try {
    if (isFull()) root.setAttribute('data-cinnamon-width', 'full');
    else root.removeAttribute('data-cinnamon-width');
    for (const combo of widthCombos()) {
      showValue(combo);
      if (combo.getAttribute('aria-expanded') === 'true') decorateList(combo);
    }
  } catch (e) { /* never break the page */ }
}
const schedule = () => { if (!S.queued) { S.queued = true; requestAnimationFrame(sync); } };

cinnamon.settings.onChange(sync);
S.observer = new MutationObserver((muts) => {
  if (muts.every((m) => m.target.nodeType === 1 && m.target.closest('[data-cinnamon-option]'))) return;
  schedule();
});
S.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
sync();
