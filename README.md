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

## How it works

```
Claude Code ──writes──▶ transcripts ──▶ L1 extract.mjs ──▶ local store ──▶ L3 render.mjs ──▶ dashboard.html
                                        (SessionEnd hook,      ▲
                                         no tokens)            │ labels
                        /vibe-check ──▶ L2 classify.mjs ───────┘
                                        headless claude -p (Haiku), redacted views only
```

1. **Extract (L1).** When a session ends, a hook starts a detached script and exits in well under a second. The script measures behavior only (it never interprets your words) and writes metrics plus a compact, redacted view of each session. A 287 KB transcript becomes about 5 KB.
2. **Classify (L2).** On request, or after each session if you opt in, one headless `claude -p` call per session labels each typed prompt: new request, clarification, action correction, claim challenge, give-up or praise, plus tone. Each prompt is labelled once and cached.
3. **Render (L3).** A self-contained HTML file with inline SVG. No CDN, no server, no model.

### Isolation guards on every classification call

| Guard | How |
|---|---|
| No hooks run (yours or any plugin's) | `--settings` with `disableAllHooks: true` |
| No loop back into Vibe Check | `VIBECHECK_CHILD=1`; the hook exits immediately when it sees it |
| Not saved as a session | `--no-session-persistence`; L1 also counts only `promptSource: "typed"` |
| No side effects | `--tools ""`, run from an empty folder |
| No CLAUDE.md | `claudeMdExcludes` lists the user file and every parent folder's files by exact path |
| No thinking (5–10× cheaper) | `MAX_THINKING_TOKENS=0` |
| Stable labels | pinned `claude-haiku-4-5-20251001`, stored with every label |

A self-test checks the first four with one tiny call before auto-classify turns on, and again whenever Claude Code updates. If a guard fails, auto-classify turns itself off and the dashboard says why.

## Cost

About 2,200 input and 900 output tokens per 11-prompt session: roughly **$0.007 and 10 seconds**. A developer with about 160 typed prompts a week spends around **$0.10 a week** at Haiku 4.5 list price ($1 / $5 per million tokens), or a small share of a Pro/Max plan. Everything measured costs **zero tokens**. Every call's usage and cost is in `~/.claude/vibe-check/runs.jsonl`.

## Your data

See [PRIVACY.md](PRIVACY.md). In short: everything stays in `~/.claude/vibe-check/`; compact views are deleted after 30 days; `/vibe-check --forget` deletes it all; your transcripts are never modified.

## Development

```
npm test                 # unit + integration tests, uses a fake claude, no tokens
npm run fixtures         # regenerate synthetic fixtures
npm run eval             # live classifier eval against hand labels (spends ~$0.02)
claude --plugin-dir .    # try the plugin locally
```

## License

MIT
