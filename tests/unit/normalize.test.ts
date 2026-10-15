import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeLog } from '../../src/core/normalize.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/logs/${name}`, import.meta.url), 'utf8');

describe('normalizeLog', () => {
  it('strips ANSI colors', () => {
    const n = normalizeLog('\u001b[31mred\u001b[0m text\n\u001b]0;title\u0007plain\n');
    expect(n.lines.map((l) => l.text)).toEqual(['red text', 'plain']);
  });

  it('handles CRLF and keeps the last version of \\r progress lines', () => {
    const n = normalizeLog(fixture('generic-crlf.log'));
    const texts = n.lines.map((l) => l.text);
    expect(texts).toContain('downloading 100%');
    expect(texts.some((t) => t.includes('50%'))).toBe(false);
    expect(texts.every((t) => !t.includes('\r'))).toBe(true);
  });

  it('strips BOM and GitHub Actions timestamp prefixes, keeping original line numbers', () => {
    const n = normalizeLog(fixture('gha-npm-ci.log'));
    expect(n.hadTimestamps).toBe(true);
    expect(n.lines[0]?.text).toBe("Current runner version: '2.0.0'");
    const err = n.lines.find((l) => l.text.startsWith('##[error]'));
    expect(err?.n).toBe(17);
  });

  it('does not strip timestamps when only a minority of lines have them', () => {
    const n = normalizeLog('2025-01-01T00:00:00Z started\nplain one\nplain two\nplain three\n');
    expect(n.hadTimestamps).toBe(false);
    expect(n.lines[0]?.text).toBe('2025-01-01T00:00:00Z started');
  });

  it('parses the gh run view --log-failed tab prefix and step hints', () => {
    const raw =
      'build\tRun tests\t2025-01-01T00:00:00.0000000Z hello\nbuild\tUNKNOWN STEP\t2025-01-01T00:00:01.0000000Z world\n';
    const n = normalizeLog(raw);
    expect(n.hadGhPrefix).toBe(true);
    expect(n.lines.map((l) => l.text)).toEqual(['hello', 'world']);
    expect(n.lines[0]?.stepHint).toBe('Run tests');
    expect(n.lines[1]?.stepHint).toBeUndefined();
  });

  it('collapses identical consecutive lines with a counter', () => {
    const n = normalizeLog('a\na\na\nb\n');
    expect(n.lines).toHaveLength(2);
    expect(n.lines[0]).toMatchObject({ text: 'a', repeat: 3, n: 1 });
    expect(n.lines[1]?.n).toBe(4);
  });

  it('collapses long runs of npm warn lines', () => {
    const warns = Array.from({ length: 50 }, (_, i) => `npm warn deprecated pkg${i}@1.0.0: old`);
    const n = normalizeLog([...warns, 'npm error code E404'].join('\n'));
    expect(n.collapsedLineCount).toBe(47);
    expect(n.lines).toHaveLength(4);
    expect(n.lines[3]?.text).toBe('npm error code E404');
    expect(n.lines[3]?.n).toBe(51);
  });

  it('truncates very long lines with a marker before regexes run', () => {
    const n = normalizeLog('x'.repeat(10_000) + '\nok\n', { maxLineLength: 100 });
    expect(n.truncatedLineCount).toBe(1);
    expect(n.lines[0]?.text.length).toBeLessThan(200);
    expect(n.lines[0]?.text).toContain('[truncated');
  });

  it('handles empty input without throwing', () => {
    const n = normalizeLog('');
    expect(n.lines).toEqual([]);
    expect(n.originalLineCount).toBe(0);
  });

  it('warns on binary input and does not throw', () => {
    const n = normalizeLog('abc\u0000\u0001\u0002 binary\n');
    expect(n.warnings.length).toBe(1);
    expect(n.lines[0]?.text).toBe('abc binary');
  });

  it('is deterministic', () => {
    const raw = fixture('gha-npm-ci.log');
    expect(JSON.stringify(normalizeLog(raw))).toBe(JSON.stringify(normalizeLog(raw)));
  });

  it('survives pathological lines within a time budget', () => {
    const patho = [
      '\u001b[' + '9'.repeat(50_000),
      '\u001b]' + 'a'.repeat(50_000),
      '\r'.repeat(50_000),
    ];
    const start = performance.now();
    normalizeLog(patho.join('\n'));
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
