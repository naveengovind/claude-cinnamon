// How the release signs what it ships. With a "Developer ID Application" identity in this Mac's keychain (or one named
// by CINNAMON_SIGN_IDENTITY), everything is signed for distribution: the hardened runtime, a secure timestamp and, for
// the Bun-compiled cinnamon command, the entitlements its engine needs (scripts/entitlements/cinnamon.plist); the menu
// bar app is then notarized and stapled with a notarytool keychain profile: CINNAMON_NOTARY_PROFILE, or else
// `cinnamon-notary` when it exists (made once with `xcrun notarytool store-credentials cinnamon-notary`). Without one, everything is signed ad hoc, as before.
// CINNAMON_SIGN_IDENTITY=- forces ad hoc.
import { spawnSync } from 'node:child_process';

export interface SignOptions { identifier?: string; entitlements?: string }

export class Signing {
  constructor(readonly identity: string | null, readonly notaryProfile: string | null = null) {}

  /** The notarytool keychain profile used when CINNAMON_NOTARY_PROFILE names none (and it exists). */
  static readonly DEFAULT_PROFILE = 'cinnamon-notary';

  /** From this Mac's keychain and the environment. */
  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): Signing {
    const list = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout || '';
    const identity = Signing.pickIdentity(list, env);
    let profile = env.CINNAMON_NOTARY_PROFILE || null;
    if (!profile && identity) { // the default profile, if `xcrun notarytool store-credentials cinnamon-notary` made it
      const r = spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', Signing.DEFAULT_PROFILE], { encoding: 'utf8' });
      if (r.status === 0) profile = Signing.DEFAULT_PROFILE;
    }
    return new Signing(identity, profile);
  }

  /** The identity to sign with, from `security find-identity` output: only a Developer ID Application one. */
  static pickIdentity(list: string, env: NodeJS.ProcessEnv): string | null {
    const named = env.CINNAMON_SIGN_IDENTITY;
    if (named) return named === '-' ? null : named;
    return /"(Developer ID Application: [^"]+)"/.exec(list)?.[1] ?? null;
  }

  get distributable(): boolean { return this.identity !== null; }
  get canNotarize(): boolean { return this.identity !== null && !!this.notaryProfile; }
  get describe(): string {
    return this.identity ? `${this.identity}${this.canNotarize ? ', notarized' : ' (not notarized: set CINNAMON_NOTARY_PROFILE)'}` : 'ad hoc (no Developer ID Application identity)';
  }

  /** codesign's arguments for one file or bundle. */
  args(target: string, o: SignOptions = {}): string[] {
    const out = ['--force', '--sign', this.identity ?? '-'];
    if (this.identity) out.push('--options', 'runtime', '--timestamp');
    if (this.identity && o.entitlements) out.push('--entitlements', o.entitlements);
    if (o.identifier) out.push('--identifier', o.identifier);
    out.push(target);
    return out;
  }

  /** Sends a zip of an app to Apple and staples the ticket to the app; throws when Apple rejects it. */
  notarize(zip: string, app: string, run: (cmd: string, args: string[]) => void): void {
    if (!this.canNotarize) return;
    run('xcrun', ['notarytool', 'submit', zip, '--keychain-profile', this.notaryProfile!, '--wait']);
    run('xcrun', ['stapler', 'staple', app]);
  }
}
