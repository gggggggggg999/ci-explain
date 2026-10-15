import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReportSchema } from '../../src/core/schema.js';
import { fixturePath, runCli } from '../helpers/cli-io.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ci-explain-test-'));

describe('cli', () => {
  it('prints help and version', async () => {
    const help = await runCli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/Usage:/);
    expect(help.stdout).toMatch(/Exit codes:/);
    const version = await runCli(['--version']);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('analyzes a file in text format without colors when not a TTY', async () => {
    const r = await runCli([fixturePath('gha-npm-ci.log')]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('node.npm.ci-lock-mismatch');
    expect(r.stdout).toContain('Failed step: Run npm ci');
    expect(r.stdout).not.toContain('\u001b[');
  });

  it('uses colors only on a TTY and honors NO_COLOR / --no-color', async () => {
    const path = fixturePath('gha-npm-ci.log');
    expect((await runCli([path], { tty: true })).stdout).toContain('\u001b[');
    expect((await runCli([path], { tty: true, env: { NO_COLOR: '1' } })).stdout).not.toContain(
      '\u001b[',
    );
    expect((await runCli([path, '--no-color'], { tty: true })).stdout).not.toContain('\u001b[');
  });

  it('reads from stdin', async () => {
    const log = readFileSync(fixturePath('gha-npm-ci.log'), 'utf8');
    const r = await runCli(['-', '--format', 'json'], { stdin: log });
    expect(r.code).toBe(0);
    const report = ReportSchema.parse(JSON.parse(r.stdout));
    expect(report.source.kind).toBe('stdin');
    expect(report.findings[0]?.ruleId).toBe('node.npm.ci-lock-mismatch');
  });

  it('emits schema-valid JSON with evidence line numbers from the original file', async () => {
    const r = await runCli([fixturePath('gha-npm-ci.log'), '--format', 'json']);
    const report = ReportSchema.parse(JSON.parse(r.stdout));
    expect(report.schemaVersion).toBe(1);
    expect(report.source).toEqual({ kind: 'file', format: 'github-actions' });
    expect(report.llm).toEqual({ used: false });
    expect(report.findings[0]?.evidence[0]?.line).toBe(16);
  });

  it('is deterministic: two runs give byte-identical output', async () => {
    for (const format of ['text', 'markdown', 'json']) {
      const a = await runCli([fixturePath('gha-npm-ci.log'), '--format', format]);
      const b = await runCli([fixturePath('gha-npm-ci.log'), '--format', format]);
      expect(a.stdout).toBe(b.stdout);
    }
  });

  it('respects --max-findings', async () => {
    const r = await runCli([
      fixturePath('generic-crlf.log'),
      '--format',
      'json',
      '--max-findings',
      '1',
    ]);
    expect(ReportSchema.parse(JSON.parse(r.stdout)).findings.length).toBeLessThanOrEqual(1);
  });

  it('reports an unrecognized failure honestly (exit 0, unknown finding)', async () => {
    const r = await runCli(['-', '--format', 'json'], { stdin: 'something went wrong: error 7\n' });
    expect(r.code).toBe(0);
    expect(ReportSchema.parse(JSON.parse(r.stdout)).findings[0]?.ruleId).toBe('unknown');
  });

  describe('exit codes', () => {
    it('2 for bad arguments', async () => {
      for (const argv of [
        ['--format', 'xml', 'x.log'],
        ['--max-bytes', 'abc', 'x.log'],
        ['--bogus', 'x.log'],
        [],
        ['a.log', 'b.log'],
        ['x.log', '--no-redact', '--format', 'json'],
      ]) {
        const r = await runCli(argv);
        expect(r.code, argv.join(' ')).toBe(2);
        expect(r.stderr).toContain('Error:');
        expect(r.stderr).not.toMatch(/at .*\.ts/);
      }
    });

    it('3 for missing, empty and directory inputs', async () => {
      const dir = tmp();
      const empty = join(dir, 'empty.log');
      writeFileSync(empty, '   \n\n');
      expect((await runCli([join(dir, 'nope.log')])).code).toBe(3);
      expect((await runCli([empty])).code).toBe(3);
      expect((await runCli([dir])).code).toBe(3);
      const r = await runCli(['-'], { stdin: '' });
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('empty');
    });

    it('handles binary input without crashing', async () => {
      const r = await runCli(['-', '--format', 'json'], {
        stdin: 'abc\u0000\u0001\u0002 error here\n',
      });
      expect(r.code).toBe(0);
      expect(ReportSchema.parse(JSON.parse(r.stdout)).warnings.join(' ')).toMatch(/binary/);
    });
  });

  describe('redaction flags', () => {
    const secret = 'gh' + 'p_' + 'x'.repeat(36);
    const log = `error: bad credentials ${secret}\n`;

    it('redacts by default in every format', async () => {
      for (const format of ['text', 'markdown', 'json']) {
        const r = await runCli(['-', '--format', format], { stdin: log });
        expect(r.stdout, format).not.toContain(secret);
        expect(r.stdout, format).toContain('[REDACTED:github-token]');
      }
    });

    it('--no-redact works only for text, with a warning', async () => {
      const r = await runCli(['-', '--no-redact'], { stdin: log });
      expect(r.stdout).toContain(secret);
      expect(r.stderr).toContain('WARNING');
    });
  });

  describe('--export-excerpt', () => {
    it('writes a redacted excerpt with a review header and refuses to overwrite', async () => {
      const secret = 'gh' + 'p_' + 'y'.repeat(36);
      const dir = tmp();
      const out = join(dir, 'excerpt.txt');
      const stdin = `step\nerror: token ${secret} rejected\n`;
      const first = await runCli(['-', '--export-excerpt', out], { stdin });
      expect(first.code).toBe(0);
      const content = readFileSync(out, 'utf8');
      expect(content).toContain('REVIEW BEFORE SHARING');
      expect(content).not.toContain(secret);
      expect(content).toContain('[REDACTED:github-token]');

      const second = await runCli(['-', '--export-excerpt', out], { stdin });
      expect(second.code).toBe(3);
      expect(second.stderr).toContain('--force');
      expect((await runCli(['-', '--export-excerpt', out, '--force'], { stdin })).code).toBe(0);
    });

    it('stays redacted even with --no-redact', async () => {
      const secret = 'gh' + 'p_' + 'z'.repeat(36);
      const out = join(tmp(), 'e.txt');
      await runCli(['-', '--no-redact', '--export-excerpt', out], { stdin: `error ${secret}\n` });
      expect(readFileSync(out, 'utf8')).not.toContain(secret);
    });
  });

  describe('--max-bytes', () => {
    it('analyzes the tail, marks truncated, and keeps original line numbers', async () => {
      const lines = Array.from({ length: 2000 }, (_, i) => `filler line number ${i + 1}`);
      lines.push("Error: Cannot find module 'late-module'");
      lines.push('tail line');
      const text = lines.join('\n') + '\n';
      const r = await runCli(['-', '--format', 'json', '--max-bytes', '2000'], { stdin: text });
      expect(r.code).toBe(0);
      expect(r.stderr).toContain('--max-bytes');
      const report = ReportSchema.parse(JSON.parse(r.stdout));
      expect(report.truncated).toBe(true);
      const f = report.findings.find((x) => x.ruleId === 'node.module-not-found');
      expect(f?.evidence[0]?.line).toBe(2001);
    });
  });
});
