import type { Rule } from '../../core/types.js';
import { cap, dedupeEvidence, ev, indexOfLine, npmText } from '../helpers.js';

const isNpmCode = (code: string) => (text: string) => {
  const t = npmText(text);
  return t !== null && t.trim() === `code ${code}`;
};

export const npmEresolve: Rule = {
  id: 'node.npm.eresolve',
  title: 'npm cannot resolve the dependency tree (ERESOLVE)',
  ecosystem: 'node',
  category: 'dependency',
  kind: 'rootCause',
  priority: 80,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real npm 10.9.0 output (npm install with conflicting peer dependencies) and a real GitHub Actions npm ci failure (peer range containing spaces).',
  match(ctx) {
    const at = indexOfLine(ctx, isNpmCode('ERESOLVE'));
    if (at < 0) return null;
    const evidence = [ev(ctx.lines[at]!)];
    const captures: Record<string, string> = {};
    const window = ctx.lines.slice(at, at + 30);
    window.forEach((line, i) => {
      const t = npmText(line.text);
      if (t === null) return;
      if (t.startsWith('Found: ')) {
        evidence.push(ev(line));
        captures.found = cap(t.slice('Found: '.length));
      } else if (t.startsWith('Could not resolve dependency:')) {
        evidence.push(ev(line));
        const next = window[i + 1];
        const nt = next ? npmText(next.text) : null;
        const m = nt ? /^(?:peer|peerOptional) (.{1,150}?) from (\S{1,150})/.exec(nt) : null;
        if (next && m) {
          evidence.push(ev(next));
          captures.required = cap(m[1] ?? '');
          captures.requiredBy = cap(m[2] ?? '');
        }
      }
    });
    return { evidence: dedupeEvidence(evidence), captures };
  },
  explain(m) {
    const { found, required, requiredBy } = m.captures;
    if (found && required && requiredBy) {
      return `npm could not build a consistent dependency tree: ${requiredBy} requires the peer dependency ${required}, but ${found} is requested elsewhere.`;
    }
    return 'npm reported ERESOLVE: it could not build a consistent dependency tree because of conflicting (peer) dependency requirements.';
  },
  suggest() {
    return [
      'Align the versions of the packages named in the conflict, or upgrade the package that declares the peer requirement.',
      'As a temporary workaround npm offers --legacy-peer-deps or --force, but both can hide a real incompatibility.',
    ];
  },
};

export const npmCiLockMismatch: Rule = {
  id: 'node.npm.ci-lock-mismatch',
  title: 'npm ci: package.json and the lockfile are out of sync',
  ecosystem: 'node',
  category: 'dependency',
  kind: 'rootCause',
  priority: 85,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote:
    'Checked against real npm 10.9.0 output (npm ci with a modified package.json, and npm ci without a lockfile).',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => {
      const n = npmText(t);
      return (
        n !== null &&
        (n.includes(
          '`npm ci` can only install packages when your package.json and package-lock.json',
        ) ||
          n.includes('`npm ci` command can only install with an existing package-lock.json'))
      );
    });
    if (at < 0) return null;
    const line = ctx.lines[at]!;
    const evidence = [ev(line)];
    for (const l of ctx.lines.slice(at + 1, at + 12)) {
      const n = npmText(l.text);
      if (n && (n.startsWith('Invalid:') || n.startsWith('Missing:'))) {
        if (evidence.length < 4) evidence.push(ev(l));
      }
    }
    const missingLockfile = line.text.includes('existing package-lock.json');
    return {
      evidence,
      captures: { variant: missingLockfile ? 'missing-lockfile' : 'out-of-sync' },
    };
  },
  explain(m) {
    return m.captures.variant === 'missing-lockfile'
      ? 'npm ci requires a package-lock.json (or npm-shrinkwrap.json) and none was found.'
      : 'npm ci refuses to install because package.json and the lockfile disagree; the lines below show which entries do not match.';
  },
  suggest(m) {
    return m.captures.variant === 'missing-lockfile'
      ? ['Commit package-lock.json to the repository, or use npm install instead of npm ci.']
      : ['Run npm install locally to update the lockfile and commit the result.'];
  },
};

