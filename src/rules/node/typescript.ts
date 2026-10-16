import type { Evidence, LogLine, Rule } from '../../core/types.js';
import { cap, ev, plural } from '../helpers.js';

interface TsError {
  line: LogLine;
  file: string;
  code: string;
  message: string;
}

const LOCATION_SUFFIX = /(?:\(\d+,\d+\)|:\d+:\d+)$/;
const TS_CODE = /^(TS\d{1,5}): (.*)$/;

function parseTsError(line: LogLine): TsError | null {
  const text = line.text;
  let idx = text.indexOf(' error TS');
  let skip = ' error '.length;
  if (idx < 0 && text.startsWith('error TS')) {
    idx = 0;
    skip = 'error '.length;
  }
  if (idx < 0) return null;
  const m = TS_CODE.exec(text.slice(idx + skip));
  if (!m) return null;
  let head = text.slice(0, idx).trim();
  if (head.endsWith(' -')) head = head.slice(0, -2);
  if (head.endsWith(':')) head = head.slice(0, -1);
  const file = head.replace(LOCATION_SUFFIX, '');
  return { line, file, code: m[1] ?? '', message: m[2] ?? '' };
}

export const typescriptErrors: Rule = {
  id: 'node.typescript.errors',
  title: 'TypeScript compilation errors',
  ecosystem: 'node',
  category: 'type-check',
  kind: 'rootCause',
  priority: 80,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real tsc 6.0.3 output ("file(line,col): error TSxxxx: message"). The "--pretty" variant ("file:line:col - error TSxxxx") follows the TypeScript documentation and was not checked against a real run.',
  match(ctx) {
    const errors = ctx.lines.map(parseTsError).filter((e): e is TsError => e !== null);
    if (errors.length === 0) return null;
    const files = new Set(errors.map((e) => e.file).filter((f) => f !== ''));
    const first = errors[0]!;
    const evidence: Evidence[] = errors.slice(0, 3).map((e) => ev(e.line));
    return {
      evidence,
      occurrences: errors.length,
      captures: {
        count: String(errors.length),
        files: String(files.size),
        firstCode: first.code,
        firstFile: cap(first.file),
        firstMessage: cap(first.message),
      },
    };
  },
  explain(m) {
    const n = Number(m.captures.count);
    const files = Number(m.captures.files);
    const where = m.captures.firstFile ? ` in ${m.captures.firstFile}` : '';
    const scope = files > 0 ? ` across ${files} ${plural(files, 'file')}` : '';
    return `TypeScript reported ${n} ${plural(n, 'error')}${scope}. The first one is ${m.captures.firstCode}${where}: ${m.captures.firstMessage}`;
  },
  suggest(m) {
    return [
      Number(m.captures.count) > 1
        ? 'Fix the first error first: later errors are often a consequence of it.'
        : 'Fix the reported type error.',
      'Run the type check locally (for example tsc --noEmit) to reproduce it.',
    ];
  },
};
