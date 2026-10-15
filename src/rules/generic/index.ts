import type { Rule } from '../../core/types.js';
import { ev, indexOfLine } from '../helpers.js';

const TOKEN_PERMISSIONS = 'Resource not accessible by integration';

export const tokenPermissions: Rule = {
  id: 'github.token-permissions',
  title: 'GitHub token lacks permission (Resource not accessible by integration)',
  ecosystem: 'generic',
  category: 'permission',
  kind: 'rootCause',
  priority: 85,
  confidence: 'high',
  verifiedOn: null,
  sourceNote:
    'GitHub API error message "Resource not accessible by integration"; not checked against a real run in this project.',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => t.includes(TOKEN_PERMISSIONS));
    if (at < 0) return null;
    return { evidence: [ev(ctx.lines[at]!)], captures: {} };
  },
  explain() {
    return 'A GitHub API call was rejected because the token used by the workflow does not have the permission the call needs.';
  },
  suggest() {
    return [
      'Add the missing permission under "permissions:" for this job (grant only what is needed).',
      'Note that tokens for pull requests from forks are restricted regardless of the permissions set.',
    ];
  },
};

export const exitCodeSymptom: Rule = {
  id: 'generic.exit-code',
  title: 'Step failed with a non-zero exit code',
  ecosystem: 'generic',
  category: 'unknown',
  kind: 'symptom',
  priority: 10,
  confidence: 'medium',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Line "##[error]Process completed with exit code N." observed in a real GitHub Actions log.',
  match(ctx) {
    const at = indexOfLine(ctx, (t) =>
      /^##\[error\]Process completed with exit code \d{1,3}\.?$/.test(t),
    );
    if (at < 0) return null;
    const line = ctx.lines[at]!;
    const code = /exit code (\d+)/.exec(line.text)?.[1] ?? '';
    return { evidence: [ev(line)], captures: { code } };
  },
  explain(m) {
    return `The step ended with exit code ${m.captures.code}. This is a symptom, not a cause: the reason is in the output above it.`;
  },
  suggest() {
    return [
      'Read the lines just above the exit-code message; they usually contain the real error.',
    ];
  },
};
