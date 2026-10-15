import type { AnalysisResult } from './analyze.js';
import { ReportSchema, SCHEMA_VERSION, type LlmSection, type Report } from './schema.js';

export interface ReportContext {
  toolVersion: string;
  sourceKind: 'file' | 'stdin' | 'github-run';
  llm?: LlmSection;
  extraWarnings?: string[];
}

/** Builds the versioned, validated report from an analysis result. */
export function buildReport(result: AnalysisResult, ctx: ReportContext): Report {
  const report: Report = {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: 'ci-explain', version: ctx.toolVersion },
    source: { kind: ctx.sourceKind, format: result.format },
    failedStep: result.failedStep,
    exitCode: result.exitCode,
    truncated: result.truncated,
    warnings: [...result.warnings, ...(ctx.extraWarnings ?? [])],
    redactions: { count: result.redactions.count },
    findings: result.findings.map((f) => ({
      ruleId: f.ruleId,
      title: f.title,
      category: f.category,
      confidence: f.confidence,
      explanation: f.explanation,
      suggestions: f.suggestions,
      step: f.step,
      job: f.job ?? null,
      evidence: f.evidence,
      occurrences: f.occurrences,
    })),
    llm: ctx.llm ?? { used: false },
  };
  return ReportSchema.parse(report);
}
