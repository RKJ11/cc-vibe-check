# Changelog

## 0.2.0 (2026-09-27)

- Layer 2 classification: `classify.mjs` labels every typed prompt with one
  headless `claude -p` call per session on pinned `claude-haiku-4-5-20251001`,
  with all hooks off, no tools, no CLAUDE.md, no session persistence and
  thinking off. At most 3 at a time under a lock file, at low priority.
- Turn-count validation with one retry for missing turns; the rest stay pending.
- Label cache keyed by prompt uuid, so each prompt is classified once.
- Run log `runs.jsonl` with tokens and cost per call.
- Isolation self-test (hooks, transcript, CLAUDE.md, output tokens), repeated
  on every Claude Code version change while auto-classify is on.
- Opt-in auto-classify with a versioned consent.
- Estimated dashboard panels: vibe score, first-try acceptance, gave up,
  challenge responses, repeated corrections with CLAUDE.md check.
- `/vibe-check` skill launcher; `--forget`, `status`, `selftest`.
- Fixes from testing on real transcripts (CC 2.1.169–2.1.283):
  - Injected command content without `promptSource` was counted as a typed
    prompt in transcripts that use the field.
  - Classifier labelled design decisions and answers to the agent's questions
    as action-corrections (precision 0/6 on a real design session → 1.00).
    Tone after API/login errors no longer read as frustration; rule candidates
    must be project-independent.
  - Retried prompts are no longer repeated in full in the compact view.
  - Session outcome reflects how it ended, not a recovered mid-session error.
  - `--days` rejects negative and non-numeric values; classification timeout
    is read per call.
  - Background subagents: span now comes from the subagent's own transcript
    (`<session>/subagents/agent-<id>.jsonl` + `.meta.json`); the tool result
    is only a launch acknowledgement.
- Self-test also plants a hooked `--plugin-dir` plugin and a parent-folder
  CLAUDE.md.
- Verified live on Claude Code 2.1.283 with unguarded controls: no hooks from
  project settings, user settings, `--plugin-dir` plugins or user-scope
  marketplace plugins; no user, project, local or parent-folder CLAUDE.md; no
  transcript. Live eval: label accuracy 93.9%, correction precision 1.00,
  cross-run agreement 90.9%, max 1,306 output tokens per call.
- The label feedback loop (formerly v0.3) is deferred to a later release.

## 0.1.0 (2026-09-27)

- Layer 1 `extract.mjs`: behavior metrics from local transcripts, no tokens.
  Typed prompts only; interrupts, tool rejections, rewinds, API/auth errors
  and retries, tool errors, same-file churn, git reverts, subagent runs,
  compactions, permission mode changes, waits and work time.
- Redacted compact views (keys, tokens, emails, private URLs removed).
- Layer 3 `render.mjs`: self-contained `dashboard.html`, no CDN.
- SessionEnd hook: starts a detached worker and exits in well under a second.
