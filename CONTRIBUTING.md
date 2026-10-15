# Contributing

Thanks for helping! The most valuable contribution is a **new rule** or a
**false-positive report**. See [docs/WRITING-RULES.md](docs/WRITING-RULES.md).

## Setup

```bash
git clone https://github.com/gggggggggg999/ci-explain.git
cd ci-explain
npm ci
```

## Checks (all must pass)

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run eval
npm run docs:check
```

## Rules for contributions

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`, `refactor:`).
- Code, comments, and docs in English.
- Fixtures must be synthetic or fully anonymized. Never commit real tokens,
  private repository names, internal URLs, or personal data.
- Fake secrets in tests must be built by concatenation in test code
  (for example `'ghp_' + 'x'.repeat(36)`), never stored as ready-made strings.
- Logs are untrusted input: never execute or interpret anything from a log.
- No telemetry, no network calls outside `github` and `--llm`.
