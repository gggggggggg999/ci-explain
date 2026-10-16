import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeLog } from '../../src/core/analyze.js';

const gha = (stepName: string, body: string[], exit = 1) =>
  [
    '##[group]Run actions/checkout@v1',
    '##[endgroup]',
    `##[group]Run ${stepName}`,
    ...body,
    `##[error]Process completed with exit code ${exit}.`,
    'Post job cleanup.',
  ].join('\n');

describe('analyzeLog', () => {
  it('prefers a root cause over the exit-code symptom', () => {
    const r = analyzeLog(
      gha('npm run build', [
        "src/a.ts(1,1): error TS2322: Type 'x' is not assignable to type 'y'.",
      ]),
    );
    expect(r.findings.map((f) => f.ruleId)).toEqual(['node.typescript.errors']);
    expect(r.failedStep).toBe('Run npm run build');
    expect(r.exitCode).toBe(1);
  });

  it('folds a cascade of identical-kind errors into one finding with a counter', () => {
    const body = Array.from(
      { length: 60 },
      (_, i) => `src/f${i}.ts(1,1): error TS2304: Cannot find name 'x${i}'.`,
    );
    const r = analyzeLog(gha('tsc', body));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.occurrences).toBe(60);
    expect(r.findings[0]?.evidence.length).toBeLessThanOrEqual(6);
  });

  it('shows the exit-code symptom when nothing else is recognized', () => {
    const r = analyzeLog(gha('./run.sh', ['doing things'], 3));
    expect(r.findings[0]?.ruleId).toBe('generic.exit-code');
  });

  it('returns an honest "unknown" finding with evidence and no invented cause', () => {
    const r = analyzeLog('step one ok\nSomething exploded: error 0x42 in module zeta\nbye\n');
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.ruleId).toBe('unknown');
    expect(f.confidence).toBe('low');
    expect(f.evidence.some((e) => e.text.includes('exploded'))).toBe(true);
    expect(f.explanation).toMatch(/No rule recognized a cause/);
    expect(f.suggestions.join(' ')).toMatch(/--llm/);
    expect(f.suggestions.join(' ')).toMatch(/--export-excerpt/);
  });

  it('finds a root cause outside the failed step with lowered confidence', () => {
    const log = [
      '##[group]Run build',
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
      '##[endgroup]',
      '##[group]Run publish',
      'publishing...',
      '##[error]Process completed with exit code 1.',
    ].join('\n');
    const r = analyzeLog(log);
    const f = r.findings.find((x) => x.ruleId === 'infra.oom.node-heap');
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('medium');
    expect(f?.step).toBeNull();
  });

  it('limits findings by maxFindings (default 3)', () => {
    const body = [
      "src/a.ts(1,1): error TS2322: Type 'x' is not assignable to type 'y'.",
      'FATAL ERROR: JavaScript heap out of memory',
      'Error: ENOSPC: no space left on device, write',
      'RequestError [HttpError]: Resource not accessible by integration',
      "Error: Cannot find module 'abc'",
    ];
    expect(analyzeLog(gha('x', body)).findings).toHaveLength(3);
    expect(analyzeLog(gha('x', body), { maxFindings: 1 }).findings).toHaveLength(1);
    expect(analyzeLog(gha('x', body), { maxFindings: 10 }).totalFindings).toBe(5);
  });

  it('handles empty input without findings or errors', () => {
    const r = analyzeLog('');
    expect(r.findings).toEqual([]);
    expect(r.format).toBe('generic');
  });

  it('never returns a finding without evidence', () => {
    const dir = new URL('../fixtures/rules/', import.meta.url).pathname;
    for (const rule of readdirSync(dir)) {
      for (const f of readdirSync(`${dir}${rule}`)) {
        const r = analyzeLog(readFileSync(`${dir}${rule}/${f}`, 'utf8'), { maxFindings: 50 });
        for (const finding of r.findings) expect(finding.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic: identical input gives byte-identical output', () => {
    const body = [
      "src/a.ts(1,1): error TS2322: Type 'x' is not assignable to type 'y'.",
      'x error',
    ];
    const log = gha('build', body);
    expect(JSON.stringify(analyzeLog(log))).toBe(JSON.stringify(analyzeLog(log)));
  });
});

describe('offline guarantee', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('analysis never calls fetch', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access attempted');
    });
    vi.stubGlobal('fetch', fetchSpy);
    analyzeLog(gha('build', ['error: something', 'Error: Cannot find module "x"']));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('core and rules do not import network or filesystem modules', () => {
    for (const dir of ['core', 'rules']) {
      const root = new URL(`../../src/${dir}/`, import.meta.url).pathname;
      const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(`${d}${e.name}/`) : [`${d}${e.name}`],
        );
      for (const file of walk(root)) {
        const text = readFileSync(file, 'utf8');
        expect(text, file).not.toMatch(/from 'node:(?:fs|net|http|https|child_process|dns|tls)/);
        expect(text, file).not.toMatch(/\bfetch\(/);
      }
    }
  });
});

describe('ReDoS resistance', () => {
  it('analyzes pathological lines quickly', () => {
    const big = 'a'.repeat(100_000);
    const lines = [
      'npm error ' + ' '.repeat(50_000) + 'code ERESOLVE',
      "Error: Cannot find module '" + 'a'.repeat(50_000),
      ' FAIL ' + ' '.repeat(50_000) + 'x',
      '✖ ' + '9'.repeat(50_000) + ' problems (1 errors, 0 warnings)',
      'src/' + '('.repeat(50_000) + ' error TS' + '9'.repeat(50_000) + ': x',
      '='.repeat(50_000) + ' ' + '1 failed '.repeat(5_000),
      '  1:1  error  ' + ' '.repeat(50_000) + 'x',
      'FAILED ' + ':'.repeat(50_000),
      big,
      'E   ModuleNotFoundError: No module named ' + "'".repeat(50_000),
    ];
    const start = performance.now();
    analyzeLog(gha('patho', lines));
    analyzeLog(lines.join('\n'));
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe('TypeScript rule explanation', () => {
  it('names the file without location punctuation and counts distinct files', () => {
    const r = analyzeLog(
      gha('tsc', [
        "src/index.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/util.ts(4,3): error TS2304: Cannot find name 'cfg'.",
        "src/util.ts(9,10): error TS2304: Cannot find name 'cfg'.",
      ]),
    );
    const f = r.findings[0]!;
    expect(f.explanation).toContain('3 errors across 2 files');
    expect(f.explanation).toContain('TS2322 in src/index.ts: Type');
  });
});
