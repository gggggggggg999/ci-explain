# Using ci-explain with GitHub Actions

Two things are covered here: the `ci-explain github` command, and the example workflow in
[`examples/github-actions/explain-failed-runs.yml`](../examples/github-actions/explain-failed-runs.yml).

> **Status of the example workflow: partially verified.** Besides YAML validation and automated tests of the
> rules below, it ran successfully once on 2026-10-17 in the author's own repository, triggered by a failed
> same-repository pull request run (and `ci-explain github` was run against that real failed run). **Pull
> requests from forks, private repositories, and other setups have not been tested.**

Documentation consulted (checked 2026-10-15):

- Secure use reference: <https://docs.github.com/en/actions/reference/security/secure-use>
- `workflow_run` event: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Workflow jobs REST API: <https://docs.github.com/en/rest/actions/workflow-jobs>
- REST API rate limits: <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
- Log retention: <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
- Workflow commands (job summary size limit): <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands>

## `ci-explain github`

```bash
export GITHUB_TOKEN=...   # never pass the token as an argument
ci-explain github --repo owner/name --run 1234567890
```

(Replace `ci-explain` with `node dist/cli/main.js` when running from a source checkout.)

What it does, using only the official REST API:

1. `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` to list the jobs of the run.
2. Selects failed jobs (`failure` or `timed_out`), at most `--max-jobs` (default 3).
3. `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`. GitHub answers with a redirect to a
   short-lived download URL (the docs say the link expires after one minute).

Headers: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10` (the value shown in the
docs when checked), and `Authorization: Bearer <GITHUB_TOKEN>` **only on requests to the API host**.

Safety properties (covered by automated tests against local mock servers; the happy path was also run against real GitHub once, on 2026-10-17, using the author's own repository; error paths and redirects to other hosts were not exercised against real GitHub):

- Redirects are handled manually. The token is **never** sent to the host a redirect points to.
  Redirect targets must be `https` (plain `http` only for localhost, used by the tests).
- The token is read from `GITHUB_TOKEN` only, never from a command-line argument, and never printed.
- Timeouts, a download size cap, and `--max-bytes` (the end of an oversized log is analyzed).
- Errors: 401, 403, rate limit (primary and secondary), 404, 410 and expired logs get specific messages
  (exit code 4). Logs are retained for 90 days by default; private repositories can configure 1 to 400 days.
- `--repo` and `--run` are validated before any request.

Token permissions: reading job logs needs read access to the repository's Actions data. For classic personal
access tokens on private repositories the REST docs state the `repo` scope; for the workflow's own
`GITHUB_TOKEN`, `actions: read` is the intended permission. This was exercised with the author's own token on their own repository only.

`--github-api-url` lets you point at GitHub Enterprise Server. The token is sent to whatever host you give, so
only use hosts you trust (https is required; http only for localhost).

## The composite action (easiest)

The repository root contains [`action.yml`](../action.yml), a composite action. Using it as in the README
runs ci-explain from the exact commit you pin: it sets up Node 22, builds ci-explain, runs
`ci-explain github --format markdown` and appends the result to the job summary.

Inputs: `run-id` (required), `repository` (default: the current repository), `token` (default:
`github.token`), `max-findings` (default 3), `max-jobs` (default 3). Inputs reach the script through `env`, never
through string interpolation, the setup-node action is pinned to a commit SHA, and the action never checks out
or runs the pull request's code. It has been tested by running it in the author's own repository (see the status
note above); it is not published to the Marketplace.

## The example workflow

It triggers on `workflow_run` (type `completed`) of the workflow(s) you list, runs only when the conclusion
is `failure`, runs `ci-explain github`, and appends the Markdown to `$GITHUB_STEP_SUMMARY`.

Design decisions, and why:

| Decision                                                   | Reason                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions: actions: read` and nothing else              | Least privilege. The secure-use docs recommend read-only defaults and granting more only where needed.                                                                                                                                                        |
| Never check out or run the pull request's code             | `workflow_run` workflows run with elevated privileges (write access and secrets); the docs warn that running untrusted code there can lead to cache poisoning and unintended privileges. The example checks out only the ci-explain tool at a commit you pin. |
| Event values go through `env:`, never straight into `run:` | Avoids script injection from attacker-influenced event fields (docs: assign to an intermediate environment variable).                                                                                                                                         |
| Third-party actions pinned to full commit SHAs             | A tag can be moved or deleted; a SHA cannot. Verify the SHA comes from the action's original repository.                                                                                                                                                      |
| Output goes to the job summary, not to a PR comment        | The summary needs no extra permissions.                                                                                                                                                                                                                       |
| Output capped below 1 MiB                                  | The docs state each step's summary is limited to 1 MiB (1,048,576 bytes); ci-explain truncates at 1,000,000 bytes with a visible note.                                                                                                                        |

### Pull requests from forks

Logs of a fork pull request are written by the fork's author, so they are **untrusted input**. ci-explain
never executes anything from a log, escapes Markdown (including `@mentions`, `#123` references, HTML and
links), and does not call an AI provider unless you add `--llm`. Do not add `--llm` to this workflow on
public repositories without thinking through what is sent where.

Because a `workflow_run` workflow runs in the context of the default branch, it can use a write-capable
token and secrets even when the triggering workflow could not (this is how the event is documented).
That is why the example keeps permissions minimal and never touches the pull request's code.

### Optional: a pull request comment

Posting a comment needs `pull-requests: write` (or `issues: write`) on the token. That widens what a
compromised step could do, so it is **not** in the example. If you add it, keep the comment text produced by
`--format markdown` (it is escaped for this use), keep the step free of PR code, and limit the permission to
that one job.

### Installing ci-explain in the workflow

The example builds ci-explain from source at a commit you pin (`ref: REPLACE_WITH_FULL_COMMIT_SHA`).
Replace the placeholder with a full 40-character SHA of a revision you reviewed. A simpler alternative that needs no checkout is a pinned run straight from GitHub:
`npx --yes github:gggggggggg999/ci-explain#<tag> github --repo "$REPO" --run "$RUN_ID" --format markdown`
(it builds the tool on first use). Pin a release tag, and ideally verify the commit it points to.
