# Decisions

## D-001. Competitor research (checked 2026-10-15)

Method: web search on 2026-10-15; results are secondary summaries and
were not verified in depth. Maintenance status and accuracy of the small
projects were NOT verified.

| Tool                           | What it does (per its listing)                                                                    | Source                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GitHub Copilot "Explain error" | Built into GitHub UI; explains one failed Actions job at a time; counts toward Copilot chat quota | https://github.blog/changelog/2025-01-15-copilot-users-can-ask-about-a-failed-actions-job-ga                             |
| WhyCI                          | Deterministic CI failure analysis; scores error-like lines (local prototype per its README)       | https://github.com/preet18chaudhary-arch/WhyCI                                                                           |
| ci-why                         | Cleans a log and sends an excerpt to the Anthropic API; has a PR-comment Action mode              | https://dev.to/ciwhy-tool/i-built-a-cli-that-reads-your-broken-ci-log-and-tells-you-why-it-failed-in-plain-english-3bkd  |
| FaultLens                      | "Local-first, explainable log incident diagnosis"                                                 | https://github.com/MangoGreenTeaz/FaultLens                                                                              |
| gh run view --log-failed       | Raw failed-step logs, no explanation                                                              | https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/using-workflow-run-logs |

### Honest differentiation (planned, not yet implemented)

- Offline deterministic core with a rule catalog; AI is opt-in.
- Evidence-first: every finding cites original log line numbers.
- Secret redaction before any output / AI call, plus `--show-prompt`.
- Community-extensible rule catalog with fixtures.

### Where ci-explain is weaker

- Built-in Copilot feature has no setup and sees the full GitHub context.
- Rule catalog starts small (~25 rules); unknown failures get "not recognized".
- Step-aware parsing for GitHub Actions only in v0.1.0.
- No accuracy data on real logs yet.

Conclusion: niche overlaps with other small tools, but the combination
above is a defensible focus. No blocker.

## D-002. Name availability (checked 2026-10-15)

- npm `ci-explain`: 404 (free). GitHub repo search: no repo named `ci-explain`.
- Alternatives free on npm if needed: `ci-failure-explainer`, `logwhy`, `failwhy`.
  (`ci-why` is taken.)

## D-003. Node.js

- Local: Node v22.12.0, npm 10.9.0.
- Schedule per secondary sources (to verify against the official
  nodejs/Release schedule before setting `engines`): Node 22 maintenance until
  2027-04-30, Node 24 LTS, Node 20 EOL. `engines` will list only versions
  actually run in CI.
- `node:util parseArgs` exists in local Node 22 (typeof = function); stability
  status to be checked in docs.

## D-004. Argument parser

`node:util parseArgs` is used (no dependency). Node docs history: "v20.0.0: The API is no longer
experimental." (https://nodejs.org/docs/latest-v22.x/api/util.html, checked 2026-10-15; the fetched page did
not show a stability line, so only the history entry is relied on). `engines` is >= 22.12.0.

## D-005. Build

Plain `tsc` (ESM only, `NodeNext`). tsup 9 requires Node >= 22.18 but CI also runs 22.12.0; a bundler adds
nothing for a CLI with one runtime dependency. TypeScript is pinned to 6.0.3 because typescript-eslint 8.71.2
declares support for `typescript <6.1.0` (TypeScript 7 is the latest release).

## D-006. AI provider

One adapter: OpenAI-compatible chat completions (`POST {base}/chat/completions`, `Authorization: Bearer`,
`messages`, `choices[0].message.content`). The official OpenAI API reference pages could not be fetched on
2026-10-15 (HTTP 403/404), so the request shape rests on the widely used chat-completions contract and
secondary sources confirming that `max_tokens` is deprecated in favor of `max_completion_tokens`
(compatible servers may only know `max_tokens`, hence `--llm-max-tokens-param`).
Not verified with a real provider: documentation says "should work, untested".
No default base URL and no default model: the user must choose where the redacted excerpt goes.
Redirects are never followed, so the API key can only reach the configured host.
