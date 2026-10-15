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
