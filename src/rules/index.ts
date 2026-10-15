import { z } from 'zod';
import type { Rule } from '../core/types.js';
import {
  exitCodeSymptom,
  gitCheckout,
  gitPermissionDenied,
  missingEnv,
  tokenPermissions,
} from './generic/index.js';
import { dockerBuildFailed, dockerCopyNotFound, dockerRateLimit } from './docker/index.js';
import {
  diskFull,
  githubRateLimit,
  jobCancelled,
  jobTimeout,
  networkErrors,
  nodeHeapOom,
  oomExit137,
} from './infra/index.js';
import { eslintProblems, prettierCheck } from './node/lint.js';
import { moduleNotFound } from './node/module-not-found.js';
import { enginesMismatch, nodeGyp, pnpmLockfile, yarnLockfile } from './node/package-managers.js';
import { npmAuth, npmCiLockMismatch, npmE404, npmEacces, npmEresolve } from './node/npm.js';
import { testFailures, testSnapshot, testTimeout } from './node/tests.js';
import { typescriptErrors } from './node/typescript.js';
import { pipDependency, pythonImportError, pytestFailures } from './python/index.js';

const RuleMetaSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, 'id must be lower-case dotted'),
  title: z.string().min(5).max(120),
  ecosystem: z.enum(['node', 'python', 'docker', 'infra', 'generic']),
  category: z.enum([
    'dependency',
    'test',
    'build',
    'lint',
    'type-check',
    'config',
    'permission',
    'network',
    'resource',
    'unknown',
  ]),
  kind: z.enum(['rootCause', 'symptom']),
  priority: z.number().int().min(0).max(100),
  confidence: z.enum(['high', 'medium', 'low']),
  verifiedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  sourceNote: z.string().min(10),
});

const ALL_RULES: Rule[] = [
  npmEresolve,
  npmCiLockMismatch,
  moduleNotFound,
  npmE404,
  npmAuth,
  npmEacces,
  typescriptErrors,
  eslintProblems,
  prettierCheck,
  testFailures,
  testSnapshot,
  testTimeout,
  pythonImportError,
  pytestFailures,
  nodeHeapOom,
  diskFull,
  pnpmLockfile,
  yarnLockfile,
  enginesMismatch,
  nodeGyp,
  pipDependency,
  dockerBuildFailed,
  dockerRateLimit,
  dockerCopyNotFound,
  oomExit137,
  jobTimeout,
  jobCancelled,
  networkErrors,
  githubRateLimit,
  gitPermissionDenied,
  gitCheckout,
  missingEnv,
  tokenPermissions,
  exitCodeSymptom,
];

/** Validates rule metadata and id uniqueness. Throws on the first problem. */
export function validateRules(rules: Rule[]): Rule[] {
  const seen = new Set<string>();
  for (const rule of rules) {
    RuleMetaSchema.parse({
      id: rule.id,
      title: rule.title,
      ecosystem: rule.ecosystem,
      category: rule.category,
      kind: rule.kind,
      priority: rule.priority,
      confidence: rule.confidence,
      verifiedOn: rule.verifiedOn,
      sourceNote: rule.sourceNote,
    });
    if (seen.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
  }
  return rules;
}

export const rules: readonly Rule[] = validateRules(ALL_RULES);
