import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export class InputError extends Error {
  override name = 'InputError';
}

export interface InputResult {
  text: string;
  /** True when the head of the input was dropped because it exceeded maxBytes. */
  truncated: boolean;
  /** Original number of the first line in `text` (1 unless the head was dropped). */
  firstLineNumber: number;
  bytesRead: number;
}

function countNewlines(buf: Buffer): number {
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
  return n;
}

/**
 * Reads a stream while keeping at most ~maxBytes of the END of the input in memory.
 * The tail is kept because the cause of a CI failure is usually near the end. Line numbers
 * of the kept part still refer to the original input.
 */
export async function readStreamTail(
  stream: Readable,
  maxBytes: number,
  /** Hard cap on the total bytes read; exceeding it aborts with an InputError. */
  maxTotalBytes = Infinity,
): Promise<InputResult> {
  const chunks: Buffer[] = [];
  let kept = 0;
  let droppedBytes = 0;
  let droppedNewlines = 0;
  let total = 0;

  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string);
    total += chunk.length;
    if (total > maxTotalBytes) {
      stream.destroy();
      throw new InputError('The input is too large to download safely.');
    }
    chunks.push(chunk);
    kept += chunk.length;
    while (chunks.length > 1 && kept - (chunks[0] as Buffer).length >= maxBytes) {
      const first = chunks.shift() as Buffer;
      kept -= first.length;
      droppedBytes += first.length;
      droppedNewlines += countNewlines(first);
    }
  }

  let buf = Buffer.concat(chunks);
  let truncated = false;
  let firstLineNumber = 1;
  if (buf.length > maxBytes) {
    const cut = buf.length - maxBytes;
    droppedNewlines += countNewlines(buf.subarray(0, cut));
    droppedBytes += cut;
    buf = buf.subarray(cut);
  }
  if (droppedBytes > 0) {
    truncated = true;
    // The kept data usually starts mid-line: drop that partial line.
    const nl = buf.indexOf(0x0a);
    if (nl >= 0) {
      buf = buf.subarray(nl + 1);
      droppedNewlines += 1;
    }
    firstLineNumber = droppedNewlines + 1;
  }
  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(buf),
    truncated,
    firstLineNumber,
    bytesRead: total,
  };
}

export async function readInput(
  source: string,
  maxBytes: number,
  stdin: Readable,
): Promise<InputResult> {
  if (source === '-') return readStreamTail(stdin, maxBytes);
  try {
    return await readStreamTail(createReadStream(source), maxBytes);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new InputError(`File not found: ${source}`);
    if (code === 'EISDIR') throw new InputError(`Not a file (it is a directory): ${source}`);
    if (code === 'EACCES') throw new InputError(`Permission denied reading: ${source}`);
    throw new InputError(`Cannot read ${source}: ${code ?? 'unknown error'}`);
  }
}
