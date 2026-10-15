import { Readable } from 'node:stream';
import type { CliIo } from '../../src/cli/run.js';
import { run } from '../../src/cli/run.js';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(
  argv: string[],
  options: { stdin?: string; env?: Record<string, string>; tty?: boolean } = {},
): Promise<CliResult> {
  let stdout = '';
  let stderr = '';
  const stdin = Readable.from(options.stdin !== undefined ? [Buffer.from(options.stdin)] : []);
  const io: CliIo = {
    stdin: Object.assign(stdin, { isTTY: false }),
    stdout: {
      write: (s: string) => (stdout += s),
      isTTY: options.tty ?? false,
    },
    stderr: { write: (s: string) => (stderr += s) },
    env: options.env ?? {},
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

export const fixturePath = (name: string) =>
  new URL(`../fixtures/logs/${name}`, import.meta.url).pathname;
