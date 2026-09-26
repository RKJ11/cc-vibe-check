# Privacy

Vibe Check runs entirely on your machine. It has no server, no telemetry and no account.

## What it reads

The session transcripts Claude Code saves in `~/.claude/projects`. It never modifies or deletes them.

## What it stores

Everything lives in `~/.claude/vibe-check/`.

| Data | Where | Kept | Leaves the machine |
|---|---|---|---|
| Behavior metrics (counts and timings, no prompt text) | `data/sessions/` | Until you delete it | Never |
| Labels (label, tone, confidence, suggested rule) | `data/labels/` | Until you delete it | Never |
| Compact views (your prompts, a short head and tail of each reply, redacted) | `views/` | 30 days | Only when classified, to your model provider |
| Run log (time, tokens, cost per classification call) | `runs.jsonl` | Until you delete it | Never |
| Dashboard | `dashboard.html` | Rebuilt on each run | Never |

`/vibe-check --forget --yes` deletes the whole folder.

## What is sent, and when

Only when you run `/vibe-check`, or after each session if you turned on auto-classify: the compact view of a session is sent to the model provider your Claude Code is already configured to use (Anthropic, Bedrock or Vertex), through Claude Code itself. Before a view is written, API keys, tokens, passwords, emails, credentials in URLs and private or internal URLs are removed.

Classification calls are not saved as Claude Code sessions and run with all hooks and CLAUDE.md files switched off.
