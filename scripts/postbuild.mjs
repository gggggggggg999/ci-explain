// Makes the compiled CLI entry executable and verifies it has a shebang.
import { chmodSync, readFileSync } from 'node:fs';

const entry = new URL('../dist/cli/main.js', import.meta.url);
const text = readFileSync(entry, 'utf8');
if (!text.startsWith('#!/usr/bin/env node')) {
  throw new Error('dist/cli/main.js is missing the shebang line');
}
chmodSync(entry, 0o755);
