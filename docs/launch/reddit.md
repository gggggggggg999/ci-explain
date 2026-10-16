# Reddit drafts

Short variants. **The owner must read each community's current rules on self-promotion before posting**
(some require a ratio of non-promotional participation, a specific flair, or a weekly thread). Do not post the
same text everywhere on the same day. Link: https://github.com/gggggggggg999/ci-explain

## r/devops

Title: I wrote a CLI that explains a failed CI log with the exact lines as evidence (offline, AI optional)

Body: It reads a failed build log (file, stdin, or a GitHub Actions run) and explains common causes using a
rule catalog, quoting the original log lines. It runs offline, redacts secrets, and says "cause not recognized"
instead of guessing. AI is optional and `--show-prompt` shows what would be sent. Early (v0.1.0), 34 rules,
tested only on synthetic fixtures, GitHub Actions steps only. Which failures should it explain next?

## r/node

Title: Open-source CLI that explains npm/pnpm/yarn, TypeScript, ESLint, Vitest/Jest CI failures from the log

Body: Built in TypeScript with one runtime dependency (zod). Rules for ERESOLVE, lockfile mismatches, missing
modules, engines, tsc errors (cascades folded into one finding), ESLint, Prettier --check, test failures,
snapshot mismatches, timeouts. Not on npm yet (build from source). Looking for failures it gets wrong or misses.

## r/github

Title: Explaining failed GitHub Actions runs from the logs, with an example workflow_run job summary

Body: `ci-explain github --repo owner/name --run <id>` downloads the failed jobs' logs through the official API
(token from env only, never sent to the redirect host) and explains them. There is an example workflow that
writes the explanation to the job summary with `actions: read` permissions only; it has not been run in a real
repo yet, so I would appreciate a second pair of eyes on docs/GITHUB-ACTIONS.md.

## r/webdev

Title: A small tool to find the actual error in a wall of CI output

Body: Pipe your failed build log in and get the likely cause plus the exact lines (with line numbers). Works
offline. Early project: feedback on which frontend toolchain errors to cover next is very welcome.

## r/SideProject

Title: ci-explain: explain why your CI failed in seconds (open source, early)

Body: Weekend-sized idea turned into a careful little CLI: evidence-first, offline, secrets redacted, AI
optional. It is v0.1.0, tested on synthetic data only, and I am looking for real failures to teach it.
