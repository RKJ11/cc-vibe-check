# Vibe Check

**How you and Claude are really getting along.**

A Claude Code plugin that reads the session transcripts Claude Code already saves on your machine and shows you, in a local dashboard, where your work with Claude runs smoothly and where it grinds: interrupts, rejected tool calls, rewinds, corrections you keep repeating, and how Claude responds when you challenge it.

- **Measured** panels are counted by a script from transcript events. They cost zero tokens and refresh every time a session ends.
- **Estimated** panels come from a small Haiku model reading your prompts in the background. They are labelled as estimates, with confidence.
- **Nothing is uploaded.** The only network traffic is the classification calls, which go to the same model provider your Claude Code already uses, and only when you ask for them.

## Install

```
/plugin marketplace add RKJ11/cc-vibe-check
/plugin install cc-vibe-check
```

No configuration and no API key. Requires Node 18+ (already present wherever Claude Code runs).

## Use

| Command | What it does |
|---|---|
| `/vibe-check` | Refresh metrics and the dashboard, and classify new prompts in the background |
| `/vibe-check --project <name> --days <n>` | Limit to one project or a time window (default 84 days) |
| `/vibe-check --no-classify` | Measured metrics only, no model calls |
| `/vibe-check --auto on` | Classify each session automatically after it ends. Explains what runs and asks you to confirm |
| `/vibe-check --auto off` | Back to on-request only |
| `/vibe-check status` | Auto-classify, self-test and pending prompts |
| `/vibe-check selftest` | Re-check the isolation guards with one tiny call |
| `/vibe-check --forget` | Delete everything Vibe Check has stored |

Open `~/.claude/vibe-check/dashboard.html` in a browser. It is a stable path you can bookmark.

The same commands work from any terminal: `node <plugin>/scripts/vibe-check.mjs …`.

## What runs on your machine

- When a session ends, a quick background script counts what happened. It uses no tokens and never reads your words for meaning.
- Classification happens only when you ask for it, or after each session if you turn auto on. Each prompt is labelled once and the result is cached.
- Classification calls run with every hook, tool and CLAUDE.md turned off and are not saved as sessions. A self-test checks this, and auto-classify switches itself off if a check fails.

## Cost

A developer with about 160 typed prompts a week spends around **$0.10 a week** at Haiku 4.5 list price ($1 / $5 per million tokens), or a small share of a Pro/Max plan. Everything measured costs **zero tokens**. Every call's usage and cost is in `~/.claude/vibe-check/runs.jsonl`.

## Your data

See [PRIVACY.md](PRIVACY.md). In short: everything stays in `~/.claude/vibe-check/`; compact views are deleted after 30 days; `/vibe-check --forget` deletes it all; your transcripts are never modified.

## License

MIT
