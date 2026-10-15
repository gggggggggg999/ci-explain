import type { LogLine, NormalizedLog, Segmentation, Step } from './types.js';

const GROUP = '##[group]';
const ENDGROUP = '##[endgroup]';
const ERROR_CMD = '##[error]';
const EXIT_CODE_RE = /^Process completed with exit code (\d{1,3})\.?$/;

/**
 * Step heuristic for GitHub Actions job logs (observed on real logs, see docs/ARCHITECTURE.md):
 * a user step starts with a `##[group]Run ...` line; `Post job cleanup.` and
 * `Cleaning up orphan processes` start the closing phases. Other `##[group]` blocks are
 * sub-sections inside the current step and do not start a new one.
 */
function stepStartName(line: LogLine): string | null {
  const t = line.text;
  if (t.startsWith(GROUP + 'Run ')) return t.slice(GROUP.length);
  if (t === 'Post job cleanup.') return 'Post job cleanup';
  if (t === 'Cleaning up orphan processes') return 'Complete job';
  return null;
}

export function isGithubActionsLog(log: NormalizedLog): boolean {
  return log.lines.some(
    (l) => l.text.startsWith(GROUP) || l.text.startsWith(ENDGROUP) || l.text.startsWith(ERROR_CMD),
  );
}

export function segmentLog(log: NormalizedLog): Segmentation {
  const { lines } = log;
  if (!isGithubActionsLog(log)) {
    return { format: 'generic', steps: [], failedStep: null, exitCode: null };
  }

  const steps: Step[] = [];
  let current: Step | null = null;
  const open = (name: string, index: number, line: LogLine) => {
    if (current) current.endIndex = index - 1;
    current = {
      name,
      startIndex: index,
      endIndex: lines.length - 1,
      startLine: line.n,
      endLine: line.n,
      failed: false,
    };
    steps.push(current);
  };

  lines.forEach((line, index) => {
    const name = stepStartName(line);
    if (name !== null) open(name, index, line);
    else if (!current) open('Set up job', index, line);
  });
  for (const s of steps) s.endLine = (lines[s.endIndex] as LogLine).n;

  // `gh run view --log-failed` knows real step names: use them when every line of a step agrees.
  for (const s of steps) {
    const hint = lines[s.endIndex]?.stepHint;
    if (hint) s.name = hint;
  }

  // Failed step: the step holding the last `Process completed with exit code N`,
  // otherwise the step holding the last `##[error]` command.
  let failedIndex = -1;
  let exitCode: number | null = null;
  let lastErrorIndex = -1;
  lines.forEach((line, index) => {
    if (!line.text.startsWith(ERROR_CMD)) return;
    lastErrorIndex = index;
    const m = EXIT_CODE_RE.exec(line.text.slice(ERROR_CMD.length).trim());
    if (m) {
      failedIndex = index;
      exitCode = Number(m[1]);
    }
  });
  if (failedIndex === -1) failedIndex = lastErrorIndex;

  let failedStep: Step | null = null;
  if (failedIndex !== -1) {
    failedStep =
      steps.find((s) => failedIndex >= s.startIndex && failedIndex <= s.endIndex) ?? null;
    if (failedStep) failedStep.failed = true;
  }
  return { format: 'github-actions', steps, failedStep, exitCode };
}
