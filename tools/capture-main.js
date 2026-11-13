// Main process: save a PNG of the Claude window's page to the path in CM_CAPTURE_PATH (set by the caller via the
// placeholder below), for checking visual changes without a screen-recording permission.
(async () => {
  const { webContents } = require('electron');
  const fs = require('fs');
  const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && /^https:\/\/claude\.ai\//.test(w.getURL()));
  if (!wc) return 'no view';
  const img = await wc.capturePage();
  const out = '__CAPTURE_PATH__';
  fs.writeFileSync(out, img.toPNG());
  return { out, size: img.getSize() };
})()
