// Turning on Claude's main-process debugger also runs `open -a "Google Chrome" chrome://inspect`.
// apply.sh uses this to undo that:
//   osascript -l JavaScript chrome-tab.js snapshot            -> {"running":bool,"ids":[...]} (before the press)
//   osascript -l JavaScript chrome-tab.js cleanup '<snapshot>' -> closes chrome://inspect tabs opened since the
//                                                                 snapshot; quits Chrome if it was not running before
//                                                                 and one of those tabs was found
// Never launches Chrome itself: every window/tab access is behind running().
function run(argv) {
  const chrome = Application('Google Chrome');
  const isInspect = (url) => String(url || '').startsWith('chrome://inspect');

  function inspectTabs() {
    const found = [];
    if (!chrome.running()) return found;
    for (const w of chrome.windows()) {
      const ids = w.tabs.id();
      const urls = w.tabs.url();
      ids.forEach((id, i) => { if (isInspect(urls[i])) found.push({ w, id }); });
    }
    return found;
  }

  if (argv[0] === 'snapshot') {
    return JSON.stringify({ running: chrome.running(), ids: inspectTabs().map((t) => t.id) });
  }

  if (argv[0] === 'cleanup') {
    let snap = {};
    try { snap = JSON.parse(argv[1] || '{}'); } catch (e) {}
    if (typeof snap.running !== 'boolean') return JSON.stringify({ skipped: 'no snapshot' });
    const known = new Set(snap.ids || []);
    let closed = 0;
    // Started at the press: Claude opens the tab a moment later. Check every 0.1s so it is closed almost as soon
    // as it appears; Chrome may still be launching, so give up only after 15s.
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

  return 'usage: chrome-tab.js snapshot | cleanup <snapshot>';
}
