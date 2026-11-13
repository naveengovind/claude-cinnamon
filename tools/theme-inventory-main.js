// Main process: inventory for theming.
//  - what the app's own frame page (file://…/main_window) shows
//  - every colour variable the claude.ai page declares for dark mode, by selector group
//  - every distinct background / border / text colour currently on screen, with an example element
(async () => {
  const { webContents } = require('electron');
  const fs = require('fs');
  const all = webContents.getAllWebContents().filter((w) => !w.isDestroyed());
  const frame = all.find((w) => w.getURL().startsWith('file://'));
  const page = all.find((w) => /^https:\/\/claude\.ai\//.test(w.getURL()));
  const frameInfo = frame && await frame.executeJavaScript(`({ title: document.title, text: document.body.innerText.slice(0, 200), bg: getComputedStyle(document.body).backgroundColor, html: document.documentElement.outerHTML.length, rootAttrs: [...document.documentElement.attributes].map((a) => a.name + '=' + a.value.slice(0, 30)), size: [innerWidth, innerHeight] })`).catch((e) => String(e));
  const pageInfo = await page.executeJavaScript(`(() => {
    const groups = {};
    const walk = (rs, media) => { for (const r of rs) {
      if (r.cssRules && !r.selectorText) { try { walk(r.cssRules, r.media ? r.media.mediaText : media); } catch {} continue; }
      if (!r.style || !r.selectorText) continue;
      const sel = r.selectorText;
      const dark = /data-mode="dark"|cds-dark-scope|\\.dark\\b/.test(sel);
      const fizzy = /fizzy-lake/.test(sel);
      const key = (dark ? 'dark' : 'base') + (fizzy ? '+fizzy' : '');
      for (const n of r.style) if (n.startsWith('--cds-') || n.startsWith('--df-') || n.startsWith('--dframe')) {
        const v = r.style.getPropertyValue(n).trim();
        if (!/#|rgb|hsl|color|var\\(--cds-(gray|alpha|neutral|white|black)/.test(v)) continue;
        ((groups[key] ??= {})[n] ??= []).push(v.slice(0, 90));
      }
    } };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
    const seen = { bg: {}, border: {}, color: {} };
    const tally = (kind, c, el) => { if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return; const t = (seen[kind][c] ??= { n: 0, ex: '' }); t.n++; if (!t.ex) t.ex = el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 3).join('.').slice(0, 60); };
    for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); tally('bg', cs.backgroundColor, el); if (parseFloat(cs.borderTopWidth) > 0) tally('border', cs.borderTopColor, el); if (el.childElementCount === 0 && el.textContent.trim()) tally('color', cs.color, el); }
    const top = (o) => Object.entries(o).sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([c, t]) => c + '  x' + t.n + '  ' + t.ex);
    return { groups, onScreen: { bg: top(seen.bg), border: top(seen.border), color: top(seen.color) } };
  })()`);
  fs.writeFileSync('__OUT__', JSON.stringify({ frameInfo, pageInfo }, null, 1));
  return { frameInfo, groupSizes: Object.fromEntries(Object.entries(pageInfo.groups).map(([k, v]) => [k, Object.keys(v).length])) };
})()
