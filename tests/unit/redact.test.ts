import { describe, expect, it } from 'vitest';
import { analyzeLog } from '../../src/core/analyze.js';
import { normalizeLog } from '../../src/core/normalize.js';
import { redactLines, redactText } from '../../src/core/redact.js';

// Fake secrets are assembled at runtime so no ready-made secret string exists in the repository.
const fake = {
  ghp: 'gh' + 'p_' + 'x'.repeat(36),
  ghs: 'gh' + 's_' + 'Ab1'.repeat(10),
  pat: 'github' + '_pat_' + 'A1b2'.repeat(10),
  aws: 'AK' + 'IA' + 'ABCDEFGH12345678',
  jwt: ['ey' + 'JhbGciOiJIUzI1NiJ9', 'ey' + 'JzdWIiOiJkZW1vIn0', 'sig' + 'nature12345'].join('.'),
  npm: 'npm' + '_' + 'a1B2c3D4'.repeat(5),
  slack: 'xo' + 'xb-' + '1234567890-abcdefghij',
  google: 'AI' + 'za' + 'S'.repeat(35),
  stripe: 'sk' + '_live_' + 'q'.repeat(24),
};

const red = (text: string, pii = false) => redactText(text, { pii });

describe('redactText', () => {
  it.each([
    ['github classic token', `token ${fake.ghp} end`, fake.ghp, 'github-token'],
    ['github installation token', `x ${fake.ghs}`, fake.ghs, 'github-token'],
    ['github fine-grained token', `PAT=${fake.pat}`, fake.pat, 'github-token'],
    ['aws access key id', `key ${fake.aws} used`, fake.aws, 'aws-access-key-id'],
    ['jwt', `jwt: ${fake.jwt}`, fake.jwt, 'jwt'],
    ['npm token', `//registry/:_authToken=${fake.npm}`, fake.npm, 'npm-token'],
    ['slack token', `hook ${fake.slack}`, fake.slack, 'slack-token'],
    ['google api key', `k=${fake.google}`, fake.google, 'google-api-key'],
    ['stripe key', `k ${fake.stripe}`, fake.stripe, 'stripe-key'],
  ])('redacts %s', (_name, input, secret, kind) => {
    const r = red(input);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain(`[REDACTED:`);
    expect(r.byKind[kind] ?? 0).toBeGreaterThan(0);
  });

  it('redacts Authorization headers but keeps the scheme', () => {
    const r = red('curl -H "Authorization: Bearer abcdefghijklmnop1234" https://x.test');
    expect(r.text).toContain('Authorization: Bearer [REDACTED:auth-header]');
    expect(r.text).not.toContain('abcdefghijklmnop1234');
    expect(red('Authorization: Basic dXNlcjpwYXNzd29yZA==').text).not.toContain('dXNlcjpwYXNz');
  });

  it('redacts URL credentials and keeps host and path', () => {
    const r = red('git clone https://deploy:' + 'hunter2hunter2' + '@example.test/org/repo.git');
    expect(r.text).toBe('git clone https://[REDACTED:url-credentials]@example.test/org/repo.git');
  });

  it('redacts KEY=value and JSON pairs with secret-like names', () => {
    expect(red('NPM_TOKEN=abcd1234efgh5678').text).toBe('NPM_TOKEN=[REDACTED:secret-value]');
    expect(red('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG').text).not.toContain(
      'wJalrXUtnFEMI',
    );
    expect(red('{"password": "correct-horse-battery"}').text).toBe(
      '{"password": "[REDACTED:secret-value]"}',
    );
    expect(red("api_key: 'Zx9Qp2Lm7Vb3'").text).not.toContain('Zx9Qp2Lm7Vb3');
  });

  it('leaves values GitHub already masked as they are', () => {
    expect(red('GITHUB_TOKEN: ***').text).toBe('GITHUB_TOKEN: ***');
    expect(red('password=********').count).toBe(0);
    expect(red('https://user:***@example.test/x').text).toBe('https://user:***@example.test/x');
  });

  it('redacts a secret in the middle of a long line', () => {
    const line = 'a'.repeat(500) + ` token=${fake.ghp} ` + 'b'.repeat(500);
    const r = red(line);
    expect(r.text).not.toContain(fake.ghp);
    expect(r.text.startsWith('a'.repeat(500))).toBe(true);
    expect(r.text.endsWith('b'.repeat(500))).toBe(true);
  });

  it('does not redact ordinary hashes, UUIDs, versions or common config values', () => {
    const benign = [
      'commit 3d3c42e5aac5ba805825da76410c181273ba90b1',
      'id 123e4567-e89b-12d3-a456-426614174000',
      'sha256:' + 'a'.repeat(64),
      'node v22.12.0, npm 10.9.0, typescript@6.0.3',
      'max_tokens=1000',
      'auth: true',
      'author: Jane Doe',
      'token: ${{ secrets.DEMO }}',
      'tokens used: 1200',
      'password: required',
      'See https://example.test/docs/tokens for details',
    ];
    for (const line of benign) expect(red(line).text, line).toBe(line);
  });

  it('redacts private key blocks inside one text', () => {
    const body = 'MIIB' + 'x'.repeat(60);
    const text = [
      'before',
      '-----BEGIN RSA ' + 'PRIVATE KEY-----',
      body,
      body,
      '-----END RSA ' + 'PRIVATE KEY-----',
      'after',
    ].join('\n');
    const r = red(text);
    expect(r.text).toBe('before\n[REDACTED:private-key]\nafter');
    expect(r.byKind['private-key']).toBe(1);
  });

  it('pii: e-mail and IPv4 only when requested', () => {
    const text = 'user jane.doe@example.test from 192.0.2.44';
    expect(red(text).text).toBe(text);
    const r = red(text, true);
    expect(r.text).toBe('user [REDACTED:email] from [REDACTED:ipv4]');
  });

  it('is deterministic and never throws on odd input', () => {
    const odd = '\u0000\ud800 token=' + 'é'.repeat(100);
    expect(red(odd).text).toBe(red(odd).text);
  });
});

