import { describe, expect, it } from 'vitest';
import { analyzeLog } from '../../src/core/analyze.js';
import { normalizeLog } from '../../src/core/normalize.js';
import { segmentLog } from '../../src/core/segment.js';
import { rules, validateRules } from '../../src/rules/index.js';
import type { RuleContext } from '../../src/core/types.js';
import { loadRuleFixtures, makeVariants } from '../helpers/variants.js';

const fixtures = loadRuleFixtures();

describe('rule registry', () => {
  it('has unique ids and valid metadata', () => {
    expect(() => validateRules([...rules])).not.toThrow();
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  it('rejects duplicate ids and bad metadata', () => {
    const first = rules[0]!;
    expect(() => validateRules([first, first])).toThrow(/Duplicate/);
    expect(() => validateRules([{ ...first, id: 'Bad Id' }])).toThrow();
  });

  it('every rule has >= 2 positive and >= 1 negative fixtures, and no orphan fixture dirs', () => {
    const ids = new Set(rules.map((r) => r.id));
    for (const f of fixtures) expect(ids.has(f.ruleId), `orphan fixtures: ${f.ruleId}`).toBe(true);
    for (const rule of rules) {
      const f = fixtures.find((x) => x.ruleId === rule.id);
      expect(f, `fixtures for ${rule.id}`).toBeDefined();
      expect(f!.positives.length, `${rule.id} positives`).toBeGreaterThanOrEqual(2);
      expect(f!.negatives.length, `${rule.id} negatives`).toBeGreaterThanOrEqual(1);
    }
  });

  it('rules marked verified carry a date, unverified ones say so in sourceNote', () => {
    for (const rule of rules) {
      if (rule.verifiedOn === null) {
        expect(rule.sourceNote.toLowerCase(), rule.id).toMatch(/not checked|was not|not verified/);
      }
    }
  });
});

describe.each(fixtures)('fixtures for $ruleId', ({ ruleId, positives, negatives }) => {
  for (const fx of positives) {
    for (const variant of makeVariants(fx.text, true)) {
      it(`matches ${fx.name} [${variant.name}] with line-accurate evidence`, () => {
        const result = analyzeLog(variant.text, { maxFindings: 100 });
        const finding = result.findings.find((f) => f.ruleId === ruleId);
        expect(finding, `finding for ${ruleId}`).toBeDefined();
        expect(finding!.evidence.length).toBeGreaterThan(0);

        // Evidence must point at the right ORIGINAL line number.
        const normalized = normalizeLog(variant.text);
        for (const e of finding!.evidence) {
          const line = normalized.lines.find((l) => l.n === e.line);
          expect(line, `line ${e.line} exists`).toBeDefined();
          expect(line!.text.startsWith(e.text.replace(/…$/, ''))).toBe(true);
          const original = variant.text.split('\n')[e.line - 1] ?? '';
          expect(original.includes(e.text.replace(/…$/, ''))).toBe(true);
        }
      });
    }
  }
  for (const fx of negatives) {
    for (const variant of makeVariants(fx.text, false)) {
      it(`does not match ${fx.name} [${variant.name}]`, () => {
        const result = analyzeLog(variant.text, { maxFindings: 100 });
        expect(result.findings.map((f) => f.ruleId)).not.toContain(ruleId);
      });
    }
  }
});

describe('explanations only use facts present in the evidence', () => {
  const DERIVED = new Set([
    'count',
    'files',
    'failed',
    'problems',
    'errors',
    'warnings',
    'variant',
    'runner',
  ]);
  for (const f of fixtures) {
    const rule = rules.find((r) => r.id === f.ruleId)!;
    for (const fx of f.positives) {
      it(`${f.ruleId} / ${fx.name}`, () => {
        const log = normalizeLog(fx.text);
        const seg = segmentLog(log);
        const ctx: RuleContext = { lines: log.lines, step: null, format: seg.format };
        const m = rule.match(ctx);
        expect(m).not.toBeNull();
        const evidenceText = m!.evidence.map((e) => e.text).join('\n');
        for (const [key, value] of Object.entries(m!.captures)) {
          if (DERIVED.has(key) || value === '') continue;
          const parts = key === 'rules' ? value.split(', ') : [value];
          for (const part of parts) {
            expect(evidenceText.includes(part.replace(/…$/, '')), `${key}=${part}`).toBe(true);
          }
        }
        expect(rule.explain(m!).length).toBeGreaterThan(10);
        expect(rule.suggest(m!).length).toBeLessThanOrEqual(3);
      });
    }
  }
});
