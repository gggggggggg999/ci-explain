# Troubleshooting

**"stdin is a terminal"** — you ran `ci-explain -` without piping anything. Pipe a log in or pass a file.

**"The input is empty"** (exit 3) — the file or stdin had no non-blank content.

**"Cause not recognized"** — no rule matched. The excerpt shows the most error-like lines. You can request a rule:
`--export-excerpt excerpt.txt`, review the file by hand, then open a "new rule request" issue.

**Findings point at line numbers that look off** — numbers refer to the original input. If the input was larger
than `--max-bytes`, only the end was analyzed, but numbers still refer to the original input. Raise `--max-bytes`
to analyze more.

**A step name looks odd** — in raw GitHub Actions job logs, steps are detected from `##[group]Run ...` lines.
`gh run view --log-failed` output is supported too. Other CI formats are analyzed without steps.

**`--llm` says a key is missing** — set `CI_EXPLAIN_LLM_API_KEY` (environment only), and pass `--llm-base-url` and
`--llm-model` (or the matching `CI_EXPLAIN_LLM_BASE_URL` / `CI_EXPLAIN_LLM_MODEL`).

**AI layer unavailable** — the reason is printed (timeout, rate limit, auth, bad response). Layer-1 results are
still shown. Use `--llm-required` to make this an error (exit 5). Some servers only accept the older
`max_tokens` parameter: use `--llm-max-tokens-param max_tokens`.

**`github` command errors (exit 4)** — 401: bad or expired token; 403: no access or rate limit; 404: wrong
`--repo`/`--run`, a private repository without access, or logs that expired (90 days by default; private
repositories can configure 1 to 400 days).

**Colors in a CI log** — colors are used only on a TTY; set `NO_COLOR=1` or pass `--no-color` to be sure.
