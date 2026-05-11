# Lint Workflow — Knowledge Base Maintenance

Two levels of maintenance: structural (automated) and semantic (agent-driven review).

---

## Level 1: Structural Lint (automated)

```bash
kb lint
```

Reports:
- **broken** (error): links pointing to non-existent files
- **orphan** (warning): docs with zero incoming links
- **missing** (error): docs missing required frontmatter (id, title, category)
- **drift** (warning): index out of sync with file content

### Auto-fix

```bash
kb lint --fix
```

Fixes broken links (removes dead links, keeps text) and drift (re-syncs index).

### Fixing orphans

For each orphan, find what should link to it:
```bash
kb related <orphan-id>
```

Add a link from a related doc:
```bash
kb update <related-id> --append "\n\nSee also: [Orphan Title](./orphan-id.md)"
```

---

## Level 2: Semantic Review (agent methodology)

Run this periodically (every 10-20 ingests, or when user requests). This is the deeper health check that requires reading and reasoning.

### Step 1: Check for contradictions

Find docs with high semantic similarity that might contain conflicting claims:

```bash
kb list --format json
```

For each doc (or a subset of recent/important ones):
```bash
kb related <id> --limit 5
```

Read the doc and its top related docs. Look for:
- Same topic described differently in two places
- Numbers, dates, or facts that disagree
- Outdated claims superseded by newer information

Fix by updating the stale doc or merging the two into one.

### Step 2: Find missing pages

Read through docs looking for concepts that are **mentioned but don't have their own page**. Signs:
- A term appears in multiple docs but has no dedicated page
- Links that SHOULD exist but don't (the concept is discussed without a link)

Create pages for important concepts that deserve their own entry:
```bash
kb add --title "Missing Concept" --category concepts --content "..."
```

### Step 3: Check cross-reference density

Good wiki pages have 2-5 outgoing links. Check for under-linked pages:
```bash
kb read <filename> --links
```

If a page has 0-1 links, it's likely under-connected. Read it, identify related topics, and add links.

### Step 4: Review category consistency

```bash
kb categories
kb list --category <each-category>
```

Look for:
- Categories with only 1-2 docs (maybe merge into another)
- Docs miscategorized (move via `kb update <id> --category <correct>`)
- Inconsistent naming (some categories plural, some singular)

### Step 5: Identify stale content

```bash
kb log --limit 50
```

Look for docs that haven't been updated in a long time but cover evolving topics. Read them and check if the information is still current.

### Step 6: Identify knowledge gaps

Review the KB holistically. Look for:
- Topics that are referenced but thin (mentioned in many docs, but the dedicated page is shallow)
- Areas where the KB has depth in one aspect but not related ones (e.g., detailed on "how" but missing "why")
- Questions the user might ask that the KB can't answer well

**Suggest sources to fill gaps.** For each gap identified:
- What specific information is missing?
- What kind of source would fill it? (article, documentation, conversation with someone, experiment)
- If applicable, suggest a web search query that would find relevant material

Report to user: "The KB has gaps in X, Y, Z. Suggested sources to investigate: ..."

This turns lint from a passive health check into an active growth driver for the KB.

### Step 7: Update schema

After any semantic review session:
```bash
kb schema update
```

---

## Rebuilding the index

If the index gets corrupted or you've edited MD files manually:
```bash
kb reindex
```

Drops all index data and rebuilds from MD files (re-computes embeddings).

---

## Maintenance cadence

- `kb lint` — after every ingest session
- `kb lint --fix` — when structural issues found
- Semantic review (Level 2) — every 10-20 ingests or weekly
- `kb schema update` — after structural changes
