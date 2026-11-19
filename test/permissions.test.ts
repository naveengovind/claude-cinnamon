// core/lib/Permissions.ts and how the apply entry point reads it.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromEnv } from '../core/apply/main';
import { permissionPrefs } from '../core/lib/Permissions';

test('by default Cinnamon uses Accessibility only, and closes the Chrome tab with it', () => {
  assert.deepStrictEqual(permissionPrefs({}), { mode: 'accessibility', closeChromeTab: true });
});

test('"none" and closing the Chrome tab are read from config.json; anything else falls back', () => {
  assert.deepStrictEqual(permissionPrefs({ permissions: 'none', closeChromeTab: true }), { mode: 'none', closeChromeTab: true });
  assert.deepStrictEqual(permissionPrefs({ permissions: 'everything', closeChromeTab: 'yes' }), { mode: 'accessibility', closeChromeTab: true });
  assert.deepStrictEqual(permissionPrefs({ closeChromeTab: false }), { mode: 'accessibility', closeChromeTab: false });
});

test('the apply entry point takes manual mode and the Chrome tab setting from your config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-perm-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ theme: 'ember', permissions: 'none', closeChromeTab: true }));
  const { applier } = fromEnv({ CINNAMON_HOME: home });
  const opts = (applier as unknown as { opts: { manual?: boolean; closeChromeTab?: boolean } }).opts;
  assert.strictEqual(opts.manual, true);
  assert.strictEqual(opts.closeChromeTab, true);
});
