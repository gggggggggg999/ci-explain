import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

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
}, 60_000);
