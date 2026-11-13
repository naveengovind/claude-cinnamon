/// <reference path="../../types/cinnamon.d.ts" />
// Full width — adds "Full" to Settings → Appearance → Transcript width, next to the app's own widths.
// The choice is saved as this extension's `width` setting; width.css does the rest when the page is marked
// data-cinnamon-width="full". Anchors: the settings row labelled "Transcript width", its combobox and the listbox
// its popup holds (Base UI, linked by aria-controls). Missing anchors → nothing is added.

interface FullWidthState { observer?: MutationObserver; queued?: boolean }
type Listbox = HTMLElement & { __cinnamonListening?: boolean };

const leaves = (el: Element): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('*')].filter((e) => e.childElementCount === 0 && e.textContent!.trim());

class FullWidth {
  private readonly root = document.documentElement;

  constructor(private readonly s: FullWidthState) {}

  private isFull(): boolean { return cinnamon.settings.get('width') === 'full'; }

  private widthCombos(): HTMLElement[] {
    return [...document.querySelectorAll('[data-settings-row]')]
      .filter((r) => leaves(r).some((e) => e.textContent!.trim() === 'Transcript width' && !e.closest('[data-settings-control]')))
      .map((r) => r.querySelector<HTMLElement>('[role="combobox"]'))
      .filter((c): c is HTMLElement => !!c);
  }

  private showValue(combo: HTMLElement): void {
    const v = combo.querySelector<HTMLElement>('[id$="-trigger-value"]') || leaves(combo)[0];
    if (!v) return;
    if (this.isFull()) {
      if (v.textContent !== 'Full') { v.dataset.cinnamonApp = v.textContent ?? ''; v.textContent = 'Full'; }
    } else if (v.textContent === 'Full' && v.dataset.cinnamonApp) {
      v.textContent = v.dataset.cinnamonApp;
      delete v.dataset.cinnamonApp;
    }
  }

  private static closeList(combo: HTMLElement): void {
    const target: EventTarget = document.getElementById(combo.getAttribute('aria-controls') || '') || document;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  private decorateList(combo: HTMLElement): void {
    const popup = document.getElementById(combo.getAttribute('aria-controls') || '');
    const list = popup?.querySelector<Listbox>('[role="listbox"]');
    if (!list) return;
    let opt = list.querySelector<HTMLElement>('[data-cinnamon-option]');
    if (!opt) {
      const model = [...list.querySelectorAll('[role="option"]')].pop();
      if (!model) return;
      opt = model.cloneNode(true) as HTMLElement;
      for (const el of [opt, ...opt.querySelectorAll('*')]) {
        for (const a of ['id', 'data-selected', 'data-highlighted', 'aria-selected']) el.removeAttribute(a);
      }
      opt.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove()); // the copied check mark
      (leaves(opt)[0] || opt).textContent = 'Full';
      opt.setAttribute('title', 'Full');
      opt.setAttribute('data-cinnamon-option', '');
      opt.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cinnamon.settings.set('width', 'full');
        FullWidth.closeList(combo);
      });
      list.append(opt);
    }
    if (!list.__cinnamonListening) {
      list.__cinnamonListening = true;
      // picking one of the app's widths turns Full off (capture: before the app closes the list)
      list.addEventListener('click', (e) => {
        const o = (e.target as Element).closest('[role="option"]');
        if (o && !o.hasAttribute('data-cinnamon-option') && this.isFull()) cinnamon.settings.set('width', null);
      }, true);
    }
    opt.setAttribute('aria-selected', String(this.isFull()));
    list.toggleAttribute('data-cinnamon-full', this.isFull());
    const check = opt.querySelector('[data-cinnamon-check]');
    if (this.isFull() && !check) {
      const c = Object.assign(document.createElement('span'), { className: 'cinnamon-check', textContent: '✓' });
      c.setAttribute('data-cinnamon-check', '');
      c.setAttribute('aria-hidden', 'true');
      opt.append(c);
    } else if (!this.isFull() && check) check.remove();
  }

  readonly sync = (): void => {
    this.s.queued = false;
    try {
      if (this.isFull()) this.root.setAttribute('data-cinnamon-width', 'full');
      else this.root.removeAttribute('data-cinnamon-width');
      for (const combo of this.widthCombos()) {
        this.showValue(combo);
        if (combo.getAttribute('aria-expanded') === 'true') this.decorateList(combo);
      }
    } catch { /* never break the page */ }
  };

  private readonly schedule = (): void => { if (!this.s.queued) { this.s.queued = true; requestAnimationFrame(this.sync); } };

  start(): void {
    cinnamon.settings.onChange(this.sync);
    this.s.observer = new MutationObserver((muts) => {
      if (muts.every((m) => m.target.nodeType === 1 && (m.target as Element).closest('[data-cinnamon-option]'))) return;
      this.schedule();
    });
    this.s.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
    this.sync();
  }
}

{
  const page = window as unknown as { __cinnamonFullWidth?: FullWidthState };
  const s = (page.__cinnamonFullWidth ??= {});
  try { s.observer?.disconnect(); } catch {}
  new FullWidth(s).start();
}

export {}; // a module: its names stay its own (Bun wraps it for the page)
