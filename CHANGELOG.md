# Changelog

All notable changes are documented here. The JSON output has its own `schemaVersion`; changes to it
are recorded here as well and require a new `schemaVersion`.

## 0.1.3

### Added

- Composite GitHub Action (`action.yml`): `uses: gggggggggg999/ci-explain@<full-sha>` writes the explanation of a failed run to the job summary. Verified once in the project's own repository (2026-10-17); not published to the Marketplace.
- README section "Use it in GitHub Actions".

## 0.1.2

### Changed

- Added a `prepare` script, so `npx --yes github:gggggggggg999/ci-explain#<tag>` builds and runs the tool straight from GitHub (verified on 2026-10-17). The package is still not published to the npm registry.

## 0.1.1

### Fixed

- `node.npm.eresolve` now parses peer ranges that contain spaces (found by running `ci-explain github` on a real failed run).

### Verified

- `ci-explain github` and the example workflow were run once against real GitHub (the project's own repository, 2026-10-17).

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
