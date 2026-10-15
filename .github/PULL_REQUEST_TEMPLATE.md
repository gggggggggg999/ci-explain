## What does this change?

## Checklist

- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `npm run eval`, `npm run docs:check` pass
- [ ] New or changed rule: positive and negative fixtures added; `sourceNote` says where the message format comes from and what was not checked
- [ ] Fixtures are synthetic or fully anonymized (no real tokens, private repo names, internal URLs, personal data)
- [ ] Fake secrets in tests are built by concatenation, not stored as ready-made strings
- [ ] No telemetry or new network calls outside `github` and `--llm`
- [ ] Docs updated if behavior changed
