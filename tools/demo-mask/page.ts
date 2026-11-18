/// <reference path="../../types/cinnamon.d.ts" />
// Demo mask: for screenshots of Cinnamon that are safe to publish. Every piece of text in the sidebar that isn't one of
// the app's own labels (chat and session titles, pinned items, project, folder and branch names, the account) is
// swapped for a made-up one, so nothing of the person's own shows. Anything it doesn't recognize is replaced, never
// kept. Not a built-in extension: scripts/screenshots.ts puts it in place while it takes pictures, then removes it.
// Taking it out puts the real text back.

const KEEP = new Set([
  'New', 'New chat', 'New session', 'Search', 'Projects', 'Meetings', 'Beta', 'Artifacts', 'Scheduled', 'Dispatch',
  'Design', 'Customize', 'Pinned', 'Chats and tasks', 'Chats', 'Recents', 'Starred', 'View all', 'Code', 'Chat',
  'Cowork', 'Sessions', 'Routines', 'Working', 'Running', 'Local', 'Cloud', 'SSH', 'Today', 'Yesterday',
  'Previous 7 days', 'Previous 30 days', 'Older', 'All', 'Archived', 'Show more', 'Show less', '·', '•', '—',
]);
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

const sidebars = (): Element[] => [...document.querySelectorAll('nav, aside')];
const assigned = new Map<Text, string>(); // what we wrote into each node
const original = new Map<Text, string>(); // what the app had there

// The same real text always gets the same made-up one, and each list is handed out in order (no repeats until it runs out).
const given = new Map<string, string>();
const used: Record<string, number> = {};
function next(kind: string, list: readonly string[]): string { const i = (used[kind] = (used[kind] ?? -1) + 1); return list[i % list.length]!; }

function demoFor(text: string, node: Text): string {
  const el = node.parentElement;
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
  if (/icon/i.test(getComputedStyle(el).fontFamily)) return false; // the app's icons are words in an icon font
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

function mask(node: Text): void {
  if (assigned.get(node) === node.data) return;
  const text = node.data.trim();
  if (!text || KEEP.has(text) || NEUTRAL.test(text) || APP_WORDS.test(text) || !visible(node)) return;
  original.set(node, node.data);
  const demo = demoFor(text, node);
  assigned.set(node, demo);
  node.data = demo;
}

function sweep(root: Node): void {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) mask(n as Text);
}

function maskAll(): void { for (const s of sidebars()) sweep(s); }

const observer = new MutationObserver((records) => {
  for (const r of records) {
    const inSidebar = (n: Node | null) => !!(n && (n instanceof Element ? n : n.parentElement)?.closest('nav, aside'));
    if (r.type === 'characterData' && r.target instanceof Text && inSidebar(r.target)) mask(r.target);
    for (const n of r.addedNodes) if (inSidebar(n)) { if (n instanceof Text) mask(n); else sweep(n); }
  }
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true });
maskAll();
document.documentElement.dataset.cinnamonDemo = 'on';

// scripts/screenshots.ts steers the page through this extension's `go` setting (a path such as /epitaxy)
function go(settings: Record<string, unknown>): void {
  const to = settings.go;
  if (typeof to !== 'string' || !to.startsWith('/') || location.pathname === to) return;
  cinnamon.settings.set('go', null);
  location.assign(to);
}
go({ go: cinnamon.settings.get('go') });
cinnamon.settings.onChange(go);

cinnamon.onDispose(() => {
  observer.disconnect();
  for (const [node, text] of original) if (node.isConnected && node.data === assigned.get(node)) node.data = text;
  assigned.clear(); original.clear();
  delete document.documentElement.dataset.cinnamonDemo;
});
