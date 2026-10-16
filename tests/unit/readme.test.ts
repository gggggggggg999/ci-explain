import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath, runCli } from '../helpers/cli-io.js';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

describe('README', () => {
  it('shows real output: the example equals what the tool prints for the referenced fixture', async () => {
    const block = /```text\n([\s\S]*?)```/.exec(readme)?.[1];
    expect(block).toBeDefined();
    const r = await runCli([fixturePath('gha-ts-build.log')]);
    expect(r.stdout.trimEnd()).toBe((block as string).trimEnd());
  });

  it('does not claim things the project must not claim', () => {
    expect(readme).not.toMatch(/production[- ]ready/i);
    expect(readme).not.toMatch(/\d+(\.\d+)?\s*%\s*accura/i);
    expect(readme).not.toMatch(/!\[[^\]]*\]\(https:\/\/img\.shields\.io/);
    expect(readme).not.toMatch(/npx ci-explain/);
  });

  it('documents every exit code the CLI can return', () => {
    for (const code of ['0', '1', '2', '3', '4', '5']) {
      expect(readme).toMatch(new RegExp(`\\| ${code}\\s*\\|`));
    }
  });
});
