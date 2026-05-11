# Phase 3: Implementation Planning

## Implementation Steps (Sequential)

Each step is an atomic, testable unit of work. Steps are executed sequentially via coding subagents.

---

## Step 1: Project Scaffold

**Goal**: Working moostjs CLI app that boots and responds to `aimem --help`.

**Tasks**:
- Initialize pnpm project with proper package.json (name: `ai-memory`, bin: `aimem`)
- Install dependencies: `@moostjs/cli`, `@atscript/db`, `@atscript/db-sqlite`, `better-sqlite3`, `typescript`
- Set up tsconfig.json (ESM, Node 22, strict)
- Create `src/main.ts` with moostjs CLI app bootstrap
- Create `src/app.controller.ts` with root controller (just `--version` and `--help`)
- Add build script (tsc or esbuild/tsup)
- Verify: `pnpm build && node dist/main.js --help` prints usage

**Subagent skills**: `moostjs`, `atscript`

---

## Step 2: Config Service + KB Management

**Goal**: `aimem kb create/list/delete/info` commands work. Config file readable/writable.

**Tasks**:
- Create `src/services/config.service.ts`:
  - Reads/writes `~/.ai-memory/config.json`
  - Default config: `{ defaultKb: "default", dataDir: "~/.ai-memory", embeddingModel: "all-MiniLM-L6-v2" }`
  - Auto-creates data dir on first access
- Create `src/controllers/kb.controller.ts`:
  - `kb create <name>` — creates `<dataDir>/<name>/docs/` directory + empty `index.db`
  - `kb list` — lists directories in dataDir that contain `docs/`
  - `kb delete <name>` — removes KB directory (with confirmation prompt)
  - `kb info <name>` — doc count, total size, last modified
- Create `src/controllers/config.controller.ts`:
  - `config get <key>`, `config set <key> <value>`, `config list`
- Wire into app module
- Verify: `aimem kb create test && aimem kb list && aimem kb info test && aimem kb delete test`

**Subagent skills**: `moostjs`

---

## Step 3: Storage Service + MD Parser

**Goal**: Can read/write MD files with frontmatter. Can extract links from content.

**Tasks**:
- Install: `gray-matter` (frontmatter parsing), `remark`, `remark-parse`, `mdast-util-to-string`
- Create `src/services/parser.service.ts`:
  - `parse(mdContent)` → `{ frontmatter, body, links[] }`
  - Frontmatter: extract id, title, category, tags, created, updated
  - Links: extract all `[text](./file.md)` patterns from body → `{ text, target }`
  - Also handle bare `(./file.md)` links
- Create `src/services/storage.service.ts`:
  - `resolvePath(kb, filename)` → absolute path to file in KB's docs/
  - `readDoc(kb, filename)` → parsed MD (frontmatter + body + links)
  - `readLines(kb, filename, start, end)` → specific lines with line numbers
  - `writeDoc(kb, filename, frontmatter, body)` → writes MD file (frontmatter + body)
  - `deleteDoc(kb, filename)` → removes file
  - `listFiles(kb)` → all .md filenames in docs/
  - `renameDoc(kb, oldName, newName)` → renames file on disk
  - `docExists(kb, filename)` → boolean
- Create `src/utils/slug.ts`: title → slug (lowercase, hyphens, no special chars)
- Create `src/utils/hash.ts`: content → SHA-256 hex string
- Verify: unit tests for parser (link extraction, frontmatter) and storage (read/write round-trip)

**Subagent skills**: `moostjs`

---

## Step 4: SQLite Schema + Index Service

**Goal**: SQLite database with documents, FTS5, and links tables. CRUD operations working.

**Tasks**:
- Create atscript models in `src/models/`:
  - `document.as` — id, title, category, tags (JSON), content, file_path, content_hash, created_at, updated_at
  - `link.as` — from_id, to_id, link_text
  - `chunk.as` — id, doc_id, heading, content, position, content_hash
- Create `src/services/index.service.ts`:
  - `initDb(kb)` — open/create SQLite DB, create tables if not exist (including FTS5 + triggers)
  - `upsertDoc(doc)` — insert or update document record + FTS5 entry
  - `deleteDoc(id)` — remove from all tables
  - `getDoc(id)` → document record
  - `listDocs(filters?)` → filtered list
  - `upsertLinks(docId, links[])` — replace links for a doc
  - `getLinksFrom(id)` → outgoing links
  - `getLinksTo(id)` → incoming links (backlinks)
  - `searchFts(query, limit)` → FTS5 results with rank
