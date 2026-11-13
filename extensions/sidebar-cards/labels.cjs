// Your own session labels (To do / In progress / Done), kept in a plain JSON file you can read:
// { "<sessionId>": { "label": "todo" | "doing" | "done", "setAt": <ms> } }
'use strict';
const fs = require('node:fs');

const LABELS = { todo: 'To do', doing: 'In progress', done: 'Done' };
const SESSION_ID = /^local_[A-Za-z0-9-]{1,64}$/;
const MAX = 2000; // newest kept

function readLabels(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

// changes: { sessionId: label | null }; null clears. Unknown labels and odd session ids are ignored; at most MAX
// labels are kept (the newest). Written atomically.
function applyLabelChanges(file, changes, now = Date.now()) {
  let cur = readLabels(file);
  for (const [id, label] of Object.entries(changes || {})) {
    if (!SESSION_ID.test(id)) continue;
    if (label === null) delete cur[id];
    else if (Object.hasOwn(LABELS, label)) cur[id] = { label, setAt: now };
  }
  const ids = Object.keys(cur);
  if (ids.length > MAX) {
    const keep = ids.sort((a, b) => (cur[b]?.setAt || 0) - (cur[a]?.setAt || 0)).slice(0, MAX);
    cur = Object.fromEntries(keep.map((id) => [id, cur[id]]));
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return cur;
}

module.exports = { LABELS, readLabels, applyLabelChanges };
