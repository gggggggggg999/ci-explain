import { writeFile } from 'node:fs/promises';

export class OutputFileError extends Error {
  override name = 'OutputFileError';
}

/** Writes a file without overwriting an existing one unless `force` is set. */
export async function writeFileSafely(
  path: string,
  content: string,
  force: boolean,
): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: force ? 'w' : 'wx', mode: 0o600 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new OutputFileError(`${path} already exists; use --force to overwrite it.`);
    }
    throw new OutputFileError(`Cannot write ${path}: ${code ?? 'unknown error'}`);
  }
}
