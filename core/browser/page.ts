// Cinnamon in claude.ai's own page (the MAIN world) when it runs in a browser through the Cinnamon extension, put in
// before the page runtime (core/page/runtime.ts) and the Settings rows:
//   window.__cinnamonSend(msg)   what the runtime and the rows send to Cinnamon: posted to the extension's content
//                                script (same window, same origin), which passes it on to the cinnamon command
//   window.__cinnamonBrowser.ran which extension code already runs in this document (id → signature), so code is
//                                never run twice in one document (browser/apply.ts reads and writes it)

interface BrowserPage { ran: Record<string, string> }
interface PageWindow { __cinnamonSend?: (msg: unknown) => void; __cinnamonBrowser?: BrowserPage }

/** The tag the content script looks for on messages from the page. */
const TO_HOST = 'cinnamon:to-host';

const w = window as unknown as PageWindow;
w.__cinnamonBrowser ??= { ran: {} };
w.__cinnamonSend = (msg: unknown): void => {
  try { window.postMessage({ [TO_HOST]: true, msg }, location.origin); } catch {}
};

export {};
