# Writing a rule in 15 minutes

Rules are plain TypeScript objects. A rule recognizes one kind of failure from the log lines and explains
it with the exact lines as evidence. Fixtures and the checks around them keep rules honest.

Principles (they are reviewed on every pull request):

1. **Evidence first.** A rule returns the log lines it relied on, or nothing. No evidence, no finding.
2. **Precision over recall.** It is better to miss a failure than to report a wrong cause. Prefer a
   specific message over a broad keyword.
3. **No invented facts.** `explain()` may only use the rule's own knowledge and values captured from the
   evidence lines. Do not claim anything the log does not show (for example, "the secret is empty").
4. **Use real output.** Run the tool yourself and copy its real message. If you cannot, set
   `verifiedOn: null`, say so in `sourceNote`, and keep `confidence` at `medium` or `low`.
5. **Logs are untrusted.** Never execute anything from a log. Keep regexes simple and anchored (a test
   throws pathological lines at every rule).

## 1. Get a real, anonymized sample

Run the failing tool, or use ci-explain to export an excerpt:

```bash
ci-explain build.log --export-excerpt excerpt.txt
```

Open `excerpt.txt` and **read it yourself** before sharing: redaction is pattern-based and can miss
secrets. Remove private names, paths and URLs. Replace them with neutral ones such as
`/home/runner/work/demo/demo` or `example.test`.

## 2. Write the rule

Most rules fire on one line and attach a few related lines. Use `defineLineRule`
([src/rules/helpers.ts](../src/rules/helpers.ts)):

```ts
import { defineLineRule } from '../helpers.js';

export const demoRule = defineLineRule({
  id: 'node.demo.thing', // lower-case, dotted, stable forever
  title: 'Demo tool: something failed',
  ecosystem: 'node', // node | python | docker | infra | generic
  category: 'build', // dependency | test | build | lint | type-check | config | permission | network | resource | unknown
  priority: 70, // 0-100; higher wins when confidence ties
  confidence: 'high', // high | medium | low
  verifiedOn: '2026-10-15', // date you checked the message against real output/docs, or null
  sourceNote: 'Checked against real demo-tool 1.2.3 output.', // or say what was NOT checked
  find: (text) => text.startsWith('demo-tool: fatal: '),
  captures: (line) => ({ detail: line.text.slice('demo-tool: fatal: '.length) }),
  explain: (m) => `demo-tool failed: ${m.captures.detail}.`,
  suggest: () => ['Run demo-tool locally to reproduce.'], // 1-3 text suggestions; never executed
});
```

Rules that must look at several lines can implement `match(ctx)` directly (see
[src/rules/node/npm.ts](../src/rules/node/npm.ts)). Whichever style you use:

- `kind: 'rootCause'` (default) for causes; `'symptom'` for things like "exit code 1" that only show up
  alongside a cause. Symptoms are hidden when a root cause is found.
- Fold cascades into one finding with `occurrences` (see the TypeScript rule) instead of reporting each line.
- Keep evidence short: the triggering line plus at most a few context lines.

Register it in [src/rules/index.ts](../src/rules/index.ts).

## 3. Add fixtures

Create `tests/fixtures/rules/<rule-id>/` with:

- `pos-1.log`, `pos-2.log` (at least two): logs that must trigger the rule, ideally in different shapes
  (for example an older and a newer message format).
- `neg-1.log` (at least one): similar-looking text that must **not** trigger it.

Fixtures must be synthetic or fully anonymized. Never commit real tokens, private repository names,
internal URLs, or personal data. If a test needs a fake secret, build it in test code
(`'ghp_' + 'x'.repeat(36)`) so that scanners do not flag the repository.

The test helper automatically wraps every fixture in six variants: plain, with ANSI colors, with CRLF,
with GitHub Actions timestamps, inside a step group, and a full GitHub-like log with a byte-order mark.
The rule must match (or must not match) in all of them, and the evidence line numbers must point at
the right original line.

## 4. Run the checks

```bash
npm run eval        # per-rule table: missed matches and false positives must be 0
npm test            # includes registry, fixture-variant, ReDoS, and "facts come from evidence" checks
npm run docs:gen    # regenerates docs/RULES.md from the registry
npm run lint && npm run format:check && npm run typecheck
```

`npm run docs:check` (also run in CI) fails if `docs/RULES.md` is out of date.

## 5. Open a pull request

Describe where the message format comes from (tool and version, or a documentation link) and how you
checked it. Rules you could not verify are welcome; they simply ship with lower confidence and an honest
`sourceNote`.

Passing the fixtures only shows the rule behaves as written. It says nothing about accuracy on real-world
logs, and the project does not claim any.
