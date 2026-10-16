# Press kit

Only facts that exist and were checked are listed here. Fill in author details and screenshots yourself.

## Description

ci-explain is an open-source command-line tool that reads the log of a failed CI build and explains common
failure causes, quoting the exact log lines (with their original line numbers) as evidence. If it does not
recognize a cause, it says so and shows the most relevant lines.

The base analysis is deterministic and offline: it normalizes the log, redacts secrets, detects the failed
step in GitHub Actions logs, and applies a catalog of rules. An optional AI explanation can be requested for
OpenAI-compatible servers; `--show-prompt` shows exactly what would be sent and sends nothing.

It is an early release (v0.1.0). It was tested on hand-written synthetic fixtures and locally reproduced tool
output, so no accuracy figures are published. It is independent and not affiliated with GitHub or any CI vendor.

## Facts

- Name: ci-explain; license: MIT; language: TypeScript; runtime: Node.js 22.12 or newer.
- 34 rules at v0.1.0; formats: text, markdown, json (`schemaVersion` 1).
- One runtime dependency (zod). No telemetry.
- Not published to npm at the time of writing; install by building from source.
- GitHub source and AI layer verified with mocks only.

## Author

(Fill in only details the author has confirmed.) Author and license holder: Myrza Dokturbekov.

## Links

- Repository: https://github.com/gggggggggg999/ci-explain
- Release: https://github.com/gggggggggg999/ci-explain/releases/tag/v0.1.0
- Documentation: README.md and docs/ in the repository

## Screenshots

(Add your own screenshots here.)
