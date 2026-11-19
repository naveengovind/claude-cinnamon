// core/lib/Applied.ts: "applied" holds while Cinnamon runs in that Claude, even after the marker was removed.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isApplied, markLive } from '../core/lib/Applied';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-applied-'));

test('applied when the apply marker names this Claude', () => {
  const d = dir();
  fs.mkdirSync(path.join(d, 'state'));
  fs.writeFileSync(path.join(d, 'state', 'applied'), '123 Thu Nov 12 18:03:11 2026\n');
  assert.strictEqual(isApplied(d, '123'), true);
  assert.strictEqual(isApplied(d, '124'), false);
});

test('still applied after cinnamon install removed the marker, while Cinnamon runs in that Claude', () => {
  const d = dir();
  markLive(d, 123);
  assert.strictEqual(isApplied(d, '123'), true);
  assert.strictEqual(isApplied(d, '999'), false, 'a restarted Claude does not count');
  assert.strictEqual(isApplied(d, null), false);
});
