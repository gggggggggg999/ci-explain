import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractWindows } from '../../src/core/extract.js';
import { normalizeLog } from '../../src/core/normalize.js';
import { segmentLog } from '../../src/core/segment.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/logs/${name}`, import.meta.url), 'utf8');

describe('segmentLog', () => {
  it('finds steps and the failed step in a GitHub Actions log', () => {
    const log = normalizeLog(fixture('gha-npm-ci.log'));
    const seg = segmentLog(log);
    expect(seg.format).toBe('github-actions');
    expect(seg.steps.map((s) => s.name)).toEqual([
      'Set up job',
      'Run actions/checkout@v1',
      'Run npm ci',
      'Post job cleanup',
      'Complete job',
    ]);
    expect(seg.failedStep?.name).toBe('Run npm ci');
    expect(seg.exitCode).toBe(1);
  });

  it('does not treat sub-groups inside a step as new steps', () => {
    const seg = segmentLog(normalizeLog(fixture('gha-npm-ci.log')));
    expect(seg.steps.some((s) => s.name.includes('Getting Git version info'))).toBe(false);
  });

  it('falls back to generic format without steps', () => {
    const seg = segmentLog(normalizeLog(fixture('generic-crlf.log')));
    expect(seg).toMatchObject({ format: 'generic', steps: [], failedStep: null });
  });

  it('uses the last exit-code error when several errors exist', () => {
    const raw = [
      '##[group]Run a',
      '##[error]fatal: transient problem',
      '##[group]Run b',
      'boom error',
      '##[error]Process completed with exit code 2.',
    ].join('\n');
    const seg = segmentLog(normalizeLog(raw));
    expect(seg.failedStep?.name).toBe('Run b');
    expect(seg.exitCode).toBe(2);
  });
});

describe('extractWindows', () => {
  it('returns windows with original line numbers inside the failed step', () => {
    const log = normalizeLog(fixture('gha-npm-ci.log'));
    const seg = segmentLog(log);
    const windows = extractWindows(log, seg);
    expect(windows.length).toBeGreaterThan(0);
    const all = windows.flatMap((w) => w.lines.map((l) => l.n));
    expect(all).toContain(17);
    expect(all).not.toContain(1);
    expect(windows[0]?.stepName).toBe('Run npm ci');
  });

  it('merges overlapping windows and respects the line budget', () => {
    const body = Array.from({ length: 500 }, (_, i) => `error number ${i}`).join('\n');
    const log = normalizeLog(body);
    const windows = extractWindows(log, segmentLog(log), { maxTotalLines: 50 });
    const total = windows.reduce((n, w) => n + w.lines.length, 0);
    expect(total).toBeLessThanOrEqual(50);
    for (let i = 1; i < windows.length; i++) {
      expect((windows[i] as { startLine: number }).startLine).toBeGreaterThan(
        (windows[i - 1] as { endLine: number }).endLine,
      );
    }
  });

  it('returns no windows for empty input', () => {
    const log = normalizeLog('');
    expect(extractWindows(log, segmentLog(log))).toEqual([]);
  });
});
