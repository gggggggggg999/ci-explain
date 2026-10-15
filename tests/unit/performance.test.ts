import { describe, expect, it } from 'vitest';
import { analyzeLog } from '../../src/core/analyze.js';

describe('performance regression guard', () => {
  it('analyzes a ~5 MiB synthetic log well within a generous ceiling', () => {
    const lines: string[] = ['##[group]Run npm test'];
    for (let i = 0; i < 60_000; i++) {
      lines.push(`2025-01-01T00:00:00.0000000Z   PASS  src/module-${i}.test.ts (${i % 97} ms)`);
      if (i % 5000 === 0) {
        lines.push(
          `2025-01-01T00:00:00.0000000Z src/m${i}.ts(1,3): error TS2322: Type 'string' is not assignable to type 'number'.`,
        );
      }
    }
    lines.push('2025-01-01T00:00:01.0000000Z ##[error]Process completed with exit code 1.');
    const text = lines.join('\n');
    expect(text.length).toBeGreaterThan(4_000_000);

    const start = performance.now();
    const result = analyzeLog(text);
    const ms = performance.now() - start;

    expect(result.findings[0]?.ruleId).toBe('node.typescript.errors');
    // Measured on the maintainer's machine at roughly 1 s per 10 MiB; the ceiling is 10x+ that.
    expect(ms).toBeLessThan(15_000);
  });
});
