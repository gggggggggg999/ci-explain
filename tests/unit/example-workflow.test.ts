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

  it('has no run scripts of its own: event data only goes through action inputs', () => {
    for (const step of wf.jobs.explain?.steps ?? []) {
      expect(step.run).toBeUndefined();
    }
  });

  it('does not check out the pull request (no head ref/sha/repository from the event)', () => {
    expect(text).not.toMatch(/github\.event\.(pull_request|workflow_run\.head)/);
    expect(text).not.toContain('pull_request_target');
    expect(text).not.toContain('actions/checkout');
  });

  it('states honestly how far it was verified', () => {
    expect(text).toMatch(/partially verified/i);
    expect(text).toMatch(/Fork pull requests .* NOT been tested/is);
  });
});
