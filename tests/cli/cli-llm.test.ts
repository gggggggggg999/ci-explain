import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { run, type CliIo } from '../../src/cli/run.js';
import { ReportSchema } from '../../src/core/schema.js';

const API_KEY = 'sk' + '-test-' + 'z'.repeat(24);
const LOG =
  "##[group]Run node app.js\nError: Cannot find module 'abc'\n##[error]Process completed with exit code 1.\n";
const ENV = {
  CI_EXPLAIN_LLM_API_KEY: API_KEY,
  CI_EXPLAIN_LLM_BASE_URL: 'https://llm.example.test/v1',
  CI_EXPLAIN_LLM_MODEL: 'demo-model',
};
const answer = JSON.stringify({
  summary: 'Module abc is missing (L2).',
  likelyCause: 'missing dependency',
  suggestions: ['npm install abc'],
});
const ok = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });

async function go(argv: string[], env: Record<string, string>, fetchImpl: typeof fetch) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdin: Object.assign(Readable.from([Buffer.from(LOG)]), { isTTY: false }),
    stdout: { write: (s: string) => (stdout += s) },
    stderr: { write: (s: string) => (stderr += s) },
    env,
    fetch: fetchImpl,
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

describe('cli AI layer', () => {
  it('is off by default: no network call without --llm even if a key is set', async () => {
    const fetchImpl = vi.fn(ok);
    const r = await go(['-'], ENV, fetchImpl as unknown as typeof fetch);
    expect(r.code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.stdout).not.toContain('AI explanation');
  });

  it('--show-prompt prints the exact prompt and sends nothing (even with --llm and a key)', async () => {
    const fetchImpl = vi.fn(ok);
    const globalFetch = vi.fn(ok);
    vi.stubGlobal('fetch', globalFetch);
    const r = await go(['-', '--llm', '--show-prompt'], ENV, fetchImpl as unknown as typeof fetch);
    vi.unstubAllGlobals();
    expect(r.code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(r.stdout).toContain('=== system message ===');
    expect(r.stdout).toContain('=== user message ===');
    expect(r.stdout).toContain('Cannot find module');
    expect(r.stdout).not.toContain(API_KEY);
    expect(r.stderr).toContain('Nothing was sent');
  });

  it('--show-prompt works without any key or URL', async () => {
    const r = await go(['-', '--show-prompt'], {}, vi.fn() as unknown as typeof fetch);
    expect(r.code).toBe(0);
  });

  it('--llm without key, base URL or model fails clearly (exit 2), never silently', async () => {
    const f = vi.fn(ok) as unknown as typeof fetch;
    const noKey = await go(['-', '--llm'], { ...ENV, CI_EXPLAIN_LLM_API_KEY: '' }, f);
    expect(noKey.code).toBe(2);
    expect(noKey.stderr).toContain('CI_EXPLAIN_LLM_API_KEY');
    const { CI_EXPLAIN_LLM_BASE_URL: _u, ...noUrl } = ENV;
    expect((await go(['-', '--llm'], noUrl, f)).code).toBe(2);
    const { CI_EXPLAIN_LLM_MODEL: _m, ...noModel } = ENV;
    expect((await go(['-', '--llm'], noModel, f)).code).toBe(2);
    expect(
      (await go(['-', '--llm', '--llm-base-url', 'http://remote.example.test/v1'], ENV, f)).code,
    ).toBe(2);
    expect(f).not.toHaveBeenCalled();
  });

  it('adds a labeled AI section on success and keeps layer-1 findings', async () => {
    const fetchImpl = vi.fn(ok);
    const r = await go(
      ['-', '--llm', '--format', 'json'],
      ENV,
      fetchImpl as unknown as typeof fetch,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('llm.example.test');
    const report = ReportSchema.parse(JSON.parse(r.stdout));
    expect(report.llm.used).toBe(true);
    expect(report.llm.notice).toMatch(/may be wrong/);
    expect(report.findings[0]?.ruleId).toBe('node.module-not-found');
    expect(r.stdout).not.toContain(API_KEY);
  });

  it('degrades safely: AI failure still prints layer-1 results with exit 0', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const r = await go(['-', '--llm'], ENV, f as unknown as typeof fetch);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('node.module-not-found');
    expect(r.stdout).toContain('AI layer unavailable');
    expect(r.stderr + r.stdout).not.toContain(API_KEY);
  });

  it('--llm-required turns an AI failure into exit code 5 (after printing results)', async () => {
    const f = vi.fn(async () => new Response('x', { status: 401 }));
    const r = await go(['-', '--llm', '--llm-required'], ENV, f as unknown as typeof fetch);
    expect(r.code).toBe(5);
    expect(r.stdout).toContain('node.module-not-found');
  });

  it('rejects --no-redact with --llm and --llm-required without --llm', async () => {
    const f = vi.fn(ok) as unknown as typeof fetch;
    expect((await go(['-', '--llm', '--no-redact'], ENV, f)).code).toBe(2);
    expect((await go(['-', '--llm-required'], ENV, f)).code).toBe(2);
  });

  it('sends only redacted text', async () => {
    const secret = 'gh' + 'p_' + 'm'.repeat(36);
    const f = vi.fn(ok);
    const io: CliIo = {
      stdin: Object.assign(Readable.from([Buffer.from(`error: bad token ${secret}\n`)]), {
        isTTY: false,
      }),
      stdout: { write: () => true },
      stderr: { write: () => true },
      env: ENV,
      fetch: f as unknown as typeof fetch,
    };
    await run(['-', '--llm'], io);
    const init = (f.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(init.body as string).not.toContain(secret);
    expect(init.body as string).toContain('REDACTED');
  });
});
