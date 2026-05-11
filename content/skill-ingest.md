# Ingest Workflow — Storing New Knowledge

Follow these steps when receiving new information to store.

## Determine scale

Before starting, assess the input:
- **Small fact / single concept** → Simple ingest (Step 1 below)
- **Large document / article / transcript / multi-topic input** → Decomposition ingest (Step 1D below)

---

## Simple Ingest (single concept)

### Step 1: Search for existing knowledge

**CLI:**
```bash
kb search "<key concepts from the new information>"
```

**API:**
```
GET /api/search?q=<key concepts>&limit=10&kb=<name>
```

If a highly relevant doc exists (score > 0.03), go to Step 2a. Otherwise Step 2b.

### Step 2a: Update existing document

**CLI:**
```bash
kb read <filename>
```

**API:**
```
GET /api/read/<filename>?kb=<name>
```

Review the existing content. Then either:

**CLI:**
- Append new info: `kb update <id> --append "\n\n## New Section\n\ncontent..."`
- Replace with merged content: `kb update <id> --content "full merged content"`

**API:**
```
PUT /api/docs/<id>
body: { "append": "\n\n## New Section\n\ncontent..." }
PUT /api/docs/<id>
body: { "content": "full merged content" }
```

### Step 2b: Create new document

Check existing categories and schema:

**CLI:**
```bash
kb categories
kb schema
```

**API:**
```
GET /api/categories?kb=<name>
GET /api/schema?kb=<name>
```

Create the document:

**CLI:**
```bash
kb add --title "Descriptive Title" --category <category> --tags "tag1,tag2" --content "content with [links](./related-doc.md)"
```

**API:**
```
POST /api/docs
body: { "title": "Descriptive Title", "category": "<category>", "tags": ["tag1","tag2"], "content": "content with [links](./related-doc.md)" }
```

For large content, use `--file <path>` or pipe via `--stdin` (CLI only).

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

**CLI:**
```bash
# Check if it exists
kb search "<entity/concept name>"

# If exists: read and update
kb read <filename>
kb update <id> --append "\n\n## From [Source Title]\n\nnew information..."

# If new: create with links to related pages
kb add --title "Entity Name" --category <category> --tags "..." --content "..."
```

**API:**
```
GET /api/search?q=<entity/concept name>&limit=10&kb=<name>

GET /api/read/<filename>?kb=<name>
PUT /api/docs/<id>
body: { "append": "\n\n## From [Source Title]\n\nnew information..." }

POST /api/docs
body: { "title": "Entity Name", "category": "<category>", "tags": ["..."], "content": "..." }
```

### Step 4D: Create a summary page (optional)

For substantial sources, create a summary page that links to all the pages it touched:

**CLI:**
```bash
kb add --title "Summary: Source Title" --category summaries --tags "summary,source-name" --content "## Key takeaways\n\n- Point 1 (see [Entity](./entity.md))\n- Point 2 (see [Concept](./concept.md))\n..."
```

**API:**
```
POST /api/docs
body: { "title": "Summary: Source Title", "category": "summaries", "tags": ["summary","source-name"], "content": "## Key takeaways\n\n..." }
```

### Step 5D: Cross-link everything

Every page created or updated should link to related pages. Use `kb related <id>` to find candidates:

**CLI:**
```bash
kb related <new-doc-id>
```

**API:**
```
GET /api/docs/<new-doc-id>/related?kb=<name>&limit=10
```

Update related docs to link back:

**CLI:**
```bash
kb update <related-id> --append "\n\nSee also: [New Topic](./new-topic.md)"
```

**API:**
```
PUT /api/docs/<related-id>
body: { "append": "\n\nSee also: [New Topic](./new-topic.md)" }
```

---

## After every ingest (MANDATORY)

### Sync related knowledge

Search for docs that might now contain outdated or contradictory information:

**CLI:**
```bash
kb search "<key facts from new content>"
```

**API:**
```
GET /api/search?q=<key facts>&limit=10&kb=<name>
```

Read each result. If any contain stale info, update them.

### Update schema

**CLI:**
```bash
kb schema update
```

**API:**
```
POST /api/schema?kb=<name>
```

### Verify

**CLI:**
```bash
kb lint
```

**API:**
```
GET /api/lint?kb=<name>
```

Should report no broken links or drift.

---

## Guidelines

- **Title**: specific and descriptive ("React Query Caching Strategy" not "Notes")
- **Category**: check `kb categories` and `kb schema` first; reuse existing
- **Tags**: 2-5 short keywords for discoverability
- **Size**: target 50-200 lines per doc; split if larger
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

