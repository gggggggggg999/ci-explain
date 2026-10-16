# 60-second demo script

Goal: show a failed log, one command, an explanation with evidence, then the privacy feature.
Use only the synthetic fixture from the repository so nothing private appears on screen.

Preparation: `git clone https://github.com/gggggggggg999/ci-explain && cd ci-explain && npm ci && npm run build`.
Use a large terminal font and a clean prompt.

| Time      | Show        | Do                                                                                                                                                                                                                |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:08 | The raw log | `less tests/fixtures/logs/gha-ts-build.log` (scroll, point at the red errors buried in noise). Say: "A failed build is a wall of text."                                                                           |
| 0:08-0:25 | One command | `node dist/cli/main.js tests/fixtures/logs/gha-ts-build.log`                                                                                                                                                      |
| 0:25-0:40 | Explanation | Point at: failed step, "3 occurrences" folded into one finding, the evidence lines with original line numbers, suggestions marked "nothing is executed".                                                          |
| 0:40-0:50 | Honesty     | `echo "weird failure: error 0x42" \| node dist/cli/main.js -` shows "Cause not recognized" and the relevant lines, no invented cause.                                                                             |
| 0:50-1:00 | Privacy     | `node dist/cli/main.js tests/fixtures/logs/gha-ts-build.log --show-prompt` shows exactly what an AI would receive (redacted) and "Nothing was sent". Say: "Offline by default, AI optional, you see what leaves." |

Do not show a real API key. Do not claim accuracy numbers or provider compatibility.
