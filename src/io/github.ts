import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { z } from 'zod';
import { InputError, readStreamTail, type InputResult } from './read-input.js';

/** API version header value taken from the GitHub REST docs (checked 2026-10-15). */
export const GITHUB_API_VERSION = '2026-03-10';
export const DEFAULT_API_URL = 'https://api.github.com';
export const DEFAULT_MAX_JOBS = 3;

/** Failure of an external source (exit code 4). Messages are fixed text: no tokens or headers. */
export class GithubError extends Error {
  override name = 'GithubError';
}

export interface GithubConfig {
  repo: string;
  runId: string;
  token: string;
  apiUrl?: string;
  maxJobs?: number;
  maxBytesPerJob: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface JobLog extends InputResult {
  jobName: string;
  jobId: number;
}

export interface GithubLogs {
  jobs: JobLog[];
  failedJobCount: number;
}

const JobsResponse = z.object({
  jobs: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_REDIRECTS = 3;
const MAX_TOTAL_DOWNLOAD_FACTOR = 8;

function assertSafeUrl(url: URL, what: string): void {
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new GithubError(`${what} must use https (http is allowed only for localhost).`);
  }
  if (url.username || url.password) throw new GithubError(`${what} must not contain credentials.`);
}

export function parseRepo(repo: string): { owner: string; name: string } {
  const m = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(repo);
  if (!m) throw new GithubError('--repo must look like owner/name.');
  return { owner: m[1] as string, name: m[2] as string };
}

function describeStatus(res: Response, what: string): GithubError {
  const status = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  const retryAfter = res.headers.get('retry-after');
  if (status === 401) {
    return new GithubError(
      'GitHub rejected the token (401). Check that GITHUB_TOKEN is valid and not expired.',
    );
  }
  if (status === 403 || status === 429) {
    if (remaining === '0') {
      const when =
        reset && /^\d{1,12}$/.test(reset) ? new Date(Number(reset) * 1000).toISOString() : 'later';
      return new GithubError(`GitHub API rate limit exceeded; it resets at ${when}.`);
    }
    if (status === 429 || retryAfter) {
      return new GithubError(
        `GitHub rate-limited the request (secondary limit)${retryAfter && /^\d{1,6}$/.test(retryAfter) ? `; retry after ${retryAfter} seconds` : '; retry in about a minute'}.`,
      );
    }
    return new GithubError(
      `GitHub refused access (403) to ${what}. The token needs read access to the repository and to Actions.`,
    );
  }
  if (status === 404) {
    return new GithubError(
      `GitHub returned 404 for ${what}. Check --repo and --run. Private repositories need a token with access, and workflow logs expire (90 days by default; private repositories can set 1 to 400 days).`,
    );
  }
  if (status === 410) {
    return new GithubError(
      'The logs for this job are gone (410). Workflow logs expire after the repository retention period (90 days by default).',
    );
  }
  return new GithubError(`GitHub returned an unexpected status (${status}) for ${what}.`);
}

export async function fetchFailedJobLogs(config: GithubConfig): Promise<GithubLogs> {
  const { owner, name } = parseRepo(config.repo);
  if (!/^\d{1,20}$/.test(config.runId)) throw new GithubError('--run must be a numeric run ID.');
  const api = new URL(config.apiUrl ?? DEFAULT_API_URL);
  assertSafeUrl(api, 'The GitHub API URL');
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 30_000;

  const call = async (url: URL, withAuth: boolean): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'ci-explain',
    };
    if (withAuth) headers.Authorization = `Bearer ${config.token}`;
    try {
      // Redirects are handled manually so the token is never sent to another host.
      return await doFetch(url, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const n = (err as { name?: string }).name;
      if (n === 'TimeoutError' || n === 'AbortError')
        throw new GithubError('The request to GitHub timed out.');
      throw new GithubError('Network error while contacting GitHub.');
    }
  };

  const base = `${api.origin}${api.pathname.replace(/\/+$/, '')}`;
  const jobsUrl = new URL(
    `${base}/repos/${owner}/${name}/actions/runs/${config.runId}/jobs?per_page=100&filter=latest`,
  );
  const jobsRes = await call(jobsUrl, true);
  if (!jobsRes.ok) {
    if (jobsRes.status >= 300 && jobsRes.status < 400) {
      throw new GithubError('Unexpected redirect from the GitHub API; not followed.');
    }
    throw describeStatus(jobsRes, 'the workflow run');
  }
  let parsed;
  try {
    parsed = JobsResponse.parse(await jobsRes.json());
  } catch {
    throw new GithubError('GitHub returned a response in an unexpected shape.');
  }

  const failed = parsed.jobs.filter(
    (j) => j.conclusion === 'failure' || j.conclusion === 'timed_out',
  );
  if (failed.length === 0) {
    throw new GithubError(
      'This run has no failed jobs (conclusions: ' +
        ([...new Set(parsed.jobs.map((j) => j.conclusion ?? 'in progress'))].join(', ') || 'none') +
        ').',
    );
  }

  const selected = failed.slice(0, config.maxJobs ?? DEFAULT_MAX_JOBS);
  const jobs: JobLog[] = [];
  for (const job of selected) {
    const logUrl = new URL(`${base}/repos/${owner}/${name}/actions/jobs/${job.id}/logs`);
    let res = await call(logUrl, true);
    let hops = 0;
    // The logs endpoint answers with a redirect to a short-lived download URL: follow it WITHOUT the token.
    while (res.status >= 300 && res.status < 400) {
      if (++hops > MAX_REDIRECTS)
        throw new GithubError('Too many redirects while downloading the log.');
      const location = res.headers.get('location');
      if (!location) throw new GithubError('GitHub sent a redirect without a location.');
      const target = new URL(location, logUrl);
      assertSafeUrl(target, 'The log download URL');
      res = await call(target, false);
    }
    if (!res.ok) throw describeStatus(res, `the log of job "${job.name}"`);
    if (!res.body) throw new GithubError('GitHub returned an empty log response.');

    let log: InputResult;
    try {
      log = await readStreamTail(
        Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
        config.maxBytesPerJob,
        config.maxBytesPerJob * MAX_TOTAL_DOWNLOAD_FACTOR,
      );
    } catch (err) {
      if (err instanceof InputError) throw new GithubError(err.message);
      throw new GithubError('Network error while downloading the log.');
    }
    jobs.push({ ...log, jobName: job.name, jobId: job.id });
  }
  return { jobs, failedJobCount: failed.length };
}
