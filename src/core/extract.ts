import type { ErrorWindow, LogLine, NormalizedLog, Segmentation } from './types.js';

export interface ExtractOptions {
  linesBefore?: number;
  linesAfter?: number;
  /** Lines taken from the end of the failed step. */
  tailLines?: number;
  /** Upper bound of lines across all windows. */
  maxTotalLines?: number;
}

const DEFAULTS = { linesBefore: 4, linesAfter: 3, tailLines: 15, maxTotalLines: 200 };

// Plain substring markers (lower-case); no regex, so no backtracking risk.
const MARKERS = [
  'error',
  'err!',
  'fail',
  'exception',
  'traceback',
  'exit code',
  'fatal',
  'denied',
  'cannot ',
  'not found',
  'killed',
  'timed out',
  'panic',
];

export function isErrorCandidate(text: string): boolean {
  const lower = text.toLowerCase();
  for (const m of MARKERS) if (lower.includes(m)) return true;
  return false;
}

/** Returns the lines a rule should look at first: the failed step if known, otherwise everything. */
export function scopeIndexes(log: NormalizedLog, seg: Segmentation): [number, number] {
  if (seg.failedStep) return [seg.failedStep.startIndex, seg.failedStep.endIndex];
  return [0, log.lines.length - 1];
}

/**
 * Builds merged windows around error candidates plus the tail of the failed step.
 * Output is used by rules, the excerpt export, and the AI layer.
 */
export function extractWindows(
  log: NormalizedLog,
  seg: Segmentation,
  options: ExtractOptions = {},
): ErrorWindow[] {
  const o = { ...DEFAULTS, ...options };
  if (log.lines.length === 0) return [];
  const [from, to] = scopeIndexes(log, seg);

  const ranges: { start: number; end: number; priority: number }[] = [];
  const tailStart = Math.max(from, to - o.tailLines + 1);
  ranges.push({ start: tailStart, end: to, priority: 0 });

  for (let i = from; i <= to; i++) {
    const line = log.lines[i] as LogLine;
    if (isErrorCandidate(line.text)) {
      ranges.push({
        start: Math.max(from, i - o.linesBefore),
        end: Math.min(to, i + o.linesAfter),
        priority: 1,
      });
    }
  }

  const merged = mergeRanges(ranges);
  // Enforce the line budget: tail first, then earliest windows.
  const budgeted: { start: number; end: number; priority: number }[] = [];
  let used = 0;
  const byPriority = [...merged].sort((a, b) => a.priority - b.priority || a.start - b.start);
  for (const r of byPriority) {
    const size = r.end - r.start + 1;
    if (used + size <= o.maxTotalLines) {
      budgeted.push(r);
      used += size;
    } else if (used < o.maxTotalLines) {
      const room = o.maxTotalLines - used;
      budgeted.push({ ...r, end: r.start + room - 1 });
      used = o.maxTotalLines;
    }
  }
  budgeted.sort((a, b) => a.start - b.start);

  return budgeted.map((r) => {
    const slice = log.lines.slice(r.start, r.end + 1);
    return {
      startLine: (slice[0] as LogLine).n,
      endLine: (slice[slice.length - 1] as LogLine).n,
      lines: slice,
      stepName: seg.failedStep?.name ?? null,
    };
  });
}

function mergeRanges(
  ranges: { start: number; end: number; priority: number }[],
): { start: number; end: number; priority: number }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { start: number; end: number; priority: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
      last.priority = Math.min(last.priority, r.priority);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}
