import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readStreamTail } from '../../src/io/read-input.js';

const stream = (chunks: string[]) => Readable.from(chunks.map((c) => Buffer.from(c)));

describe('readStreamTail', () => {
  it('returns everything when under the limit', async () => {
    const r = await readStreamTail(stream(['a\nb\n', 'c\n']), 1000);
    expect(r).toMatchObject({ text: 'a\nb\nc\n', truncated: false, firstLineNumber: 1 });
  });

  it('keeps the tail, drops the partial first line, and tracks the original line number', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i + 1).padStart(3, '0')}`);
    const chunks = lines.map((l) => l + '\n');
    const r = await readStreamTail(stream(chunks), 100);
    expect(r.truncated).toBe(true);
    const kept = r.text.trimEnd().split('\n');
    expect(kept[kept.length - 1]).toBe('line-100');
    const first = kept[0] as string;
    expect(first).toBe(`line-${String(r.firstLineNumber).padStart(3, '0')}`);
    expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(100);
  });

  it('works with a single huge chunk', async () => {
    const text = Array.from({ length: 50 }, (_, i) => `row${i + 1}`).join('\n') + '\n';
    const r = await readStreamTail(stream([text]), 40);
    const kept = r.text.trimEnd().split('\n');
    expect(kept.at(-1)).toBe('row50');
    expect(kept[0]).toBe(`row${r.firstLineNumber}`);
  });

  it('does not throw on invalid UTF-8', async () => {
    const r = await readStreamTail(Readable.from([Buffer.from([0xff, 0xfe, 0x41, 0x0a])]), 100);
    expect(r.text).toContain('A');
  });
});
