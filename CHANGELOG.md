# Changelog

All notable changes to this project will be documented in this file. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows semver.

## [0.3.0] — 2026-05-14

Retrieval-quality release. Documents are now chunked by H2/H3 heading and searched chunk-by-chunk, so structure matters — lint warns about retrievability issues and `kb add/update` surface those warnings up-front.

### Added

- **Heading-based chunking** with per-doc cap of 2 chunks per result. Each chunk gets its own embedding; the doc-level embedding is the L2-normalized centroid of its chunks. Skip-embed via per-chunk `contentHash` — editing one section only re-embeds that section.
- **`kb add --dry-run` / `kb update --dry-run`** — lint the to-be-written content without touching the index. Returns the same shape as a real run so agents can iterate before committing.
- **Always-on per-doc lint on `kb add` / `kb update`** — the response now surfaces retrievability warnings about the just-added/updated doc.
- **New lint types**: `chunk-merge` (section too small / link-heavy and will fold into the previous chunk), `long-paragraph` (>1500 chars, will be truncated by embedding model), `doc-too-short` (<200 words, noisy centroid), `doc-too-long` (>1500 words, split into sub-docs).
- **Frontmatter opt-outs** (matched case-insensitively):
  - `important_sections` — prevent merging of named short sections
  - `suppress_merge_warn` — silence chunk-merge warnings for named sections
  - `suppress_lint` — silence doc-level soft warnings (`doc-too-short`, `doc-too-long`, `long-paragraph`, `chunk-merge`)
- **`kb reindex <id>`** — single-doc rebuild (no need to reindex the whole wiki on schema or content drift).
- **`--format json` on `kb lint`** — machine-parseable `{ issues, fixed }` output.
- **HTTP API parity**: `POST /api/docs` and `PUT /api/docs/:id` accept `dryRun` and return `issues[]`. New `POST /api/reindex/:id` endpoint.
- **No-args `kb` now renders the same help as `kb --help`** (routed through the `cliHelpInterceptor` instead of a hand-maintained static command list).
- **`__VERSION__` build-time substitution** from `package.json` — `kb version` always reflects the published version, single source of truth.
- **`kb setup --global` / `-g`** — install user-scope kb integration so it's discoverable from any project without per-project setup. For Claude Code: installs `~/.claude/skills/kb/SKILL.md`, `~/.claude/commands/kb:*.md`, and the CLAUDE.md memo at `~/.claude/CLAUDE.md`. For Codex CLI: writes the memo at `~/.codex/AGENTS.md`. Agents without a documented user-scope file (Cursor, Cline, Windsurf, Continue.dev) are skipped with a clear note.
- **CLAUDE.md / AGENTS.md memo blocks** with `<!-- kb-cli:start v=X --> ... <!-- kb-cli:end -->` markers — `kb setup` now writes a short "kb exists, run `kb skill`" pointer into CLAUDE.md (for Claude Code) or AGENTS.md (for other agents). Re-running `kb setup` rewrites the block in place (idempotent); delete the block to uninstall. Replaces the previous broken substring-based dedup that false-matched on any file containing "kb".
- **`kb resolve <arg>`** (and `GET /api/resolve/:input`) — diagnostic that maps any accepted handle form to its canonical id + filename, says whether the file exists, and offers fuzzy suggestions if not. Use when `kb read` / `kb update` say "not found".
- **`kb wiki list` and `kb status` now mark the effective default wiki** (`*` prefix) and surface its source (`kb.config.json in this directory` vs `global config`) — so agents in a project know which wiki commands will actually target.
- **New lint type `corrupt-id`** (error): flags index rows whose id ends in `.md` — a symptom of the duplicate-row bug below in pre-0.3 wikis. `kb lint --fix` removes the orphan row; `drift` re-indexes the canonical row.

### Fixed

- **`kb reindex` now prints progress** (`\r[N/Total]` on TTY, `[N/Total]` newlines when piped). Previously the CLI sat silent for tens of seconds and looked stuck even though the underlying service supported a progress callback. When `kb reindex` auto-routes through a running `kb serve` (HTTP can't stream progress), prints an up-front "Reindexing via running kb serve (PID …) — this may take a while…" line instead.
- **`kb reindex` now actually compacts the index.** `dropAll` previously did row-level `deleteMany({})` on the typed tables, which doesn't release `sqlite-vec` shadow-chunk storage (vec0 preallocates 1024-slot fixed-size blocks per partition and never reclaims them on delete). It now physically `DROP TABLE`s every doc/chunk/link table — including the vec0 shadow tables — clears the atscript-db sync state (`schema_version`, `synced_tables`, `table_snapshot:*`), `VACUUM`s, and `wal_checkpoint(TRUNCATE)`s before letting `syncSchema` recreate the tables empty.
- **Removed the unused `@db.search.filter 'embedding'` partition key on `Document.category`.** It was creating a separate 1024-slot vec0 shadow chunk (~3 MB at 768-dim) for **every distinct category value** with no callsite that actually filtered vector searches by category. On a 25-doc / 8-category wiki this alone wasted ~21 MB. With both fixes above, the same wiki compacts from ~31 MB to ~9 MB on the next `kb reindex`.
- **`kb update foo.md` no longer plants a phantom index row.** Before: passing an id with the `.md` suffix to `kb update` / `kb delete` / `kb rename` / `kb reindex` created a duplicate index entry with `id="foo.md"` next to the canonical `id="foo"` — `kb toc`, `kb list`, and `kb search` then surfaced both. Now every accepted form (bare id, `.md` in any case, `./` prefix, full disk path, surrounding whitespace, any-case input on case-insensitive filesystems) normalizes to one canonical lowercase id at every public boundary (CLI handlers, HTTP API endpoints, wiki-ops entry, plus `indexAndEmbed` defense-in-depth). Existing wikis with planted `.md`-suffixed rows: run `kb lint --fix` to heal.
- **`kb lint --fix` on drift now fully re-indexes the doc** (chunks, FTS, embeddings, centroid). Previously it only updated the `contentHash` column, which silently hid the warning while the search index stayed stale.
- **`kb status` reports the effective default wiki** — previously read the global default directly, ignoring `kb.config.json` overrides in cwd. Now reports the same wiki commands actually target, with the source labeled.

### Changed

- **Search granularity**: results are scored at chunk level via Reciprocal Rank Fusion across BM25 (chunk FTS) and cosine similarity (chunk vectors), then capped at 2 chunks per doc to prevent one large doc from dominating.
- **Contentless FTS5** (`content=''`, `contentless_delete=1`) using `chunks.rowid` as the join key — eliminates the side `chunks_fts_rowid` mapping table.
- **`bge-base-en-v1.5`** (768-dim, 512-token) is now the default embedding model, with `gte-base-en-v1.5` (8K-token) available via `kb config set embeddingModel`.
- BM25 weights re-tuned to `(2.0, 2.0, 2.0, 1.0, 1.0)` for `(heading_path, heading, title, tags, content)`.

### Migration

Existing wikis from 0.2.x will automatically migrate on first `kb` invocation — `kb migrate` rebuilds chunks/FTS/vectors from the markdown files (the source of truth). Run with `--dry-run` first to preview. Migration is resumable if interrupted.

Wikis that ran any 0.3.0-dev build (or accumulated dead vec0 shadow chunks for any other reason) should run `kb reindex` once on 0.3.0 to reclaim disk space — the new compacting `dropAll` only kicks in on a full reindex.
