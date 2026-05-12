---
name: kb
description: Manage persistent wiki via the kb CLI or HTTP API. Use when storing, retrieving, updating, or searching knowledge that should persist across conversations. Triggers on remember, store, recall, look up, find in memory, organize knowledge.
---

# kb

Persistent wiki for AI agents. Two interfaces: CLI and HTTP API.

**CLI** (run directly):
```bash
kb skill                # full instructions
kb skill ingest         # how to store knowledge
kb skill search         # how to retrieve knowledge
kb skill update         # how to modify knowledge
kb skill lint           # how to maintain wiki health
```

**HTTP API** (when `kb serve` is running on port 4141):
```
GET http://localhost:4141/api          # list all endpoints
GET http://localhost:4141/api/skill    # full instructions via API
```

Quick reference:
```bash
kb search "<query>"              # find knowledge
kb search "<query>" --mode fts   # exact keyword match (fast, no model load)
kb read <filename>               # read document
kb add --title "..." --category <cat> --tags "..." --body "..."
kb update <id> --append "..."    # add to existing
kb lint --fix                    # check and fix health
kb log                           # recent activity
kb log add --op <type> --details "..."  # record session summary
```

Key rules:
1. Always search before adding (avoid duplicates)
2. Cross-link related docs with `[text](./file.md)`
3. After every mutation, check and fix related docs
4. Discuss key takeaways with user before ingesting
5. Resolve contradictions using recency → authority → specificity
6. Log session summaries after ingest/lint with `kb log add`
