// Evaluate a JS file in the Claude app's main process through its own Node inspector
// (Developer > Enable Main Process Debugger). Prints the returned value as JSON.
// Usage: node cdp.mjs <file.js> [port]
// Gives up after CM_CDP_TIMEOUT_MS (default 30 s) so a hung connection never keeps the debugger busy.
import { readFileSync } from 'node:fs';

const [file, port = '9229'] = process.argv.slice(2);
const limit = Number(process.env.CM_CDP_TIMEOUT_MS || 30000);
setTimeout(() => { console.error(`cdp: no answer from Claude's debugger within ${limit} ms`); process.exit(2); }, limit).unref();

const src = readFileSync(file, 'utf8');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(limit) })).json();
const target = targets.find((t) => t.webSocketDebuggerUrl);
if (!target) throw new Error('no inspector target; is the main process debugger enabled?');

const ws = new WebSocket(target.webSocketDebuggerUrl);
const alive = setInterval(() => {}, 1000); // keep running until the answer, the close, or the time limit
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
ws.onclose = () => { if (pending.size) { console.error('cdp: the debugger connection closed before answering'); process.exit(1); } };
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });

const res = await send('Runtime.evaluate', {
  expression: src,
  awaitPromise: true,
  returnByValue: true,
  includeCommandLineAPI: true,
});
clearInterval(alive);
ws.close();
if (res.error) { console.error(JSON.stringify(res.error)); process.exit(1); }
if (res.result.exceptionDetails) {
  console.error(res.result.exceptionDetails.exception?.description || JSON.stringify(res.result.exceptionDetails));
  process.exit(1);
}
console.log(JSON.stringify(res.result.result.value, null, 1));
process.exit(0);
