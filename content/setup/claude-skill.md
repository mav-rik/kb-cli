---
name: aimem
description: Manage persistent knowledge via the aimem CLI. Use when storing, retrieving, updating, or searching knowledge that should persist across conversations. Triggers on remember, store, recall, look up, find in memory, organize knowledge.
---

# aimem

Run `aimem skill` to see full instructions. Run workflow-specific guides:
- `aimem skill ingest` — how to store new knowledge
- `aimem skill search` — how to find and retrieve knowledge
- `aimem skill update` — how to modify/reorganize knowledge
- `aimem skill lint` — how to maintain KB health

Quick reference:
```bash
aimem search "<query>"              # find knowledge
aimem read <filename>               # read document
aimem add --title "..." --category <cat> --tags "..." --content "..."
aimem update <id> --append "..."    # add to existing
aimem lint                          # check health
```

Key rules:
1. Always search before adding (avoid duplicates)
2. Cross-link related docs with `[text](./file.md)`
3. After every mutation, check and fix related docs
