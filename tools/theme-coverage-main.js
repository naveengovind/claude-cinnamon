// Main process: theme coverage check. Opens each menu, dropdown, dialog and side panel it can find, and reports
// opaque neutral colours that are not in the active theme's palette, with the CSS variables those elements use.
// Usage: CM_PALETTE="#111111,#151515,…" substituted for __PALETTE__ by the caller.
(async () => {
  const { webContents } = require('electron');
  const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && /^https:\/\/claude\.ai\//.test(w.getURL()));
  const palette = __PALETTE__;
  const surfaces = [
    ['account menu', 'button[aria-haspopup="menu"][aria-label*="account" i]'],
    ['group and sort', 'button[aria-label="Group and sort"]'],
    ['session menu', 'button[aria-label^="More options for Test"]'],
    ['view options', 'button[aria-label="View options"]'],
    ['composer add', 'button[aria-label="Add"]'],
    ['model picker', 'button[aria-label^="Model:"]'],
    ['permissions', 'button[aria-label="Bypass permissions"], button[aria-label*="permission" i]'],
    ['usage', 'button[aria-label^="Usage"]'],
    ['terminal panel', 'button[aria-label="Terminal"]'],
    ['changes panel', 'button[aria-label="Changes"]'],
    ['browser panel', 'button[aria-label="Browser"]'],
    ['files panel', 'button[aria-label="Files"]'],
  ];
  const scan = `(() => {
    const palette = new Set(${JSON.stringify(palette)}.map((h) => h.toLowerCase()));
    const rules = []; const walk = (rs) => { for (const r of rs) { if (r.cssRules && !r.selectorText) { try { walk(r.cssRules); } catch {} continue; } if (r.selectorText && /var\\(--/.test(r.style.cssText)) rules.push(r); } };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
    const toHex = (c) => { const m = c.match(/^rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)$/) || c.match(/^color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)(?: \\/ ([\\d.]+))?\\)$/);
      if (!m) return null; let [r, g, b] = m.slice(1, 4).map(Number); if (c.startsWith('color(')) [r, g, b] = [r, g, b].map((x) => Math.round(x * 255));
      const a = m[4] === undefined ? 1 : Number(m[4]); return { hex: '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''), a, neutral: Math.max(r, g, b) - Math.min(r, g, b) < 6, white: r > 245 && g > 245 && b > 245, black: r < 10 && g < 10 && b < 10 }; };
    const varsFor = (el, prop) => { const names = new Set(); for (const r of rules) { try { if (!el.matches(r.selectorText)) continue; } catch { continue; } const v = r.style.getPropertyValue(prop) || (prop === 'background-color' ? r.style.getPropertyValue('background') : ''); for (const m of v.matchAll(/var\\((--[\\w-]+)/g)) names.add(m[1]); } return [...names].slice(0, 3).join(','); };
    const out = {};
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect(); if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      for (const [kind, prop, val] of [['bg', 'background-color', cs.backgroundColor], ['border', 'border-color', parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : null]]) {
        if (!val) continue; const c = toHex(val); if (!c || c.a === 0 || !c.neutral || c.white || c.black) continue;
        if (c.a < 1 && palette.has(c.hex)) continue; if (palette.has(c.hex)) continue;
        const key = kind + ' ' + c.hex + (c.a < 1 ? '/' + c.a : '');
        (out[key] ??= { n: 0, ex: el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 3).join('.').slice(0, 50), vars: varsFor(el, prop) }).n++;
      }
    }
    return out;
  })()`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { page: await wc.executeJavaScript(scan) };
  for (const [name, sel] of surfaces) {
    const clicked = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
    if (!clicked) { report[name] = 'trigger not found'; continue; }
    await wait(600);
    report[name] = await wc.executeJavaScript(scan);
    // close: Escape for popups, click again for panel toggles
    if (/panel/.test(name)) await wc.executeJavaScript(`document.querySelector(${JSON.stringify(sel)})?.click()`);
    else wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await wait(400);
  }
  return report;
})()
