import type { Evidence, LogLine, Rule, RuleMatch } from '../../core/types.js';
import { cap, dedupeEvidence, ev, findAll, indexOfLine, plural } from '../helpers.js';

const MODULE_NOT_FOUND = /^(?:E\s+)?ModuleNotFoundError: No module named '([^']{1,200})'/;
const IMPORT_ERROR = /^(?:E\s+)?ImportError: (cannot import name '[^']{1,200}'.{0,200})/;
const PYTEST_FAILED = /^FAILED (\S+::\S+)/;
const PYTEST_SUMMARY = /^=+ (.*?\b(\d+) failed.*?) in [\d.]+s.*=+$/;

function tracebackLocation(lines: LogLine[], at: number): LogLine | undefined {
  for (let i = at - 1; i >= 0 && at - i <= 6; i--) {
    const t = lines[i]!.text;
    if (/^\s*File "/.test(t) || /^\S+\.py:\d+: in /.test(t)) return lines[i];
  }
  return undefined;
}

export const pythonImportError: Rule = {
  id: 'python.import-error',
  title: 'Python cannot import a module',
  ecosystem: 'python',
  category: 'dependency',
  kind: 'rootCause',
  priority: 70,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'ModuleNotFoundError checked against real pytest 9.1.1 output on Python 3.14. The "ImportError: cannot import name" wording was not checked against a real run, so it is reported with medium confidence.',
  match(ctx): RuleMatch | null {
    const at = indexOfLine(ctx, (t) => MODULE_NOT_FOUND.test(t));
    if (at >= 0) {
      const line = ctx.lines[at]!;
      const evidence = [ev(line)];
      const loc = tracebackLocation(ctx.lines, at);
      if (loc) evidence.push(ev(loc));
      return {
        evidence: dedupeEvidence(evidence),
        captures: { name: cap(MODULE_NOT_FOUND.exec(line.text)?.[1] ?? '') },
      };
    }
    const imp = indexOfLine(ctx, (t) => IMPORT_ERROR.test(t));
    if (imp >= 0) {
      const line = ctx.lines[imp]!;
      const evidence = [ev(line)];
      const loc = tracebackLocation(ctx.lines, imp);
      if (loc) evidence.push(ev(loc));
      return {
        evidence: dedupeEvidence(evidence),
        captures: { detail: cap(IMPORT_ERROR.exec(line.text)?.[1] ?? '') },
        confidence: 'medium',
      };
    }
    return null;
  },
  explain(m) {
    return m.captures.name
      ? `Python could not find a module named "${m.captures.name}" in the environment used by this step.`
      : `Python failed to import a name: ${m.captures.detail}.`;
  },
  suggest(m) {
    return m.captures.name
      ? [
          `Check that the package providing "${m.captures.name}" is in the requirements installed by this job, and that the install step used the same Python environment.`,
        ]
      : ['Check that the installed version of the package actually provides the imported name.'];
  },
};

export const pytestFailures: Rule = {
  id: 'python.pytest.failures',
  title: 'pytest tests failed',
  ecosystem: 'python',
  category: 'test',
  kind: 'rootCause',
  priority: 50,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real pytest 9.1.1 output (short test summary and final summary line).',
  match(ctx) {
    const failed = findAll(ctx, (t) => PYTEST_FAILED.test(t));
    const summaryAt = indexOfLine(ctx, (t) => PYTEST_SUMMARY.test(t));
    if (failed.length === 0 && summaryAt < 0) return null;
    const evidence: Evidence[] = failed.slice(0, 3).map(ev);
    let count = failed.length;
    if (summaryAt >= 0) {
      const s = ctx.lines[summaryAt]!;
      evidence.push(ev(s));
      count = Math.max(count, Number(PYTEST_SUMMARY.exec(s.text)?.[2] ?? 0));
    }
    if (count === 0) return null;
    return {
      evidence: dedupeEvidence(evidence),
      occurrences: count,
      captures: {
        failed: String(count),
        first: cap(PYTEST_FAILED.exec(failed[0]?.text ?? '')?.[1] ?? ''),
      },
    };
  },
  explain(m) {
    const n = Number(m.captures.failed);
    const first = m.captures.first ? ` First failing test: ${m.captures.first}.` : '';
    return `pytest reported ${n} failed ${plural(n, 'test')}.${first}`;
  },
  suggest() {
    return ['Run the failing test locally and read the assertion output shown above the summary.'];
  },
};
