// Evaluates code in the Claude app's main process through its own Node inspector (Developer > Enable Main Process
// Debugger, 127.0.0.1:9229), and returns the value. Gives up after a time limit (CM_CDP_TIMEOUT_MS, default 30 s) so a
// hung connection never keeps the debugger busy.
// CLI: bun core/InspectorClient.ts <file.js> [port]  → prints the value as JSON (exit 1 on an exception, 2 on time-out).
import fs from 'node:fs';

export class InspectorError extends Error {}

export class InspectorClient {
  constructor(readonly port = 9229, readonly limitMs = Number(process.env.CM_CDP_TIMEOUT_MS || 30_000)) {}

  async evaluate(expression: string): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new InspectorError(`no answer from Claude's debugger within ${this.limitMs} ms`)), this.limitMs);
    });
    let ws: WebSocket | null = null;
    try {
      return await Promise.race([limit, (async () => {
        const targets = await (await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(this.limitMs) })).json() as { webSocketDebuggerUrl?: string }[];
        const target = targets.find((t) => t.webSocketDebuggerUrl);
        if (!target) throw new InspectorError('no inspector target; is the main process debugger enabled?');
        ws = new WebSocket(target.webSocketDebuggerUrl!);
        const socket = ws;
        await new Promise<void>((ok, fail) => { socket.onopen = () => ok(); socket.onerror = () => fail(new InspectorError('could not connect to the debugger')); });
        const answer = new Promise<{ error?: unknown; result?: { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } } }>((ok, fail) => {
          socket.onmessage = (m) => { const msg = JSON.parse(String(m.data)); if (msg.id === 1) ok(msg); };
          socket.onclose = () => fail(new InspectorError('the debugger connection closed before answering'));
        });
        socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } }));
        const res = await answer;
        if (res.error) throw new InspectorError(JSON.stringify(res.error));
        const ex = res.result?.exceptionDetails;
        if (ex) throw new InspectorError(ex.exception?.description || JSON.stringify(ex));
        return res.result?.result?.value;
      })()]);
    } finally {
      clearTimeout(timer);
      try { (ws as WebSocket | null)?.close(); } catch {}
    }
  }
}

if (import.meta.main) {
  const [file, port = '9229'] = process.argv.slice(2);
  const client = new InspectorClient(Number(port));
  try {
    const value = await client.evaluate(fs.readFileSync(file!, 'utf8'));
    console.log(JSON.stringify(value, null, 1));
    process.exit(0);
  } catch (e) {
    console.error(`cdp: ${(e as Error).message}`);
    process.exit(/within/.test((e as Error).message) ? 2 : 1);
  }
}
