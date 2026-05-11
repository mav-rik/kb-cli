# Solution Design: ai-memory CLI

## Package Name

`ai-memory` (npm global install: `pnpm add -g ai-memory`, binary: `aimem`)

## CLI Command Design

### Knowledge Base Management

```bash
aimem kb list                          # list all knowledge bases
aimem kb create <name>                 # create a new KB
aimem kb delete <name>                 # delete a KB (with confirmation)
aimem kb info <name>                   # show KB stats (doc count, size, last updated)
```

### Reading Documents (CLI as Virtual Filesystem)

The CLI is the **sole read interface** for agents. Agents never access MD files directly.
This gives us control over formatting, line numbering, metadata, and link resolution.

```bash
# Read a document (streams to stdout with line numbers)
aimem read [--kb <name>] <path>                    # full document (e.g., "concepts/kubernetes.md")
aimem read [--kb <name>] <path> --lines 160-240    # specific line range (for chunked reading)
aimem read [--kb <name>] <path> --meta             # frontmatter/metadata only (JSON)
aimem read [--kb <name>] <path> --links            # list all outgoing links from this document

# Follow a link from a document (resolves to target in same docs/ dir)
aimem read [--kb <name>] <path> --follow <link>    # resolve link and read target
# Example: aimem read kubernetes.md --follow "./api-redesign.md"
```

**Read output format** (when reading content):
```
=== kubernetes.md (lines 1-45 of 45) ===
Tags: container, orchestration, devops
Links: ./api-redesign.md, ./docker.md
---
1  | # Kubernetes
2  | 
3  | Container orchestration platform...
...
45 | See [API Redesign](./api-redesign.md) for migration plan.
```

This format gives the agent: file identity, total line count, tags, outgoing links, and numbered content for precise line-range follow-ups.

### Document Operations

```bash
# Add a new document
aimem add [--kb <name>] --title "..." --category <cat> [--tags "t1,t2"] [--content "..."]
aimem add [--kb <name>] --file <path>   # ingest from file (parses frontmatter if present)
aimem add [--kb <name>] --stdin         # read content from stdin

# Update existing document
aimem update [--kb <name>] <id> [--title "..."] [--tags "..."] [--content "..."] [--append "..."]

# Rename a document (updates all links across KB)
aimem rename [--kb <name>] <old-id> <new-id>

# Delete a document
aimem delete [--kb <name>] <id>

# List documents
aimem list [--kb <name>] [--category <cat>] [--tag <tag>] [--format json|table]
```

### Search

```bash
# Hybrid search (semantic + keyword)
aimem search [--kb <name>] "<query>" [--limit 10] [--format json|table]

# Output includes path for each result so agent can immediately `aimem read` it:
# path, title, category, score, snippet (truncated content around match)
```

### Maintenance

```bash
aimem lint [--kb <name>]               # report broken links, orphans, missing fields
aimem lint [--kb <name>] --fix         # auto-fix what's possible (remove broken links)
aimem reindex [--kb <name>]            # rebuild SQLite index from MD files
aimem toc [--kb <name>]                # regenerate index.md table of contents
```

### Configuration

```bash
aimem config get <key>                  # get a config value
aimem config set <key> <value>          # set a config value
aimem config list                       # show all config
```

**Config keys**: `default-kb`, `embedding-model`, `data-dir`, `chunk-max-tokens`

### Global Flags

- `--kb <name>` — target knowledge base (default: value of `default-kb` config, fallback: "default")
- `--format json|table|md` — output format (default: table for terminals, json for piped output)
- `--quiet` / `-q` — minimal output
- `--verbose` / `-v` — detailed output

## SQLite Schema (atscript)

### documents table

