import type { AnalysisResult } from './analyze.js';

/** Renders the (already redacted) error windows as a shareable excerpt. */
export function renderExcerpt(result: AnalysisResult, toolVersion: string): string {
  const out: string[] = [
    `# ci-explain excerpt (ci-explain ${toolVersion})`,
    '# REVIEW BEFORE SHARING: redaction is pattern-based and can miss secrets.',
    '# Read this file yourself and remove anything private before posting it anywhere.',
    '# Nothing was sent anywhere. Numbers on the left are line numbers in the original log.',
    `# format: ${result.format}; failed step: ${result.failedStep ?? 'unknown'}; redactions: ${result.redactions.count}`,
    '',
  ];
  const width = String(
    Math.max(1, ...result.windows.flatMap((w) => w.lines.map((l) => l.n))),
  ).length;
  result.windows.forEach((w, i) => {
    if (i > 0) out.push('...');
    if (w.job && w.job !== result.windows[i - 1]?.job) out.push(`# job: ${w.job}`);
    for (const l of w.lines) {
      const rep = l.repeat > 1 ? `  (x${l.repeat})` : '';
      out.push(`${String(l.n).padStart(width)} | ${l.text}${rep}`);
    }
  });
  return out.join('\n') + '\n';
}
