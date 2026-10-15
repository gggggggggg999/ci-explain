import type { Rule } from '../../core/types.js';
import { cap, defineLineRule, ev, findAll, indexOfLine } from '../helpers.js';

export const nodeHeapOom: Rule = {
  id: 'infra.oom.node-heap',
  title: 'Node.js ran out of heap memory',
  ecosystem: 'infra',
  category: 'resource',
  kind: 'rootCause',
  priority: 85,
  confidence: 'high',
  verifiedOn: null,
  sourceNote:
    'V8 fatal error text "JavaScript heap out of memory"; not checked against a real run in this project.',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => t.includes('JavaScript heap out of memory'));
    if (at < 0) return null;
    return { evidence: [ev(ctx.lines[at]!)], captures: {} };
  },
  explain() {
    return 'The Node.js process hit its V8 heap limit and was terminated.';
  },
  suggest() {
    return [
      'Reduce memory use of the step (for example split the work or lower parallelism).',
      'If the work genuinely needs more memory, the heap limit can be raised with NODE_OPTIONS=--max-old-space-size=<MB>.',
    ];
  },
};

export const diskFull: Rule = {
  id: 'infra.disk-full',
  title: 'No space left on device',
  ecosystem: 'infra',
  category: 'resource',
  kind: 'rootCause',
  priority: 85,
  confidence: 'high',
  verifiedOn: null,
  sourceNote:
    'POSIX/Node.js message "ENOSPC: no space left on device" / "No space left on device"; not checked against a real run in this project. The inotify variant (ENOSPC: System limit for number of file watchers reached) is deliberately excluded.',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => {
      const lower = t.toLowerCase();
      return lower.includes('no space left on device');
    });
    if (at < 0) return null;
    const line = ctx.lines[at]!;
    return { evidence: [ev(line)], captures: { detail: cap(line.text) } };
  },
  explain() {
    return 'A write failed because the disk of the runner (or container) is full.';
  },
  suggest() {
    return [
      'Free space before this step (remove unneeded files, caches, or Docker images) or reduce the size of generated artifacts.',
    ];
  },
};

export const oomExit137: Rule = defineLineRule({
  id: 'infra.oom.exit-137',
  title: 'Process killed (exit code 137)',
  ecosystem: 'infra',
  category: 'resource',
  priority: 70,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'Exit code 137 is 128 + SIGKILL (9) by shell convention; this was not verified against a real run, and whether the kill came from the out-of-memory killer is NOT visible in the log, so confidence is capped at medium.',
  find: (t) => /\bexit (?:code|status):? 137\b/.test(t) || /\bExit code 137\b/.test(t),
  explain: () =>
    'A process was killed with SIGKILL (exit code 137). This is often the out-of-memory killer, but the log does not show who sent the signal.',
  suggest: () => [
    'Check memory use of the step; reduce parallelism or split the work if it is memory-heavy.',
    'Look for other causes of SIGKILL (for example a timeout or a container limit) if memory is not the problem.',
  ],
});

export const jobTimeout: Rule = defineLineRule({
  id: 'infra.job-timeout',
  title: 'Job exceeded its maximum execution time',
  ecosystem: 'infra',
  category: 'resource',
  priority: 85,
  confidence: 'high',
  verifiedOn: null,
  sourceNote:
    'GitHub Actions message "The job running on runner ... has exceeded the maximum execution time of N minutes" was not checked against a real run in this project.',
  find: (t) => /has exceeded the maximum execution time of \d{1,6} minutes/.test(t),
  captures: (l) => ({
    minutes: /maximum execution time of (\d{1,6}) minutes/.exec(l.text)?.[1] ?? '',
  }),
  explain: (m) =>
    `The job ran longer than its limit of ${m.captures.minutes} minutes and was stopped. The log does not show which step was slow.`,
  suggest: () => [
    'Find the slowest step (compare step timestamps) and speed it up, add caching, or split the job.',
    'If the work is legitimately long, raise timeout-minutes (within the platform maximum).',
  ],
});

export const jobCancelled: Rule = defineLineRule({
  id: 'infra.job-cancelled',
  title: 'Job or step was canceled',
  ecosystem: 'infra',
  category: 'config',
  kind: 'rootCause',
  priority: 40,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'GitHub Actions cancellation lines ("The operation was canceled.", "Canceling since a higher priority waiting request ... exists") were not checked against real runs in this project.',
  find: (t) =>
    t === '##[error]The operation was canceled.' ||
    t.startsWith('Canceling since a higher priority waiting request'),
  explain: () =>
    'The job or step was canceled. The log does not say whether this was a manual cancel, concurrency settings, or a timeout.',
  suggest: () => [
    'Check whether a newer run or a concurrency group canceled this run, or whether someone canceled it.',
  ],
});

const NET_CODE = /\b(ETIMEDOUT|ECONNRESET|EAI_AGAIN)\b/;

export const networkErrors: Rule = {
  id: 'infra.network',
  title: 'Network error (timeout, connection reset, DNS)',
  ecosystem: 'infra',
  category: 'network',
  kind: 'rootCause',
  priority: 50,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'ETIMEDOUT / ECONNRESET / EAI_AGAIN are standard system error codes; these codes were not checked against a real failing run in this project, and their presence says a network call failed, not which side was at fault, so confidence is capped at medium.',
  match(ctx) {
    const lines = findAll(ctx, (t) => NET_CODE.test(t));
    const first = lines[0];
    if (!first) return null;
    return {
      evidence: lines.slice(0, 3).map(ev),
      occurrences: lines.length,
      captures: { code: NET_CODE.exec(first.text)?.[1] ?? '' },
    };
  },
  explain(m) {
    return `A network operation failed with ${m.captures.code}. This is often transient (registry, DNS, or the remote host), but the log does not show which side was at fault.`;
  },
  suggest() {
    return [
      'Re-run the job; if it keeps failing, check the status of the remote service and whether the runner can reach it.',
      'Add retries or a cache for the step that downloads from the network.',
    ];
  },
};

export const githubRateLimit: Rule = defineLineRule({
  id: 'github.rate-limit',
  title: 'GitHub API rate limit exceeded',
  ecosystem: 'generic',
  category: 'network',
  priority: 80,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'Wording "API rate limit exceeded" / "secondary rate limit" follows the GitHub REST rate-limit documentation (checked 2026-10-15) but was not seen in a real log here; confidence is capped at medium.',
  find: (t) => {
    const lower = t.toLowerCase();
    return lower.includes('api rate limit exceeded') || lower.includes('secondary rate limit');
  },
  explain: () => 'A GitHub API request was rejected because a rate limit was exceeded.',
  suggest: () => [
    'Wait for the limit to reset, and authenticate requests (authenticated requests have higher limits).',
    'Reduce the number of API calls in the job or add caching/backoff.',
  ],
});
