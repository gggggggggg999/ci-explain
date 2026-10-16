# Privacy

CI logs can contain personal and confidential data. ci-explain is designed so that nothing leaves your
machine unless you explicitly ask for it, and so that you can see what would leave first.

There is **no telemetry, analytics, or hidden network call** in v0.1.0. Any future telemetry would have to be
documented here and be off by default.

| What is read                                                                         | Where it goes                                                                                                                                                                       | When                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| A log file or stdin                                                                  | Stays in memory on your machine; output goes to your terminal or a file you name                                                                                                    | Always                  |
| The excerpt file from `--export-excerpt`                                             | Written to the file you name (never overwrites without `--force`). Nothing is sent.                                                                                                 | With `--export-excerpt` |
| `GITHUB_TOKEN` and the run's job logs                                                | Token goes **only** to the GitHub API host (`api.github.com` or the `--github-api-url` you give). Logs are downloaded from the temporary URL GitHub returns, **without** the token. | `ci-explain github`     |
| Redacted error windows + rule finding ids/titles/line numbers + the failed step name | Sent over HTTPS to the `--llm-base-url` you choose, with your API key in the `Authorization` header. Never the whole log.                                                           | `--llm` only            |

`--show-prompt` prints the exact messages that `--llm` would send and sends nothing, even if a key is set.

## Secret redaction: what it is and what it is not

Redaction replaces matches of known patterns with markers like `[REDACTED:github-token]`: GitHub tokens,
AWS access key IDs, npm/Slack/Google/Stripe-style keys, Azure account keys and SAS signatures, JWTs,
`Authorization` headers, URL credentials, secret-looking `KEY=value` pairs, and private key blocks.
Optionally (`--redact-pii`) e-mail and IPv4 addresses. Values GitHub already masked (`***`) are left as they are.
Only the redaction type and a count are reported, never values.

**Redaction by pattern does not guarantee that every secret is removed.** A secret with an unusual format, a
password that is not in a `password=...` shape, or private data that is not a secret at all (customer names,
internal hostnames, file paths) can pass through. You are responsible for checking before you send anything to an
external service or publish an excerpt. That is why `--show-prompt` and the "review before sharing" header of
`--export-excerpt` exist.

Redaction runs on every output format; text mode on a terminal can opt out with `--no-redact` (which prints a
warning and is refused together with `--llm`, `--show-prompt`, markdown, or json).

## For operators

Sending logs to an external AI provider is your decision and your responsibility. Check your own obligations
(contracts, internal policies, data protection rules) before enabling `--llm` in automation. This project does
not claim compliance with any specific law or standard.
