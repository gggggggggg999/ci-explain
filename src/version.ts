import { readFileSync } from 'node:fs';

/** Reads the package version from package.json (works from src/ and dist/). */
export function readVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const raw = readFileSync(new URL(rel, import.meta.url), 'utf8');
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === 'ci-explain' && parsed.version) return parsed.version;
    } catch {
      // try next location
    }
  }
  return '0.0.0';
}