```
documents {
  id          TEXT PRIMARY KEY     -- slug derived from title (e.g., "api-redesign")
  title       TEXT NOT NULL
  category    TEXT                 -- concepts, projects, people, decisions, references
  tags        TEXT                 -- JSON array: ["api", "architecture"]
  content     TEXT                 -- full markdown body (no frontmatter)
  file_path   TEXT NOT NULL        -- relative path within KB docs/
  content_hash TEXT                -- SHA-256 of content (for change detection)
  created_at  TEXT NOT NULL        -- ISO 8601
  updated_at  TEXT NOT NULL        -- ISO 8601
}
```

### documents_fts (FTS5 virtual table)

```
documents_fts {
  id          -- reference to documents.id
  title
  content
  tags
}
-- tokenize='porter unicode61'
```

### documents_vec (sqlite-vec vec0 virtual table)

```
documents_vec {
  id          TEXT PRIMARY KEY
  embedding   FLOAT[384]          -- all-MiniLM-L6-v2 output
}
```

### links table

```
links {
  from_id     TEXT NOT NULL        -- source document id (= filename without .md)
  to_id       TEXT NOT NULL        -- target document id (= filename without .md)
  link_text   TEXT                 -- display text from [text](./file.md)
  PRIMARY KEY (from_id, to_id)
}
```

### chunks table (for long documents)

```
chunks {
  id          TEXT PRIMARY KEY     -- "{doc_id}#chunk-{n}"
  doc_id      TEXT NOT NULL        -- parent document
  heading     TEXT                 -- section heading this chunk belongs to
  content     TEXT NOT NULL        -- chunk text
  position    INTEGER              -- order within document
  content_hash TEXT
}
```

### chunks_vec (sqlite-vec for chunk-level embeddings)

```
chunks_vec {
  id          TEXT PRIMARY KEY     -- matches chunks.id
  embedding   FLOAT[384]
}
```

## Module Architecture (moostjs)

```
src/
├── main.ts                        # CLI entry point, Moost app bootstrap
├── app.module.ts                  # root module, registers all controllers
├── controllers/
│   ├── kb.controller.ts           # kb create/list/delete/info
│   ├── read.controller.ts         # read (with lines, meta, links, follow)
│   ├── doc.controller.ts          # add/update/delete/list
│   ├── search.controller.ts       # search command
│   ├── lint.controller.ts         # lint/toc commands
│   ├── reindex.controller.ts      # reindex command
│   └── config.controller.ts       # config get/set/list
├── services/
│   ├── storage.service.ts         # MD file read/write/delete, path resolution
│   ├── index.service.ts           # SQLite operations (CRUD, FTS, links)
│   ├── embedding.service.ts       # model loading, text → vector
│   ├── search.service.ts          # hybrid search orchestration (vec + FTS + rank)
│   ├── parser.service.ts          # MD parsing (frontmatter, body, relative links)
│   ├── linker.service.ts          # link resolution, graph traversal, broken link detection
│   └── config.service.ts          # config file read/write
├── models/                        # atscript .as schema files
│   ├── document.as
│   ├── chunk.as
│   └── link.as
└── utils/
    ├── slug.ts                    # title → id slug generation
    ├── hash.ts                    # content hashing (SHA-256)
    └── format.ts                  # output formatting (table, json, md)
```

## Key Design Decisions

### 1. MD as Source of Truth, SQLite as Derived

- Users can edit MD files manually — `reindex` rebuilds the DB.
- On `add`/`update` via CLI, both MD file and SQLite are written atomically.
- Content hash detects drift between MD and index on `lint`.

### 2. Relative Path Links (Flat Structure)

- All documents in flat `docs/` directory — no subdirectories.
- Link format: `[Display Text](./filename.md)` — always same directory.
- Parsed from body content during indexing.
- Stored in `links` table for graph traversal.
- **On rename**: CLI scans all docs, updates links pointing to old filename → new filename.
- **On add**: warns if new doc contains links to non-existent files.
- **On delete**: warns which docs now have broken links to the deleted file.
- `lint` reports all broken links, orphans, and suggests fixes.

