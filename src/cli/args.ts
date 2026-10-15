import { parseArgs } from 'node:util';

export type OutputFormat = 'text' | 'markdown' | 'json';

export interface CliOptions {
  help: boolean;
  version: boolean;
  format: OutputFormat;
  maxFindings: number;
  maxBytes: number | null;
  noColor: boolean;
  noRedact: boolean;
  redactPii: boolean;
  exportExcerpt: string | null;
  force: boolean;
  llm: boolean;
  showPrompt: boolean;
  llmBaseUrl: string | null;
  llmModel: string | null;
  llmRequired: boolean;
  llmMaxInputBytes: number | null;
  llmMaxOutputTokens: number | null;
  llmTimeoutSeconds: number | null;
  llmTokenParam: 'max_completion_tokens' | 'max_tokens' | null;
  positionals: string[];
}

export class UsageError extends Error {
  override name = 'UsageError';
}

function positiveInt(name: string, value: string): number {
  if (!/^\d{1,12}$/.test(value) || Number(value) < 1) {
    throw new UsageError(`${name} must be a positive integer (got "${value}")`);
  }
  return Number(value);
}

export function parseCliArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        format: { type: 'string' },
        'max-findings': { type: 'string' },
        'max-bytes': { type: 'string' },
        'no-color': { type: 'boolean' },
        'no-redact': { type: 'boolean' },
        'redact-pii': { type: 'boolean' },
        'export-excerpt': { type: 'string' },
        force: { type: 'boolean' },
        llm: { type: 'boolean' },
        'show-prompt': { type: 'boolean' },
        'llm-base-url': { type: 'string' },
        'llm-model': { type: 'string' },
        'llm-required': { type: 'boolean' },
        'llm-max-input-bytes': { type: 'string' },
        'llm-max-output-tokens': { type: 'string' },
        'llm-timeout': { type: 'string' },
        'llm-max-tokens-param': { type: 'string' },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const v = parsed.values;
  const format = v.format ?? 'text';
  if (format !== 'text' && format !== 'markdown' && format !== 'json') {
    throw new UsageError(`--format must be one of text, markdown, json (got "${format}")`);
  }
  if (v['no-redact'] && format !== 'text') {
    throw new UsageError('--no-redact is only allowed with --format text');
  }
  const tokenParam = v['llm-max-tokens-param'] ?? null;
  if (
    tokenParam !== null &&
    tokenParam !== 'max_completion_tokens' &&
    tokenParam !== 'max_tokens'
  ) {
    throw new UsageError('--llm-max-tokens-param must be max_completion_tokens or max_tokens');
  }
  if ((v.llm || v['show-prompt']) && v['no-redact']) {
    throw new UsageError('--no-redact cannot be combined with --llm or --show-prompt');
  }
  if (v['llm-required'] && !v.llm) {
    throw new UsageError('--llm-required needs --llm');
  }
  return {
    help: v.help ?? false,
    version: v.version ?? false,
    format,
    maxFindings: v['max-findings'] ? positiveInt('--max-findings', v['max-findings']) : 3,
    maxBytes: v['max-bytes'] ? positiveInt('--max-bytes', v['max-bytes']) : null,
    noColor: v['no-color'] ?? false,
    noRedact: v['no-redact'] ?? false,
    redactPii: v['redact-pii'] ?? false,
    exportExcerpt: v['export-excerpt'] ?? null,
    force: v.force ?? false,
    llm: v.llm ?? false,
    showPrompt: v['show-prompt'] ?? false,
    llmBaseUrl: v['llm-base-url'] ?? null,
    llmModel: v['llm-model'] ?? null,
    llmRequired: v['llm-required'] ?? false,
    llmMaxInputBytes: v['llm-max-input-bytes']
      ? positiveInt('--llm-max-input-bytes', v['llm-max-input-bytes'])
      : null,
    llmMaxOutputTokens: v['llm-max-output-tokens']
      ? positiveInt('--llm-max-output-tokens', v['llm-max-output-tokens'])
      : null,
    llmTimeoutSeconds: v['llm-timeout'] ? positiveInt('--llm-timeout', v['llm-timeout']) : null,
    llmTokenParam: tokenParam,
    positionals: parsed.positionals,
  };
}

export const HELP_TEXT = `ci-explain - explain why a CI build failed, with the log lines as evidence.

Usage:
  ci-explain <logfile> [options]
  <command> | ci-explain - [options]

Options:
  --format <text|markdown|json>  Output format (default: text)
  --max-findings <n>             Maximum findings to show (default: 3)
  --max-bytes <n>                Maximum input size; the END of larger input is analyzed
                                 (default: 33554432)
  --no-color                     Disable colors (NO_COLOR is also respected)
  --no-redact                    Disable secret redaction (text format only; prints a warning)
  --redact-pii                   Also redact e-mail and IPv4 addresses
  --export-excerpt <file>        Write a redacted excerpt for bug reports (never overwrites
                                 without --force; nothing is sent anywhere)
  --force                        Allow --export-excerpt to overwrite an existing file
  --show-prompt                  Print exactly what the AI layer would send (after redaction)
                                 and exit. Sends nothing.
  --llm                          Add an AI explanation (OFF by default). Needs the API key in
                                 CI_EXPLAIN_LLM_API_KEY, plus --llm-base-url and --llm-model
                                 (or CI_EXPLAIN_LLM_BASE_URL / CI_EXPLAIN_LLM_MODEL).
  --llm-base-url <url>           OpenAI-compatible base URL (https, or http for localhost).
                                 You choose where the redacted excerpt is sent.
  --llm-model <name>             Model name (no default)
  --llm-required                 Exit with code 5 if the AI layer is unavailable
  --llm-max-input-bytes <n>      Maximum log excerpt sent to the model (default: 24000)
  --llm-max-output-tokens <n>    Maximum output tokens (default: 800)
  --llm-timeout <seconds>        Request timeout (default: 30)
  --llm-max-tokens-param <name>  max_completion_tokens (default) or max_tokens, for servers that
                                 only know the older name
  -h, --help                     Show this help
  -v, --version                  Show the version

The base analysis is offline: it makes no network calls and sends nothing anywhere.
Logs are untrusted input; nothing from a log is ever executed.

Exit codes:
  0  analysis done (including "cause not recognized")
  1  unexpected error
  2  invalid arguments
  3  input unreadable, empty, or unsupported
  5  --llm-required was set and the AI layer was unavailable
`;
