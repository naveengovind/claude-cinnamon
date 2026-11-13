// Extensions: folders with a manifest.json, bundled (extensions/ in Cinnamon) or installed by the user
// (~/.config/claude-cinnamon/extensions/). Used by the CLI and the main process. No Electron.
//
// manifest.json: { "id", "name", "description", "version", "page": ["x.js" | "x.ts"], "css": ["x.css"],
//                  "main": "x.cjs" | "x.ts" (bundled only), "enabledByDefault": true }
// TypeScript files are compiled by the main process when it loads them (see core/main/Compiler.ts).
import fs from 'node:fs';
import path from 'node:path';

export interface Manifest {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  version?: unknown;
  page?: unknown;
  css?: unknown;
  main?: unknown;
  enabledByDefault?: unknown;
  [key: string]: unknown;
}
export interface ExtensionEntry {
  id: string;
  dir: string;
  bundled: boolean;
  name: string;
  description: string;
  manifest: Manifest;
  error?: string;
}
export interface ExtensionRoots { bundled: string; user: string }
/** The files an extension's manifest names, each checked to be inside its folder. */
export interface ExtensionFiles { page: string[]; css: string[]; main: string | null; errors: string[] }
/** The same, read: page and css sources (as written; TypeScript is compiled later), the main part's path. */
export interface LoadedExtension { page: string[]; css: string[]; main: string | null; errors: string[] }

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SUFFIXES = { page: ['.js', '.ts'], css: ['.css'], main: ['.cjs', '.ts'] } as const;

export class ExtensionCatalog {
  constructor(readonly roots: ExtensionRoots) {}

  /** Bundled and user extensions, sorted by name. A user folder can't replace a bundled id. */
  list(): ExtensionEntry[] {
    const byId = new Map<string, ExtensionEntry>();
    for (const [root, isBundled] of [[this.roots.bundled, true], [this.roots.user, false]] as const) {
      let names: string[] = [];
      try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
      for (const id of names) {
        if (!ID.test(id)) continue;
        if (byId.has(id) && byId.get(id)!.bundled) continue; // a download can't replace a bundled extension
        const dir = path.join(root, id);
        if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
        try {
          const manifest = ExtensionCatalog.readManifest(dir);
          byId.set(id, {
            id, dir, bundled: isBundled, manifest,
            name: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : id,
            description: typeof manifest.description === 'string' ? manifest.description : '',
          });
        } catch (e) {
          byId.set(id, { id, dir, bundled: isBundled, manifest: {}, name: id, description: '', error: String((e as Error).message || e) });
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  static readManifest(dir: string): Manifest {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as unknown;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('manifest is not an object');
    return m as Manifest;
  }

  /** On unless the config turns it off, or its manifest says off by default; never when it failed to load. */
  static isEnabled(ext: { id: string; manifest: Manifest; error?: string }, config: { extensions?: Record<string, unknown> } | null | undefined): boolean {
    if (ext.error) return false;
    const set = config && config.extensions && config.extensions[ext.id];
    if (typeof set === 'boolean') return set;
    return ext.manifest.enabledByDefault !== false;
  }

  /** The page, css and main files of an extension, refusing anything outside its folder (by path or through a link). */
  static files(e: ExtensionEntry): ExtensionFiles {
    const out: ExtensionFiles = { page: [], css: [], main: null, errors: [] };
    for (const key of ['page', 'css'] as const) {
      const list = e.manifest[key];
      for (const rel of Array.isArray(list) ? (list as unknown[]) : []) {
        const full = ExtensionCatalog.inside(e.dir, rel, SUFFIXES[key]);
        if (!full) { out.errors.push(`${e.id}: ${key} file ${JSON.stringify(rel)} refused (must be a ${SUFFIXES[key].join(' or ')} file inside the extension)`); continue; }
        if (!ExtensionCatalog.isFile(full)) { out.errors.push(`${e.id}: ${key} file ${String(rel)} not found`); continue; }
        out[key].push(full);
      }
    }
    if (e.manifest.main !== undefined) {
      if (!e.bundled) out.errors.push(`${e.id}: "main" ignored (downloaded extensions run in the page only)`);
      else {
        const full = ExtensionCatalog.inside(e.dir, e.manifest.main, SUFFIXES.main);
        if (full && fs.existsSync(full)) out.main = full;
        else out.errors.push(`${e.id}: main file ${JSON.stringify(e.manifest.main)} not found or refused`);
      }
    }
    return out;
  }

  /** Reads an extension's files: { page: [source], css: [text], main: path|null, errors: [] }. */
  static load(e: ExtensionEntry): LoadedExtension {
    const f = ExtensionCatalog.files(e);
    const out: LoadedExtension = { page: [], css: [], main: f.main, errors: f.errors };
    for (const key of ['page', 'css'] as const) {
      for (const full of f[key]) {
        try { out[key].push(fs.readFileSync(full, 'utf8')); } catch { out.errors.push(`${e.id}: ${key} file ${path.relative(e.dir, full)} not found`); }
      }
    }
    return out;
  }

  // A file named in the manifest, resolved inside the extension folder (or null if it would escape it, by its
  // path or through a link).
  private static inside(dir: string, rel: unknown, suffixes: readonly string[]): string | null {
    if (typeof rel !== 'string' || !suffixes.some((s) => rel.endsWith(s)) || path.isAbsolute(rel)) return null;
    const full = path.resolve(dir, rel);
    if (!full.startsWith(dir + path.sep)) return null;
    try {
      const realDir = fs.realpathSync(dir);
      if (!fs.realpathSync(full).startsWith(realDir + path.sep)) return null;
    } catch { /* missing file: reported as not found */ }
    return full;
  }

  private static isFile(file: string): boolean {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  }
}

export const listExtensions = (roots: ExtensionRoots): ExtensionEntry[] => new ExtensionCatalog(roots).list();
export const isEnabled = ExtensionCatalog.isEnabled;
export const loadExtension = (e: ExtensionEntry): LoadedExtension => ExtensionCatalog.load(e);
