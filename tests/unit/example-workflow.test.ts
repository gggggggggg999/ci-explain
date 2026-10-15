import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const path = new URL('../../examples/github-actions/explain-failed-runs.yml', import.meta.url);
const text = readFileSync(path, 'utf8');
const wf = parse(text) as {
  on: { workflow_run: { workflows: string[]; types: string[] } };
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; steps: Record<string, unknown>[] }>;
};

describe('examples/github-actions/explain-failed-runs.yml', () => {
  it('is valid YAML triggered by completed workflow_run events', () => {
    expect(wf.on.workflow_run.types).toEqual(['completed']);
    expect(wf.on.workflow_run.workflows.length).toBeGreaterThan(0);
  });

  it('uses minimal permissions: only actions: read', () => {
    expect(wf.permissions).toEqual({ actions: 'read' });
  });

  it('only runs for failed conclusions', () => {
    expect(wf.jobs.explain?.if).toContain("conclusion == 'failure'");
  });

  it('pins every third-party action to a full commit SHA', () => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1] as string);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });

  it('never interpolates event data directly into run scripts', () => {
    for (const step of wf.jobs.explain?.steps ?? []) {
      const script = typeof step.run === 'string' ? step.run : '';
      expect(script).not.toContain('${{');
    }
  });

  it('does not check out the pull request (no head ref/sha/repository from the event)', () => {
    expect(text).not.toMatch(/github\.event\.(pull_request|workflow_run\.head)/);
    expect(text).not.toContain('pull_request_target');
  });

  it('does not persist credentials on checkout and writes only to the job summary', () => {
    expect(text).toContain('persist-credentials: false');
    expect(text).toContain('GITHUB_STEP_SUMMARY');
  });

  it('is marked as requiring manual verification', () => {
    expect(text).toMatch(/needs manual verification/i);
  });
});
