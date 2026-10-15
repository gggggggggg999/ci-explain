import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactText, STRICT_KINDS } from '../../src/core/redact.js';

const root = new URL('../../', import.meta.url).pathname;
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('repository hygiene', () => {
  it('contains no ready-made secret strings of the strict kinds', () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (file.endsWith('package-lock.json') || /\.(png|gif|jpg|tgz)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      const r = redactText(text);
      for (const kind of STRICT_KINDS) {
        if ((r.byKind[kind] ?? 0) > 0) offenders.push(`${file.slice(root.length)} (${kind})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no .env files', () => {
    expect(walk(root).filter((f) => /(^|\/)\.env(\..*)?$/.test(f))).toEqual([]);
  });
});
