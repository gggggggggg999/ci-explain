export type Confidence = 'high' | 'medium' | 'low';

/** One logical log line after normalization. `n` is the 1-based line number in the ORIGINAL input. */
export interface LogLine {
  n: number;
  text: string;
  /** How many identical consecutive lines were collapsed into this one (1 = no collapse). */
  repeat: number;
  /** Step name hint when the input carries it (`gh run view --log-failed` format). */
  stepHint?: string;
}

export interface NormalizeOptions {
  /** Longer lines are truncated (before any regex runs). Default 2000. */
  maxLineLength?: number;
}

export interface NormalizedLog {
  lines: LogLine[];
  originalLineCount: number;
  hadTimestamps: boolean;
  hadGhPrefix: boolean;
  truncatedLineCount: number;
  /** Lines dropped by collapsing long homogeneous runs (identical repeats are kept as `repeat`). */
  collapsedLineCount: number;
  warnings: string[];
}

export type LogFormat = 'github-actions' | 'generic';

export interface Step {
  name: string;
  /** Inclusive indexes into NormalizedLog.lines. */
  startIndex: number;
  endIndex: number;
  /** Original line numbers of the first and last line of the step. */
  startLine: number;
  endLine: number;
  failed: boolean;
}

export interface Segmentation {
  format: LogFormat;
  steps: Step[];
  failedStep: Step | null;
  exitCode: number | null;
}

export interface ErrorWindow {
  startLine: number;
  endLine: number;
  lines: LogLine[];
  stepName: string | null;
}

export interface Evidence {
  line: number;
  text: string;
}

export type Ecosystem = 'node' | 'python' | 'docker' | 'infra' | 'generic';
export type Category =
  | 'dependency'
  | 'test'
  | 'build'
  | 'lint'
  | 'type-check'
  | 'config'
  | 'permission'
  | 'network'
  | 'resource'
  | 'unknown';
export type RuleKind = 'rootCause' | 'symptom';

export interface RuleContext {
  /** Lines to search: the failed step if known, otherwise the whole log. */
  lines: LogLine[];
  step: Step | null;
  format: LogFormat;
}

export interface RuleMatch {
  evidence: Evidence[];
  captures: Record<string, string>;
  /** How many similar problems were folded into this match (cascade collapse). */
  occurrences?: number;
  /** Overrides the rule's default confidence (for example when the message is less specific). */
  confidence?: Confidence;
}

export interface Rule {
  id: string;
  title: string;
  ecosystem: Ecosystem;
  category: Category;
  kind: RuleKind;
  /** Higher wins when confidence ties. */
  priority: number;
  confidence: Confidence;
  /** Date the message format was checked against real tool output or documentation; null if not verified. */
  verifiedOn: string | null;
  sourceNote: string;
  match(ctx: RuleContext): RuleMatch | null;
  explain(m: RuleMatch): string;
  suggest(m: RuleMatch): string[];
}

export interface Finding {
  ruleId: string;
  title: string;
  category: Category;
  kind: RuleKind;
  confidence: Confidence;
  explanation: string;
  suggestions: string[];
  step: string | null;
  evidence: Evidence[];
  occurrences: number;
}
