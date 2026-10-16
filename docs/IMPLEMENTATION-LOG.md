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

## Stage 4 — secret redaction (2026-10-15)

- `src/core/redact.ts`: GitHub tokens (ghp/gho/ghu/ghs/ghr/github_pat), AWS access key IDs (AKIA/ASIA),
  npm, Slack, Google API, Stripe-style keys, Azure `AccountKey=`/`sig=`, JWT, Authorization/Bearer,
  URL credentials, secret-looking KEY=value / JSON pairs, multi-line private key blocks, optional PII (e-mail, IPv4).
- Checked against GitHub docs (2026-10-15): token prefixes are documented but no fixed length, and
  installation tokens may be JWT-shaped (`ghs_APPID_JWT`), so the pattern accepts variable length.
  The AWS docs page fetched did not state the AKIA/ASIA prefixes; they are widely documented
  conventions but were not re-verified here. npm/Slack/Google/Stripe patterns follow vendor
  conventions and are not verified against vendor docs.
- Redaction runs on normalized lines BEFORE rules, extraction, and any output, so findings, evidence,
  excerpts and AI prompts never contain raw values. Only counts (`redactions.count`, `byKind`) are reported.
- Tests build fake secrets by concatenation; a repository scan test asserts no ready-made secret
  strings (strict kinds) and no `.env` files exist. `npm test`: 423 passed.

## Stage 5 — CLI and output formats (2026-10-15)

- `ci-explain <file|->` with `--format text|markdown|json`, `--max-findings`, `--max-bytes`,
  `--no-color`/`NO_COLOR`, `--no-redact` (text only, warns), `--redact-pii`, `--export-excerpt`, `--force`,
  `--help`, `--version`. Exit codes 0/1/2/3 (4 and 5 arrive with the GitHub and AI stages).
- `node:util parseArgs` is used: Node docs history says "The API is no longer experimental" since v20.0.0
  (stability line itself not shown in the fetched page; checked 2026-10-15).
- Input is read as a stream keeping only the last `--max-bytes` (default 32 MiB); the tail is analyzed,
  `truncated: true` is set, and line numbers still refer to the original input.
- JSON output is validated by a Zod schema (`schemaVersion: 1`). Markdown is escaped (formatting, HTML,
  images, @mentions, #123, autolinks), evidence lives in a fence longer than any backtick run in the
  content, size is capped at 1,000,000 bytes (GitHub documents 1 MiB per step for job summaries).
- Excerpts are always redacted (even with `--no-redact`), carry a "review before sharing" header and never
  overwrite files without `--force`.
- CLI verified from a packed tarball installed into a clean temp dir (help, version, analysis, stdin, exit codes).
- Entry point split: `src/cli/main.ts` (bin) and `src/cli/run.ts` (testable), because a symlinked bin
  breaks "am I the entry module" checks.

## Stage 6 — optional AI layer (2026-10-15)

- Off by default; `--llm` needs `CI_EXPLAIN_LLM_API_KEY` (env only), `--llm-base-url` and `--llm-model`
  (or the matching env vars). Missing pieces fail with exit 2, never silently.
- `--show-prompt` prints the exact redacted messages and sends nothing (tested with a stubbed global fetch).
- Prompt: system instructions are separate from the untrusted log; the log sits between fixed markers
  (forged markers are neutralized); only redacted error windows + rule ids/titles/line numbers are included;
  a second redaction pass runs over the final text; input/output budgets are configurable.
- Model output must be JSON validated by Zod; anything else is discarded. Text is stripped of HTML, images,
  links, control chars, mentions and issue refs; suggestions are shown as "suggestion, not executed".
- Reliability: timeout (no retry), retry only 429/5xx/network (2 retries, backoff), 401/403 no retry;
  errors carry fixed messages (no key, headers, prompt or body); failures degrade to layer-1 output
  (`--llm-required` makes it exit 5).
- ALL AI tests use mocks. No real provider call was made; no compatibility is claimed.

## Stage 7 — GitHub source and workflow example (2026-10-15)

- `ci-explain github --repo owner/name --run <id>` (token from `GITHUB_TOKEN` only). Official REST endpoints
  checked 2026-10-15: list jobs for a run, download job logs (302 to a link that expires after 1 minute),
  `X-GitHub-Api-Version: 2026-03-10`. Redirects are manual; the token is never sent to another host
  (tested with two local servers); http allowed only for localhost; size caps, timeouts, 401/403/404/410,
  primary/secondary rate limits, expired logs. Failed jobs are analyzed separately (default max 3) and merged;
  each finding carries its job name because line numbers refer to that job's log.
- Log retention verified in GitHub docs: 90 days by default, 1 to 400 days for private repositories.
- Job summary limit verified in GitHub docs: 1 MiB per step; Markdown output capped at 1,000,000 bytes.
- Example workflow validated as YAML and by tests (minimal permissions, pinned SHAs, no event data in `run:`,
  no PR checkout). NOT run in a real repository: marked "needs manual verification". `yaml` added as a dev dependency
  (ISC, no dependencies) for those tests.
- All GitHub tests use local mock HTTP servers; no real GitHub request was made by the tool.

## Stage 8 — complete rule catalog, contributor docs, performance (2026-10-15)

- Catalog now has 34 rules, covering every item of the target list. New ones: pnpm/yarn frozen lockfile,
  engines, node-gyp, pip, Docker (build failed, rate limit, COPY not found), exit 137, job timeout,
  job canceled, network codes, GitHub API rate limit, git permission denied, checkout/submodule, missing env.
- Real local output used for pnpm 10, Yarn 1.22, npm engine-strict, pip, git. Real output revealed wording
  differences from memory (for example Yarn: "was run with", not "was executed with"). Docker, node-gyp
  and others could not be reproduced here; they are marked unverified and capped at medium confidence.
- Added `defineLineRule` helper, docs/WRITING-RULES.md, issue templates (bug, new-rule-request,
  false-positive), PR template.
- Performance measured and recorded in DECISIONS (D-008); regression test added.
- `npm test`: 835 passed. `npm run eval`: 34 rules, 0 missed, 0 false positives (synthetic fixtures).

## Stage 9 — end-to-end run (2026-10-15/16)
Automatically verified (from the packed tarball installed into a clean temp dir): `--help`, `--version`,
every positive fixture of every rule, stdin, exit codes 2/3, empty/whitespace/binary/huge (40 MB) input,
no-network guarantee (fetch and sockets booby-trapped via `node --import`), `--show-prompt` sends nothing,
`npm pack` contents. Local mock servers cover the GitHub source. No real GitHub or LLM call was made.
Found in a clean clone: `.gitignore` excluded `*.log`, so no fixture was ever committed (fixed with a
negation rule); process-spawning tests needed longer timeouts (`vitest.config.ts`).
Found while generating the README example: a bug in the TypeScript rule (file name kept the "(12,7):"
suffix, so "files" was over-counted); fixed and covered by a test.
Commit: `test: add end-to-end and failure-path coverage` (+ fixes above).

## Stage 10 — documentation (2026-10-16)
README (example output generated by the tool and checked by a test), ARCHITECTURE, PRIVACY, SECURITY,
GITHUB-ACTIONS, WRITING-RULES, TROUBLESHOOTING, ROADMAP, RULES (generated), PR/issue templates, Dependabot.
Packaged `files` limited to dist, README, LICENSE, CHANGELOG and the user-facing docs.
