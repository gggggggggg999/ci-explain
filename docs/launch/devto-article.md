# How I built ci-explain: an evidence-first CI log explainer

Draft for dev.to. All code below is from the repository
(https://github.com/gggggggggg999/ci-explain). Publishing is up to the owner.

CI failures are rarely mysterious, but the answer is buried in thousands of lines. I wanted a tool that
says what failed and **shows the lines that prove it**, works offline, and only uses AI if I ask.

## Principle 1: evidence first

A rule must return the log lines it relied on, or nothing. The analyzer drops any match without evidence:

```ts
const m = rule.match(ctx);
if (!m || m.evidence.length === 0) continue; // evidence-first: no evidence, no finding
```

And when nothing matches, the tool does not invent a cause. It returns an `unknown` finding with the most
error-like window of the log and says "No rule recognized a cause".

## Principle 2: keep the original line numbers

Normalization removes ANSI codes, CRLF, `\r` progress-bar overwrites and timestamps, and collapses repeats,
yet evidence must still point at the real line in the real file. Every normalized line carries its original number:

```ts
export interface LogLine {
  n: number; // 1-based line number in the ORIGINAL input
  text: string;
  repeat: number; // identical consecutive lines collapsed into this one
}
```

Even when a 200 MB log is cut to its last 32 MiB, the reader tracks how many lines it dropped, so evidence
line numbers still refer to the original input. A test fixes this with a 40 MB input.

## Principle 3: cascades become one finding

One missing type can produce dozens of TypeScript errors. The TypeScript rule folds them into a single finding
with a counter and the first three lines as evidence, instead of printing 60 lines. Symptoms like "Process
completed with exit code 1" are ranked below root causes and hidden when a root cause exists.

## Secret redaction, and why fake tokens are built in tests

Logs contain secrets, and redaction runs before analysis, so findings, excerpts and AI prompts never contain
raw values. Only counts are reported. To test it without committing anything that looks like a secret (GitHub's
push protection and scanners would flag it), fake tokens are assembled at runtime:

```ts
const fake = {
  ghp: 'gh' + 'p_' + 'x'.repeat(36),
  aws: 'AK' + 'IA' + 'ABCDEFGH12345678',
};
```

A test scans the whole repository with the redactor itself and fails if a ready-made secret string exists.
Pattern-based redaction cannot catch everything, so the docs say so, and `--show-prompt` exists so that you
can read what would be sent.

## Logs are untrusted input

A pull request author controls the log. So: nothing from a log is executed or put in a shell; every regex is
simple and anchored; lines are truncated before regexes run; and a test throws pathological lines at every
rule under a time limit. For the AI layer, the log sits between fixed markers in a separate message, the
model must answer in a strict JSON shape validated with Zod, and the output is stripped of HTML, links and
mentions:

```ts
.replace(/<[^>]{0,500}>/g, '')
.replace(/\b(?:https?|ftp):\/\/\S{1,500}/gi, '[link removed]')
.replace(/@(?!​)/g, `@${ZWSP}`)
```

A prompt cannot remove all prompt-injection risk, so the model gets no tools and cannot act.

## Safe output for job summaries

The Markdown renderer escapes prose, neutralizes `@mentions` and `#123`, and puts evidence in a code fence
longer than any backtick run inside the content, so a hostile log cannot close the fence:

```ts
export function fence(text: string, info = ''): string {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const marks = '`'.repeat(Math.max(3, longest + 1));
  return `${marks}${info}\n${text}\n${marks}`;
}
```

Output is capped below the 1 MiB per-step job summary limit documented by GitHub.

## What I learned from real output

Rules written from memory were wrong in small ways. Running the real tools showed that npm's message for a
missing lockfile differs from what I remembered, and that Yarn says "was run with", not "was executed with".
Looking at a real GitHub Actions log also showed that `##[group]` appears _inside_ steps, so steps start at
`##[group]Run ` lines. Rules whose format I could not reproduce are labeled unverified and capped at medium
confidence.

## Honest limits

34 rules, tested on hand-written fixtures and locally reproduced output. No accuracy numbers, because I do not
have a set of real logs. The GitHub-run source and AI layer are tested with mocks only.

Which failures should it explain next? Tell me in an issue.