- FTS5 setup: `CREATE VIRTUAL TABLE documents_fts USING fts5(title, content, tags, tokenize='porter unicode61')`
- Verify: can create DB, insert doc, query FTS5, insert/query links

**Subagent skills**: `atscript`, `atscript-db`, `moostjs`

---

## Step 5: Read Controller (Virtual Filesystem)

**Goal**: `aimem read <filename>` works with all options (lines, meta, links, follow).

**Tasks**:
- Create `src/controllers/read.controller.ts`:
  - `read <path>` — full document with header (filename, line count, tags, links list) + numbered lines
  - `read <path> --lines <start>-<end>` — specific line range only
  - `read <path> --meta` — frontmatter as JSON output
  - `read <path> --links` — list outgoing links (from links table)
  - `read <path> --follow <link>` — resolve `./target.md` → read that file instead
- Output formatting: header line, separator, numbered content lines
- Handle: file not found, invalid line range, broken follow link
- Verify: add a doc manually, test all read modes

**Subagent skills**: `moostjs`

---

## Step 6: Document Operations (add, update, delete, list)

**Goal**: Full CRUD via CLI — `aimem add`, `aimem update`, `aimem delete`, `aimem list`.

**Tasks**:
- Create `src/controllers/doc.controller.ts`:
  - `add --title --category [--tags] [--content] [--file] [--stdin]`:
    - Generate ID from title (slug)
    - Check for duplicate ID
    - Write MD file (frontmatter + body)
    - Parse links from content
    - Index in SQLite (metadata + FTS5 + links)
    - Compute content hash
    - Warn if links point to non-existent files
    - Output: created file path + any warnings
  - `update <id> [--title] [--tags] [--category] [--content] [--append]`:
    - Read existing doc
    - Apply changes (merge frontmatter, replace or append content)
    - Update file + index
    - Re-parse links, update links table
    - Warn about new broken links
  - `delete <id>`:
    - Remove file
    - Remove from index (all tables)
    - Scan links table for incoming links → warn about newly broken links
  - `list [--category] [--tag] [--format]`:
    - Query index with optional filters
    - Output: table (id, title, category, tags, updated) or JSON
- Verify: full add→read→update→list→delete cycle

**Subagent skills**: `moostjs`

---

## Step 7: Rename + Link Integrity

**Goal**: `aimem rename <old> <new>` renames file and updates all cross-references.

**Tasks**:
- Add to doc controller:
  - `rename <old-id> <new-id>`:
    - Validate new-id doesn't exist
    - Rename file: `old-id.md` → `new-id.md`
    - Update frontmatter `id:` field in renamed file
    - Scan ALL other MD files for `[...](./old-id.md)` → replace with `[...](./new-id.md)`
    - Update SQLite: document record (id, file_path), links table (both from_id and to_id references)
    - Update FTS5 entry
    - Report: "Renamed old-id → new-id. Updated N links in M documents."
- Create `src/services/linker.service.ts`:
  - `findBrokenLinks(kb)` → list of { from, to, linkText } where target doesn't exist
  - `findOrphans(kb)` → docs with zero incoming links
  - `updateLinksInFile(kb, filename, oldTarget, newTarget)` → rewrite links in a file
  - `getBacklinks(kb, docId)` → all docs linking to this one
- Verify: create 3 docs with links between them, rename one, verify links updated

**Subagent skills**: `moostjs`

---

## Step 8: Embeddings Service

**Goal**: Can compute embeddings locally. Model auto-downloads on first use.

**Tasks**:
- Install: `@huggingface/transformers`
- Create `src/services/embedding.service.ts`:
  - `init()` — lazy load model (all-MiniLM-L6-v2) on first call
  - `embed(text)` → Float32Array (384 dimensions)
  - `embedBatch(texts[])` → Float32Array[] (for bulk operations)
  - Model caching: store in `~/.ai-memory/models/` (configurable)
  - Content-hash check: skip re-embedding if hash unchanged
- Install: `sqlite-vec`
- Extend index.service.ts:
  - Create `documents_vec` table (vec0 virtual table, 384 dims)
  - `upsertVec(id, embedding)` — store vector
  - `searchVec(queryEmbedding, limit)` → KNN results with distance
- Verify: embed a string, store in vec table, query returns nearest match

