// Sidebar cards — main part. Sends each claude.ai view the data its cards show (folder, branch, model, age,
// Working timer, app state, your label), refreshed when session files change and every 6s; saves the labels
// you set in the page (collected every 2s) to labels.json in this extension's data folder.
'use strict';
const path = require('node:path');

function fresh(name) { const p = path.join(__dirname, name); delete require.cache[p]; return require(p); }

module.exports = {
  activate(ctx) {
    const meta = fresh('meta.cjs');
    const labels = fresh('labels.cjs');
    const sessionsRoot = path.join(ctx.appDataDir, 'claude-code-sessions');
    const labelsPath = path.join(ctx.dataDir, 'labels.json');

    // Never throws: a bad session file or a closed view only skips this push.
    async function push(wc) {
      let data;
      try { data = JSON.stringify(meta.payload(sessionsRoot, Date.now(), { labels: labels.readLabels(labelsPath) })); } catch { return; }
      await ctx.run(wc, `window.__cmSetMeta ? (window.__cmSetMeta(${data}), true) : false`);
    }
    const pushAll = async () => { for (const wc of ctx.views()) await push(wc); };

    async function collectLabels() {
      const changes = {};
      for (const wc of ctx.views()) {
        const c = await ctx.run(wc, 'window.__cmTakeLabelChanges ? window.__cmTakeLabelChanges() : null');
        if (c && typeof c === 'object') Object.assign(changes, c);
      }
      if (!Object.keys(changes).length) return;
      try { labels.applyLabelChanges(labelsPath, changes); } catch (e) { ctx.log('could not save labels', e); return; }
      await pushAll();
    }

    ctx.onViewReady(push);
    let debounce = null;
    ctx.watch(sessionsRoot, { recursive: true }, () => {
      if (debounce) ctx.clearTimer(debounce);
      debounce = ctx.setTimeout(pushAll, 300);
    });
    ctx.setInterval(collectLabels, 2000);
    ctx.setInterval(pushAll, 6000);
    return { pushAll, collectLabels };
  },
};
