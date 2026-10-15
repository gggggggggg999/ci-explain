// Generates a large synthetic GitHub Actions-style log for performance measurements.
// Usage: node scripts/gen-big-log.mjs <size-in-MiB> <output-file>
import { createWriteStream } from 'node:fs';

const mib = Number(process.argv[2]);
const out = process.argv[3];
if (!Number.isFinite(mib) || mib <= 0 || !out) {
  console.error('usage: node scripts/gen-big-log.mjs <size-in-MiB> <output-file>');
  process.exit(2);
}
const target = mib * 1024 * 1024;
const stream = createWriteStream(out, { flags: 'wx' });
let written = 0;
let i = 0;
const write = (line) => {
  const text = `2025-01-01T00:00:${String(i % 60).padStart(2, '0')}.0000000Z ${line}\n`;
  written += text.length;
  return stream.write(text);
};
write('##[group]Run npm test');
while (written < target) {
  i++;
  const ok = write(`  PASS  src/module-${i}.test.ts (${i % 97} ms) \u001b[32mok\u001b[0m`);
  if (i % 5000 === 0)
    write(
      `src/module-${i}.ts(${i % 80},3): error TS2322: Type 'string' is not assignable to type 'number'.`,
    );
  if (!ok) await new Promise((r) => stream.once('drain', r));
}
write('##[error]Process completed with exit code 1.');
stream.end();
