import type { Rule } from '../../core/types.js';
import { cap, defineLineRule, ev, indexOfLine } from '../helpers.js';

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

const PERMISSION_MARKERS = [
  'Permission denied (publickey)',
  'remote: Permission to ',
  'fatal: Authentication failed for',
  'fatal: could not read Username for',
];

export const gitPermissionDenied: Rule = defineLineRule({
  id: 'git.permission-denied',
  title: 'Git was denied access (authentication or push permission)',
  ecosystem: 'generic',
  category: 'permission',
  priority: 70,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'Git messages "Permission denied (publickey)", "remote: Permission to ... denied", "Authentication failed", "could not read Username" were not checked against real runs in this project.',
  find: (t) => PERMISSION_MARKERS.some((m) => t.includes(m)),
  explain: () =>
    'Git could not authenticate to the remote or was not allowed to access/push to the repository.',
  suggest: () => [
    'For pushes from a workflow, check that the job has contents: write permission and that branch protection allows the push.',
    'For SSH or private repositories, check that the key or token is configured and has access.',
  ],
});

export const gitCheckout: Rule = defineLineRule({
  id: 'git.checkout-submodule',
  title: 'Git checkout or submodule step failed',
  ecosystem: 'generic',
  category: 'config',
  priority: 65,
  confidence: 'medium',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real git 2.37 output: "fatal: No url found for submodule path ... in .gitmodules" and "fatal: repository ... not found" / "remote: Repository not found.". The "clone of ... into submodule path ... failed" wording was not checked against a real run.',
  find: (t) =>
    /^fatal: No url found for submodule path '/.test(t) ||
    /^fatal: clone of '.{1,300}' into submodule path '.{1,300}' failed/.test(t) ||
    /^fatal: repository '.{1,300}' not found/.test(t) ||
    t === 'remote: Repository not found.',
  captures: (l) => {
    const sub = /submodule path '([^']{1,300})'/.exec(l.text)?.[1];
    return { variant: sub ? 'submodule' : 'repository', path: cap(sub ?? '') };
  },
  explain: (m) =>
    m.captures.variant === 'submodule'
      ? `Git could not set up the submodule at ${m.captures.path}.`
      : 'Git reported that the repository was not found. For private repositories this message also appears when the credentials cannot see the repository.',
  suggest: (m) =>
    m.captures.variant === 'submodule'
      ? [
          'Check .gitmodules has a url for this path and that the credentials can read that repository.',
        ]
      : ['Check the repository name and that the token or key used by the job has access to it.'],
});

const ENV_PATTERNS: { re: RegExp; confidence: 'low' | 'medium' }[] = [
  { re: /Input required and not supplied: (\S{1,100})/, confidence: 'medium' },
  {
    re: /(?:missing|undefined|unset)(?: required)?(?: environment)? variable:? ['"`]?([A-Z][A-Z0-9_]{2,60})/i,
    confidence: 'low',
  },
  {
    re: /environment variable ['"`]?([A-Z][A-Z0-9_]{2,60})['"`]? (?:is )?(?:not set|not defined|required|missing|undefined)/i,
    confidence: 'low',
  },
];

export const missingEnv: Rule = defineLineRule({
  id: 'config.missing-env',
  title: 'A required input or environment variable is reported missing',
  ecosystem: 'generic',
  category: 'config',
  priority: 45,
  confidence: 'low',
  verifiedOn: null,
  sourceNote:
    'Wordings follow the GitHub Actions toolkit ("Input required and not supplied") and common application messages; not checked against real runs in this project. Confidence is limited to medium/low because a log cannot prove a secret is empty.',
  find: (t) => ENV_PATTERNS.some((p) => p.re.test(t)),
  captures: (l): Record<string, string> => {
    for (const p of ENV_PATTERNS) {
      const m = p.re.exec(l.text);
      if (m) return { name: cap(m[1] ?? '') };
    }
    return {};
  },
  confidenceFor: (l) => ENV_PATTERNS.find((p) => p.re.test(l.text))?.confidence,
  explain: (m) =>
    `The log reports that ${m.captures.name} is missing. A log cannot show whether the value is empty, unset, or simply not available to this run (for example, repository secrets are not passed to workflows triggered by pull requests from forks).`,
  suggest: (m) => [
    `Check where ${m.captures.name} is supposed to come from (workflow env, secrets, or action inputs) and that it is available for this event.`,
  ],
});
