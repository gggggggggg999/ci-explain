import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('docs', () => {
  it('docs/RULES.md is in sync with the rule registry', () => {
    const root = new URL('../../', import.meta.url).pathname;
    const out = execFileSync('npx', ['tsx', 'scripts/gen-rules-doc.ts', '--check'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(out).toMatch(/in sync/);
  });
});
