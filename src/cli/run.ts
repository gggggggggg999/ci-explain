import type { Readable } from 'node:stream';
import { analyzeLog } from '../core/analyze.js';
import { renderExcerpt } from '../core/excerpt.js';
import { mergeJobResults } from '../core/merge.js';
import { buildReport } from '../core/report.js';
import {
  DEFAULT_API_URL,
  DEFAULT_MAX_JOBS,
  fetchFailedJobLogs,
  GithubError,
} from '../io/github.js';
import { DEFAULT_MAX_BYTES, InputError, readInput } from '../io/read-input.js';
import { OutputFileError, writeFileSafely } from '../io/write-output.js';
import { explainWithLlm } from '../llm/explain.js';
import { createOpenAiCompatibleProvider } from '../llm/openai-compatible.js';
import {
  buildPrompt,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_OUTPUT_TOKENS,
  formatPromptForDisplay,
} from '../llm/prompt.js';
import { LlmError } from '../llm/provider.js';
import type { LlmSection } from '../core/schema.js';
import { readVersion } from '../version.js';
import { HELP_TEXT, parseCliArgs, UsageError } from './args.js';
import { renderJson } from './render-json.js';
import { renderMarkdown } from './render-markdown.js';
import { renderText } from './render-text.js';

export interface CliIo {
  stdin: Readable & { isTTY?: boolean };
  stdout: { write(s: string): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown };
  env: Record<string, string | undefined>;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  INPUT: 3,
  EXTERNAL: 4,
  LLM_REQUIRED: 5,
} as const;

