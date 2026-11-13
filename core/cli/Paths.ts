// Where Cinnamon's files are: the install (CINNAMON_ROOT, a stable path such as Homebrew's opt/ link, so the login
// item survives upgrades) and your own folder (CINNAMON_HOME, default ~/.config/claude-cinnamon).
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
  static readonly LABEL = 'local.claude-cinnamon.helper';
  static readonly FORMULA = 'naveengovind/tap/cinnamon';

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
  }

  core(...parts: string[]): string { return path.join(this.root, 'core', ...parts); }
}
