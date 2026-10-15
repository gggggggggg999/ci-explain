import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRuleFixtures } from '../helpers/variants.js';

const root = new URL('../../', import.meta.url).pathname;
const fixture = (name: string) => join(root, 'tests/fixtures/logs', name);
let bin = '';

// Builds the package, packs it, installs the tarball into a clean temp folder and runs the real bin.
beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
  const packDir = mkdtempSync(join(tmpdir(), 'ci-explain-pack-'));
  execFileSync('npm', ['pack', '--silent', '--pack-destination', packDir], {
    cwd: root,
    stdio: 'pipe',
  });
  const tgz = readdirSync(packDir).find((f) => f.endsWith('.tgz')) as string;
  const installDir = mkdtempSync(join(tmpdir(), 'ci-explain-install-'));
  execFileSync('npm', ['init', '-y'], { cwd: installDir, stdio: 'pipe' });
  execFileSync(
    'npm',
    ['install', join(packDir, tgz), '--no-audit', '--no-fund', '--prefer-offline'],
    { cwd: installDir, stdio: 'pipe' },
  );
  bin = join(installDir, 'node_modules', '.bin', 'ci-explain');
}, 240_000);

const exec = (args: string[], input?: string) =>
  spawnSync(bin, args, { encoding: 'utf8', input, env: { ...process.env, NO_COLOR: '1' } });

describe('installed tarball', () => {
  it('--help and --version work', () => {
    expect(exec(['--help']).stdout).toContain('Usage:');
    expect(exec(['--version']).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('analyzes a fixture and prints evidence', () => {
    const r = exec([fixture('gha-npm-ci.log')]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('node.npm.ci-lock-mismatch');
  });

  it('reads stdin', () => {
    const r = exec(['-', '--format', 'json'], 'Error: ENOSPC: no space left on device, write\n');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).findings[0].ruleId).toBe('infra.disk-full');
  });

  it('returns documented exit codes', () => {
    expect(exec(['--format', 'bad', 'x']).status).toBe(2);
    expect(exec([fixture('does-not-exist.log')]).status).toBe(3);
    expect(exec(['-'], '').status).toBe(3);
  });

  it('analyzes the first positive fixture of EVERY rule from the installed package', () => {
    const missing: string[] = [];
    for (const fx of loadRuleFixtures()) {
      for (const pos of fx.positives) {
        const dir = mkdtempSync(join(tmpdir(), 'ci-explain-fx-'));
        const file = join(dir, 'in.log');
        writeFileSync(file, pos.text);
        const r = exec([file, '--format', 'json', '--max-findings', '50']);
        const ids = (JSON.parse(r.stdout).findings as { ruleId: string }[]).map((f) => f.ruleId);
        if (r.status !== 0 || !ids.includes(fx.ruleId)) missing.push(`${fx.ruleId}/${pos.name}`);
      }
    }
    expect(missing).toEqual([]);
  }, 120_000);

  it('makes no network calls when analyzing (fetch and sockets are booby-trapped)', () => {
    const r = spawnSync(bin, [fixture('gha-npm-ci.log'), '--format', 'json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `--import ${join(root, 'tests/helpers/no-network.mjs')}`,
      },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('NETWORK ACCESS ATTEMPTED');
    expect(JSON.parse(r.stdout).findings.length).toBeGreaterThan(0);
  });

  it('the booby trap itself works (sanity check of the test)', () => {
    const r = spawnSync(
      process.execPath,
      [
        '--import',
        join(root, 'tests/helpers/no-network.mjs'),
        '-e',
        'fetch("https://example.test")',
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('NETWORK ACCESS ATTEMPTED');
  });

  it('does not send anything for --show-prompt even with a key configured', () => {
    const r = spawnSync(bin, ['-', '--show-prompt'], {
      encoding: 'utf8',
      input: 'error: boom\n',
      env: {
        ...process.env,
        CI_EXPLAIN_LLM_API_KEY: 'sk' + '-test-' + 'a'.repeat(20),
        CI_EXPLAIN_LLM_BASE_URL: 'https://llm.example.test/v1',
        CI_EXPLAIN_LLM_MODEL: 'demo',
        NODE_OPTIONS: `--import ${join(root, 'tests/helpers/no-network.mjs')}`,
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('=== user message ===');
  });

  describe('edge inputs', () => {
    it('empty and whitespace-only input: clear message, exit 3, no stack trace', () => {
      for (const input of ['', '\n\n   \n']) {
        const r = exec(['-'], input);
        expect(r.status).toBe(3);
        expect(r.stderr).toContain('empty');
        expect(r.stderr).not.toMatch(/\bat .*(\.js|\.ts):\d+/);
      }
    });

    it('binary input: warns and does not crash', () => {
      const bytes = Buffer.alloc(4096);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
      const dir = mkdtempSync(join(tmpdir(), 'ci-explain-bin-'));
      const file = join(dir, 'bin.dat');
      writeFileSync(file, Buffer.concat([bytes, Buffer.from('\nerror: something\n')]));
      const r = exec([file, '--format', 'json']);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).warnings.join(' ')).toMatch(/binary|UTF-8/);
    });

    it('huge input: only the tail is analyzed, flagged as truncated, line numbers stay original', () => {
      const filler = 'filler line with some typical build output text 0123456789\n';
      const count = 700_000; // ~40 MB, above the 32 MiB default limit
      const text = filler.repeat(count) + "Error: Cannot find module 'tail-module'\n";
      const r = spawnSync(bin, ['-', '--format', 'json'], {
        encoding: 'utf8',
        input: text,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1' },
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('--max-bytes');
      const report = JSON.parse(r.stdout);
      expect(report.truncated).toBe(true);
      const f = report.findings.find(
        (x: { ruleId: string }) => x.ruleId === 'node.module-not-found',
      );
      expect(f.evidence[0].line).toBe(count + 1);
    }, 120_000);

    it('a missing file is exit 3 with a readable message', () => {
      const r = exec(['/definitely/not/here.log']);
      expect(r.status).toBe(3);
      expect(r.stderr).toContain('File not found');
    });
  });

  it('the packed package contains the expected files and nothing private', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root,
      encoding: 'utf8',
    });
    const files = (JSON.parse(out)[0].files as { path: string }[]).map((f) => f.path);
    expect(files).toContain('dist/cli/main.js');
    expect(files).toContain('LICENSE');
    expect(files).toContain('package.json');
    for (const bad of files) {
      expect(bad, bad).not.toMatch(/^(tests|src|scripts|examples|\.github)\//);
      expect(bad, bad).not.toMatch(/(^|\/)\.env/);
      expect(bad, bad).not.toMatch(/\.test\./);
    }
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('"license": "MIT"');
  });
}, 60_000);
