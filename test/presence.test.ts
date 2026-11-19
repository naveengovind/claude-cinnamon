// core/lib/Presence.ts: which browsers have the extension, and which are connected right now.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSERS } from '../core/browser/BrowserSetup';
import { Presence } from '../core/lib/Presence';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-presence-'));

test('a browser that never connected is "never"; one whose connection process runs is "connected"', () => {
  const p = new Presence(dir());
  assert.strictEqual(p.link('arc'), 'never');
  p.connected('arc', '0.4.4.1', process.pid);
  assert.strictEqual(p.link('arc'), 'connected');
  assert.strictEqual(p.read('arc')?.extensionVersion, '0.4.4.1');
});

test('after it disconnects (or its process is gone) the extension counts as loaded but idle', () => {
  const p = new Presence(dir());
  p.connected('chrome', '1', process.pid);
  p.disconnected('chrome', process.pid);
  assert.strictEqual(p.link('chrome'), 'idle');
  p.connected('brave', '1', 2 ** 22 + 12345); // no such process
  assert.strictEqual(p.link('brave'), 'idle');
});

test('a later connection keeps the first connection time; another process does not clear it', () => {
  const p = new Presence(dir());
  p.connected('arc', '1', process.pid, new Date('2026-01-01T00:00:00Z'));
  p.connected('arc', '2', process.pid, new Date('2026-02-01T00:00:00Z'));
  p.disconnected('arc', 1);
  const r = p.read('arc')!;
  assert.strictEqual(r.firstConnected, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(r.lastConnected, '2026-02-01T00:00:00.000Z');
  assert.strictEqual(r.pid, process.pid);
});

test('the browser is known from the connection process\'s parent', () => {
  assert.strictEqual(Presence.browserOf('/Applications/Arc.app/Contents/MacOS/Arc', BROWSERS), 'arc');
  assert.strictEqual(Presence.browserOf('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', BROWSERS), 'chrome');
  assert.strictEqual(Presence.browserOf('/usr/bin/login', BROWSERS), null);
});