describe('redactLines', () => {
  it('redacts multi-line private keys and keeps original line numbers', () => {
    const raw = [
      'start',
      '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAA',
      'AAAAB3NzaC1yc2EAAAADAQAB',
      '-----END OPENSSH ' + 'PRIVATE KEY-----',
      'end',
    ].join('\n');
    const log = normalizeLog(raw);
    const r = redactLines(log.lines);
    expect(r.lines.map((l) => l.text)).toEqual([
      'start',
      '[REDACTED:private-key]',
      '[REDACTED:private-key]',
      '[REDACTED:private-key]',
      '[REDACTED:private-key]',
      'end',
    ]);
    expect(r.lines[5]?.n).toBe(6);
    expect(r.count).toBe(1);
  });

  it('redacts an unclosed key block up to a safety limit and then resumes', () => {
    const lines = [
      '-----BEGIN PRIVATE ' + 'KEY-----',
      ...Array.from({ length: 150 }, (_, i) => `line${i}`),
    ];
    const r = redactLines(normalizeLog(lines.join('\n')).lines);
    expect(r.lines.slice(0, 101).every((l) => l.text === '[REDACTED:private-key]')).toBe(true);
    expect(r.lines[120]?.text).toBe('line119');
  });

  it('handles a key squeezed into one line', () => {
    const text =
      'key="-----BEGIN PRIVATE ' + 'KEY-----\\nMIIBVgIB\\n-----END PRIVATE ' + 'KEY-----" done';
    const r = redactLines(normalizeLog(text).lines);
    expect(r.lines[0]?.text).not.toContain('MIIBVgIB');
  });
});

describe('analyzeLog redaction', () => {
  const log = [
    '##[group]Run npm install',
    `npm error code E404`,
    `npm error 404 Not Found - GET https://deploy:${'p4ss' + 'w0rd-value-1'}@registry.example.test/demo-pkg - Not found`,
    `GITHUB_TOKEN=${fake.ghp}`,
    '##[error]Process completed with exit code 1.',
  ].join('\n');

  it('removes secrets from findings, evidence, windows and reports only counts', () => {
    const r = analyzeLog(log);
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(fake.ghp);
    expect(dump).not.toContain('p4ss' + 'w0rd-value-1');
    expect(r.redactions.count).toBeGreaterThanOrEqual(2);
    expect(Object.keys(r.redactions)).toEqual(['count', 'byKind']);
  });

  it('keeps raw values only when redaction is explicitly disabled', () => {
    const r = analyzeLog(log, { redact: false });
    expect(JSON.stringify(r)).toContain('p4ss' + 'w0rd-value-1');
    expect(r.redactions.count).toBe(0);
  });
});

describe('redaction ReDoS resistance', () => {
  it('handles pathological lines within a time budget', () => {
    const inputs = [
      'a.'.repeat(1000),
      'token'.repeat(400),
      'token=' + '='.repeat(2000),
      'x'.repeat(2000) + '@' + 'y.'.repeat(1000),
      'https://' + 'a:'.repeat(1000) + '@',
      '1.'.repeat(1000),
      'Authorization: ' + 'Bearer '.repeat(300),
      'gh' + 'p_' + '_'.repeat(2000),
    ];
    const start = performance.now();
    for (const input of inputs) {
      redactText(input, { pii: true });
      redactLines(normalizeLog(input).lines, { pii: true });
    }
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
