# Ingest Workflow — Storing New Knowledge

## Quick start

The whole loop, in five commands:

```bash
kb search "<topic>"                                  # 1. search — find existing seeds
kb read <id>                                         # 2. read   — load context
kb update <id> --append "..."                        # 3. update — extend an existing doc when it fits
# — or —
kb add --title "..." -c <cat> --dry-run --content "..."   # 3. add (dry-run) — preview lint
kb add --title "..." -c <cat> --content "..."             # 4. add        — commit the new doc
kb update <existing-id> --append "See also: [...](./new.md)"  # 5. link back — wire the new node into the graph
```

Read the rest of this file before doing real ingest work — the rules below are what make a doc actually findable later.

---

You are not just writing a document — you are adding a node to a graph that future agents will discover and traverse. Every ingestion decision should be made with that in mind.

## How knowledge gets discovered later

A future agent will find what you write through two mechanisms:

1. **Search** — by query terms and semantic similarity. Titles, headings, and the opening lines of a page weigh heavily in ranking. Pick terms a future searcher would actually use, not internal jargon.
2. **Crawling** — by following links outward from seed pages. A page with **no incoming links is invisible** until someone happens to search for its exact topic. Cross-references are pre-computed reasoning: when you link page A to page B, you're telling future agents "if you're reading A, B is worth reading too."

So when you ingest:

- **Decompose into atomic, linked pages**, not monoliths. Small notes are easier to discover, cite, and recombine.
- **Choose titles that match how someone would search**, not how the source phrased it.
- **After creating a new page, link FROM existing related pages back to it** — otherwise it can't be reached by traversal.
- **Place the most searchable terms in the title, first heading, and opening sentence.**

Bad ingest = a dead-end page no one will ever reach. Good ingest = a well-placed node in the graph that pulls its weight in future queries.

## Step 0: Discuss with user

Before writing anything to the wiki, briefly discuss key takeaways:
- What are the most important points in this source?
- Are there claims that might conflict with existing knowledge?
- What should be emphasized or de-emphasized?

Skip only if the user explicitly asks for hands-off ingestion (e.g. batch processing).

## Determine scale

Before starting, assess the input:
- **Small fact / single concept** → Simple ingest (Step 1 below)
- **Large document / article / transcript / multi-topic input** → Decomposition ingest (Step 1D below)

---

## Simple Ingest (single concept)

### Step 1: Search for existing knowledge

```bash
kb search "<key concepts from the new information>"
```

If a highly relevant doc exists (score > 0.03), go to Step 2a. Otherwise Step 2b.

### Step 2a: Update existing document

```bash
kb read <filename>
```

Review the existing content. Then either:

- Append new info: `kb update <id> --append "\n\n## New Section\n\ncontent..."`
- Replace with merged content: `kb update <id> --content "full merged content"`

### Step 2b: Create new document

Check existing categories and schema:

```bash
kb categories
kb schema
```

**Iterate with `--dry-run` first.** `kb add --dry-run` returns the per-doc lint result (chunk-merge, long-paragraph, doc-too-short, doc-too-long, missing frontmatter) without writing or indexing. Use it to catch retrievability issues before the doc lands in search:

```bash
kb add --title "Descriptive Title" --category <category> --tags "tag1,tag2" --content "..." --dry-run
# Reshape content / add important_sections / suppress_lint, repeat until clean.

kb add --title "Descriptive Title" --category <category> --tags "tag1,tag2" --content "content with [links](./related-doc.md)"
# Real run also returns lint warnings (always-on), so you'll see anything left over.
```

For large content, use `--file <path>` or pipe via `--stdin`. **`kb update --file <path>` works too** — replaces the doc body, parses optional frontmatter (CLI flags win; file frontmatter fills gaps). Cleaner than `--content "$(cat file)"` for wiki-sync workflows.

`kb update --dry-run` works the same way — applies the patch (`--content`, `--append`, or `--file`) in memory, lints the merged result, and returns the issues without touching the index.

> **For intentional index/landing/list sections, prefer frontmatter suppression over living with warnings.** Lint output now prints the exact remediation pointer for each issue: `important_sections` (preserve a short section from auto-merge), `suppress_merge_warn` (allow the merge but stop warning), and `suppress_lint` (silence doc-level soft warnings: `chunk-merge`, `doc-too-short`, `doc-too-long`, `long-paragraph`). Required frontmatter (`id`, `title`, `category`) is still mandatory even when using suppressions.

---

## Decomposition Ingest (large/multi-topic source)

When ingesting a long article, transcript, report, or any source covering multiple topics — **decompose it into multiple wiki pages**. A single source should touch 5-15 wiki pages.

### Step 1D: Analyze the source

