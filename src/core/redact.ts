import type { LogLine } from './types.js';

export interface RedactOptions {
  /** Also redact e-mail addresses and IPv4 addresses (off by default). */
  pii?: boolean;
}

export interface RedactionSummary {
  count: number;
  byKind: Record<string, number>;
}

export interface RedactedText extends RedactionSummary {
  text: string;
}

export interface RedactedLines extends RedactionSummary {
  lines: LogLine[];
}

export const STRICT_KINDS = [
  'private-key',
  'github-token',
  'aws-access-key-id',
  'jwt',
  'npm-token',
  'slack-token',
  'google-api-key',
  'stripe-key',
  'azure-secret',
] as const;

const marker = (kind: string) => `[REDACTED:${kind}]`;
const isMasked = (value: string) => /^\*{3,}$/.test(value);

interface Pattern {
  kind: string;
  re: RegExp;
  /** Returns the replacement or null to leave the match untouched. */
  replace: (match: RegExpExecArray) => string | null;
}

const WORDS_NOT_SECRETS = new Set([
  'true',
  'false',
  'null',
  'none',
  'undefined',
  'yes',
  'no',
  'on',
  'off',
  'required',
  'optional',
  'string',
  'number',
  'boolean',
]);

function looksLikeSecretValue(value: string): boolean {
  if (isMasked(value) || value.startsWith('[REDACTED')) return false;
  if (value.startsWith('$') || value.startsWith('<') || value.startsWith('%')) return false;
  if (WORDS_NOT_SECRETS.has(value.toLowerCase())) return false;
  if (value.length >= 8) return true;
  return /[A-Za-z]/.test(value) && /\d/.test(value);
}

// Order matters: specific vendor formats first, generic KEY=value last.
// Every expression is anchored on a literal prefix or uses bounded/linear classes (no nested quantifiers).
const PATTERNS: Pattern[] = [
  {
    kind: 'github-token',
    // GitHub documents the prefixes but no fixed length (installation tokens may be JWT-shaped).
    re: /\b(?:gh[pousr]_[A-Za-z0-9_.-]{16,}|github_pat_[A-Za-z0-9_]{20,})/g,
    replace: () => marker('github-token'),
  },
  {
    kind: 'aws-access-key-id',
    re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: () => marker('aws-access-key-id'),
  },
  {
    kind: 'npm-token',
    re: /\bnpm_[A-Za-z0-9]{30,}\b/g,
    replace: () => marker('npm-token'),
  },
  {
    kind: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    replace: () => marker('slack-token'),
  },
  {
    kind: 'google-api-key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: () => marker('google-api-key'),
  },
  {
    kind: 'stripe-key',
    re: /\b[sr]k_live_[0-9A-Za-z]{16,}/g,
    replace: () => marker('stripe-key'),
  },
  {
    kind: 'azure-secret',
    re: /\b(AccountKey=|SharedAccessKey=|[?&]sig=)[A-Za-z0-9+/%=]{20,}/g,
    replace: (m) => `${m[1] ?? ''}${marker('azure-secret')}`,
  },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: () => marker('jwt'),
  },
  {
    kind: 'auth-header',
    re: /\b(Authorization\s*[:=]\s*["']?)(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (m) => `${m[1] ?? ''}${m[2] ?? ''} ${marker('auth-header')}`,
  },
  {
    kind: 'bearer',
    re: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{20,}/g,
    replace: (m) => `${m[1] ?? ''} ${marker('bearer')}`,
  },
  {
    kind: 'url-credentials',
    re: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^/\s:@]{1,100}):([^/\s@]{1,200})@/gi,
    replace: (m) => (isMasked(m[3] ?? '') ? null : `${m[1] ?? ''}${marker('url-credentials')}@`),
  },
  {
    kind: 'secret-value',
    re: /\b([A-Za-z0-9_.-]{0,60}(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|client[_-]?secret)[A-Za-z0-9_.-]{0,60})(["']?\s*[:=]\s*["']?)([^\s"',;]{4,})/gi,
    replace: (m) =>
      looksLikeSecretValue(m[3] ?? '')
        ? `${m[1] ?? ''}${m[2] ?? ''}${marker('secret-value')}`
        : null,
  },
];

