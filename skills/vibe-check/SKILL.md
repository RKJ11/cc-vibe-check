---
name: vibe-check
description: Refresh your Vibe Check dashboard.
disable-model-invocation: true
argument-hint: "[--project <name>] [--days <n>] [--auto on|off] [--forget]"
allowed-tools: Bash(node:*)
---
Run this one command with the Bash tool and wait for it to finish (it returns in a few seconds; classification continues in its own background process):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/vibe-check.mjs" $ARGUMENTS
```

Relay its output to the user exactly as printed. Do not read, open or summarise any file it mentions, and do not run any other command.
