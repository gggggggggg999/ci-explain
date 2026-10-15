import type { Report } from '../core/schema.js';

const CODES = { bold: '1', dim: '2', red: '31', yellow: '33', green: '32', cyan: '36' } as const;

export function makeStyle(color: boolean) {
  const wrap = (code: string, s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  return {
    bold: (s: string) => wrap(CODES.bold, s),
    dim: (s: string) => wrap(CODES.dim, s),
    confidence: (c: 'high' | 'medium' | 'low') =>
      wrap(c === 'high' ? CODES.green : c === 'medium' ? CODES.yellow : CODES.red, `[${c}]`),
    cyan: (s: string) => wrap(CODES.cyan, s),
  };
}

export function renderText(report: Report, options: { color: boolean }): string {
  const s = makeStyle(options.color);
  const out: string[] = [];
  out.push(s.bold(`ci-explain ${report.tool.version}`) + s.dim(` — ${report.source.format} log`));
  if (report.failedStep) {
    const code = report.exitCode !== null ? ` (exit code ${report.exitCode})` : '';
    out.push(`Failed step: ${report.failedStep}${code}`);
  }
  if (report.truncated) {
    out.push(
      s.dim('Note: the input was larger than --max-bytes; only the end of it was analyzed.'),
    );
  }
  for (const w of report.warnings) out.push(s.dim(`Warning: ${w}`));
  out.push('');

  if (report.findings.length === 0) {
    out.push('No error lines found in the log.');
  }
  report.findings.forEach((f, i) => {
    const count = f.occurrences > 1 ? ` (${f.occurrences} occurrences)` : '';
    out.push(`${i + 1}. ${s.confidence(f.confidence)} ${s.bold(f.title)}${count}`);
    out.push(
      `   ${s.dim(f.ruleId)}${f.job ? s.dim(` · job: ${f.job}`) : ''}${f.step ? s.dim(` · step: ${f.step}`) : ''}`,
    );
    out.push(`   ${f.explanation}`);
    out.push('   Evidence (line numbers refer to the original log):');
    const width = String(Math.max(...f.evidence.map((e) => e.line))).length;
    for (const e of f.evidence) {
      out.push(`     ${s.cyan(String(e.line).padStart(width))} | ${e.text}`);
    }
    if (f.suggestions.length > 0) {
      out.push('   Suggestions (text only, nothing is executed):');
      for (const sug of f.suggestions) out.push(`     - ${sug}`);
    }
    out.push('');
  });

  if (report.llm.used) {
    out.push(s.bold('AI explanation') + s.dim(' (AI-generated, may be wrong; untrusted text)'));
    if (report.llm.provider) out.push(s.dim(`   provider: ${report.llm.provider}`));
    if (report.llm.summary) out.push(`   ${report.llm.summary.split('\n').join('\n   ')}`);
    if (report.llm.likelyCause) out.push(`   Likely cause: ${report.llm.likelyCause}`);
    if (report.llm.suggestions && report.llm.suggestions.length > 0) {
      out.push('   Suggestions (AI-generated; suggestion, not executed):');
      for (const sug of report.llm.suggestions) out.push(`     - ${sug}`);
    }
    out.push('');
  } else if (report.llm.unavailableReason) {
    out.push(s.dim(`AI layer unavailable: ${report.llm.unavailableReason}`));
    out.push('');
  }
  if (report.redactions.count > 0) {
    out.push(s.dim(`${report.redactions.count} value(s) redacted before analysis.`));
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}
