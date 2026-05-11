---
name: ai-memory
description: Manage persistent knowledge bases for AI agents via the aimem CLI. Use when storing, retrieving, updating, or searching knowledge that should persist across conversations. Triggers on requests to remember, store, recall, look up, or organize information in the agent's memory.
---

# ai-memory

You have access to a persistent knowledge base via the `aimem` CLI. Use it to store, retrieve, and manage knowledge that should persist across conversations.

## When to use

- User asks you to **remember** something → `aimem add`
- User asks you to **recall/find** something → `aimem search` then `aimem read`
- You need **context** from prior knowledge → `aimem search`
- User provides **new information** to store → `aimem add` or `aimem update`
- User asks to **organize** or **clean up** memory → `aimem lint`, `aimem rename`

## Core workflow

### Storing knowledge

1. **Search first** — avoid duplicates:
   ```bash
   aimem search "topic keywords"
   ```
2. If related doc exists → **update** it:
   ```bash
   aimem update <id> --append "New information here"
   ```
3. If no match → **create** new doc:
   ```bash
   aimem add --title "Topic Name" --category <category> --tags "tag1,tag2" --content "..."
   ```
4. **Link related docs** — include `[Related Topic](./related-topic.md)` links in the content body.
5. **Sync related knowledge** (MANDATORY after every add/update):
   ```bash
   aimem search "<key concepts from the new/changed content>"
   ```
   Read each related doc. If any contain outdated, contradictory, or superseded information:
   - Update them with corrected info via `aimem update <id> --content "..."`
   - Or append a correction: `aimem update <id> --append "\n\n> Updated: ..."`
   - Remove stale cross-links if the relationship no longer applies
   
   This step ensures the KB stays internally consistent. Never leave contradictions.

### Retrieving knowledge

1. **Search** for relevant docs:
   ```bash
   aimem search "your query here"
   ```
   Returns: filename, title, category, score, snippet.

2. **Read** a specific document:
   ```bash
   aimem read <filename>
   ```
   Returns: header (tags, links, line count) + numbered content.

3. **Read specific lines** (for large docs):
   ```bash
   aimem read <filename> --lines 1-80
   aimem read <filename> --lines 81-160
   ```

4. **Follow links** to explore related knowledge:
   ```bash
   aimem read <filename> --follow "./related-doc.md"
   ```

5. **List links** from a document:
   ```bash
   aimem read <filename> --links
   ```

6. **Get metadata** only:
   ```bash
   aimem read <filename> --meta
   ```

## Commands reference

### Knowledge base management
```bash
aimem kb create <name>       # create a new KB
aimem kb list                # list all KBs
aimem kb info <name>         # show KB stats
aimem kb delete <name>       # delete a KB
```

### Document operations
```bash
aimem add --title "..." --category <cat> [--tags "..."] [--content "..."] [--file <path>] [--stdin]
aimem update <id> [--title "..."] [--category "..."] [--tags "..."] [--content "..."] [--append "..."]
aimem delete <id>
aimem rename <old-id> <new-id>
aimem list [--category <cat>] [--tag <tag>] [--format json]
```

### Reading
```bash
aimem read <filename>                    # full doc with line numbers
aimem read <filename> --lines <start>-<end>  # specific line range
aimem read <filename> --meta             # frontmatter as JSON
aimem read <filename> --links            # outgoing links list
aimem read <filename> --follow <link>    # resolve and read linked doc
```

### Search
```bash
aimem search "<query>" [--limit N] [--format json]
aimem related <id> [--limit N] [--format json]   # find docs semantically similar to a given doc
```

### Maintenance
```bash
aimem lint [--fix]    # check for broken links, orphans, drift
aimem reindex         # rebuild index from MD files
aimem toc             # regenerate table of contents
```

### Global options
- `--kb <name>` — target knowledge base (default: "default")
- `--format json` — machine-readable output

## Categories

Categories are **free-form strings** — create whatever makes sense for the knowledge base's domain. There is no fixed list. Use `aimem list --category <cat>` to browse by category.

**Choosing categories**: Look at what's already in the KB first (`aimem list`) and reuse existing categories for consistency. If nothing fits, create a new one.

**Naming convention**: short, lowercase, singular nouns. Examples by domain:

| Domain | Example categories |
|--------|-------------------|
| Software dev | `architecture`, `api`, `debugging`, `tooling`, `deployment` |
| Personal | `health`, `finance`, `travel`, `recipes`, `contacts` |
| Work | `meetings`, `projects`, `policies`, `onboarding`, `clients` |
| Research | `papers`, `methods`, `datasets`, `findings`, `hypotheses` |
| Mixed | `notes`, `plans`, `ideas`, `logs`, `references` |

The agent should **discover existing categories** before inventing new ones — run `aimem list` to see what's already in use.

## Best practices

### Document sizing
- **Target: 50-200 lines per document.** Shorter docs are easier to search, read, and link.
- **Split large topics** into focused sub-documents rather than one massive file.
  - Bad: one 500-line "Architecture" doc covering everything
  - Good: "Auth Architecture", "Data Layer Architecture", "API Design" as separate docs
- **If a doc grows beyond 300 lines**, consider splitting it. Use links to connect the pieces.

### Naming and IDs
- Titles become filename slugs: "API Design Decisions" → `api-design-decisions.md`
- **Use descriptive, specific titles** — not "Notes" or "Stuff" but "React Query Caching Strategy"
- **KB names**: lowercase letters, numbers, dashes, underscores only (e.g., `work`, `personal`, `project-x`)
- **Avoid generic titles** that could conflict — prefix with domain if needed

### Cross-referencing
- **Link related docs aggressively** — links are the primary navigation mechanism.
- Format: `[Display Text](./other-doc.md)` — always use `./` prefix.
- When creating a new doc, search for related existing docs and add bidirectional links.
- After adding a doc about topic X, update existing docs that discuss X to link back.

### Content organization
- **One concept per document** — atomic knowledge units are more reusable.
- **Use headings** (## / ###) to structure longer docs — aids reading with `--lines`.
- **Put the most important info first** — search snippets show the beginning of content.

### General
1. **Always search before adding** — prevents duplicates and finds related docs to link to.
2. **Use tags generously** — tags improve both FTS keyword search and filtering.
3. **Update, don't duplicate** — if info evolves, update the existing doc with `--append` or `--content`.
4. **Run lint periodically** — catches broken links, orphaned docs, and index drift.
5. **Read in chunks** — for large docs, use `--lines` to avoid overwhelming context windows.

## Document format

Documents are Markdown with YAML frontmatter:
```markdown
---
id: document-slug
title: Document Title
category: concepts
tags: [tag1, tag2]
created: 2025-01-15
updated: 2025-03-20
---

# Document Title

Content with [links to related docs](./other-doc.md).
```

## Navigation pattern

The most efficient way to explore the knowledge base:
```
search → read top result → follow links → read related → ...
```

This mimics how a human would browse a wiki — start with a search, then navigate through cross-references to build complete context.
