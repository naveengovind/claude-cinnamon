// Where Cinnamon's files are: the install (CINNAMON_ROOT, a stable path such as Homebrew's opt/ link, so the login
// item survives upgrades) and your own folder (CINNAMON_HOME, default ~/.config/claude-cinnamon). A standalone binary
// sets CINNAMON_BIN (itself) and CINNAMON_VERSION.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class Paths {
  readonly root: string;
  readonly user: string;
  readonly config: string;
  readonly themes: string;
  readonly extensions: string;
  readonly logs: string;
  readonly applied: string;
  readonly helperApp: string;
  readonly bundledThemes: string;
  readonly bundledExtensions: string;
  /** The standalone binary, when running as one. */
  readonly binary: string | null;
  readonly version: string;
  static readonly LABEL = 'local.claude-cinnamon.helper';
  static readonly FORMULA = 'naveengovind/tap/cinnamon';
  static readonly REPO = 'naveengovind/claude-cinnamon';

  constructor(env: NodeJS.ProcessEnv = process.env, defaultRoot = path.join(import.meta.dir, '..', '..')) {
    this.root = env.CINNAMON_ROOT || defaultRoot;
    this.user = env.CINNAMON_HOME || path.join(os.homedir(), '.config', 'claude-cinnamon');
    this.config = path.join(this.user, 'config.json');
    this.themes = path.join(this.user, 'themes');
    this.extensions = path.join(this.user, 'extensions');
    this.logs = path.join(this.user, 'logs', 'helper.log');
    this.applied = path.join(this.user, 'state', 'applied');
    this.helperApp = path.join(this.user, 'helper', 'Cinnamon Helper.app');
    this.bundledThemes = path.join(this.root, 'themes');
    this.bundledExtensions = path.join(this.root, 'extensions');
    this.binary = env.CINNAMON_BIN || null;
    this.version = env.CINNAMON_VERSION || Paths.packageVersion(this.root);
  }

  private static packageVersion(root: string): string {
    try { return String((JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: unknown }).version ?? '?'); } catch { return '?'; }
  }

  core(...parts: string[]): string { return path.join(this.root, 'core', ...parts); }
}
