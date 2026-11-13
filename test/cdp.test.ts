// core/InspectorClient.ts gives up instead of holding Claude's debugger open when the inspector never answers.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

test('cdp exits with an error when the inspector never answers', async () => {
  const silent = net.createServer(() => {}); // accepts, never upgrades
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  const ws = `ws://127.0.0.1:${silent.address().port}/x`;
  const list = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([{ webSocketDebuggerUrl: ws }])); });
  await new Promise((r) => list.listen(0, '127.0.0.1', r));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cdp-')), 'x.js');
  fs.writeFileSync(file, '1');
  const started = Date.now();
  const code = await new Promise((r) => {
    const p = spawn(process.execPath, [path.join(import.meta.dir, '..', 'core', 'InspectorClient.ts'), file, String(list.address().port)], { env: { ...process.env, CM_CDP_TIMEOUT_MS: '500' } });
    p.on('exit', r);
  });
  silent.close(); list.close();
  assert.notStrictEqual(code, 0);
  assert.ok(Date.now() - started < 5000, 'gave up quickly');
});
