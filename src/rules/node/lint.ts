import type { Evidence, LogLine, Rule } from '../../core/types.js';
import { cap, dedupeEvidence, ev, indexOfLine, plural } from '../helpers.js';

const ESLINT_SUMMARY = /^✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)\s*$/;
const ESLINT_ERROR_LINE = /^\s+\d+:\d+\s+error\s+(.+?)(?:\s{2,}(\S+))?$/;

export const eslintProblems: Rule = {
  id: 'node.eslint.problems',
  title: 'ESLint reported errors',
  ecosystem: 'node',
  category: 'lint',
  kind: 'rootCause',
  priority: 70,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real ESLint 10.12.0 default ("stylish") formatter output. Other formatters are not covered.',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => {
      const m = ESLINT_SUMMARY.exec(t);
      return m !== null && Number(m[2]) > 0;
    });
    if (at < 0) return null;
    const summary = ctx.lines[at]!;
    const sm = ESLINT_SUMMARY.exec(summary.text)!;
    const errorLines: LogLine[] = [];
    for (let i = 0; i < at; i++) {
      if (ESLINT_ERROR_LINE.test(ctx.lines[i]!.text)) errorLines.push(ctx.lines[i]!);
    }
    const evidence: Evidence[] = [ev(summary)];
    const rules = new Set<string>();
    for (const l of errorLines.slice(0, 3)) {
      const r = ESLINT_ERROR_LINE.exec(l.text)?.[2];
      if (r) rules.add(r);
    }
    for (const l of errorLines.slice(0, 3)) evidence.push(ev(l));
    // File header: the nearest unindented line above the first error line.
    const first = errorLines[0];
    if (first) {
      const idx = ctx.lines.indexOf(first);
      for (let i = idx - 1; i >= 0 && idx - i <= 6; i--) {
        const t = ctx.lines[i]!.text;
        if (t.length > 0 && !/^\s/.test(t)) {
          evidence.push(ev(ctx.lines[i]!));
          break;
        }
      }
    }
    return {
      evidence: dedupeEvidence(evidence),
      occurrences: Number(sm[2]),
      captures: {
        problems: sm[1] ?? '',
        errors: sm[2] ?? '',
        warnings: sm[3] ?? '',
        rules: [...rules].slice(0, 3).join(', '),
      },
    };
  },
  explain(m) {
    const errors = Number(m.captures.errors);
    const rules = m.captures.rules ? ` Rules involved (first ones): ${m.captures.rules}.` : '';
    return `ESLint finished with ${errors} ${plural(errors, 'error')} and ${m.captures.warnings} ${plural(Number(m.captures.warnings), 'warning')}.${rules}`;
  },
  suggest() {
    return [
      'Run ESLint locally on the files named in the evidence; many problems can be fixed automatically with --fix.',
    ];
  },
};

export const prettierCheck: Rule = {
  id: 'node.prettier.check',
  title: 'Prettier --check found unformatted files',
  ecosystem: 'node',
  category: 'lint',
  kind: 'rootCause',
  priority: 70,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote: 'Checked against real Prettier 3.9.10 output of "prettier --check".',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => t.startsWith('[warn] Code style issues found in'));
    if (at < 0) return null;
    const summary = ctx.lines[at]!;
    const evidence: Evidence[] = [];
    const files: LogLine[] = [];
    for (let i = at - 1; i >= 0; i--) {
      const l = ctx.lines[i]!;
      if (!l.text.startsWith('[warn] ')) break;
      files.unshift(l);
    }
    for (const l of files.slice(0, 3)) evidence.push(ev(l));
    evidence.push(ev(summary));
    return {
      evidence,
      occurrences: Math.max(files.length, 1),
      captures: {
        files: String(files.length),
        first: cap(files[0]?.text.slice('[warn] '.length) ?? ''),
      },
    };
  },
  explain(m) {
    const n = Number(m.captures.files);
    return n > 0
      ? `Prettier found ${n} ${plural(n, 'file')} that ${n === 1 ? 'is' : 'are'} not formatted according to the configuration.`
      : 'Prettier found files that are not formatted according to the configuration.';
  },
  suggest() {
    return ['Run Prettier with --write locally and commit the formatting changes.'];
  },
};
