import { rankFindings, type AnalysisResult } from './analyze.js';
import type { Finding } from './types.js';

export interface JobResult {
  job: string;
  result: AnalysisResult;
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Combines per-job analyses of one workflow run into one result.
 * Each finding keeps the job name, because its evidence line numbers refer to that job's log.
 */
export function mergeJobResults(jobs: JobResult[], maxFindings: number): AnalysisResult {
  if (jobs.length === 0) throw new Error('mergeJobResults needs at least one job');
  const first = jobs[0] as JobResult;

  const all: (Finding & { _priority: number; _first: number })[] = [];
  jobs.forEach(({ job, result }, jobIndex) => {
    result.findings.forEach((f, i) => {
      all.push({
        ...f,
        job,
        _priority: 1000 - i - jobIndex * 10,
        _first: f.evidence[0]?.line ?? 0,
      });
    });
  });
  const ranked = rankFindings(all);
  // Several jobs may report the same unknown/symptom finding; keep unknowns only if nothing else exists.
  const meaningful = ranked.filter((f) => f.ruleId !== 'unknown');
  const pool = meaningful.length > 0 ? meaningful : ranked;
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const f of pool) {
    const key = `${f.job}|${f.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { _priority: _p, _first: _f, ...rest } = f;
    unique.push(rest);
  }
  unique.sort(
    (a, b) =>
      (a.kind === 'rootCause' ? 0 : 1) - (b.kind === 'rootCause' ? 0 : 1) ||
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence],
  );

  const byKind: Record<string, number> = {};
  for (const { result } of jobs) {
    for (const [k, v] of Object.entries(result.redactions.byKind)) byKind[k] = (byKind[k] ?? 0) + v;
  }
  return {
    format: jobs.some((j) => j.result.format === 'github-actions') ? 'github-actions' : 'generic',
    failedStep: first.result.failedStep ? `${first.job} / ${first.result.failedStep}` : null,
    exitCode: first.result.exitCode,
    truncated: jobs.some((j) => j.result.truncated),
    warnings: [...new Set(jobs.flatMap((j) => j.result.warnings))],
    redactions: {
      count: jobs.reduce((n, j) => n + j.result.redactions.count, 0),
      byKind,
    },
    findings: unique.slice(0, maxFindings),
    totalFindings: unique.length,
    windows: jobs.flatMap(({ job, result }) => result.windows.map((w) => ({ ...w, job }))),
    stats: {
      originalLines: jobs.reduce((n, j) => n + j.result.stats.originalLines, 0),
      analyzedLines: jobs.reduce((n, j) => n + j.result.stats.analyzedLines, 0),
      collapsedLines: jobs.reduce((n, j) => n + j.result.stats.collapsedLines, 0),
    },
  };
}
