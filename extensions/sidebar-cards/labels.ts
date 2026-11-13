// Your own session labels (To do / In progress / Done), kept in a plain JSON file you can read:
// { "<sessionId>": { "label": "todo" | "doing" | "done", "setAt": <ms> } }
import fs from 'node:fs';

export const LABELS = { todo: 'To do', doing: 'In progress', done: 'Done' } as const;
export type Label = keyof typeof LABELS;
export type Labels = Record<string, { label: Label; setAt: number }>;

export class LabelStore {
  static readonly SESSION_ID = /^local_[A-Za-z0-9-]{1,64}$/;
  static readonly MAX = 2000; // newest kept

  constructor(readonly file: string) {}

  read(): Labels {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      return d && typeof d === 'object' && !Array.isArray(d) ? (d as Labels) : {};
    } catch { return {}; }
  }

  /** changes: { sessionId: label | null }; null clears. Unknown labels and odd session ids are ignored; at most MAX
   *  labels are kept (the newest). Written atomically. */
  apply(changes: Record<string, unknown> | null | undefined, now = Date.now()): Labels {
    let cur = this.read();
    for (const [id, label] of Object.entries(changes || {})) {
      if (!LabelStore.SESSION_ID.test(id)) continue;
      if (label === null) delete cur[id];
      else if (typeof label === 'string' && Object.hasOwn(LABELS, label)) cur[id] = { label: label as Label, setAt: now };
    }
    const ids = Object.keys(cur);
    if (ids.length > LabelStore.MAX) {
      const keep = ids.sort((a, b) => (cur[b]?.setAt || 0) - (cur[a]?.setAt || 0)).slice(0, LabelStore.MAX);
      cur = Object.fromEntries(keep.map((id) => [id, cur[id]!]));
    }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(cur, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
    return cur;
  }
}

// Function forms (used by the tests).
export const readLabels = (file: string): Labels => new LabelStore(file).read();
export const applyLabelChanges = (file: string, changes: Record<string, unknown> | null | undefined, now = Date.now()): Labels => new LabelStore(file).apply(changes, now);
