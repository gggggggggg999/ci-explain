import type { Rule } from '../../core/types.js';
import { cap, ev, indexOfLine } from '../helpers.js';

const NODE_ERR =
  /^(?:Uncaught )?Error(?: \[ERR_MODULE_NOT_FOUND\])?: Cannot find (module|package) '([^']{1,200})'/;
const JEST_ERR = /^\s*Cannot find module '([^']{1,200})' from '[^']{1,300}'/;

export const moduleNotFound: Rule = {
  id: 'node.module-not-found',
  title: 'Node.js cannot find a module',
  ecosystem: 'node',
  category: 'dependency',
  kind: 'rootCause',
  priority: 70,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real Node 22 output for require() and import of a missing package. The Jest variant ("Cannot find module ... from ...") was not checked against a real run, so it is reported with medium confidence.',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => NODE_ERR.test(t));
    if (at >= 0) {
      const line = ctx.lines[at]!;
      const m = NODE_ERR.exec(line.text)!;
      const evidence = [ev(line)];
      const codeAt = indexOfLine(ctx, (t) => t.includes("code: 'MODULE_NOT_FOUND'"), at);
      if (codeAt >= 0 && codeAt - at < 25) evidence.push(ev(ctx.lines[codeAt]!));
      return { evidence, captures: { name: cap(m[2] ?? ''), kind: m[1] ?? 'module' } };
    }
    const jest = indexOfLine(ctx, (t) => JEST_ERR.test(t));
    if (jest >= 0) {
      const line = ctx.lines[jest]!;
      const m = JEST_ERR.exec(line.text)!;
      return {
        evidence: [ev(line)],
        captures: { name: cap(m[1] ?? ''), kind: 'module' },
        confidence: 'medium',
      };
    }
    return null;
  },
  explain(m) {
    return `Node.js could not resolve the ${m.captures.kind} "${m.captures.name}" at runtime.`;
  },
  suggest(m) {
    return [
      `Check that "${m.captures.name}" is listed in dependencies (not only devDependencies if it is needed in production) and that the install step ran before this step.`,
      'If it is a relative import, check the file path and its case (Linux runners are case-sensitive).',
    ];
  },
};
