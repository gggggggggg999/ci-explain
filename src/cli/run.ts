import type { Readable } from 'node:stream';
import { analyzeLog } from '../core/analyze.js';
import { renderExcerpt } from '../core/excerpt.js';
import { buildReport } from '../core/report.js';
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
    if (opts.positionals.length !== 1) {
      throw new UsageError('Expected exactly one input: a log file path, or "-" for stdin.');
    }
    const source = opts.positionals[0] as string;
    if (source === '-' && io.stdin.isTTY) {
      throw new UsageError('stdin is a terminal. Pipe a log into ci-explain, or pass a file path.');
    }

    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const input = await readInput(source, maxBytes, io.stdin);
    if (input.text.trim() === '')
      throw new InputError('The input is empty: there is nothing to analyze.');
    if (input.truncated) {
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

    const result = analyzeLog(input.text, {
      maxFindings: opts.maxFindings,
      redact: !opts.noRedact,
      redactPii: opts.redactPii,
      inputTruncated: input.truncated,
      firstLineNumber: input.firstLineNumber,
    });
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
      sourceKind: source === '-' ? 'stdin' : 'file',
      llm,
    });

    if (opts.exportExcerpt) {
      // The excerpt is always redacted, even when --no-redact was used for the terminal output.
      const safe = opts.noRedact
        ? analyzeLog(input.text, {
            redact: true,
            redactPii: opts.redactPii,
            firstLineNumber: input.firstLineNumber,
          })
        : result;
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
    if (err instanceof InputError || err instanceof OutputFileError) {
      io.stderr.write(`Error: ${err.message}\n`);
      return EXIT.INPUT;
    }
    // Never print raw error objects: they could carry log content.
    io.stderr.write('Error: unexpected internal error.\n');
    return EXIT.UNEXPECTED;
  }
}
