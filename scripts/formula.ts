// The Homebrew formula (Formula/cinnamon.rb in naveengovind/homebrew-tap), made from a release's checksums:
//   bun scripts/formula.ts             prints it for package.json's version and dist/SHA256SUMS
//   bun scripts/formula.ts --publish   commits it to the tap and pushes (scripts/release.ts does this after each release)
// It installs the standalone binary for the Mac's architecture, so Homebrew needs nothing else.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../core/cli/Paths';

export interface Sums { arm64: string; x64: string }
const ROOT = path.join(import.meta.dir, '..');

export function renderFormula({ version, repo, sha256 }: { version: string; repo: string; sha256: Sums }): string {
  const asset = (arch: keyof Sums) => `https://github.com/${repo}/releases/download/v${version}/cinnamon-darwin-${arch}.tar.gz`;
  return `# Cinnamon: themes and extensions for the Claude desktop app (macOS).
# Made by scripts/formula.ts in ${repo} at each release; change it there.
class Cinnamon < Formula
  desc "Themes and extensions for the Claude desktop app, Spicetify-style"
  homepage "https://github.com/${repo}"
  version "${version}"

  on_arm do
    url "${asset('arm64')}"
    sha256 "${sha256.arm64}"
  end
  on_intel do
    url "${asset('x64')}"
    sha256 "${sha256.x64}"
  end

  livecheck do
    url :stable
    strategy :github_latest
  end

  depends_on macos: :ventura

  def install
    bin.install "cinnamon"
  end

  def caveats
    <<~EOS
      Finish setting up (adds the login item that applies Cinnamon each time Claude starts):
        cinnamon install

      Cinnamon needs Developer Mode in Claude: Help > Troubleshooting > Enable Developer Mode.

      Before \`brew uninstall cinnamon\`, run: cinnamon uninstall
    EOS
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/cinnamon --version").strip
  end
end
`;
}

/** The two tarballs' checksums from a release's SHA256SUMS. */
export function readSums(file: string): Sums {
  const sums: Partial<Sums> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?cinnamon-darwin-(arm64|x64)\.tar\.gz$/.exec(line.trim());
    if (m) sums[m[2] as keyof Sums] = m[1];
  }
  for (const arch of ['arm64', 'x64'] as const) if (!sums[arch]) throw new Error(`${file} has no checksum for the ${arch} build`);
  return sums as Sums;
}

function git(dir: string, args: string[]): { status: number; out: string } {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { status: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** Commits the formula to the tap and pushes it; says so and does nothing when the tap has it already. */
export function publishFormula(text: string, version: string, tap = Paths.TAP): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinnamon-tap-'));
  try {
    const clone = spawnSync('gh', ['repo', 'clone', tap, dir, '--', '--quiet'], { encoding: 'utf8' });
    if (clone.status !== 0) throw new Error(`could not clone ${tap}:\n${clone.stderr}`);
    fs.mkdirSync(path.join(dir, 'Formula'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Formula', 'cinnamon.rb'), text);
    git(dir, ['add', 'Formula/cinnamon.rb']);
    if (git(dir, ['diff', '--cached', '--quiet']).status === 0) { console.log(`${tap} has this formula already.`); return; }
    for (const step of [['commit', '-q', '-m', `cinnamon ${version}`], ['push', '-q', 'origin', 'HEAD']]) {
      const r = git(dir, step);
      if (r.status !== 0) throw new Error(`git ${step[0]} in ${tap} failed:\n${r.out}`);
    }
    console.log(`Published the cinnamon ${version} formula to ${tap}.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const version = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const text = renderFormula({ version, repo: Paths.REPO, sha256: readSums(path.join(ROOT, 'dist', 'SHA256SUMS')) });
  if (process.argv.includes('--publish')) publishFormula(text, version);
  else process.stdout.write(text);
}
