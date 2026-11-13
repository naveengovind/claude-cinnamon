// Session metadata for the sidebar cards, read from the Claude app's own session files and the
// matching Claude Code session logs. Only display fields are kept: folder, branch, last activity time,
// model, whether a turn is in progress (and since when), the app's after-turn status and its one-line summary.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

const DEFAULT_PROJECTS = path.join(require('node:os').homedir(), '.claude', 'projects');
const TAIL = 64 * 1024;
const LONG_TAIL = 1024 * 1024;
const STALE_MS = 15 * 60e3;
const logCache = new Map(); // log path -> { key: "size:mtime", branch, since, mtime }

function readTail(file, size, len) {
  const fd = fs.openSync(file, 'r');
  try {
    const n = Math.min(len, size);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    const lines = buf.toString('utf8').split('\n');
    if (n < size) lines.shift(); // first line is partial
    return lines;
  } finally { fs.closeSync(fd); }
}

const isToolResult = (e) => Array.isArray(e.message?.content) && e.message.content.some((c) => c && c.type === 'tool_result');
const promptText = (e) => {
  const c = e.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
};
const isInterrupt = (e) => /^\[Request interrupted/.test(promptText(e));

// From a log tail: is the latest turn still running, and when was its prompt sent? → ms or null.
function turnSince(lines) {
  const conv = [];
  for (const l of lines) {
    if (!l) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (e && (e.type === 'user' || e.type === 'assistant')) conv.push(e);
  }
  const last = conv[conv.length - 1];
  if (!last) return { running: false, since: null };
  let running;
  if (last.type === 'assistant') running = !last.message?.stop_reason || last.message.stop_reason === 'tool_use';
  else running = isToolResult(last) || !isInterrupt(last);
  if (!running) return { running: false, since: null };
  for (let i = conv.length - 1; i >= 0; i--) {
    const e = conv[i];
    if (e.type === 'user' && !isToolResult(e) && !e.isMeta && !isInterrupt(e)) {
      const t = Date.parse(e.timestamp);
      return { running: true, since: Number.isFinite(t) ? t : null };
    }
  }
  return { running: true, since: null };
}

// Branch and running state from the Claude Code log of a session (tail only; cached by size+mtime).
function logInfo(projectsRoot, cwd, cliId, now) {
  const none = { branch: null, working: null };
  if (!cwd || !cliId) return none;
  const file = path.join(projectsRoot, cwd.replace(/[^A-Za-z0-9]/g, '-'), `${cliId}.jsonl`);
  let st;
  try { st = fs.statSync(file); } catch { return none; }
  const key = `${st.size}:${st.mtimeMs}`;
  let hit = logCache.get(file);
  if (!hit || hit.key !== key) {
    let branch = null, running = false, since = null;
    try {
      let lines = readTail(file, st.size, TAIL);
      const text = lines.join('\n');
      const all = [...text.matchAll(/"gitBranch":"((?:[^"\\]|\\.)*)"/g)];
      const last = all.length ? JSON.parse(`"${all[all.length - 1][1]}"`) : null;
      branch = last && last !== 'HEAD' ? last : null;
      ({ running, since } = turnSince(lines));
      if (running && since == null && st.size > TAIL) {
        lines = readTail(file, st.size, LONG_TAIL);
        ({ running, since } = turnSince(lines));
      }
      if (running && since == null) since = st.mtimeMs;
    } catch { branch = null; running = false; since = null; }
    hit = { key, branch, running, since, mtime: st.mtimeMs };
    logCache.set(file, hit);
  }
  const fresh = now - hit.mtime < STALE_MS;
  return { branch: hit.branch, working: hit.running && fresh ? hit.since : null };
}

const NEEDS = new Set(['needs_input', 'need_input', 'awaiting_permission', 'requires_action']);
const STATES = { blocked: 'blocked', failed: 'failed', review_ready: 'review' };

// The app's own after-turn status, reduced to the chips worth showing: needs | blocked | failed | review | null.
function appState(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.interruptedAwaitingPerson) return 'needs';
  const p = d.postTurnSummary;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.needs_action === 'string' && p.needs_action.trim()) return 'needs';
  const cat = typeof p.status_category === 'string' ? p.status_category : '';
  if (NEEDS.has(cat)) return 'needs';
  return STATES[cat] || null;
}

function readSessions(root, { projectsRoot = DEFAULT_PROJECTS, now = Date.now() } = {}) {
  const out = {};
  for (const account of subdirs(root)) {
    for (const org of subdirs(account)) {
      let names = [];
      try { names = fs.readdirSync(org); } catch {}
      for (const name of names) {
        if (!/^local_.+\.json$/.test(name)) continue;
        let d;
        try { d = JSON.parse(fs.readFileSync(path.join(org, name), 'utf8')); } catch { continue; }
        if (!d || typeof d !== 'object') continue;
        const str = (v) => (typeof v === 'string' && v ? v : null);
        const dir = str(d.originCwd) || str(d.cwd);
        const log = logInfo(projectsRoot, str(d.cwd), str(d.cliSessionId), now);
        const summary = d.postTurnSummary && typeof d.postTurnSummary === 'object' ? str(d.postTurnSummary.status_detail) : null;
        out[name.slice(0, -'.json'.length)] = {
          folder: dir ? path.basename(dir) : '',
          branch: str(d.branch) || log.branch || str(d.worktreeName),
          time: typeof d.lastActivityAt === 'number' ? d.lastActivityAt : null,
          model: str(d.model),
          working: log.working,
          state: appState(d),
          summary: summary ? summary.slice(0, 200) : null,
        };
      }
    }
  }
  return out;
}

function relTime(ms, now) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (h < 1) return `${Math.floor(m)}m`;
  if (d < 1) return `${Math.floor(h)}h`;
  if (d < 14) return `${Math.floor(d)}d`;
  if (d < 63) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

function shortModel(id) {
  if (!id) return null;
  const parts = id.replace(/^claude-/, '').split('-').filter((p) => !/^\d{8}$/.test(p));
  const family = parts.shift();
  if (!family) return null;
  const name = family[0].toUpperCase() + family.slice(1);
  return parts.length ? `${name} ${parts.join('.')}` : name;
}

function payload(root, now, { labels = {}, ...opts } = {}) {
  const out = {};
  for (const [id, m] of Object.entries(readSessions(root, { ...opts, now }))) {
    out[id] = {
      folder: m.folder,
      branch: m.branch,
      rel: m.time == null ? '' : relTime(m.time, now),
      model: shortModel(m.model),
      working: m.working,
      state: m.state,
      summary: m.summary,
      label: labels[id]?.label ?? null,
    };
  }
  return out;
}

module.exports = { readSessions, relTime, shortModel, payload, appState };
