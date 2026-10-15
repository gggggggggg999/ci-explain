import type { LogLine, NormalizedLog, NormalizeOptions } from './types.js';

export const DEFAULT_MAX_LINE_LENGTH = 2000;

// CSI sequences and OSC sequences (terminated by BEL or ST). Linear-time, no nested quantifiers.
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// C0 control characters except TAB (LF/CR are handled before this runs), plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
// 2025-01-31T12:34:56.1234567Z  (format observed in real GitHub Actions job logs)
const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z ?/;
// `gh run view --log-failed` prefixes lines with "<job>\t<step>\t".
const GH_TAB_PREFIX = /^([^\t]{0,200})\t([^\t]{0,200})\t/;
const NPM_WARN = /^npm (?:warn|WARN)\b/;
const NPM_WARN_RUN_THRESHOLD = 10;
const NPM_WARN_KEEP = 3;

function cleanRawLine(raw: string, index: number, maxLen: number): { text: string; cut: boolean } {
  let line = raw;
  if (index === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
  if (line.includes('\r')) {
    // Progress bars overwrite the line with \r: keep the last non-empty version.
    const parts = line.split('\r');
    let last = '';
    for (const part of parts) if (part.length > 0) last = part;
    line = last;
  }
  let cut = false;
  if (line.length > maxLen) {
    const dropped = line.length - maxLen;
    line = `${line.slice(0, maxLen)} …[truncated ${dropped} chars]`;
    cut = true;
  }
  line = line.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(CONTROL_CHARS, '');
  return { text: line, cut };
}

/**
 * Normalizes a raw log. Original line numbers are preserved so evidence can point at the source file.
 * Pure function: no I/O.
 */
export function normalizeLog(input: string, options: NormalizeOptions = {}): NormalizedLog {
  const maxLen = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const warnings: string[] = [];
  const firstLine = options.firstLineNumber ?? 1;

  const rawLines = input.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

  if (input.includes('\u0000') || countReplacementChars(input) > input.length * 0.05) {
    warnings.push('Input looks binary or is not valid UTF-8; results may be unreliable.');
  }

  let truncatedLineCount = 0;
  const cleaned: { n: number; text: string }[] = [];
  rawLines.forEach((raw, i) => {
    const { text, cut } = cleanRawLine(raw, i, maxLen);
    if (cut) truncatedLineCount++;
    cleaned.push({ n: i + firstLine, text });
  });

  const nonEmpty = cleaned.filter((l) => l.text.trim() !== '');

  // Optional `gh run view --log-failed` prefix.
  const prefixed = nonEmpty.filter((l) => GH_TAB_PREFIX.test(l.text)).length;
  const hadGhPrefix = nonEmpty.length > 0 && prefixed >= nonEmpty.length * 0.5;
  const stepHints = new Map<number, string>();
  if (hadGhPrefix) {
    for (const l of cleaned) {
      const m = GH_TAB_PREFIX.exec(l.text);
      if (m) {
        const step = (m[2] ?? '').trim();
        if (step && step !== 'UNKNOWN STEP') stepHints.set(l.n, step);
        l.text = l.text.slice(m[0].length);
      }
    }
  }

  // Timestamp prefixes: strip only if they dominate, so generic logs with leading dates stay intact.
  const stamped = nonEmpty.filter((l) => TIMESTAMP_PREFIX.test(l.text)).length;
  const hadTimestamps = nonEmpty.length > 0 && stamped >= nonEmpty.length * 0.5;
  if (hadTimestamps) {
    for (const l of cleaned) l.text = l.text.replace(TIMESTAMP_PREFIX, '');
  }

  // Collapse identical consecutive lines; drop blank lines.
  const lines: LogLine[] = [];
  for (const l of cleaned) {
    if (l.text.trim() === '') continue;
    const prev = lines[lines.length - 1];
    if (prev && prev.text === l.text) {
      prev.repeat++;
      continue;
    }
    const line: LogLine = { n: l.n, text: l.text, repeat: 1 };
    const hint = stepHints.get(l.n);
    if (hint) line.stepHint = hint;
    lines.push(line);
  }

  // Collapse long runs of `npm warn` noise: keep the first few lines of the run.
  const result: LogLine[] = [];
  let collapsedLineCount = 0;
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i] as LogLine;
    if (NPM_WARN.test(cur.text)) {
      let j = i;
      while (j < lines.length && NPM_WARN.test((lines[j] as LogLine).text)) j++;
      const runLength = j - i;
      if (runLength >= NPM_WARN_RUN_THRESHOLD) {
        for (let k = i; k < i + NPM_WARN_KEEP; k++) result.push(lines[k] as LogLine);
        collapsedLineCount += runLength - NPM_WARN_KEEP;
        i = j;
        continue;
      }
    }
    result.push(cur);
    i++;
  }

  return {
    lines: result,
    originalLineCount: rawLines.length + firstLine - 1,
    hadTimestamps,
    hadGhPrefix,
    truncatedLineCount,
    collapsedLineCount,
    warnings,
  };
}

function countReplacementChars(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) count++;
  return count;
}
