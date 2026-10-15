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
