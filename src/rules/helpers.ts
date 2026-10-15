import type {
  Category,
  Confidence,
  Ecosystem,
  Evidence,
  LogLine,
  Rule,
  RuleContext,
  RuleKind,
  RuleMatch,
} from '../core/types.js';

export const MAX_EVIDENCE_TEXT = 300;
export const MAX_CAPTURE = 120;

export function ev(line: LogLine): Evidence {
  const text =
    line.text.length > MAX_EVIDENCE_TEXT ? line.text.slice(0, MAX_EVIDENCE_TEXT) + '…' : line.text;
  return { line: line.n, text };
}

/** Shortens a value taken from the (untrusted) log before it is placed into an explanation. */
export function cap(value: string, max = MAX_CAPTURE): string {
  const v = value.trim();
  return v.length > max ? v.slice(0, max) + '…' : v;
}

export function indexOfLine(ctx: RuleContext, test: (text: string) => boolean, from = 0): number {
  for (let i = from; i < ctx.lines.length; i++) {
    if (test((ctx.lines[i] as LogLine).text)) return i;
  }
  return -1;
}

export function findAll(ctx: RuleContext, test: (text: string) => boolean): LogLine[] {
  return ctx.lines.filter((l) => test(l.text));
}

/** Returns the text after an npm log prefix ("npm error " or legacy "npm ERR! "), or null. */
export function npmText(text: string): string | null {
  if (text.startsWith('npm error ')) return text.slice('npm error '.length);
  if (text.startsWith('npm ERR! ')) return text.slice('npm ERR! '.length);
  return null;
}

export function dedupeEvidence(items: Evidence[]): Evidence[] {
  const seen = new Set<number>();
  const out: Evidence[] = [];
  for (const e of [...items].sort((a, b) => a.line - b.line)) {
    if (seen.has(e.line)) continue;
    seen.add(e.line);
    out.push(e);
  }
  return out;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return n === 1 ? one : many;
}

export interface LineRuleSpec {
  id: string;
  title: string;
  ecosystem: Ecosystem;
  category: Category;
  kind?: RuleKind;
  priority: number;
  confidence: Confidence;
  verifiedOn: string | null;
  sourceNote: string;
  /** Does this line trigger the rule? Use substring checks or simple anchored regexes only. */
  find: (text: string) => boolean;
  /** Extracts values from the triggering line (kept short by `cap`). */
  captures?: (line: LogLine) => Record<string, string>;
  /** Extra evidence lines: given all lines and the index of the trigger. */
  related?: (lines: LogLine[], index: number) => LogLine[];
  confidenceFor?: (line: LogLine) => Confidence | undefined;
  explain: (m: RuleMatch) => string;
  suggest: (m: RuleMatch) => string[];
}

/** Builds a rule that fires on the first line accepted by `find` and attaches related lines as evidence. */
export function defineLineRule(spec: LineRuleSpec): Rule {
  return {
    id: spec.id,
    title: spec.title,
    ecosystem: spec.ecosystem,
    category: spec.category,
    kind: spec.kind ?? 'rootCause',
    priority: spec.priority,
    confidence: spec.confidence,
    verifiedOn: spec.verifiedOn,
    sourceNote: spec.sourceNote,
    match(ctx): RuleMatch | null {
      const at = indexOfLine(ctx, spec.find);
      if (at < 0) return null;
      const line = ctx.lines[at] as LogLine;
      const evidence = [ev(line), ...(spec.related?.(ctx.lines, at) ?? []).map(ev)];
      const match: RuleMatch = {
        evidence: dedupeEvidence(evidence),
        captures: spec.captures?.(line) ?? {},
      };
      const conf = spec.confidenceFor?.(line);
      if (conf) match.confidence = conf;
      return match;
    },
    explain: spec.explain,
    suggest: spec.suggest,
  };
}
