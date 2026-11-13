// The Applier (core/apply/Applier.ts) with a fake System: no real app, debugger or browser is touched.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Applier, CLOSE_JS } from '../core/apply/Applier';
import type { System } from '../core/apply/System';

const CLAUDE = '123';
const LSTART = 'Thu Nov 12 18:03:11 2026';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Opts { mainFails?: boolean; listener?: string; running?: boolean; pressExit?: number; noHelper?: boolean; stateDir?: string; lockHeld?: boolean; keep?: boolean }

async function runApply(o: Opts = {}) {
  const calls: string[] = [];
  const out: string[] = [];
  let port = o.listener || '';
  const sys: System = {
    claudePid: () => (o.running === false ? null : CLAUDE),
    listener: () => port || null,
    lstart: () => LSTART,
    osascript: (args) => { calls.push(`chrome ${args[3]}`); return '{"running":true,"ids":[]}'; },
    osascriptAsync: async (args) => { calls.push(`chrome ${args[3]}`); await wait(600); calls.push('chrome cleanup done'); return '{"closed":1}'; },
    helperExists: () => !o.noHelper,
    helper: (args) => {
      if (args[0] === 'press') { calls.push(`press ${args[1]}`); if (o.pressExit) return { status: o.pressExit, stdout: '' }; port = CLAUDE; }
      if (args[0] === 'front') return { status: 0, stdout: '77' };
      if (args[0] === 'activate') calls.push(`activate ${args[1]}`);
      return { status: 0, stdout: '' };
    },
    sleep: async () => {},
    log: (l) => out.push(l),
  };
  const stateDir = o.stateDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cm-state-'));
  const applier = new Applier(sys, { root: path.join(import.meta.dir, '..'), stateDir, lockWait: 1 }, {
    render: async () => 'SCRIPT',
    evaluate: async (code) => {
      if (code === CLOSE_JS) { calls.push('close'); return 'closed'; }
      await wait(200);
      calls.push('main');
      if (o.mainFails) throw new Error('boom');
      return { applied: [2] };
    },
    chromeScript: () => '/tmp/chrome-tab.js',
  });
  const status = await applier.run({ keep: o.keep, lockHeld: o.lockHeld });
  const markerFile = path.join(stateDir, 'applied');
  const marker = fs.existsSync(markerFile) ? fs.readFileSync(markerFile, 'utf8').trim() : null;
  return { status, calls, out: out.join('\n'), marker, stateDir };
}
const before = (calls: string[], a: string, b: string) => calls.indexOf(a) !== -1 && calls.indexOf(a) < calls.indexOf(b);

test('the debugger is closed even when applying fails', async () => {
  const r = await runApply({ mainFails: true });
  assert.notStrictEqual(r.status, 0);
  assert.ok(before(r.calls, 'main', 'close'), r.calls.join(','));
});

test('the debugger is closed after a successful apply', async () => {
  const r = await runApply();
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(before(r.calls, 'main', 'close'), r.calls.join(','));
});

test('keep leaves the debugger open', async () => {
  const r = await runApply({ keep: true });
  assert.ok(r.calls.includes('main'));
  assert.ok(!r.calls.includes('close'));
});

test('nothing runs when Claude is not running', async () => {
  const r = await runApply({ running: false });
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(r.calls, []);
});

test('refuses when another process owns the debugger port', async () => {
  const r = await runApply({ listener: '999' });
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(r.calls, [], 'must not press, evaluate in, or close a foreign inspector');
  assert.match(r.out, /999/);
});

test('when Claude\'s debugger is already open, nothing is pressed and Chrome is left alone', async () => {
  const r = await runApply({ listener: CLAUDE });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.calls, ['main', 'close']);
});

test('the helper presses the menu item for this Claude process', async () => {
  const r = await runApply();
  assert.ok(r.calls.includes(`press ${CLAUDE}`), r.calls.join(','));
});

test('without the helper built, apply says to run cinnamon install and presses nothing', async () => {
  const r = await runApply({ noHelper: true });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.out, /cinnamon install/);
  assert.ok(!r.calls.some((c) => c.startsWith('press')));
});

test('the debugger is closed before waiting for the Chrome tab to be closed', async () => {
  const r = await runApply();
  assert.ok(before(r.calls, 'close', 'chrome cleanup done'), r.calls.join(','));
});

test('another apply in progress makes this one wait, then give up without pressing', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-state-'));
  fs.mkdirSync(path.join(stateDir, 'apply.lock'));
  fs.writeFileSync(path.join(stateDir, 'apply.lock', 'pid'), String(process.pid));
  const r = await runApply({ stateDir });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.out, /another apply/i);
  assert.deepStrictEqual(r.calls, []);
});

test('the lock is released afterwards, and skipped when the caller already holds it', async () => {
  const r = await runApply();
  assert.strictEqual(fs.existsSync(path.join(r.stateDir, 'apply.lock')), false);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-state-'));
  fs.mkdirSync(path.join(stateDir, 'apply.lock'));
  fs.writeFileSync(path.join(stateDir, 'apply.lock', 'pid'), String(process.pid));
  const held = await runApply({ stateDir, lockHeld: true });
  assert.strictEqual(held.status, 0, held.out);
});

test('after a press, the inspect tab Chrome opened is cleaned up and the previous app is brought back', async () => {
  const r = await runApply();
  const c = r.calls;
  assert.ok(before(c, 'chrome snapshot', `press ${CLAUDE}`), c.join(','));
  assert.ok(before(c, `press ${CLAUDE}`, 'chrome cleanup'), c.join(','));
  assert.ok(before(c, 'chrome cleanup', 'activate 77'), c.join(','));
});

test('the Chrome tab is closed right after the press, without waiting for the mods to be applied', async () => {
  const r = await runApply();
  assert.ok(before(r.calls, 'chrome cleanup', 'main'), r.calls.join(','));
});

test('Chrome is cleaned up even when applying fails', async () => {
  const r = await runApply({ mainFails: true });
  assert.ok(r.calls.includes('chrome cleanup'), r.calls.join(','));
});

test('a failed press leaves Chrome alone (Claude never opened anything in it)', async () => {
  const r = await runApply({ pressExit: 2 });
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.calls.includes(`press ${CLAUDE}`), r.calls.join(','));
  assert.ok(!r.calls.includes('chrome cleanup'), r.calls.join(','));
  assert.ok(!r.calls.includes('main'));
});

test('a successful apply records which Claude process has the mods', async () => {
  const r = await runApply();
  assert.strictEqual(r.marker, `${CLAUDE} ${LSTART}`);
});

test('a failed apply records nothing', async () => {
  const r = await runApply({ mainFails: true });
  assert.strictEqual(r.marker, null);
});
