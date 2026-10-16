# Architecture

```
src/
  core/   pure functions: strings in, structures out (no fs, no network, no clock, no randomness)
    normalize.ts  ANSI, CRLF, \r overwrites, BOM, timestamps, repeats, line truncation; keeps original line numbers
    redact.ts     secret redaction (runs before everything else)
    segment.ts    GitHub Actions steps and failed-step detection, or generic mode
    extract.ts    error windows around candidate lines plus the tail of the failed step
    analyze.ts    runs rules, ranks, folds symptoms, builds the "unknown" finding
    merge.ts      combines per-job results of a GitHub run
    schema.ts     Zod schema of the JSON output (schemaVersion 1)
    report.ts     AnalysisResult -> validated Report
    excerpt.ts    redacted excerpt for bug reports
  rules/  the catalog (one TypeScript object per rule) and the registry with Zod metadata validation
  llm/    provider interface, one OpenAI-compatible adapter, prompt builder, output sanitizer
  io/     file/stdin reading with size limits, GitHub API source, safe file writing
  cli/    argument parsing, renderers (text, markdown, json), run() and the bin entry
```

The core is deterministic: the same log and version produce byte-identical layer-1 output. All side effects
live in `io/` and `cli/`, so the core can later be used as a library and tested without mocks.

## Pipeline

read (bounded tail) -> normalize -> redact -> segment -> extract windows -> rules -> rank -> (optional AI)
-> render.

## GitHub Actions log format and the step heuristic

Observed on a real public failed run (read-only, nothing copied), checked 2026-10-15:

- The first line may start with a UTF-8 byte-order mark.
- Every line is prefixed with `YYYY-MM-DDThh:mm:ss.fffffffZ ` (a space follows).
- Groups are `##[group]Title` ... `##[endgroup]`. Groups are also used for sub-sections **inside** a step
  (for example inside the checkout action), so a group does not necessarily start a step.
- Failures end with `##[error]Process completed with exit code N.`
- `gh run view --log-failed` prefixes lines with `<job>\t<step>\t` (the step is sometimes `UNKNOWN STEP`).

The official workflow-commands documentation describes `::group::`, `::error::` and masking but does not
describe the raw `##[...]` rendering, so this format knowledge comes from observation, not documentation.

Heuristic used by `segment.ts`:

1. A user step starts at a `##[group]Run ...` line. `Post job cleanup.` and `Cleaning up orphan processes`
   start the closing phases. Lines before the first step belong to "Set up job".
2. The failed step is the one containing the **last** `##[error]Process completed with exit code N.`; if none
   exists, the one containing the last `##[error]` line.
3. If the log has no `##[group]`, `##[endgroup]` or `##[error]` lines, it is analyzed in generic mode
   (`source.format: "generic"`), with no steps.

Rules first search the failed step; if no root cause is found there, they search the whole log and the result
is reported with confidence lowered by one level and without a step name.

## Ranking

Root causes before symptoms, then confidence, then rule priority, then position. A symptom such as the generic
exit-code message is dropped when a root cause exists. Cascades are folded inside the rules (for example all
TypeScript errors become one finding with a counter and the first three lines as evidence).

## Confidence

Each rule has a default confidence and may lower it per match. `high` means the message is specific and was
checked against real tool output; `medium` means the message is specific but the format was not verified or
the cause cannot be established from the log alone; `low` means a hint only. See `verifiedOn` and
`sourceNote` per rule in [RULES.md](RULES.md).
