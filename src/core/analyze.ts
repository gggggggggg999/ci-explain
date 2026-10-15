import { rules as defaultRules } from '../rules/index.js';
import { extractWindows, type ExtractOptions } from './extract.js';
import { normalizeLog } from './normalize.js';
import { redactLines, type RedactionSummary } from './redact.js';
import { segmentLog } from './segment.js';
import type {
  Confidence,
  ErrorWindow,
  Finding,
  LogFormat,
  LogLine,
  Rule,
  RuleContext,
  Step,
} from './types.js';

export interface AnalyzeOptions {
  maxFindings?: number;
  maxLineLength?: number;
  extract?: ExtractOptions;
  /** Redact secrets before anything else runs (default true). Only disable for local terminal use. */
  redact?: boolean;
  /** Also redact e-mail and IPv4 addresses. */
  redactPii?: boolean;
  /** Set by the caller when the input was cut (for example by --max-bytes). */
  inputTruncated?: boolean;
  /** Injectable for tests. */
  rules?: readonly Rule[];
}

export interface AnalysisResult {
  format: LogFormat;
  failedStep: string | null;
  exitCode: number | null;
  truncated: boolean;
  warnings: string[];
  redactions: RedactionSummary;
  findings: Finding[];
  /** Total findings before the maxFindings cut. */
  totalFindings: number;
  windows: ErrorWindow[];
  stats: { originalLines: number; analyzedLines: number; collapsedLines: number };
}

const CONFIDENCE_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const MAX_EVIDENCE = 6;

function downgrade(c: Confidence): Confidence {
  return c === 'high' ? 'medium' : 'low';
}

function runRules(
  rules: readonly Rule[],
  ctx: RuleContext,
  stepName: string | null,
  downgradeConfidence: boolean,
): (Finding & { _priority: number; _first: number })[] {
  const out: (Finding & { _priority: number; _first: number })[] = [];
  for (const rule of rules) {
    const m = rule.match(ctx);
    if (!m || m.evidence.length === 0) continue; // evidence-first: no evidence, no finding
    let confidence = m.confidence ?? rule.confidence;
    if (downgradeConfidence) confidence = downgrade(confidence);
    const evidence = [...m.evidence].sort((a, b) => a.line - b.line).slice(0, MAX_EVIDENCE);
    out.push({
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      kind: rule.kind,
      confidence,
      explanation: rule.explain(m),
      suggestions: rule.suggest(m).slice(0, 3),
      step: stepName,
      evidence,
      occurrences: m.occurrences ?? 1,
      _priority: rule.priority,
      _first: evidence[0]?.line ?? 0,
    });
  }
  return out;
}

export function rankFindings<T extends Finding & { _priority: number; _first: number }>(
  findings: T[],
): T[] {
  const sorted = [...findings].sort(
    (a, b) =>
      (a.kind === 'rootCause' ? 0 : 1) - (b.kind === 'rootCause' ? 0 : 1) ||
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      b._priority - a._priority ||
      a._first - b._first ||
      a.ruleId.localeCompare(b.ruleId),
  );
  // A symptom ("exit code 1") adds nothing when a root cause was found.
  return sorted.some((f) => f.kind === 'rootCause')
    ? sorted.filter((f) => f.kind === 'rootCause')
    : sorted;
}

function unknownFinding(windows: ErrorWindow[], stepName: string | null): Finding | null {
  if (windows.length === 0) return null;
  const isCandidate = (l: LogLine) => /error|fail|exception|fatal|denied|traceback/i.test(l.text);
  const best = [...windows].sort(
    (a, b) => b.lines.filter(isCandidate).length - a.lines.filter(isCandidate).length,
  )[0] as ErrorWindow;
  const lines = best.lines.slice(-10);
  return {
    ruleId: 'unknown',
    title: 'Cause not recognized',
    category: 'unknown',
    kind: 'symptom',
    confidence: 'low',
    explanation:
      'No rule recognized a cause. The log excerpt below is the most error-like part of the log; no cause is claimed.',
    suggestions: [
      'Read the excerpt above. For an AI-written explanation use --llm (use --show-prompt first to see exactly what would be sent).',
      'To request a new rule, export a redacted excerpt with --export-excerpt and attach it to an issue after reviewing it.',
    ],
    step: stepName,
    evidence: lines.map((l) => ({ line: l.n, text: l.text.slice(0, 300) })),
    occurrences: 1,
  };
}

/** Analyzes a raw log string. Pure and deterministic: no I/O, no clock, no randomness. */
export function analyzeLog(input: string, options: AnalyzeOptions = {}): AnalysisResult {
  const rules = options.rules ?? defaultRules;
  const normalizeOptions = options.maxLineLength ? { maxLineLength: options.maxLineLength } : {};
  const normalized = normalizeLog(input, normalizeOptions);
  const redacted =
    options.redact === false
      ? { lines: normalized.lines, count: 0, byKind: {} }
      : redactLines(normalized.lines, { pii: options.redactPii ?? false });
  const log = { ...normalized, lines: redacted.lines };
  const seg = segmentLog(log);
  const windows = extractWindows(log, seg, options.extract);

  const stepName = seg.failedStep?.name ?? null;
  const scoped: RuleContext = {
    lines: seg.failedStep
      ? log.lines.slice(seg.failedStep.startIndex, seg.failedStep.endIndex + 1)
      : log.lines,
    step: seg.failedStep as Step | null,
    format: seg.format,
  };
  let found = runRules(rules, scoped, stepName, false);
  if (seg.failedStep && !found.some((f) => f.kind === 'rootCause')) {
    // No root cause in the failed step: it may be earlier in the log (or step detection was off).
    // Such findings are reported with lowered confidence and without a step name.
    const have = new Set(found.map((f) => f.ruleId));
    const wider = runRules(rules, { lines: log.lines, step: null, format: seg.format }, null, true);
    found = [...found, ...wider.filter((f) => f.kind === 'rootCause' && !have.has(f.ruleId))];
  }

  const ranked = rankFindings(found);
  const maxFindings = options.maxFindings ?? 3;
  let findings: Finding[] = ranked.slice(0, maxFindings).map((f) => {
    const { _priority: _p, _first: _f, ...rest } = f;
    return rest;
  });
  if (findings.length === 0) {
    const unknown = unknownFinding(windows, stepName);
    if (unknown) findings = [unknown];
  }

  return {
    format: seg.format,
    failedStep: stepName,
    exitCode: seg.exitCode,
    truncated: options.inputTruncated ?? false,
    warnings: log.warnings,
    redactions: { count: redacted.count, byKind: redacted.byKind },
    findings,
    totalFindings: ranked.length,
    windows,
    stats: {
      originalLines: log.originalLineCount,
      analyzedLines: log.lines.length,
      collapsedLines: log.collapsedLineCount,
    },
  };
}
