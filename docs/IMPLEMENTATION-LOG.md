# Implementation log

## Stage 0 — inspection, research (2026-10-15)

- Directory was empty. Not a git repository yet.
- Tools: node v22.12.0, npm 10.9.0, git 2.37.1, gh 2.102.0 (authenticated).
- npm name `ci-explain` free; no GitHub repo `ci-explain`.
- Competitor research recorded in DECISIONS.md.
- Waiting for owner answers to the Stage 0 question batch.

## Owner answers (2026-10-15)

- Name `ci-explain`, GitHub `gggggggggg999/ci-explain`, public: confirmed.
- License author: Myrza Dokturbekov (confirmed). Git identity: `Myrza Dokturbekov`
  with GitHub noreply address.
- Security contact: GitHub private vulnerability reporting (owner delegated the choice).
- LLM provider: not chosen yet, so the AI layer will be verified with mocks only.
- No real failed logs available; rules are verified against synthetic fixtures and
  real output of locally installed tools where possible.

## Stage 1 — foundation (2026-10-15)

- TypeScript 6.0.3 (typescript-eslint 8.71.2 requires TS < 6.1; TS 7 is not yet supported),
  Vitest 5.0.4, ESLint 10.12.0, Prettier 3.9.10, Zod 4.6.7 (only runtime dependency), tsx for scripts.
- Build with plain `tsc` (no bundler): tsup 9 requires Node >= 22.18 while CI also runs 22.12.
- Checks run: lint, format:check, typecheck, test, build: all passed. Commit `chore: initialize TypeScript project`.

## Stage 2 — normalization and segmentation (2026-10-15)

- Real GitHub Actions log format observed on a public failed run (read-only, nothing copied):
  UTF-8 BOM on the first line, `YYYY-MM-DDThh:mm:ss.fffffffZ ` prefix, `##[group]`/`##[endgroup]`,
  `##[error]Process completed with exit code N.`; `gh run view --log-failed` adds `job\tstep\t`.
  `##[group]` also marks sub-sections inside a step, so steps start at `##[group]Run ` lines only.
- Tests: 20 passing (normalize, segmentation, extraction, determinism, pathological input timing).

## Stage 3 — rules and ranking (2026-10-15)
- 18 rules so far (node/npm, TypeScript, ESLint, Prettier, Jest/Vitest, pytest, import errors,
  Node heap OOM, disk full, GitHub token permissions, exit-code symptom). Remaining rules from the
  target catalog are scheduled for Stage 8.
- Message formats were captured from real local runs (npm 10.9.0, tsc 6.0.3, ESLint 10.12.0,
  Prettier 3.9.10, Vitest 5.0.4, Node 22, pytest 9.1.1 on Python 3.14) and anonymized; rules whose
  format could not be checked say so in `sourceNote` and have `verifiedOn: null`.
- Real run found a wrong assumption: the npm message for a missing lockfile is
  "The `npm ci` command can only install with an existing package-lock.json" (fixed in the rule).
- Ranking: root causes first, then confidence, priority, position; the exit-code symptom is dropped
  when a root cause exists; findings outside the failed step get confidence lowered by one level.
- Every fixture is tested in 6 variants (clean, ANSI, CRLF, timestamps, group, full GitHub-like).
- `npm test`: 397 passed. `npm run eval`: 18 rules, 0 missed, 0 false positives (synthetic fixtures only).
- `npm run docs:check`: RULES.md in sync.
