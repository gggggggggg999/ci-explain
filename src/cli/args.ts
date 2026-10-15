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
  -h, --help                     Show this help
  -v, --version                  Show the version

The base analysis is offline: it makes no network calls and sends nothing anywhere.
Logs are untrusted input; nothing from a log is ever executed.

Exit codes:
  0  analysis done (including "cause not recognized")
  1  unexpected error
  2  invalid arguments
  3  input unreadable, empty, or unsupported
`;
