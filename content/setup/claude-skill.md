---
name: kb
description: Manage persistent wiki via the kb CLI. Use when storing, retrieving, updating, or searching knowledge that should persist across conversations. Triggers on remember, store, recall, look up, find in memory, organize knowledge.
---

# kb

Run `kb skill` to see full instructions. Run workflow-specific guides:
- `kb skill ingest` — how to store new knowledge
- `kb skill search` — how to find and retrieve knowledge
- `kb skill update` — how to modify/reorganize knowledge
- `kb skill lint` — how to maintain wiki health

Quick reference:
```bash
kb search "<query>"              # find knowledge
kb read <filename>               # read document
kb add --title "..." --category <cat> --tags "..." --content "..."
kb update <id> --append "..."    # add to existing
kb lint                          # check health
```

Key rules:
1. Always search before adding (avoid duplicates)
2. Cross-link related docs with `[text](./file.md)`
3. After every mutation, check and fix related docs
