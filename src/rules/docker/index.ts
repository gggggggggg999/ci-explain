import type { LogLine, Rule } from '../../core/types.js';
import { cap, defineLineRule } from '../helpers.js';

const PROCESS_FAILED =
  /process "([^"]{1,300})" did not complete successfully: exit code: (\d{1,3})/;

export const dockerBuildFailed: Rule = defineLineRule({
  id: 'docker.build-failed',
  title: 'Docker build failed (failed to solve)',
  ecosystem: 'docker',
  category: 'build',
  priority: 60,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'BuildKit "failed to solve: process ... did not complete successfully" wording was not checked against real docker output in this project (docker was not available); confidence is capped at medium.',
  find: (t) => t.includes('failed to solve') && PROCESS_FAILED.test(t),
  related: (lines, i) =>
    lines
      .slice(Math.max(0, i - 25), i)
      .filter((l) => /^\s*> \[.{1,80}\] /.test(l.text))
      .slice(-1),
  captures: (l) => {
    const m = PROCESS_FAILED.exec(l.text);
    return { command: cap(m?.[1] ?? ''), exitCode: m?.[2] ?? '' };
  },
  explain: (m) =>
    `A Dockerfile instruction failed: ${m.captures.command} exited with code ${m.captures.exitCode}. The cause is in that command's own output above this line.`,
  suggest: () => [
    'Read the output of the failing instruction above the error and fix that command.',
    'Reproduce locally with docker build to iterate faster.',
  ],
});

export const dockerRateLimit: Rule = defineLineRule({
  id: 'docker.rate-limit',
  title: 'Docker registry pull rate limit reached',
  ecosystem: 'docker',
  category: 'network',
  priority: 80,
  confidence: 'high',
  verifiedOn: null,
  sourceNote:
    'The "toomanyrequests" error code and "pull rate limit" wording were not checked against a real registry response in this project.',
  find: (t) => t.includes('toomanyrequests') && t.toLowerCase().includes('rate limit'),
  explain: () =>
    'The container registry refused the pull because the rate limit for this client was reached.',
  suggest: () => [
    'Authenticate to the registry in the job (anonymous pulls have lower limits), or use a mirror/cache.',
    'Re-running later may work once the limit window passes.',
  ],
});

export const dockerCopyNotFound: Rule = defineLineRule({
  id: 'docker.copy-not-found',
  title: 'Docker COPY/ADD: file not found in the build context',
  ecosystem: 'docker',
  category: 'build',
  priority: 75,
  confidence: 'medium',
  verifiedOn: null,
  sourceNote:
    'BuildKit "failed to compute cache key ... not found" and the legacy "COPY failed: file not found in build context" wordings were not checked against real docker output in this project.',
  find: (t) =>
    (t.includes('failed to compute cache key') && t.includes('not found')) ||
    t.includes('COPY failed: file not found in build context'),
  captures: (l) => ({ path: cap(/"(\/[^"]{1,300})": not found/.exec(l.text)?.[1] ?? '') }),
  related: (_lines: LogLine[], _i: number) => [],
  explain: (m) =>
    m.captures.path
      ? `Docker could not find ${m.captures.path} in the build context.`
      : 'Docker could not find a file referenced by COPY/ADD in the build context.',
  suggest: () => [
    'Check the path in the Dockerfile and that the file is not excluded by .dockerignore.',
    'Check the build context directory passed to docker build.',
  ],
});
