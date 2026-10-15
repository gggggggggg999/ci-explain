import type { Evidence, LogLine, Rule } from '../../core/types.js';
import { cap, dedupeEvidence, ev, findAll, indexOfLine, plural } from '../helpers.js';

const FAIL_LINE = /^\s*FAIL\s+(\S.{0,300})$/;
const JEST_SUMMARY = /^\s*Tests:\s+.*?(\d+) failed/;
const VITEST_SUMMARY = /^\s*Tests\s+(\d+) failed/;
const ASSERTION_HINT =
  /^(?:AssertionError|Error|TypeError|ReferenceError)\b|expect\(received\)|^\s*Expected:/;

export const testFailures: Rule = {
  id: 'node.test.failures',
  title: 'Jest/Vitest tests failed',
  ecosystem: 'node',
  category: 'test',
  kind: 'rootCause',
  priority: 50,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Vitest 5.0.4 output checked against a real run. The Jest output format ("FAIL file", "Tests: N failed") follows Jest documentation and was not checked against a real run.',
  match(ctx) {
    const fails = findAll(ctx, (t) => FAIL_LINE.test(t));
    const summaryAt = indexOfLine(ctx, (t) => JEST_SUMMARY.test(t) || VITEST_SUMMARY.test(t));
    if (fails.length === 0 || summaryAt < 0) return null;
    const summary = ctx.lines[summaryAt]!;
    const failedCount = Number(
      (JEST_SUMMARY.exec(summary.text) ?? VITEST_SUMMARY.exec(summary.text))?.[1] ?? 0,
    );
    if (failedCount === 0) return null;
    const evidence: Evidence[] = fails.slice(0, 3).map(ev);
    const firstIdx = ctx.lines.indexOf(fails[0] as LogLine);
    const hint = ctx.lines
      .slice(firstIdx + 1, firstIdx + 16)
      .find((l) => ASSERTION_HINT.test(l.text));
    if (hint) evidence.push(ev(hint));
    evidence.push(ev(summary));
    return {
      evidence: dedupeEvidence(evidence),
      occurrences: failedCount,
      captures: {
        failed: String(failedCount),
        first: cap(FAIL_LINE.exec((fails[0] as LogLine).text)?.[1] ?? ''),
        message: cap(hint?.text ?? ''),
      },
    };
  },
  explain(m) {
    const n = Number(m.captures.failed);
    const msg = m.captures.message ? ` First assertion message: ${m.captures.message}` : '';
    return `${n} ${plural(n, 'test')} failed. The first failure is reported for: ${m.captures.first}.${msg}`;
  },
  suggest() {
    return ['Run the failing test locally and read the full assertion output above the summary.'];
  },
};

export const testSnapshot: Rule = {
  id: 'node.test.snapshot',
  title: 'Snapshot mismatch',
  ecosystem: 'node',
  category: 'test',
  kind: 'rootCause',
  priority: 75,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Vitest 5.0.4 "Snapshot `name` mismatched" checked against a real run. Jest wording ("Snapshot name:", "Snapshots: N failed") follows Jest documentation and was not checked against a real run.',
  match(ctx) {
    const at = indexOfLine(
      ctx,
      (t) =>
        (t.includes('Snapshot') && t.includes('mismatched')) ||
        /^\s*Snapshots:\s+.*\b\d+ failed/.test(t) ||
        /^\s*Snapshot name:/.test(t),
    );
    if (at < 0) return null;
    const line = ctx.lines[at]!;
    const evidence = [ev(line)];
    const name = /Snapshot `([^`]{1,120})` mismatched/.exec(line.text)?.[1] ?? '';
    const jestName = /Snapshot name: `([^`]{1,120})`/.exec(line.text)?.[1] ?? '';
    return { evidence, captures: { name: cap(name || jestName) } };
  },
  explain(m) {
    return m.captures.name
      ? `A snapshot assertion failed: the received value differs from the stored snapshot "${m.captures.name}".`
      : 'A snapshot assertion failed: the received value differs from the stored snapshot.';
  },
  suggest() {
    return [
      'Review the diff shown in the log. If the change is intended, update the snapshot locally and commit it; otherwise fix the code.',
    ];
  },
};

export const testTimeout: Rule = {
  id: 'node.test.timeout',
  title: 'Test timed out',
  ecosystem: 'node',
  category: 'test',
  kind: 'rootCause',
  priority: 75,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Vitest 5.0.4 "Test timed out in Nms." checked against a real run. Jest ("Exceeded timeout of N ms for a test") and Mocha ("Timeout of Nms exceeded.") wording follows their documentation and was not checked against a real run.',
  match(ctx) {
    const patterns: [RegExp, string][] = [
      [/Test timed out in (\d+)\s?ms/, 'Vitest'],
      [/Exceeded timeout of (\d+)\s?ms for a (?:test|hook)/, 'Jest'],
      [/Timeout of (\d+)\s?ms exceeded/, 'Mocha'],
    ];
    for (const [re, runner] of patterns) {
      const at = indexOfLine(ctx, (t) => re.test(t));
      if (at < 0) continue;
      const line = ctx.lines[at]!;
      const evidence = [ev(line)];
      const failLine = ctx.lines
        .slice(Math.max(0, at - 5), at)
        .reverse()
        .find((l) => FAIL_LINE.test(l.text));
      if (failLine) evidence.push(ev(failLine));
      return {
        evidence: dedupeEvidence(evidence),
        captures: { ms: re.exec(line.text)?.[1] ?? '', runner },
      };
    }
    return null;
  },
  explain(m) {
    return `A test or hook exceeded its time limit of ${m.captures.ms} ms (${m.captures.runner} message). The log does not show whether the code was slow or hung.`;
  },
  suggest() {
    return [
      'Check the test for un-awaited promises, open handles, or real network calls; raise the timeout only if the work is legitimately slow.',
    ];
  },
};
