import type { Evidence, LogLine, RuleContext } from '../core/types.js';

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