export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    const opts = parseCliArgs(argv);
    if (opts.help) {
      io.stdout.write(HELP_TEXT);
      return EXIT.OK;
    }
    if (opts.version) {
      io.stdout.write(`${readVersion()}\n`);
      return EXIT.OK;
    }
    const isGithub = opts.positionals[0] === 'github';
    if (!isGithub && (opts.repo || opts.run || opts.maxJobs || opts.githubApiUrl)) {
      throw new UsageError(
        '--repo, --run, --max-jobs and --github-api-url are only for "ci-explain github".',
      );
    }
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

    interface LoadedInput {
      name: string | null;
      text: string;
      truncated: boolean;
      firstLineNumber: number;
    }
    let sourceKind: 'file' | 'stdin' | 'github-run';
    let inputs: LoadedInput[];

    if (isGithub) {
      if (opts.positionals.length !== 1) {
        throw new UsageError('"ci-explain github" takes no other positional arguments.');
      }
      if (!opts.repo || !opts.run) {
        throw new UsageError('"ci-explain github" needs --repo <owner/name> and --run <run-id>.');
      }
      const token = io.env.GITHUB_TOKEN;
      if (!token) {
        throw new UsageError(
          '"ci-explain github" needs a token in the GITHUB_TOKEN environment variable (never pass it as an argument).',
        );
      }
      const apiUrl = opts.githubApiUrl ?? DEFAULT_API_URL;
      let apiHost = apiUrl;
      try {
        apiHost = new URL(apiUrl).host;
      } catch {
        throw new UsageError('--github-api-url is not a valid URL.');
      }
      io.stderr.write(
        `Contacting ${apiHost} to download the logs of the failed jobs of run ${opts.run} (token from GITHUB_TOKEN).\n`,
      );
      const logs = await fetchFailedJobLogs({
        repo: opts.repo,
        runId: opts.run,
        token,
        apiUrl,
        maxJobs: opts.maxJobs ?? DEFAULT_MAX_JOBS,
        maxBytesPerJob: maxBytes,
        ...(io.fetch ? { fetchImpl: io.fetch } : {}),
      });
      if (logs.failedJobCount > logs.jobs.length) {
        io.stderr.write(
          `Note: ${logs.failedJobCount} jobs failed; analyzing the first ${logs.jobs.length}. Use --max-jobs to change this.\n`,
        );
      }
      inputs = logs.jobs.map((j) => ({
        name: j.jobName,
        text: j.text,
        truncated: j.truncated,
        firstLineNumber: j.firstLineNumber,
      }));
      if (inputs.every((i) => i.text.trim() === '')) {
        throw new GithubError('GitHub returned empty logs for the failed jobs.');
      }
      sourceKind = 'github-run';
    } else {
      if (opts.positionals.length !== 1) {
        throw new UsageError(
          'Expected exactly one input: a log file path, "-" for stdin, or the "github" command.',
        );
      }
      const source = opts.positionals[0] as string;
      if (source === '-' && io.stdin.isTTY) {
        throw new UsageError(
          'stdin is a terminal. Pipe a log into ci-explain, or pass a file path.',
        );
      }
      const input = await readInput(source, maxBytes, io.stdin);
      if (input.text.trim() === '') {
        throw new InputError('The input is empty: there is nothing to analyze.');
      }
      inputs = [{ name: null, ...input }];
      sourceKind = source === '-' ? 'stdin' : 'file';
    }

    if (inputs.some((i) => i.truncated)) {
      io.stderr.write(
        `Note: input exceeded --max-bytes (${maxBytes}); only the end of it was analyzed. ` +
          'Line numbers still refer to the original input. Use --max-bytes to change the limit.\n',
      );
    }
    if (opts.noRedact) {
      io.stderr.write(
        'WARNING: secret redaction is disabled. The output may contain secrets; do not share it.\n',
      );
    }

    const analyzeOne = (input: LoadedInput, redact: boolean, maxFindings: number) =>
      analyzeLog(input.text, {
        maxFindings,
        redact,
        redactPii: opts.redactPii,
        inputTruncated: input.truncated,
        firstLineNumber: input.firstLineNumber,
      });
    const analyzeAll = (redact: boolean) => {
      if (!isGithub) return analyzeOne(inputs[0] as LoadedInput, redact, opts.maxFindings);
      return mergeJobResults(
        inputs.map((i) => ({ job: i.name ?? '', result: analyzeOne(i, redact, opts.maxFindings) })),
        opts.maxFindings,
      );
    };
    const result = analyzeAll(!opts.noRedact);
    const version = readVersion();

    if (opts.showPrompt) {
      // Shows exactly what --llm would send. Nothing is sent, no key or URL is needed.
      const prompt = buildPrompt(result, {
        maxInputBytes: opts.llmMaxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      });
      io.stdout.write(formatPromptForDisplay(prompt));
      io.stderr.write('Nothing was sent. This is the exact text --llm would send.\n');
      return EXIT.OK;
    }

    let llm: LlmSection = { used: false };
    if (opts.llm) {
      const apiKey = io.env.CI_EXPLAIN_LLM_API_KEY;
      const baseUrl = opts.llmBaseUrl ?? io.env.CI_EXPLAIN_LLM_BASE_URL;
      const model = opts.llmModel ?? io.env.CI_EXPLAIN_LLM_MODEL;
      if (!apiKey) {
        throw new UsageError(
          '--llm needs the API key in the CI_EXPLAIN_LLM_API_KEY environment variable (never pass it as an argument).',
        );
      }
      if (!baseUrl)
        throw new UsageError('--llm needs --llm-base-url (or CI_EXPLAIN_LLM_BASE_URL).');
      if (!model) throw new UsageError('--llm needs --llm-model (or CI_EXPLAIN_LLM_MODEL).');
      let provider;
      try {
        provider = createOpenAiCompatibleProvider({
          baseUrl,
          apiKey,
          model,
          timeoutMs: (opts.llmTimeoutSeconds ?? 30) * 1000,
          ...(opts.llmTokenParam ? { tokenParam: opts.llmTokenParam } : {}),
          ...(io.fetch ? { fetchImpl: io.fetch } : {}),
        });
      } catch (err) {
        if (err instanceof LlmError) throw new UsageError(err.message);
        throw err;
      }
      const prompt = buildPrompt(result, {
        maxInputBytes: opts.llmMaxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      });
      io.stderr.write(
        `AI layer (--llm): sending a redacted excerpt (${prompt.excerptBytes} bytes, ${prompt.includedLines} lines) to ${provider.name}. ` +
          'Use --show-prompt to preview exactly what is sent.\n',
      );
      llm = await explainWithLlm(provider, prompt, {
        model,
        maxOutputTokens: opts.llmMaxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      });
      if (!llm.used) {
        io.stderr.write(`AI layer unavailable: ${llm.unavailableReason ?? 'unknown reason'}.\n`);
      }
    }

    const report = buildReport(result, {
      toolVersion: version,
      sourceKind,
      llm,
    });

    if (opts.exportExcerpt) {
      // The excerpt is always redacted, even when --no-redact was used for the terminal output.
      const safe = opts.noRedact ? analyzeAll(true) : result;
      await writeFileSafely(opts.exportExcerpt, renderExcerpt(safe, version), opts.force);
      io.stderr.write(
        `Excerpt written to ${opts.exportExcerpt}. Review it manually before sharing: redaction is pattern-based.\n`,
      );
    }

    const color = !opts.noColor && !io.env.NO_COLOR && io.stdout.isTTY === true;
    if (opts.format === 'json') io.stdout.write(renderJson(report));
    else if (opts.format === 'markdown') io.stdout.write(renderMarkdown(report));
    else io.stdout.write(renderText(report, { color }));
    if (opts.llmRequired && !llm.used) return EXIT.LLM_REQUIRED;
    return EXIT.OK;
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr.write(`Error: ${err.message}\nRun "ci-explain --help" for usage.\n`);
      return EXIT.USAGE;
    }
    if (err instanceof GithubError) {
      io.stderr.write(`Error: ${err.message}\n`);
      return EXIT.EXTERNAL;
    }
    if (err instanceof InputError || err instanceof OutputFileError) {
      io.stderr.write(`Error: ${err.message}\n`);
      return EXIT.INPUT;
    }
    // Never print raw error objects: they could carry log content.
    io.stderr.write('Error: unexpected internal error.\n');
    return EXIT.UNEXPECTED;
  }
}
