import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const EvidenceSchema = z.object({
  line: z.number().int().positive(),
  text: z.string(),
});

const FindingSchema = z.object({
  ruleId: z.string(),
  title: z.string(),
  category: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  explanation: z.string(),
  suggestions: z.array(z.string()),
  step: z.string().nullable(),
  /** Set for GitHub runs: evidence line numbers refer to this job's log. */
  job: z.string().nullable(),
  evidence: z.array(EvidenceSchema),
  occurrences: z.number().int().positive(),
});

export const LlmSectionSchema = z.object({
  used: z.boolean(),
  provider: z.string().optional(),
  model: z.string().optional(),
  summary: z.string().optional(),
  likelyCause: z.string().optional(),
  /** Model-suggested actions. Text only: never executed. */
  suggestions: z.array(z.string()).optional(),
  /** Always present when `used` is true: the text is untrusted model output. */
  notice: z.string().optional(),
  /** Why the AI layer produced nothing (never contains keys or prompts). */
  unavailableReason: z.string().optional(),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  tool: z.object({ name: z.literal('ci-explain'), version: z.string() }),
  source: z.object({
    kind: z.enum(['file', 'stdin', 'github-run']),
    format: z.enum(['github-actions', 'generic']),
  }),
  failedStep: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
  redactions: z.object({ count: z.number().int().nonnegative() }),
  findings: z.array(FindingSchema),
  llm: LlmSectionSchema,
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportFinding = z.infer<typeof FindingSchema>;
export type LlmSection = z.infer<typeof LlmSectionSchema>;
