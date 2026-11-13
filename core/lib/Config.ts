// config.json in the user folder: { "theme": "<id>", "extensions": { "<id>": true|false }, "settings": { "<id>": {…} } }.
// Used by the CLI and the main process. No Electron.
import fs from 'node:fs';
import path from 'node:path';

export type JsonObject = Record<string, unknown>;

export interface CinnamonConfig extends JsonObject {
  theme: string;
  extensions?: Record<string, unknown>;
  settings?: unknown;
}

const isObject = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);

export class Config {
  constructor(readonly file: string) {}

  /** The config, with `theme` defaulting to "default" when the file is missing, corrupt or has no theme. */
  read(): CinnamonConfig {
    let cfg: unknown = {};
    try { cfg = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    const out: JsonObject = isObject(cfg) ? cfg : {};
    if (typeof out.theme !== 'string' || !out.theme) out.theme = 'default';
    return out as CinnamonConfig;
  }

  /** Merges `patch` into what is on disk (top-level keys) and writes it atomically. */
  write(patch: JsonObject): JsonObject {
    let cur: unknown = {};
    try { cur = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    const next = { ...(isObject(cur) ? cur : {}), ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
    return next;
  }
}

export const readConfig = (file: string): CinnamonConfig => new Config(file).read();
export const writeConfig = (file: string, patch: JsonObject): JsonObject => new Config(file).write(patch);
