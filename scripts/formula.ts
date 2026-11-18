// The Homebrew formula (Formula/cinnamon.rb in naveengovind/homebrew-tap) and cask (Casks/cinnamon.rb), made from a
// release's checksums:
//   bun scripts/formula.ts             prints them for package.json's version and dist/SHA256SUMS
//   bun scripts/formula.ts --publish   commits them to the tap and pushes (scripts/release.ts does this after each release)
// The formula installs the standalone binary for the Mac's architecture, so Homebrew needs nothing else. The cask
// installs the menu bar app, Cinnamon.app, and links the cinnamon command inside it.
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

export function renderCask({ version, repo, sha256 }: { version: string; repo: string; sha256: Sums }): string {
  const asset = (arch: keyof Sums) => `https://github.com/${repo}/releases/download/v${version}/Cinnamon-app-darwin-${arch}.zip`;
  const owner = repo.split('/')[0];
  return `# Cinnamon: the menu bar app and the cinnamon command, for the Claude desktop app (macOS).
# Made by scripts/formula.ts in ${repo} at each release; change it there.
cask "cinnamon" do
  version "${version}"

  on_arm do
    url "${asset('arm64')}"
    sha256 "${sha256.arm64}"
  end
  on_intel do
    url "${asset('x64')}"
    sha256 "${sha256.x64}"
  end

  name "Cinnamon"
  desc "Themes and extensions for the Claude desktop app"
  homepage "https://${owner}.github.io/${repo.split('/')[1]}/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :ventura"

  app "Cinnamon.app"
  binary "#{appdir}/Cinnamon.app/Contents/Resources/cinnamon"

  # takes out the login item, the Claude Code mod and the skill, and leaves Claude as it was
  uninstall script: {
              executable: "#{appdir}/Cinnamon.app/Contents/Resources/cinnamon",
              args:       ["uninstall"],
              must_succeed: false,
            },
            quit:   "local.claude-cinnamon.app"

  zap trash: "~/.config/claude-cinnamon"

  caveats <<~EOS
    Open Cinnamon from Applications (it lives in the menu bar) to finish setting up, or run: cinnamon install
    Cinnamon needs Developer Mode in Claude: Help > Troubleshooting > Enable Developer Mode.
    If you installed the cinnamon formula before, remove it first: brew uninstall cinnamon
  EOS
end
`;
}

/** The two app zips' checksums from a release's SHA256SUMS. */
export function readAppSums(file: string): Sums {
  const sums: Partial<Sums> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?Cinnamon-app-darwin-(arm64|x64)\.zip$/.exec(line.trim());
    if (m) sums[m[2] as keyof Sums] = m[1];
  }
  for (const arch of ['arm64', 'x64'] as const) if (!sums[arch]) throw new Error(`${file} has no checksum for the ${arch} app`);
  return sums as Sums;
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
export function publishFormula(text: string, version: string, tap = Paths.TAP, cask: string | null = null): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinnamon-tap-'));
  try {
    const clone = spawnSync('gh', ['repo', 'clone', tap, dir, '--', '--quiet'], { encoding: 'utf8' });
    if (clone.status !== 0) throw new Error(`could not clone ${tap}:\n${clone.stderr}`);
    fs.mkdirSync(path.join(dir, 'Formula'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Formula', 'cinnamon.rb'), text);
    git(dir, ['add', 'Formula/cinnamon.rb']);
    if (cask) {
      fs.mkdirSync(path.join(dir, 'Casks'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'Casks', 'cinnamon.rb'), cask);
      git(dir, ['add', 'Casks/cinnamon.rb']);
    }
    if (git(dir, ['diff', '--cached', '--quiet']).status === 0) { console.log(`${tap} has this formula already.`); return; }
    for (const step of [['commit', '-q', '-m', `cinnamon ${version}`], ['push', '-q', 'origin', 'HEAD']]) {
      const r = git(dir, step);
      if (r.status !== 0) throw new Error(`git ${step[0]} in ${tap} failed:\n${r.out}`);
    }
    console.log(`Published the cinnamon ${version} formula${cask ? ' and cask' : ''} to ${tap}.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const version = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const text = renderFormula({ version, repo: Paths.REPO, sha256: readSums(path.join(ROOT, 'dist', 'SHA256SUMS')) });
  const sums = path.join(ROOT, 'dist', 'SHA256SUMS');
  const cask = fs.readFileSync(sums, 'utf8').includes('Cinnamon-app-darwin-') ? renderCask({ version, repo: Paths.REPO, sha256: readAppSums(sums) }) : null;
  if (process.argv.includes('--publish')) publishFormula(text, version, Paths.TAP, cask);
  else process.stdout.write(text + (cask ? `\n${cask}` : ''));
}