const PII_PATTERNS: Pattern[] = [
  {
    kind: 'email',
    re: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,5}\.[A-Za-z]{2,24}\b/g,
    replace: () => marker('email'),
  },
  {
    kind: 'ipv4',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    replace: () => marker('ipv4'),
  },
];

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z ]{0,40}PRIVATE KEY-----/;
const MAX_UNCLOSED_KEY_LINES = 100;

function applyPatterns(text: string, patterns: Pattern[], summary: RedactionSummary): string {
  let out = text;
  for (const p of patterns) {
    out = out.replace(p.re, (...args) => {
      // String.replace passes (match, ...groups, offset, string); rebuild an exec-like array.
      const groups = args.slice(0, -2) as string[];
      const replacement = p.replace(
        Object.assign(groups, { index: 0, input: out }) as RegExpExecArray,
      );
      if (replacement === null) return groups[0] ?? '';
      summary.count++;
      summary.byKind[p.kind] = (summary.byKind[p.kind] ?? 0) + 1;
      return replacement;
    });
  }
  return out;
}

function patternsFor(options: RedactOptions): Pattern[] {
  return options.pii ? [...PATTERNS, ...PII_PATTERNS] : PATTERNS;
}

/** Redacts a single piece of text (no multi-line private key handling across lines). */
export function redactText(text: string, options: RedactOptions = {}): RedactedText {
  const summary: RedactionSummary = { count: 0, byKind: {} };
  let out = text;
  // Private key blocks, including ones squeezed into a single line.
  for (;;) {
    const b = PRIVATE_KEY_BEGIN.exec(out);
    if (!b) break;
    const rest = out.slice(b.index);
    const e = PRIVATE_KEY_END.exec(rest);
    const end = e ? b.index + e.index + e[0].length : out.length;
    out = out.slice(0, b.index) + marker('private-key') + out.slice(end);
    summary.count++;
    summary.byKind['private-key'] = (summary.byKind['private-key'] ?? 0) + 1;
  }
  out = applyPatterns(out, patternsFor(options), summary);
  return { text: out, ...summary };
}

/** Redacts log lines, keeping original line numbers. Handles multi-line private key blocks. */
export function redactLines(lines: LogLine[], options: RedactOptions = {}): RedactedLines {
  const summary: RedactionSummary = { count: 0, byKind: {} };
  const patterns = patternsFor(options);
  const out: LogLine[] = [];
  let inKey = false;
  let keyLines = 0;

  for (const line of lines) {
    if (inKey) {
      keyLines++;
      const ended = PRIVATE_KEY_END.test(line.text);
      out.push({ ...line, text: marker('private-key') });
      if (ended || keyLines >= MAX_UNCLOSED_KEY_LINES) inKey = false;
      continue;
    }
    if (PRIVATE_KEY_BEGIN.test(line.text)) {
      summary.count++;
      summary.byKind['private-key'] = (summary.byKind['private-key'] ?? 0) + 1;
      const afterBegin = line.text.slice(line.text.search(PRIVATE_KEY_BEGIN));
      const closesOnSameLine = PRIVATE_KEY_END.test(afterBegin);
      const prefix = line.text.slice(0, line.text.search(PRIVATE_KEY_BEGIN));
      out.push({ ...line, text: prefix + marker('private-key') });
      if (!closesOnSameLine) {
        inKey = true;
        keyLines = 0;
      }
      continue;
    }
    const text = applyPatterns(line.text, patterns, summary);
    out.push(text === line.text ? line : { ...line, text });
  }
  return { lines: out, ...summary };
}
