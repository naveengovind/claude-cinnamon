/// <reference path="../../types/cinnamon.d.ts" />
// Demo mask: for screenshots of Cinnamon that are safe to publish. Every piece of text in the sidebar that isn't one of
// the app's own labels (chat and session titles, pinned items, project, folder and branch names, the account) is
// swapped for a made-up one, so nothing of the person's own shows. On the start screens (a new chat, a new Code
// session), where the main area holds only the app's own words, a greeting and the person's environments, the main
// area is masked too. Anything it doesn't recognize is replaced, never
// kept. Not a built-in extension: scripts/screenshots.ts puts it in place while it takes pictures, then removes it.
// Taking it out puts the real text back.

const KEEP = new Set([
  'New', 'New chat', 'New session', 'Search', 'Projects', 'Meetings', 'Beta', 'Artifacts', 'Scheduled', 'Dispatch',
  'Design', 'Customize', 'Pinned', 'Chats and tasks', 'Chats', 'Recents', 'Starred', 'View all', 'Code', 'Chat',
  'Cowork', 'Sessions', 'Routines', 'Working', 'Running', 'Local', 'Cloud', 'SSH', 'Today', 'Yesterday',
  'Previous 7 days', 'Previous 30 days', 'Older', 'All', 'Archived', 'Show more', 'Show less', '·', '•', '—',
  'More', 'Drag to pin', 'No folder', 'Default', 'Choose environment', 'Choose a folder to work in', 'Choose folder',
  'Describe a task or ask a question', 'This computer', 'Auto', 'How can I help you today?', 'Settings',
]);
/** Screens whose main area is masked as well. */
const START = /^\/(new|epitaxy)?\/?$/;
// time stamps, counts and the like carry nothing personal
const NEUTRAL = /^[\d\s·•:.,%+\-–—()]*(s|m|h|d|w|mo|y|min|hr|ago|now|just now)?[\d\s·•:.,%+\-–—()]*$/i;
// model names, effort, the Working timer: the app's, not the person's
const APP_WORDS = /^(Opus|Sonnet|Haiku|Fable|Claude)\b|^(Low|Medium|High|Max)$|^Working\b/;

const TITLES = [
  'Plan a weekend in Lisbon', 'Explain CSS container queries', 'Draft release notes for v2.4',
  'Sourdough starter troubleshooting', 'SQLite or Postgres for a side project', 'Refactor the settings page',
  'Ideas for a team offsite', 'Summarize a paper on diffusion models', 'Fix the flaky upload test',
  'Write a haiku about autumn', 'Budget spreadsheet formulas', 'Add dark mode to the docs site',
  'Rust lifetimes, explained simply', 'Birthday dinner menu', 'Migrate the API to Hono', 'Kanji study plan',
  'Tune the search ranking', 'Garden layout for tomatoes', 'Review the onboarding flow', 'Bike commute gear list',
];
const WORDS: Record<string, string[]> = {
  folder: ['demo-app', 'docs-site', 'api-server', 'mobile-client'],
  branch: ['main', 'feature/dark-mode', 'fix/upload-retry', 'docs/readme'],
};
const ACCOUNT = ['Alex', 'Personal'];
const PLACES = ['my-workspace', 'Personal'];
const GREETING = ['Good evening, Alex'];

const sidebars = (): Element[] => [...document.querySelectorAll('nav, aside')];
const assigned = new Map<Text, string>(); // what we wrote into each node
const original = new Map<Text, string>(); // what the app had there

// The same real text always gets the same made-up one, and each list is handed out in order (no repeats until it runs out).
const given = new Map<string, string>();
const used: Record<string, number> = {};
function next(kind: string, list: readonly string[]): string { const i = (used[kind] = (used[kind] ?? -1) + 1); return list[i % list.length]!; }

