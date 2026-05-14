# Lint Workflow — Knowledge Base Maintenance

Two levels of maintenance: structural (automated) and semantic (agent-driven review).

---

## Level 1: Structural Lint (automated)

```bash
kb lint [--format json]
```

Reports:

**Structural** (always actionable):
- **broken** (error): links pointing to non-existent files
- **missing** (error): docs missing required frontmatter (id, title, category)
- **corrupt-id** (error): an index row's id ends in `.md` — pre-fix versions of `kb` planted these when an agent passed `kb update foo.md` instead of `kb update foo`. `--fix` deletes the orphan row; `drift` re-indexes the canonical row.
- **drift** (warning): index out of sync with file content
- **orphan** (warning): docs with zero incoming links

**Retrievability** (soft warnings — see *Frontmatter opt-outs* below):
- **chunk-merge**: section will be auto-merged into the previous chunk (body under ~160 chars or >50% link syntax). Restructure, add to `important_sections` to preserve, or add to `suppress_merge_warn` to silence.
- **long-paragraph**: single paragraph over 1500 chars. Cannot be subdivided by the chunker; risks truncation by the 512-token embedding model. Break into smaller paragraphs.
- **doc-too-short**: body under ~200 words. Centroid embedding is noisy; either expand or fold into a larger doc.
- **doc-too-long**: body over ~1500 words. Split into linked sub-docs (one topic each).

`--format json` returns `{ issues: [...], fixed: N }` for programmatic consumption.

### Auto-fix

```bash
kb lint --fix
```

Fixes broken links (removes dead links, keeps text), drift (re-syncs index), and corrupt-id (removes orphan rows). Retrievability warnings are author-decisions and never auto-fixed.

### Frontmatter opt-outs

Three frontmatter arrays let authors opt out of retrievability warnings when the structure is deliberate. Values are matched case-insensitively.

```yaml
important_sections:        # don't merge these sections even if short / link-heavy
  - TL;DR
  - Status

suppress_merge_warn:       # merge is fine here, just stop warning about it
  - See Also
  - Contacts

suppress_lint:             # silence doc-level soft warnings (justify in commit / log)
  - doc-too-short          # e.g. intentional index page
  - doc-too-long           # e.g. canonical reference that shouldn't split
  - long-paragraph         # e.g. a deliberately unbroken transcript / quote
  - chunk-merge            # silence ALL chunk-merge warnings for this doc
```

- `important_sections` *prevents* the merge (changes chunking behavior).
- `suppress_merge_warn` lets the merge happen but silences the per-section warning.
- `suppress_lint` silences doc-level soft warnings — use only when there's a deliberate reason and note it (e.g. via `kb log add --op lint --details "..."`).

Structural issues (broken, missing) are never suppressible — they're real bugs.

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

#### Resolving contradictions

1. **Check the log**: `kb log` — which doc was updated more recently? Recent entries reflect newer sources.
2. **Check authority**: primary sources (official docs, direct observation) beat secondary sources (blog posts, summaries).
3. **Check specificity**: specific, concrete claims supersede vague or general ones.
4. **When clear winner exists**: update the stale doc, noting what changed and why.
5. **When unclear**: merge into one authoritative page, or flag both with "⚠️ Unresolved conflict — needs user verification" and report to user.

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

Look for docs that haven't been updated in a long time but cover evolving topics.

Cross-reference with document metadata:
```bash
kb read <filename> --meta
```

A doc is likely stale if:
- Its `updated` date is old relative to other docs in the same category
- It covers a fast-moving topic (tools, APIs, infrastructure) but hasn't been touched
- Related docs have been updated since, suggesting the landscape changed
- The log shows recent activity around the same topic but this doc wasn't touched

Read stale candidates and check if the information is still current. Update or flag for user review.

### Step 6: Identify knowledge gaps

Review the KB holistically. Look for:
- Topics that are referenced but thin (mentioned in many docs, but the dedicated page is shallow)
- Areas where the KB has depth in one aspect but not related ones (e.g., detailed on "how" but missing "why")
- Questions the user might ask that the KB can't answer well

**Suggest sources to fill gaps.** For each gap identified, produce actionable recommendations:

| Gap | What's missing | Suggested source type | Search query |
|-----|---------------|----------------------|--------------|
| Example | How auth tokens are rotated | Internal documentation | `"token rotation" site:docs.internal.com` |

Always provide:
- A concrete description of what information is missing
- What kind of source would fill it (docs, article, conversation, experiment, code reading)
- A ready-to-use web search query or internal resource to check

This turns lint from a passive health check into an active growth driver for the KB.

### Step 7: Log the session

Record what was found and fixed:

```bash
kb log add --op lint --details "Semantic review: found X contradictions, Y stale docs, Z gaps. Fixed: [summary of changes]"
```

### Step 8: Update schema

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