### 3. Categories as Metadata (not directories)

- Category lives in frontmatter `category:` field only.
- Indexed in SQLite, queryable via `aimem list --category <cat>`.
- Default categories: `concepts`, `projects`, `people`, `decisions`, `references`, `misc`.
- Custom categories allowed — just use any string in frontmatter.
- Changing category = `aimem update <id> --category <new>` — no file move, no broken links.

### 4. Chunking Strategy

- Documents ≤ 512 tokens: single embedding (stored in `documents_vec`).
- Documents > 512 tokens: split by heading sections. Each chunk gets its own embedding in `chunks_vec`. Document also gets a mean-pooled embedding.
- Search queries against both `documents_vec` and `chunks_vec`, deduplicates by doc_id.

### 5. Search Ranking (Reciprocal Rank Fusion)

```
score(doc) = Σ 1/(k + rank_i)
```

Where `k=60` (standard RRF constant), and `rank_i` is the document's rank in each individual result list (semantic, keyword). This avoids score normalization issues between different search methods.

### 6. ID Generation

- Derived from title via slugification: `"API Redesign Project"` → `"api-redesign-project"`
- Must be unique within a KB.
- If collision, append numeric suffix: `"api-redesign-project-2"`
- ID is immutable after creation (renaming title doesn't change ID).

### 7. Output Format Auto-detection

- If stdout is a TTY: default to `table` format (human-readable).
- If stdout is piped: default to `json` format (machine-readable for agents).
- Explicit `--format` flag overrides auto-detection.

## Skill Design (for AI agents)

The CLI acts as a **virtual filesystem** for the knowledge base. The skill instructs agents to:

1. **Never read KB files directly** — always use `aimem read` (provides line numbers, link lists, metadata).
2. **Navigation pattern**: `search` → `read` → `follow links` → `read` (drill into related knowledge).
3. **Chunked reading for large docs**: Use `--lines` to read in manageable chunks (e.g., 80 lines at a time).
4. **Before adding**: Search first to avoid duplicates. If related doc exists, update instead.
5. **Categorization**: Choose appropriate category based on content type.
6. **Linking**: When writing content, add relative-path links to related docs discovered via search.
7. **Ingestion workflow**:
   - Receive raw input from user
   - `aimem search` existing KB for overlaps
   - Decide: new doc or update existing
   - Format proper frontmatter + body with relative links
   - `aimem add` or `aimem update`
   - `aimem lint` to verify integrity
8. **Retrieval workflow**:
   - `aimem search "<query>"` — find relevant docs (returns paths + snippets)
   - `aimem read <path>` — read full content (or `--lines` for chunks)
   - Spot links in content → `aimem read <path> --follow <link>` to explore related docs
   - `aimem read <path> --links` — see all outgoing links without reading full content
   - `aimem list --category` — browse by category

## Error Handling & Link Integrity

- Missing KB: auto-create "default" KB on first use; error for other names with suggestion to create.
- Duplicate ID: error with suggestion (existing doc title shown).
- **On `add`**: warns if new doc contains links to non-existent files (not blocking — target may be added later).
- **On `delete`**: warns which docs now have broken links to the deleted file.
- **On `rename`**: atomically renames file + updates all links across KB + updates index. Reports how many links were updated.
- Missing model: auto-download on first embedding operation with progress indicator.
- Corrupt index.db: suggest `aimem reindex` to rebuild.

## Future Extensions (not in v1)

- `aimem watch` — filesystem watcher for auto-reindex on MD changes
- `aimem export` — export KB as single file (zip/tar)
- `aimem import` — import from external formats (Obsidian vault, Notion export)
- MCP server mode (`aimem mcp`) — expose as Model Context Protocol server
- Graph visualization (`aimem graph` → DOT format)
- Configurable embedding models (nomic-embed, gte-small)
- Remote sync (git-based or CRDT)
