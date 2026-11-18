// The Cinnamon extension's content script, in each claude.ai page (top frame, its own isolated world). It tells the
// background when a new document starts (so the theme's CSS goes in before the page paints) and when it is ready (so
// Cinnamon's page code can run), and passes on what Cinnamon's page code sends (core/browser/page.ts) to the cinnamon
// command: a theme pick, an extension switched on or off, a setting.
import { TO_HOST } from '../core/browser/protocol';

const tell = (msg: unknown): void => { void chrome.runtime.sendMessage(msg).catch(() => {}); };

tell({ type: 'start' });
const ready = (): void => tell({ type: 'ready' });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
else ready();

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window || e.origin !== location.origin) return; // the page itself, not a frame in it
  const d = e.data as Record<string, unknown> | null;
  if (d && typeof d === 'object' && d[TO_HOST] === true) tell({ type: 'page', msg: d.msg });
});