**Subagent skills**: `moostjs`

---

## Step 9: Hybrid Search

**Goal**: `aimem search "<query>"` returns ranked results from semantic + keyword search.

**Tasks**:
- Create `src/services/search.service.ts`:
  - `search(kb, query, limit)`:
    - Compute query embedding
    - Run in parallel: sqlite-vec KNN (top 2×limit) + FTS5 search (top 2×limit)
    - Merge via Reciprocal Rank Fusion: `score = Σ 1/(60 + rank_i)`
    - Return: top `limit` results with { id, title, category, score, snippet }
  - Snippet generation: extract ~150 chars around best FTS5 match or first paragraph
- Create `src/controllers/search.controller.ts`:
  - `search "<query>" [--limit N] [--format json|table]`
  - Table output: id | title | category | score | snippet (truncated)
  - JSON output: full result objects
- Verify: add 5+ docs, search with semantic query, verify ranking makes sense

**Subagent skills**: `moostjs`

---

## Step 10: Lint + Reindex + TOC

**Goal**: `aimem lint`, `aimem reindex`, `aimem toc` maintenance commands.

**Tasks**:
- Create `src/controllers/lint.controller.ts`:
  - `lint [--fix]`:
    - Scan all docs for broken links (target file doesn't exist)
    - Find orphans (no incoming links)
    - Check missing frontmatter fields (id, title, category)
    - Check duplicate IDs
    - Check index drift (content_hash mismatch between file and DB)
    - Report as table: type | severity | file | details
    - `--fix`: remove broken links from file content, re-index drifted docs
- Create `src/controllers/reindex.controller.ts`:
  - `reindex`:
    - Drop all SQLite data (not the schema)
    - Scan all MD files
    - Re-parse frontmatter, body, links
    - Re-compute embeddings (with progress bar)
    - Rebuild all tables (metadata, FTS5, links, vectors)
    - Report: "Reindexed N documents in Xs"
- Add `toc` command:
  - `toc` — regenerate `index.md` in KB root
  - Group by category, sorted alphabetically
  - Format: `## Category\n- [Title](./docs/filename.md)\n`
- Verify: corrupt an index manually, run reindex, verify recovery

**Subagent skills**: `moostjs`

---

## Step 11: Integration Testing

**Goal**: End-to-end tests covering the full agent workflow.

**Tasks**:
- Set up test framework (vitest or node:test)
- Test scenarios:
  - Fresh install: first command creates default KB
  - Full lifecycle: add → read → update → search → rename → lint → delete
  - Link integrity: add linked docs, rename one, verify links updated
  - Search quality: add diverse docs, verify semantic search returns relevant results
  - Reindex: modify files on disk, reindex, verify index matches
  - Edge cases: duplicate IDs, missing frontmatter, empty content, very long docs (chunking)
- CLI integration tests: spawn process, verify stdout/stderr/exit codes

---

## Step 12: Skill Creation

**Goal**: Agent skill file that teaches AI agents how to use the CLI effectively.

**Tasks**:
- Create skill using skill-creator skill
- Skill content:
  - When to use (any knowledge management task)
  - Navigation pattern: search → read → follow links
  - Ingestion pattern: search for overlap → decide new vs update → add/update → lint
  - Reading pattern: read full or chunked (--lines), follow links for depth
  - All command reference with examples
  - Best practices (search before add, meaningful titles, good categories, link related docs)

**Subagent skills**: `skill-creator`

---

## Dependency Graph

```
Step 1 (scaffold)
  ├→ Step 2 (config + KB)
  │    └→ Step 4 (SQLite schema)
  │         ├→ Step 5 (read controller)
  │         ├→ Step 6 (doc operations) ← Step 3
  │         │    └→ Step 7 (rename + links)
  │         │         └→ Step 10 (lint + reindex)
  │         └→ Step 9 (search) ← Step 8 (embeddings)
  └→ Step 3 (storage + parser)
  └→ Step 8 (embeddings)

Step 11 (testing) ← all above
Step 12 (skill) ← all above
```

## Execution Notes

- After each step: run `simplify` skill on changes > 10 LOC
- After each step: review and commit
- Steps 1-7 form the core (no AI/embeddings needed — pure CRUD + FS)
- Steps 8-9 add the "smart" layer (embeddings + semantic search)
- Step 10 adds maintenance tooling
- Steps 11-12 are polish
