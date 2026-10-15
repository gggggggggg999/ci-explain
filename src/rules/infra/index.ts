import type { Rule } from '../../core/types.js';
import { cap, ev, indexOfLine } from '../helpers.js';

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
