// The release's signing: Developer ID (hardened runtime, timestamp, notarization) when this Mac has the identity,
// ad hoc otherwise.
import { test } from 'bun:test';
import assert from 'node:assert';
import { Signing } from '../scripts/signing';

const LIST = `  1) 8030A70DADFADBADC4BDB6F8AC12EB9CF61B16F6 "Apple Development: Someone (A2ESEL58NJ)"
  2) 1111111111111111111111111111111111111111 "Developer ID Application: Example Co (ABCDE12345)"
     2 valid identities found`;

test('the Developer ID Application identity is picked, never an Apple Development one', () => {
  assert.strictEqual(Signing.pickIdentity(LIST, {}), 'Developer ID Application: Example Co (ABCDE12345)');
  assert.strictEqual(Signing.pickIdentity(LIST.split('\n')[0]!, {}), null, 'Apple Development can\'t sign for distribution');
  assert.strictEqual(Signing.pickIdentity(LIST, { CINNAMON_SIGN_IDENTITY: 'Other' }), 'Other', 'chosen by name');
  assert.strictEqual(Signing.pickIdentity(LIST, { CINNAMON_SIGN_IDENTITY: '-' }), null, '"-" asks for ad hoc');
});

test('ad hoc signing keeps the identifier; Developer ID adds the hardened runtime, a timestamp and entitlements', () => {
  assert.deepStrictEqual(new Signing(null).args('/x/A.app', { identifier: 'local.a' }), ['--force', '--sign', '-', '--identifier', 'local.a', '/x/A.app']);
  const id = 'Developer ID Application: Example Co (ABCDE12345)';
  assert.deepStrictEqual(new Signing(id).args('/x/cinnamon', { entitlements: '/e.plist' }),
    ['--force', '--sign', id, '--options', 'runtime', '--timestamp', '--entitlements', '/e.plist', '/x/cinnamon']);
});

test('notarization runs only with a Developer ID and a notarytool keychain profile', () => {
  assert.strictEqual(new Signing(null, 'cinnamon-notary').canNotarize, false);
  assert.strictEqual(new Signing('Developer ID Application: X (Y)', null).canNotarize, false);
  assert.strictEqual(new Signing('Developer ID Application: X (Y)', 'cinnamon-notary').canNotarize, true);
});
