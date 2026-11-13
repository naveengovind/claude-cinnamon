// A Homebrew install of the standalone binary. Homebrew runs it from a versioned folder
// (<prefix>/Cellar/cinnamon/<version>/bin/cinnamon) that the next upgrade removes, while <prefix>/opt/cinnamon always
// links to the installed version: the login item names that link, and updates go through brew.
import fs from 'node:fs';
import path from 'node:path';

const CELLAR = /^(.+)\/Cellar\/cinnamon\/[^/]+\/(.+)$/;
const INSTALL = /^(.+)\/(?:Cellar\/cinnamon\/[^/]+|opt\/cinnamon)\//;

export class Homebrew {
  static readonly FORMULA = 'naveengovind/tap/cinnamon';

  /** The path that survives upgrades: <prefix>/opt/cinnamon/… for a file in the Cellar, otherwise the file itself. */
  static stablePath(file: string, exists: (f: string) => boolean = fs.existsSync): string {
    const m = CELLAR.exec(file);
    if (!m) return file;
    const opt = path.join(m[1]!, 'opt', 'cinnamon', m[2]!);
    return exists(opt) ? opt : file;
  }

  /** Homebrew's prefix when `file` belongs to a Homebrew install of Cinnamon (with brew there to manage it). */
  static prefixOf(file: string | null, exists: (f: string) => boolean = fs.existsSync): string | null {
    const m = file ? INSTALL.exec(file) : null;
    return m && exists(path.join(m[1]!, 'bin', 'brew')) ? m[1]! : null;
  }
}
