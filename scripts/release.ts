// Publishes a standalone release on GitHub: bun scripts/release.ts [--draft]
// It works in this order:
//   1. Check that the working tree is clean and that tag v<version> (from package.json) is new.
//   2. Run the type check and the tests.
//   3. Build dist/ (see scripts/build.ts).
//   4. Push this commit and the new tag.
//   5. Create the GitHub release with both tarballs and SHA256SUMS.
//   6. Publish the Homebrew formula for it to the tap (not for a draft: its downloads aren't public yet; publish it
//      later with `bun scripts/formula.ts --publish`).
// `brew upgrade`, `cinnamon update` and install.sh pick up the release from there.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Paths } from '../core/cli/Paths';
import { build } from './build';
import { publishFormula, readSums, renderFormula } from './formula';

const ROOT = path.join(import.meta.dir, '..');

function sh(cmd: string, args: string[], { quiet = false } = {}): string {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'pipe', 'inherit'] });
  if (r.status !== 0) { console.error(`${cmd} ${args.join(' ')} failed${quiet ? `:\n${r.stderr}` : ''}`); process.exit(1); }
  return r.stdout.trim();
}

const version = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const tag = `v${version}`;
const draft = process.argv.includes('--draft');

if (sh('git', ['status', '--porcelain'], { quiet: true })) { console.error('Commit or stash your changes first.'); process.exit(1); }
if (sh('git', ['tag', '-l', tag], { quiet: true })) { console.error(`${tag} exists already: raise the version in package.json.`); process.exit(1); }

console.log('Checking…');
sh('bun', ['run', 'typecheck']);
sh('bun', ['run', 'test']);

console.log(`Building ${tag}…`);
const tarballs = await build();
const assets = [...tarballs, path.join(ROOT, 'dist', 'SHA256SUMS')];

sh('git', ['tag', '-a', tag, '-m', `Cinnamon ${version}`]);
sh('git', ['push', 'origin', 'HEAD']);
sh('git', ['push', 'origin', tag]);

const notes = `One \`cinnamon\` command with Bun and everything else inside.

Install with Homebrew:
\`\`\`sh
brew install ${Paths.FORMULA}
cinnamon install
\`\`\`
Or without Homebrew:
\`\`\`sh
curl -fsSL https://raw.githubusercontent.com/${Paths.REPO}/main/install.sh | sh
\`\`\`
Already installed: \`cinnamon update\`.`;
sh('gh', ['release', 'create', tag, '--repo', Paths.REPO, '--title', `Cinnamon ${version}`, '--notes', notes, '--verify-tag', ...(draft ? ['--draft'] : []), ...assets]);
console.log(`Released ${tag}${draft ? ' (draft)' : ''}.`);

if (!draft) publishFormula(renderFormula({ version, repo: Paths.REPO, sha256: readSums(path.join(ROOT, 'dist', 'SHA256SUMS')) }), version);
