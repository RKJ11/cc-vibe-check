# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cc-vibe-check` ("Vibe Check") is a Claude Code **plugin**. It reads local session transcripts and builds a dashboard of how the developer and Claude are getting along. This repo is **Phase 1 only**: an individual-developer plugin. Do not add export, team, org or rule-sharing features; those belong to Phase 2.

Plain Node ESM, zero runtime dependencies, no build step.

## Commands

```
npm test                          # all tests; uses tests/helpers/fake-claude.mjs, no tokens
node --test tests/l1.test.mjs     # one file
npm run fixtures                  # regenerate tests/fixtures/*.jsonl from make-fixtures.mjs
npm run eval                      # LIVE classifier eval, spends tokens
```

Try against a scratch store (never point tests at the real `~/.claude`):

```
VIBECHECK_HOME=/tmp/vc VIBECHECK_CLAUDE_BIN=tests/helpers/fake-claude.mjs node scripts/vibe-check.mjs
```

Env overrides: `VIBECHECK_HOME` (store), `VIBECHECK_PROJECTS_DIR` (transcripts), `CLAUDE_CONFIG_DIR` (user CLAUDE.md), `VIBECHECK_CLAUDE_BIN` (claude executable or a .mjs run with node), `VIBECHECK_MODEL`.

## Architecture

Three layers, one direction: transcripts → L1 → store → L2 → store → L3 → `dashboard.html`.

- **L1 `scripts/extract.mjs`** + `lib/transcript.mjs` (parser), `lib/metrics.mjs` (stored record, no prompt text), `lib/view.mjs` (compact view, redacted by `lib/redact.mjs`). Behavior only: never match the developer's words. Matching strings Claude Code itself writes (interrupt marker, rejection text, command wrappers, `isApiErrorMessage`) is fine. A typed prompt is `promptSource: "typed"`; older versions without that field fall back to a heuristic. Only changed files are re-read (`data/state.json`).
- **L2 `scripts/classify.mjs`** + `lib/claude.mjs`. `lib/claude.mjs` is the only place that spawns `claude`; every isolation guard lives there. Labels are keyed by prompt `uuid` and never re-requested. Output is validated (`validateLabels`) and missing turns retried once.
- **L3 `scripts/render.mjs`** + `lib/aggregate.mjs`. `aggregate` is pure; `render` embeds its JSON in a template and client-side JS draws it. Anything derived from transcripts or model output must go through `esc()` or `textContent`.
- **`scripts/hook.mjs`** (SessionEnd) only spawns `vibe-check.mjs _after-session` detached and exits. It must exit immediately when `VIBECHECK_CHILD` is set.
- **`scripts/vibe-check.mjs`** is the CLI; `skills/vibe-check/SKILL.md` is a thin launcher (`disable-model-invocation: true`).

## Rules

- Every dashboard panel is marked Measured or Estimated. Keep that honest.
- Pinned model id, never the `haiku` alias. Changing the model or `prompts/classifier.md` means running `npm run eval` first.
- Don't add `--bare` or `--setting-sources ""` to headless calls (no OAuth / doesn't stop plugin hooks; verified on CC 2.1.283).
- New transcript edge case → add it to `tests/fixtures/make-fixtures.mjs` with a hand count in `tests/l1.test.mjs`.