Read the source material and identify:
- **Entities**: people, projects, tools, companies mentioned
- **Concepts**: ideas, patterns, techniques explained
- **Decisions**: choices made, trade-offs discussed
- **Facts**: specific claims, data points, dates

### Step 2D: Plan the decomposition

For each identified element, decide:
- Does a wiki page already exist for it? → **Update** that page
- Is it substantial enough for its own page? → **Create** a new page
- Is it a minor detail? → Fold it into the most relevant existing page

### Step 3D: Execute

For each page to create or update:

```bash
# Check if it exists
kb search "<entity/concept name>"

# If exists: read and update
kb read <filename>
kb update <id> --append "\n\n## From [Source Title]\n\nnew information..."

# If new: create with links to related pages
kb add --title "Entity Name" --category <category> --tags "..." --content "..."
```

### Step 4D: Create a summary page (optional)

For substantial sources, create a summary page that links to all the pages it touched:

```bash
kb add --title "Summary: Source Title" --category summaries --tags "summary,source-name" --content "## Key takeaways\n\n- Point 1 (see [Entity](./entity.md))\n- Point 2 (see [Concept](./concept.md))\n..."
```

### Step 5D: Cross-link everything

Every page created or updated should link to related pages. Use `kb related <id>` to find candidates:

```bash
kb related <new-doc-id>
```

Update related docs to link back:

```bash
kb update <related-id> --append "\n\nSee also: [New Topic](./new-topic.md)"
```

---

## After every ingest (MANDATORY)

### Sync related knowledge

Search for docs that might now contain outdated or contradictory information:

```bash
kb search "<key facts from new content>"
```

Read each result. If any contain stale info, resolve the conflict:

#### Conflict resolution protocol

When new information contradicts existing wiki content:

1. **Check recency**: run `kb log` — which doc was updated more recently? Newer sources generally win.
2. **Check authority**: is one source more authoritative than the other? (primary vs secondary, official docs vs blog post)
3. **Check specificity**: a specific claim ("rotation period is 30 days") supersedes a general one ("credentials are rotated regularly").
4. **If unclear**: flag the contradiction explicitly in both docs with a note like "⚠️ Conflicts with [other-doc](./other-doc.md) — needs verification" and ask the user.
5. **When updating**: don't just overwrite — note what changed and why (e.g., "Updated from 90→30 days per [source]").

### Log the session

After completing the ingest, record a summary entry:

```bash
kb log add --op ingest --details "Ingested [source description]: created X pages, updated Y pages. Key insight: [one-line summary]"
```

### Update schema

```bash
kb schema update
```

### Verify

```bash
kb lint --fix
```

Should report no broken links or drift.

---

## Guidelines

- **Title**: specific and descriptive ("React Query Caching Strategy" not "Notes")
- **Category**: check `kb categories` and `kb schema` first; reuse existing
- **Tags**: 2-5 short keywords for discoverability
- **Size**: target 50-500 lines per doc; split if larger
- **Links**: add `[Display Text](./filename.md)` for every related concept
- **One concept per page**: don't cram multiple topics into one doc
- **Decompose aggressively**: a 3-page article should produce 3-8 wiki pages, not 1

## Writing wiki content (not copying source text)

**Never paste source text verbatim.** Wiki pages are synthesized, structured knowledge — not copies.

- **Distill**: extract the key information, discard filler and redundancy
- **Structure**: use headings, bullet points, short paragraphs. Make it scannable.
- **Contextualize**: explain how this relates to other knowledge in the KB (use links)
- **Be factual**: state claims clearly. If something is uncertain, say so.
- **Attribute when relevant**: "According to [source], ..." — but don't over-cite
- **Keep it current**: write as if the page will be read months later. Avoid "recently" or "last week" — use dates.
- **Front-load**: put the most important information first. Details and nuance below.

## Writing for chunked retrieval

Docs are split into chunks by H2/H3 heading at index time; each chunk is independently searchable. This shapes how you should structure new pages:

- **Sections substantive** — at least ~80 words and a topic sentence that restates the subject in plain words (the embedding model anchors on opening tokens; pronouns retrieve poorly).
- **Doc length 200-1500 words** — below 200 the centroid is noisy; above 1500 split into linked sub-docs.
- **Avoid paragraphs over 1500 chars** — they can't be subdivided and risk truncation by the 512-token embedding window.
- **Trivial sections auto-merge** — bodies under ~160 chars or with >50% link syntax fold into the previous chunk. Use `important_sections` (preserve) / `suppress_merge_warn` (silence warning) / `suppress_lint` (silence doc-level soft warnings) in frontmatter when the structure is deliberate.

After ingesting, `kb lint` will flag `chunk-merge`, `long-paragraph`, `doc-too-short`, `doc-too-long` so you can react before the doc lands in the index. See `kb skill update` for the full retrieval-authoring guide and `kb skill lint` for opt-out semantics.
