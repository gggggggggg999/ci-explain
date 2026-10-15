import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/run.js';
import { ReportSchema } from '../../src/core/schema.js';
import { fetchFailedJobLogs, GithubError, GITHUB_API_VERSION } from '../../src/io/github.js';

const TOKEN = 'gh' + 'p_' + 'T'.repeat(36);

interface Recorded {
  url: string;
  headers: IncomingHttpHeaders;
}
let apiServer: Server;
let storageServer: Server;
let apiBase = '';
let storageBase = '';
let apiRequests: Recorded[] = [];
let storageRequests: Recorded[] = [];
let behavior: {
  jobsStatus?: number;
  jobsHeaders?: Record<string, string>;
  jobs?: unknown;
  logsStatus?: number;
  logsLocation?: (id: string) => string;
  logBody?: (id: string) => string;
  storageStatus?: number;
} = {};

const jobsJson = (conclusions: [number, string, string | null][]) => ({
  total_count: conclusions.length,
  jobs: conclusions.map(([id, name, conclusion]) => ({ id, name, conclusion })),
});

beforeAll(async () => {
  storageServer = createServer((req, res) => {
    storageRequests.push({ url: req.url ?? '', headers: req.headers });
    const id = /\/log\/(\d+)/.exec(req.url ?? '')?.[1] ?? '0';
    res.statusCode = behavior.storageStatus ?? 200;
    res.end((behavior.logBody ?? defaultLog)(id));
  });
  await new Promise<void>((r) => storageServer.listen(0, '127.0.0.1', r));
  storageBase = `http://127.0.0.1:${(storageServer.address() as AddressInfo).port}`;

  apiServer = createServer((req, res) => {
    apiRequests.push({ url: req.url ?? '', headers: req.headers });
    const url = req.url ?? '';
    if (/\/actions\/runs\/\d+\/jobs/.test(url)) {
      res.statusCode = behavior.jobsStatus ?? 200;
      for (const [k, v] of Object.entries(behavior.jobsHeaders ?? {})) res.setHeader(k, v);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          behavior.jobs ??
            jobsJson([
              [1, 'build', 'failure'],
              [2, 'lint', 'success'],
              [3, 'test', 'failure'],
            ]),
        ),
      );
      return;
    }
    const m = /\/actions\/jobs\/(\d+)\/logs/.exec(url);
    if (m) {
      res.statusCode = behavior.logsStatus ?? 302;
      if (res.statusCode === 302) {
        res.setHeader(
          'location',
          (behavior.logsLocation ?? ((id) => `${storageBase}/log/${id}?sig=abc`))(m[1] as string),
        );
      }
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => apiServer.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all([
    new Promise((r) => apiServer.close(r)),
    new Promise((r) => storageServer.close(r)),
  ]);
});

beforeEach(() => {
  apiRequests = [];
  storageRequests = [];
  behavior = {};
});

const defaultLog = (id: string) =>
  [
    '2025-01-01T00:00:00.0000000Z ##[group]Run build',
    id === '1'
      ? "2025-01-01T00:00:01.0000000Z Error: Cannot find module 'alpha'"
      : '2025-01-01T00:00:01.0000000Z Error: ENOSPC: no space left on device, write',
    '2025-01-01T00:00:02.0000000Z ##[error]Process completed with exit code 1.',
  ].join('\n');

const config = (extra: Record<string, unknown> = {}) => ({
  repo: 'octo/demo',
  runId: '123',
  token: TOKEN,
  apiUrl: apiBase,
  maxBytesPerJob: 1_000_000,
  ...extra,
});

describe('fetchFailedJobLogs (local mock servers)', () => {
  it('lists jobs, downloads only failed ones, and uses documented headers', async () => {
    const logs = await fetchFailedJobLogs(config());
    expect(logs.jobs.map((j) => j.jobName)).toEqual(['build', 'test']);
    expect(logs.failedJobCount).toBe(2);
    const first = apiRequests[0] as Recorded;
    expect(first.url).toContain('/repos/octo/demo/actions/runs/123/jobs');
    expect(first.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(first.headers['x-github-api-version']).toBe(GITHUB_API_VERSION);
    expect(first.headers.accept).toBe('application/vnd.github+json');
    expect(logs.jobs[0]?.text).toContain('Cannot find module');
  });

  it('does NOT send Authorization to the host the log redirect points to', async () => {
    await fetchFailedJobLogs(config());
    expect(storageRequests.length).toBe(2);
    for (const r of storageRequests) {
      expect(r.headers.authorization).toBeUndefined();
      expect(JSON.stringify(r.headers)).not.toContain(TOKEN);
    }
    // ...while the API requests did carry it.
    expect(apiRequests.every((r) => r.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('refuses redirects to non-https remote hosts without making the request', async () => {
    behavior.logsLocation = () => 'http://logs.example.test/x';
    await expect(fetchFailedJobLogs(config())).rejects.toThrow(/https/);
    expect(storageRequests).toHaveLength(0);
  });

  it('does not follow redirects from the jobs endpoint', async () => {
    behavior.jobsStatus = 302;
    behavior.jobsHeaders = { location: `${storageBase}/steal` };
    await expect(fetchFailedJobLogs(config())).rejects.toThrow(/redirect/i);
    expect(storageRequests).toHaveLength(0);
  });

  it('limits the number of analyzed jobs (default 3, configurable)', async () => {
    behavior.jobs = jobsJson(
      [1, 2, 3, 4, 5].map((i) => [i, `job${i}`, 'failure'] as [number, string, string]),
    );
    const dflt = await fetchFailedJobLogs(config());
    expect(dflt.jobs).toHaveLength(3);
    expect(dflt.failedJobCount).toBe(5);
    expect((await fetchFailedJobLogs(config({ maxJobs: 1 }))).jobs).toHaveLength(1);
  });

  it('reports a run without failed jobs', async () => {
    behavior.jobs = jobsJson([[1, 'build', 'success']]);
    await expect(fetchFailedJobLogs(config())).rejects.toThrow(/no failed jobs/);
  });

  it('keeps only the tail of an oversized log and marks it truncated', async () => {
    behavior.logBody = () =>
      Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const logs = await fetchFailedJobLogs(config({ maxBytesPerJob: 20000, maxJobs: 1 }));
    expect(logs.jobs[0]?.truncated).toBe(true);
    expect(logs.jobs[0]?.firstLineNumber).toBeGreaterThan(1);
    expect(logs.jobs[0]?.text.trimEnd().endsWith('line 5000')).toBe(true);
  });

  it('aborts absurdly large downloads', async () => {
    behavior.logBody = () => 'x'.repeat(20_000) + '\n';
    await expect(fetchFailedJobLogs(config({ maxBytesPerJob: 100, maxJobs: 1 }))).rejects.toThrow(
      /too large/,
    );
  });

  describe('error mapping', () => {
    const cases: [number, Record<string, string>, RegExp][] = [
      [401, {}, /rejected the token/],
      [403, {}, /refused access/],
      [
        403,
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1893456000' },
        /rate limit exceeded.*2030/,
      ],
      [429, { 'retry-after': '60' }, /secondary limit.*60 seconds/],
      [404, {}, /404.*expire/],
      [500, {}, /unexpected status \(500\)/],
    ];
    it.each(cases)('jobs endpoint %i', async (status, headers, message) => {
      behavior.jobsStatus = status;
      behavior.jobsHeaders = headers;
      const err = await fetchFailedJobLogs(config()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GithubError);
      expect((err as Error).message).toMatch(message);
      expect((err as Error).message).not.toContain(TOKEN);
    });

    it('410 on logs mentions expiry', async () => {
      behavior.logsStatus = 410;
      await expect(fetchFailedJobLogs(config())).rejects.toThrow(/gone.*retention/i);
    });

    it('404 on logs mentions retention', async () => {
      behavior.storageStatus = 404;
      await expect(fetchFailedJobLogs(config())).rejects.toThrow(/expire/);
    });
  });

  it('validates repo, run id and API URL before any request', async () => {
    await expect(fetchFailedJobLogs(config({ repo: 'bad repo' }))).rejects.toThrow(/owner\/name/);
    await expect(fetchFailedJobLogs(config({ repo: '../etc/passwd' }))).rejects.toThrow(
      /owner\/name/,
    );
    await expect(fetchFailedJobLogs(config({ runId: '12; rm -rf /' }))).rejects.toThrow(/numeric/);
    await expect(fetchFailedJobLogs(config({ apiUrl: 'http://api.example.test' }))).rejects.toThrow(
      /https/,
    );
    expect(apiRequests).toHaveLength(0);
  });

  it('times out without leaking the token', async () => {
    const hang = createServer(() => {
      /* never answers */
    });
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
    const port = (hang.address() as AddressInfo).port;
    const err = await fetchFailedJobLogs(
      config({ apiUrl: `http://127.0.0.1:${port}`, timeoutMs: 100 }),
    ).catch((e: unknown) => e);
    hang.closeAllConnections();
    await new Promise((r) => hang.close(r));
    expect((err as Error).message).toMatch(/timed out/);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe('cli github command', () => {
  async function go(argv: string[], env: Record<string, string>) {
    let stdout = '';
    let stderr = '';
    const io: CliIo = {
      stdin: Object.assign(Readable.from([]), { isTTY: false }),
      stdout: { write: (s: string) => (stdout += s) },
      stderr: { write: (s: string) => (stderr += s) },
      env,
    };
    const code = await run(argv, io);
    return { code, stdout, stderr };
  }
  const args = ['github', '--repo', 'octo/demo', '--run', '123', '--github-api-url', ''];

  it('produces a github-run report with per-job findings', async () => {
    const a = [...args.slice(0, -1), apiBase, '--format', 'json'];
    const r = await go(a, { GITHUB_TOKEN: TOKEN });
    expect(r.code).toBe(0);
    const report = ReportSchema.parse(JSON.parse(r.stdout));
    expect(report.source.kind).toBe('github-run');
    expect(report.findings.map((f) => f.ruleId).sort()).toEqual([
      'infra.disk-full',
      'node.module-not-found',
    ]);
    expect(report.findings.map((f) => f.job).sort()).toEqual(['build', 'test']);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    expect(r.stderr).toContain('127.0.0.1');
  });

  it('requires GITHUB_TOKEN from the environment (exit 2) and never accepts it as an argument', async () => {
    const a = [...args.slice(0, -1), apiBase];
    expect((await go(a, {})).code).toBe(2);
    const withFlag = await go([...a, '--token', TOKEN], { GITHUB_TOKEN: TOKEN });
    expect(withFlag.code).toBe(2);
    expect(apiRequests).toHaveLength(0);
  });

  it('exits 4 on GitHub errors and never prints the token', async () => {
    behavior.jobsStatus = 401;
    const r = await go([...args.slice(0, -1), apiBase], { GITHUB_TOKEN: TOKEN });
    expect(r.code).toBe(4);
    expect(r.stderr).toContain('rejected the token');
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it('exits 2 when --repo/--run are missing or used without the github command', async () => {
    expect((await go(['github', '--run', '1'], { GITHUB_TOKEN: TOKEN })).code).toBe(2);
    expect((await go(['x.log', '--repo', 'a/b'], {})).code).toBe(2);
  });
});
