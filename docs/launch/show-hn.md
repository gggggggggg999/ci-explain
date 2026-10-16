# Show HN draft

Draft only. Publishing is up to the owner. Re-check the current Hacker News guidelines for Show HN before posting.

**Title:** Show HN: ci-explain – explain a failed CI log with the exact lines as evidence (offline, AI optional)

**Text (first person, from the owner):**

I got tired of scrolling through thousands of lines of CI output to find the one line that matters, so I
built ci-explain: a small CLI that reads the log of a failed build and tells you what failed, quoting the
exact log lines (with their original line numbers) as evidence.

How it works: the base analysis is a deterministic rule catalog that runs offline and sends nothing anywhere.
It normalizes the log (ANSI, CRLF, timestamps, progress bars), redacts secrets, finds the failed step for
GitHub Actions logs, and matches 34 rules (npm/pnpm/Yarn, TypeScript, ESLint, Prettier, Jest/Vitest, pytest,
pip, Docker, OOM, timeouts, permissions...). If no rule matches it says "cause not recognized" and shows the
most relevant lines instead of guessing. An AI explanation is optional (`--llm`, OpenAI-compatible servers), and
`--show-prompt` prints exactly what would be sent, after redaction, without sending it.

What it does not do: it does not fix anything, it is not a service, and I make no accuracy claims: the rules
were tested on hand-written fixtures and on output I reproduced locally, not on a corpus of real-world logs.
Step-aware parsing exists only for GitHub Actions; other CI logs are analyzed generically. The GitHub-run
source and the AI layer were tested with mocks only. It is not on npm yet; you build it from source.

Repo: https://github.com/gggggggggg999/ci-explain

Feedback I would really like: **which CI failures should it explain next?** If you have a failure it
misses or explains wrongly, `--export-excerpt` makes an anonymized excerpt (please read it before sharing)
that you can attach to an issue.