function demoFor(text: string, node: Text): string {
  const el = node.parentElement;
  if (el && !el.closest('nav, aside')) {
    const big = parseFloat(getComputedStyle(el).fontSize) >= 24;
    const kind = big ? 'greeting' : 'place';
    const key = `${kind}:${text}`;
    let demo = given.get(key);
    if (!demo) { demo = next(kind, big ? GREETING : PLACES); given.set(key, demo); }
    return demo;
  }
  const card = el?.classList.contains('cm-text') ? el.closest('.cm-top') ? 'folder' : el.closest('.cm-bottom') ? 'branch' : null : null;
  const kind = card ?? (el?.closest('[class*="branch" i], [data-branch]') ? 'branch'
    : el?.closest('[class*="folder" i], [class*="repo" i], [data-folder]') ? 'folder' : null) ??
    (el?.closest('[data-testid*="user" i], [aria-label*="account" i], [aria-label*="profile" i], [data-testid*="account" i]') ? 'account'
    : 'title');
  const key = `${kind}:${text}`;
  let demo = given.get(key);
  if (!demo) {
    demo = next(kind, kind === 'title' ? TITLES : kind === 'account' ? ACCOUNT : WORDS[kind]!);
    given.set(key, demo);
  }
  return demo;
}

/** Only text a person can see: not styles, scripts or icon titles, and not visually hidden labels. */
function visible(node: Text): boolean {
  const el = node.parentElement;
  if (!el || el.closest('style, script, template, svg, noscript')) return false;
  // Settings (a dialog) holds the app's own words on the pages worth showing (Appearance); never shoot Account
  if (el.closest('[role="dialog"]')) return false;
  if (/icon/i.test(getComputedStyle(el).fontFamily)) return false; // the app's icons are words in an icon font
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

function mask(node: Text): void {
  if (assigned.get(node) === node.data) return;
  const text = node.data.trim();
  if (!text || text.length <= 2 || KEEP.has(text) || NEUTRAL.test(text) || APP_WORDS.test(text) || !visible(node)) return;
  original.set(node, node.data);
  const demo = demoFor(text, node);
  assigned.set(node, demo);
  node.data = demo;
}

function sweep(root: Node): void {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) mask(n as Text);
}

const start = (): boolean => START.test(location.pathname);
const inScope = (n: Node | null): boolean => !!(n && (start() || (n instanceof Element ? n : n.parentElement)?.closest('nav, aside')));
function maskAll(): void { if (start()) sweep(document.body); else for (const s of sidebars()) sweep(s); }

const observer = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'characterData' && r.target instanceof Text && inScope(r.target)) mask(r.target);
    for (const n of r.addedNodes) if (inScope(n)) { if (n instanceof Text) mask(n); else sweep(n); }
  }
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true });
maskAll();
document.documentElement.dataset.cinnamonDemo = 'on';
// pictures in the sidebar (a workspace's logo, an avatar) can be as personal as names: hidden while the mask is on
const hideImages = document.createElement('style');
hideImages.textContent = 'nav img, aside img, nav [style*="background-image"], aside [style*="background-image"] { visibility: hidden !important; }';
document.head.append(hideImages);

// scripts/screenshots.ts steers the page through this extension's `go` setting (a path such as /epitaxy)
function go(settings: Record<string, unknown>): void {
  const to = settings.go;
  if (typeof to !== 'string' || !to.startsWith('/') || location.pathname === to) return;
  cinnamon.settings.set('go', null);
  location.assign(to);
}
// …and clicks: the `click` setting names a button, link or menu item by its text or label (as the app has it, before
// masking), which is clicked once.
function click(settings: Record<string, unknown>): void {
  const label = settings.click;
  if (typeof label !== 'string' || !label) return;
  cinnamon.settings.set('click', null);
  const textOf = (e: Element): string => {
    let t = '';
    const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) t += original.get(n as Text) ?? (n as Text).data;
    return t.replace(/\s+/g, ' ').trim();
  };
  const hit = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"]')]
    .find((e) => (e.getAttribute('aria-label') === label || textOf(e) === label) && e.getClientRects().length); // exact only: never a chat by accident
  (hit as HTMLElement | undefined)?.click();
}
function steer(settings: Record<string, unknown>): void { go(settings); click(settings); }
steer(cinnamon.settings.all());
cinnamon.settings.onChange(steer);

cinnamon.onDispose(() => {
  observer.disconnect();
  for (const [node, text] of original) if (node.isConnected && node.data === assigned.get(node)) node.data = text;
  assigned.clear(); original.clear();
  delete document.documentElement.dataset.cinnamonDemo;
  hideImages.remove();
});
