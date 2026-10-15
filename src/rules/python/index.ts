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

const PIP_NOT_FOUND = /^ERROR: Could not find a version that satisfies the requirement (\S{1,200})/;
const PIP_NO_DIST = /^ERROR: No matching distribution found for (\S{1,200})/;

export const pipDependency: Rule = {
  id: 'python.pip.dependency',
  title: 'pip cannot resolve or find a dependency',
  ecosystem: 'python',
  category: 'dependency',
  kind: 'rootCause',
  priority: 75,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'The "Could not find a version" / "No matching distribution" messages were checked against real pip output (Python 3.14). The dependency-conflict wording (ResolutionImpossible / "conflicting dependencies") was not checked against a real run, so it is reported with medium confidence.',
  match(ctx): RuleMatch | null {
    const notFound = indexOfLine(ctx, (t) => PIP_NOT_FOUND.test(t));
    if (notFound >= 0) {
      const line = ctx.lines[notFound] as LogLine;
      const evidence = [ev(line)];
      const dist = ctx.lines
        .slice(notFound + 1, notFound + 4)
        .find((l) => PIP_NO_DIST.test(l.text));
      if (dist) evidence.push(ev(dist));
      return {
        evidence,
        captures: {
          requirement: cap(PIP_NOT_FOUND.exec(line.text)?.[1] ?? ''),
          variant: 'not-found',
        },
      };
    }
    const conflict = indexOfLine(
      ctx,
      (t) =>
        t.startsWith('ERROR: ResolutionImpossible') ||
        t.includes('because these package versions have conflicting dependencies'),
    );
    if (conflict >= 0) {
      return {
        evidence: [ev(ctx.lines[conflict] as LogLine)],
        captures: { variant: 'conflict' },
        confidence: 'medium',
      };
    }
    return null;
  },
  explain(m) {
    return m.captures.variant === 'conflict'
      ? 'pip could not find a set of package versions that satisfy all requirements at once (conflicting dependencies).'
      : `pip found no installable version of ${m.captures.requirement}: the name or version may be wrong, or it may not exist for this Python version and platform.`;
  },
  suggest(m) {
    return m.captures.variant === 'conflict'
      ? ['Loosen or align the conflicting version pins in the requirements files.']
      : [
          'Check the package name and version pin for typos.',
          'Check that the package supports the Python version used by this job.',
        ];
  },
};
