import type { LogLine } from '../../core/types.js';
import { cap, defineLineRule, ev, npmText } from '../helpers.js';
import type { Rule } from '../../core/types.js';

const after = (lines: LogLine[], index: number, count: number, test: (t: string) => boolean) =>
  lines.slice(index + 1, index + 1 + count).filter((l) => test(l.text));

export const pnpmLockfile: Rule = defineLineRule({
  id: 'node.pnpm.lockfile',
  title: 'pnpm: lockfile is not up to date (frozen-lockfile)',
  ecosystem: 'node',
  category: 'dependency',
  priority: 85,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real pnpm 10 output (pnpm install --frozen-lockfile after editing package.json).',
  find: (t) => t.includes('ERR_PNPM_OUTDATED_LOCKFILE'),
  related: (lines, i) => after(lines, i, 12, (t) => t.includes('(lockfile:')).slice(0, 2),
  captures: (_line) => ({}),
  explain: () =>
    'pnpm refused to install with a frozen lockfile because pnpm-lock.yaml does not match package.json.',
  suggest: () => [
    'Run pnpm install locally to update pnpm-lock.yaml and commit it.',
    'In CI this check is on by default; --no-frozen-lockfile would skip it but hides the drift.',
  ],
});

export const yarnLockfile: Rule = defineLineRule({
  id: 'node.yarn.lockfile',
  title: 'yarn: lockfile would have to change (frozen install)',
  ecosystem: 'node',
  category: 'dependency',
  priority: 85,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Yarn 1.22 message checked against real output. The Yarn Berry message (YN0028) was not checked against a real run, so it is reported with medium confidence.',
  find: (t) =>
    t.includes('Your lockfile needs to be updated, but yarn was run with `--frozen-lockfile`') ||
    t.includes('YN0028') ||
    t.includes(
      'The lockfile would have been modified by this install, which is explicitly forbidden',
    ),
  confidenceFor: (l) =>
    l.text.includes('YN0028') || l.text.includes('explicitly forbidden') ? 'medium' : undefined,
  explain: () =>
    'yarn refused to install because the lockfile would have to change, which a frozen/immutable install forbids.',
  suggest: () => ['Run yarn install locally to update yarn.lock and commit it.'],
});

export const enginesMismatch: Rule = {
  id: 'node.engines',
  title: 'Incompatible Node.js/package manager version (engines)',
  ecosystem: 'node',
  category: 'config',
  kind: 'rootCause',
  priority: 80,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'npm EBADENGINE (with engine-strict) checked against real npm 10.9.0 output. The pnpm (ERR_PNPM_UNSUPPORTED_ENGINE) and Yarn 1 ("The engine ... is incompatible with this module") wordings were not checked against real runs. A plain "npm warn EBADENGINE" is only a warning and is deliberately ignored.',
  match(ctx) {
    const at = ctx.lines.findIndex((l) => {
      const n = npmText(l.text);
      return (
        (n !== null && n.trim() === 'code EBADENGINE') ||
        l.text.includes('ERR_PNPM_UNSUPPORTED_ENGINE') ||
        /^error .{1,200}: The engine "[^"]{1,40}" is incompatible with this module/.test(l.text)
      );
    });
    if (at < 0) return null;
    const evidence = [ev(ctx.lines[at] as LogLine)];
    const captures: Record<string, string> = {};
    for (const l of ctx.lines.slice(at + 1, at + 8)) {
      const n = npmText(l.text);
      const m = n ? /^notsup (Required|Actual): (.{1,200})$/.exec(n) : null;
      if (m) {
        evidence.push(ev(l));
        captures[(m[1] ?? '').toLowerCase()] = cap(m[2] ?? '');
      }
    }
    return { evidence, captures };
  },
  explain(m) {
    return m.captures.required && m.captures.actual
      ? `A package requires ${m.captures.required}, but this job runs ${m.captures.actual}.`
      : 'A package declares an engines range that the Node.js or package manager version used by this job does not satisfy.';
  },
  suggest() {
    return [
      'Use a Node.js version inside the required range (for example via the setup-node version input).',
      'Or relax the engines field if the package works on your version.',
    ];
  },
};

export const nodeGyp: Rule = defineLineRule({
  id: 'node.node-gyp',
  title: 'Native module build failed (node-gyp)',
  ecosystem: 'node',
  category: 'build',
  priority: 75,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'node-gyp "gyp ERR!" lines were not checked against a real failing build in this project; confidence is capped at medium.',
  find: (t) =>
    t.includes('gyp ERR! build error') ||
    t.includes('gyp ERR! find Python') ||
    t.includes('gyp ERR! configure error'),
  related: (lines, i) => {
    const near = lines.slice(Math.max(0, i - 8), i + 8);
    return near.filter((l) => l.text.startsWith('gyp ERR! stack')).slice(0, 2);
  },
  captures: (l) => ({
    stage: l.text.includes('find Python')
      ? 'python'
      : l.text.includes('configure error')
        ? 'configure'
        : 'build',
  }),
  explain: (m) =>
    m.captures.stage === 'python'
      ? 'node-gyp could not find a usable Python, which it needs to build a native module.'
      : `node-gyp failed during the ${m.captures.stage} stage while building a native module. The compiler/toolchain output is in the lines above.`,
  suggest: () => [
    'Check whether the package ships prebuilt binaries for this Node.js version and platform; upgrading the package often fixes this.',
    'Otherwise make sure the build toolchain (Python, make, a C/C++ compiler) is available on the runner.',
  ],
});
