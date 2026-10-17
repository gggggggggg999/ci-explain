import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const text = readFileSync(new URL('../../action.yml', import.meta.url), 'utf8');
const action = parse(text) as {
  inputs: Record<string, { required?: boolean; default?: string }>;
  runs: {
    using: string;
    steps: { uses?: string; run?: string; shell?: string; env?: Record<string, string> }[];
  };
};

describe('action.yml (composite action)', () => {
  it('is a composite action with a required run-id', () => {
    expect(action.runs.using).toBe('composite');
    expect(action.inputs['run-id']?.required).toBe(true);
  });

  it('pins third-party actions to a full commit SHA', () => {
    for (const step of action.runs.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('declares a shell for every run step and never interpolates inputs into scripts', () => {
    for (const step of action.runs.steps) {
      if (!step.run) continue;
      expect(step.shell).toBe('bash');
      expect(step.run).not.toContain('${{');
    }
  });

  it('passes the token only via env and writes only to the job summary', () => {
    const explain = action.runs.steps.find((s) => s.run?.includes('dist/cli/main.js'));
    expect(explain?.env?.GITHUB_TOKEN).toContain('inputs.token');
    expect(text).not.toMatch(/--token/);
    expect(explain?.run).toContain('GITHUB_STEP_SUMMARY');
  });
});
