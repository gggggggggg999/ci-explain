// Per-rule evaluation on the synthetic fixtures. Exits 1 on any mismatch.
// NOTE: fixtures are hand-written from documented/observed message formats, so these numbers
// say nothing about accuracy on real-world logs.
import { analyzeLog } from '../src/core/analyze.js';
import { rules } from '../src/rules/index.js';
import { loadRuleFixtures, makeVariants } from '../tests/helpers/variants.js';

interface Row {
  id: string;
  pos: number;
  neg: number;
  posPass: number;
  posTotal: number;
  negPass: number;
  negTotal: number;
  missed: number;
  falsePositives: number;
}

const fixtures = loadRuleFixtures();
const rows: Row[] = [];
let failed = false;

for (const rule of rules) {
  const fx = fixtures.find((f) => f.ruleId === rule.id);
  const row: Row = {
    id: rule.id,
    pos: fx?.positives.length ?? 0,
    neg: fx?.negatives.length ?? 0,
    posPass: 0,
    posTotal: 0,
    negPass: 0,
    negTotal: 0,
    missed: 0,
    falsePositives: 0,
  };
  for (const p of fx?.positives ?? []) {
    for (const v of makeVariants(p.text, true)) {
      row.posTotal++;
      const hit = analyzeLog(v.text, { maxFindings: 100 }).findings.some(
        (f) => f.ruleId === rule.id,
      );
      if (hit) row.posPass++;
      else row.missed++;
    }
  }
  for (const n of fx?.negatives ?? []) {
    for (const v of makeVariants(n.text, false)) {
      row.negTotal++;
      const hit = analyzeLog(v.text, { maxFindings: 100 }).findings.some(
        (f) => f.ruleId === rule.id,
      );
      if (!hit) row.negPass++;
      else row.falsePositives++;
    }
  }
  if (row.pos < 2 || row.neg < 1 || row.missed > 0 || row.falsePositives > 0) failed = true;
  rows.push(row);
}

const w = Math.max(...rows.map((r) => r.id.length), 4);
const head = `${'rule'.padEnd(w)}  pos  neg  pos-pass  neg-pass  missed  false+`;
console.log(head);
console.log('-'.repeat(head.length));
for (const r of rows) {
  console.log(
    `${r.id.padEnd(w)}  ${String(r.pos).padStart(3)}  ${String(r.neg).padStart(3)}  ` +
      `${`${r.posPass}/${r.posTotal}`.padStart(8)}  ${`${r.negPass}/${r.negTotal}`.padStart(8)}  ` +
      `${String(r.missed).padStart(6)}  ${String(r.falsePositives).padStart(6)}`,
  );
}
console.log(
  `\n${rows.length} rules. Synthetic fixtures only: this is a regression check, not an accuracy measurement.`,
);
if (failed) {
  console.error('EVAL FAILED: missing fixtures, missed matches, or false positives (see table).');
  process.exit(1);
}
