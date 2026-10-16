# Changelog

All notable changes are documented here. The JSON output has its own `schemaVersion`; changes to it
are recorded here as well and require a new `schemaVersion`.

## 0.1.0

First public release. Early software: tested on synthetic fixtures and locally reproduced tool output only.

### Added

- CLI that explains failed CI builds from a file, stdin, or a GitHub Actions run, with the exact log lines
  (original line numbers) as evidence.
- Log normalization: ANSI, CRLF, `\r` progress overwrites, BOM, GitHub Actions timestamps, repeated lines,
  long-line truncation; bounded input (`--max-bytes`, the end of a larger log is analyzed).
- GitHub Actions step detection with a generic fallback for other logs.
- 34 rules (npm, pnpm, Yarn, Node, TypeScript, ESLint, Prettier, Jest/Vitest, Python/pytest/pip, Docker,
  runner resources, network, permissions, git, configuration); see `docs/RULES.md`.
- Ranking, cascade folding, and an honest "cause not recognized" finding.
- Secret redaction before any output or AI call.
- Output formats: `text`, `markdown` (escaped, size-capped), and `json` (`schemaVersion: 1`).
- Optional AI layer for OpenAI-compatible servers (`--llm`, `--show-prompt`), validated and sanitized output.
  Verified with mocks only.
- `ci-explain github` (official REST API, token from `GITHUB_TOKEN`). Verified against local mock servers only.
- `--export-excerpt` for anonymized bug reports.
- Example GitHub Actions workflow (needs manual verification).

### Not included

GitHub App, Marketplace Action, dashboards, history, automatic fixes, native parsing of non-GitHub CI formats,
custom user rules, plugins, multiple AI providers. See `docs/ROADMAP.md`.
