// Turning on Claude's main-process debugger also runs `open -a "Google Chrome" chrome://inspect`. The Applier uses
// this (transpiled to plain JavaScript and run with `osascript -l JavaScript`) to undo that:
//   snapshot            -> {"running":bool,"ids":[...]} (before the press)
//   cleanup '<snapshot>' -> closes chrome://inspect tabs opened since the snapshot; quits Chrome if it was not running
//                           before and one of those tabs was found
// Never launches Chrome itself: every window/tab access is behind running().
/* eslint-disable @typescript-eslint/no-explicit-any */
declare function Application(name: string): any;
declare function delay(seconds: number): void;

// JXA calls run(argv) itself.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv: string[]): string {
  const chrome = Application('Google Chrome');
  const isInspect = (url: unknown): boolean => String(url || '').startsWith('chrome://inspect');

  function inspectTabs(): { w: any; id: number }[] {
    const found: { w: any; id: number }[] = [];
    if (!chrome.running()) return found;
    for (const w of chrome.windows()) {
      const ids: number[] = w.tabs.id();
      const urls: string[] = w.tabs.url();
      ids.forEach((id, i) => { if (isInspect(urls[i])) found.push({ w, id }); });
    }
    return found;
  }

  if (argv[0] === 'snapshot') {
    return JSON.stringify({ running: chrome.running(), ids: inspectTabs().map((t) => t.id) });
  }

  if (argv[0] === 'cleanup') {
    let snap: { running?: unknown; ids?: number[] } = {};
    try { snap = JSON.parse(argv[1] || '{}'); } catch {}
    if (typeof snap.running !== 'boolean') return JSON.stringify({ skipped: 'no snapshot' });
    const known = new Set(snap.ids || []);
    let closed = 0;
    // Started at the press: Claude opens the tab a moment later. Check every 0.1s so it is closed almost as soon as
    // it appears; Chrome may still be launching, so give up only after 15s.
    for (let i = 0; i < 150 && !closed; i++) {
      for (const t of inspectTabs()) {
        if (known.has(t.id)) continue;
        t.w.tabs.byId(t.id).close();
        closed++;
      }
      if (!closed) delay(0.1);
    }
    // quit only a Chrome that Claude itself started: it was closed before and the tab we closed was Claude's
    const quit = !snap.running && closed > 0 && chrome.running();
    if (quit) chrome.quit();
    return JSON.stringify({ closed, quit });
  }

  return 'usage: chrome-tab snapshot | cleanup <snapshot>';
}
