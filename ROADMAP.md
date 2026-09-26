# Roadmap

## Deferred features

### Label feedback loop (was HLD v0.3)

Let the developer correct a Haiku label they disagree with, so classification adapts to their own writing style.

1. The dashboard lists individual prompts with their labels (default filter: low-confidence labels and corrections).
2. "Mark wrong" records the right label. The dashboard uses the developer's label from then on.
3. A few recent corrections are added to later classification calls as per-developer worked examples (a few hundred extra input tokens).
4. Corrected prompts become personal eval cases, so `npm run eval` shows whether accuracy on that developer's style improves.

The dashboard is a static `file://` page and cannot write to disk. Options:

| Option | How | Trade-off |
|---|---|---|
| Copy a command (preferred) | "Mark wrong" copies `/vibe-check --fix <session> T11 claim-challenge` | Dashboard stays static and nothing listens; one paste per correction |
| Download a file | Dashboard saves `corrections.json`, next `/vibe-check` imports it | Batches corrections; importing from Downloads is fragile |
| Local server | `/vibe-check --serve` on localhost | Smoothest; a listening process on the developer's machine |

## Remaining for Phase 1 v1.0

- Model and Claude Code version comparison view (change markers on the score chart exist).
- Marketplace listing and launch; re-check pricing before publishing the launch numbers.

## Phase 2

Enterprise rollout (opt-in digest export, k≥5 aggregation, managed settings, rule sharing) is planned after Phase 1 v1.0 ships.
