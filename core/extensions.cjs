// Extensions: folders with a manifest.json, bundled (extensions/ in the tool) or installed by the user
// (~/.config/claude-cinnamon/extensions/). Used by the main process (core/main.js.tmpl). No Electron.
//
// manifest.json: { "name", "description", "version", "page": ["x.js"], "css": ["x.css"],
//                  "main": "x.cjs" (bundled only), "enabledByDefault": true, "githubRepo": "owner/repo" }
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function readManifest(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('manifest is not an object');
  return m;
}

/** { bundled, user } folders → [{ id, dir, bundled, name, description, manifest, error? }], sorted by name. */
function listExtensions({ bundled, user }) {
  const byId = new Map();
  for (const [root, isBundled] of [[bundled, true], [user, false]]) {
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const id of names) {
      if (!ID.test(id)) continue;
      if (byId.has(id) && byId.get(id).bundled) continue; // a download can't replace a bundled extension
      const dir = path.join(root, id);
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      try {
        const manifest = readManifest(dir);
        byId.set(id, {
          id, dir, bundled: isBundled, manifest,
          name: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : id,
          description: typeof manifest.description === 'string' ? manifest.description : '',
        });
      } catch (e) {
        byId.set(id, { id, dir, bundled: isBundled, manifest: {}, name: id, description: '', error: String(e.message || e) });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isEnabled(ext, config) {
  if (ext.error) return false;
  const set = config && config.extensions && config.extensions[ext.id];
  if (typeof set === 'boolean') return set;
  return ext.manifest.enabledByDefault !== false;
}

// A file named in the manifest, resolved inside the extension folder (or null if it would escape it, by its
// path or through a link).
function inside(dir, rel, ext) {
  if (typeof rel !== 'string' || !rel.endsWith(ext) || path.isAbsolute(rel)) return null;
  const full = path.resolve(dir, rel);
  if (!full.startsWith(dir + path.sep)) return null;
  try {
    const realDir = fs.realpathSync(dir);
    if (!fs.realpathSync(full).startsWith(realDir + path.sep)) return null;
  } catch { /* missing file: reported when read */ }
  return full;
}

/** Reads an extension's files: { page: [code], css: [text], main: path|null, errors: [] }. */
function loadExtension(e) {
  const out = { page: [], css: [], main: null, errors: [] };
  for (const [key, suffix] of [['page', '.js'], ['css', '.css']]) {
    for (const rel of Array.isArray(e.manifest[key]) ? e.manifest[key] : []) {
      const full = inside(e.dir, rel, suffix);
      if (!full) { out.errors.push(`${e.id}: ${key} file ${JSON.stringify(rel)} refused (must be a ${suffix} file inside the extension)`); continue; }
      try { out[key].push(fs.readFileSync(full, 'utf8')); } catch { out.errors.push(`${e.id}: ${key} file ${rel} not found`); }
    }
  }
  if (e.manifest.main !== undefined) {
    if (!e.bundled) out.errors.push(`${e.id}: "main" ignored (downloaded extensions run in the page only)`);
    else {
      const full = inside(e.dir, e.manifest.main, '.cjs');
      if (full && fs.existsSync(full)) out.main = full;
      else out.errors.push(`${e.id}: main file ${JSON.stringify(e.manifest.main)} not found or refused`);
    }
  }
  return out;
}

module.exports = { listExtensions, isEnabled, loadExtension };