export const npmE404: Rule = {
  id: 'node.npm.e404',
  title: 'npm registry returned 404 (package not found)',
  ecosystem: 'node',
  category: 'dependency',
  kind: 'rootCause',
  priority: 75,
  confidence: 'high',
  verifiedOn: '2026-10-15',
  sourceNote: 'Checked against real npm 10.9.0 output (npm install of a non-existent package).',
  match(ctx) {
    const at = indexOfLine(ctx, isNpmCode('E404'));
    if (at < 0) return null;
    const evidence = [ev(ctx.lines[at]!)];
    const captures: Record<string, string> = {};
    for (const l of ctx.lines.slice(at + 1, at + 6)) {
      const t = npmText(l.text);
      const m = t ? /^404 (?:Not Found - )?GET (\S+)/.exec(t) : null;
      if (m) {
        evidence.push(ev(l));
        captures.url = cap(m[1] ?? '');
        break;
      }
    }
    return { evidence, captures };
  },
  explain(m) {
    return m.captures.url
      ? `The npm registry answered 404 for ${m.captures.url}: the package or version does not exist there, or it is not visible to the credentials in use.`
      : 'The npm registry answered 404: the package or version does not exist there, or it is not visible to the credentials in use.';
  },
  suggest() {
    return [
      'Check the package name and version for typos, and confirm it is published.',
      'For private packages, check the registry URL and the auth token configured for this job.',
    ];
  },
};

export const npmAuth: Rule = {
  id: 'node.npm.auth',
  title: 'npm registry rejected the credentials (E401/E403)',
  ecosystem: 'node',
  category: 'permission',
  kind: 'rootCause',
  priority: 75,
  confidence: 'high',
  verifiedOn: null,
  sourceNote:
    'Message format "npm error code E401|E403" follows the same prefix as the verified E404 output; the exact wording of the following lines was not checked against a real registry response.',
  match(ctx) {
    const at = indexOfLine(ctx, (t) => isNpmCode('E401')(t) || isNpmCode('E403')(t));
    if (at < 0) return null;
    const line = ctx.lines[at]!;
    const evidence = [ev(line)];
    const next = ctx.lines.slice(at + 1, at + 4).find((l) => {
      const t = npmText(l.text);
      return t !== null && /^(?:401|403) /.test(t);
    });
    if (next) evidence.push(ev(next));
    return { evidence, captures: { code: line.text.includes('E401') ? 'E401' : 'E403' } };
  },
  explain(m) {
    return m.captures.code === 'E401'
      ? 'The npm registry answered 401: the request was not authenticated or the token was not accepted.'
      : 'The npm registry answered 403: the request was understood but the account or token is not allowed to perform it.';
  },
  suggest() {
    return [
      'Check that the registry token is present in this job and has not expired or been revoked.',
      'Confirm the token has access to the package or scope being requested.',
    ];
  },
};

export const npmEacces: Rule = {
  id: 'node.npm.eacces',
  title: 'Permission denied (EACCES)',
  ecosystem: 'node',
  category: 'permission',
  kind: 'rootCause',
  priority: 70,
  confidence: 'high',
  verifiedOn: null,
  sourceNote:
    'EACCES is a Node.js/POSIX error code; the surrounding npm message format was not checked against a real run.',
  match(ctx) {
    const at = indexOfLine(
      ctx,
      (t) => isNpmCode('EACCES')(t) || /\bEACCES: permission denied\b/.test(t),
    );
    if (at < 0) return null;
    const evidence = [ev(ctx.lines[at]!)];
    const captures: Record<string, string> = {};
    for (const l of ctx.lines.slice(at, at + 8)) {
      const m = /EACCES: permission denied,? (?:\w+ )?'([^']{1,300})'/.exec(l.text);
      if (m) {
        if (l.n !== ctx.lines[at]!.n) evidence.push(ev(l));
        captures.path = cap(m[1] ?? '');
        break;
      }
    }
    return { evidence, captures };
  },
  explain(m) {
    return m.captures.path
      ? `The process was denied access to ${m.captures.path} (EACCES).`
      : 'The process was denied access to a file or directory (EACCES).';
  },
  suggest() {
    return [
      'Check which user runs the step and who owns the path named in the error.',
      'Avoid fixing this with sudo; install to a location the job user can write to.',
    ];
  },
};
