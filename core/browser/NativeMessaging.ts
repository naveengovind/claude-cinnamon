// Chrome's native messaging framing: each message is UTF-8 JSON preceded by its length as a 32-bit little-endian
// integer, on the host's stdin (from the browser) and stdout (to it). The browser refuses a message to it over 1 MB,
// so a long one (a theme with a large backdrop, many extensions) is sent as chunks the extension joins back up.
// No Electron, no browser APIs: used by `cinnamon browser-host`.

/** What the browser accepts from a host in one message (1 MB), less room for the chunk wrapper. */
export const MAX_TO_BROWSER = 1024 * 1024 - 4096;
/** What the host accepts from the browser (the browser allows up to 64 MB; Cinnamon's messages are small). */
export const MAX_FROM_BROWSER = 8 * 1024 * 1024;

export interface Chunk { type: 'chunk'; id: number; index: number; count: number; data: string }

/** One message, framed. */
export function frame(msg: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(msg));
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

let nextChunkId = 1;

/** The message as it goes to the browser: itself, or chunks of its JSON when it is too long for one message. */
export function framesFor(msg: unknown, max = MAX_TO_BROWSER): Uint8Array[] {
  const json = JSON.stringify(msg);
  if (new TextEncoder().encode(json).length <= max) return [frame(msg)];
  // split by characters, a quarter of the limit each, so even all-multibyte text fits in one message
  const size = Math.max(1, Math.floor(max / 4));
  const count = Math.ceil(json.length / size);
  const id = nextChunkId++;
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) out.push(frame({ type: 'chunk', id, index: i, count, data: json.slice(i * size, (i + 1) * size) } satisfies Chunk));
  return out;
}

/** Collects bytes from the browser and hands out whole messages; a bad length ends the stream. */
export class Decoder {
  private buf = new Uint8Array(0);

  /** The whole messages the bytes so far complete. Throws on a length over the limit (a broken or hostile stream). */
  push(bytes: Uint8Array): unknown[] {
    const joined = new Uint8Array(this.buf.length + bytes.length);
    joined.set(this.buf, 0);
    joined.set(bytes, this.buf.length);
    this.buf = joined;
    const out: unknown[] = [];
    while (this.buf.length >= 4) {
      const len = new DataView(this.buf.buffer, this.buf.byteOffset, 4).getUint32(0, true);
      if (len > MAX_FROM_BROWSER) throw new Error(`message too long (${len} bytes)`);
      if (this.buf.length < 4 + len) break;
      const text = new TextDecoder().decode(this.buf.subarray(4, 4 + len));
      this.buf = this.buf.slice(4 + len);
      try { out.push(JSON.parse(text)); } catch { /* not JSON: dropped */ }
    }
    return out;
  }
}

/** Joins chunks back into the message they carry (used by the extension; here so it is tested with framesFor). */
export class ChunkJoiner {
  private parts = new Map<number, string[]>();

  /** The message once its last chunk is in, else null. A message that isn't a chunk comes straight back. */
  add(msg: unknown): unknown | null {
    const c = msg as Partial<Chunk> | null;
    if (!c || c.type !== 'chunk' || typeof c.id !== 'number' || typeof c.count !== 'number' || typeof c.index !== 'number' || typeof c.data !== 'string') return msg;
    let list = this.parts.get(c.id);
    if (!list) { list = new Array<string>(c.count); this.parts.set(c.id, list); }
    list[c.index] = c.data;
    for (let i = 0; i < c.count; i++) if (typeof list[i] !== 'string') return null;
    this.parts.delete(c.id);
    try { return JSON.parse(list.join('')); } catch { return null; }
  }
}
