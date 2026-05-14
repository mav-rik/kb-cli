---
name: kb
description: Manage persistent wiki via the kb CLI or HTTP API. Use when storing, retrieving, updating, or searching knowledge that should persist across conversations. Triggers on remember, store, recall, look up, find in memory, organize knowledge.
---

# kb

Persistent wiki for AI agents — a **graph of interlinked markdown notes** built up across prior conversations. Pages are connected because earlier sessions recognized them as related; those links are pre-computed reasoning to follow.

- **To answer a question**: search returns seed pages, not answers. Read seeds, follow `--links`, run `kb related`, and crawl outward until you have enough context. One document is almost never enough.
- **To add knowledge**: decompose into atomic linked pages, and add links FROM existing related pages back to anything new — a page with no incoming links is invisible to future agents.

Two interfaces: CLI and HTTP API.

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

Quick reference (run `kb skill` for the full command list with every flag):
```bash
# Search & retrieval
kb search "<query>" [--limit, -n N] [--mode, -m hybrid|fts|vec] [--format json] [--wiki, -w <name>]
    # Default: limit 10, mode hybrid. --mode fts = keyword only (fast, no model load).
kb related <id> [--limit, -n N] [--wiki, -w <name>]   # find similar docs

# Reading
kb read <filename> [--lines, -l 1-80] [--meta, -m] [--links] [--follow, -f ./other.md]

# Writing
kb add --title, -t "<title>" --category, -c <cat> [--tags "<t1,t2>"] \
       (--content "..." | --body "..." | --file <path> | --stdin) \
       [--dry-run] [--format json]
    # --dry-run: lint only, no write — preview retrievability issues first.
    # Real run also returns lint warnings in the response (always-on).
kb update <id> [--title, -t "..."] [--category, -c <c>] [--tags "..."] \
               (--content "<replacement>" | --append "<more>") \
               [--dry-run] [--format json]
kb delete <id>
kb rename <old> <new>                       # auto-updates links

# Browse / maintenance
kb list [--category, -c <c>] [--tag <t>] [--format json]
kb categories
kb toc
kb lint [--fix] [--format json]
    # Reports broken/orphan/missing/drift + retrievability (chunk-merge,
    # long-paragraph, doc-too-short, doc-too-long). See `kb skill lint`.
kb schema [update]
kb reindex

# Activity log
kb log [--limit, -n N]                       # default 20 entries
kb log add --op, -o <type> [--doc, -d <id>] [--details, -m "<text>"]
    # <type>: ingest | query | lint | note

# Wikis
kb wiki list | create <name> | use <name> | info <name> | delete <name> [--force, -f]

# Most commands accept --wiki, -w <name> to target a specific wiki.
```

Key rules:
1. Always search before adding (avoid duplicates)
2. Cross-link aggressively — links are how future agents traverse the graph; a page with no incoming links is unreachable
3. After every mutation, check and fix related docs
4. Discuss key takeaways with user before ingesting
5. Resolve contradictions using recency → authority → specificity
6. Log session summaries after ingest/lint with `kb log add`
7. Write for chunked retrieval — docs are split by H2/H3 heading and each chunk is searched independently. Target ~200-1500 words per doc, ≥80 words per section, paragraphs under 1500 chars. Sections under ~160 chars or >50% link syntax auto-merge into the previous chunk. Three frontmatter opt-outs (use deliberately):
   - `important_sections: [TL;DR, Status]` — prevent merging of named sections
   - `suppress_merge_warn: [See Also, Contacts]` — let the merge happen but silence the lint warning for those sections
   - `suppress_lint: [doc-too-short, doc-too-long, long-paragraph, chunk-merge]` — silence doc-level soft warnings (justify the choice)
