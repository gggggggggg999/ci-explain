import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Variant {
  name: string;
  text: string;
}

const RULES_DIR = new URL('../fixtures/rules/', import.meta.url);

/** Wraps a fixture in every formatting variant a real CI log can have. */
export function makeVariants(fixture: string, positive: boolean): Variant[] {
  const body = fixture.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const lines = body.split('\n');
  const ts = (i: number) => `2025-03-01T12:00:${String(i % 60).padStart(2, '0')}.1234567Z `;
  const wrapped = [
    '##[group]Run npm test',
    'npm test',
    '##[endgroup]',
    ...lines,
    ...(positive ? ['##[error]Process completed with exit code 1.'] : []),
  ];
  return [
    { name: 'clean', text: body + '\n' },
    { name: 'ansi', text: lines.map((l) => `\u001b[31;1m${l}\u001b[0m`).join('\n') + '\n' },
    { name: 'crlf', text: lines.join('\r\n') + '\r\n' },
    { name: 'timestamps', text: lines.map((l, i) => ts(i) + l).join('\n') + '\n' },
    { name: 'group', text: wrapped.join('\n') + '\n' },
    {
      name: 'gha-full',
      text:
        '\ufeff' +
        [
          "Current runner version: '2.0.0'",
          '##[group]Runner Image',
          'Image: example',
          '##[endgroup]',
          ...wrapped,
          'Post job cleanup.',
        ]
          .map((l, i) => ts(i) + (i > 3 ? `\u001b[36;1m${l}\u001b[0m` : l))
          .join('\r\n') +
        '\r\n',
    },
  ];
}

export interface RuleFixtures {
  ruleId: string;
  positives: { name: string; text: string }[];
  negatives: { name: string; text: string }[];
}

export function loadRuleFixtures(): RuleFixtures[] {
  const root = new URL('.', RULES_DIR).pathname;
  const out: RuleFixtures[] = [];
  for (const dir of readdirSync(root).sort()) {
    const files = readdirSync(join(root, dir))
      .filter((f) => f.endsWith('.log'))
      .sort();
    const read = (f: string) => ({ name: f, text: readFileSync(join(root, dir, f), 'utf8') });
    out.push({
      ruleId: dir,
      positives: files.filter((f) => f.startsWith('pos-')).map(read),
      negatives: files.filter((f) => f.startsWith('neg-')).map(read),
    });
  }
  return out;
}
