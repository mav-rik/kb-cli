# Architecture: ai-memory CLI

## Overview

A local-first CLI tool providing persistent, searchable knowledge storage for AI agents.
Markdown files are the **source of truth**; SQLite is a **derived index** (rebuildable from MD files at any time).

## Core Principles

1. **Markdown-first**: All knowledge lives as `.md` files with YAML frontmatter. Human-readable, diffable, git-friendly.
2. **SQLite as index**: FTS5 for keyword search, sqlite-vec for semantic search, relational tables for link graph — all derived from MD.
3. **Local-first**: No cloud dependencies. Embeddings run locally via ONNX on Apple Silicon.
4. **Multi-KB namespacing**: Independent knowledge bases (work, personal, default) — fully isolated.
5. **CLI as virtual filesystem**: Agents access all knowledge exclusively through the CLI — never reading files directly. The CLI provides reading with line ranges, link resolution, and metadata — acting as a structured FS layer purpose-built for AI navigation.
6. **Relative-path links**: Standard Markdown links (`[text](./path.md)`) enable cross-document navigation. Links are resolvable by the CLI and renderable by any MD tool.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     AI Agent (Claude, etc.)              │
│                   guided by ai-memory skill             │
└────────────────────────────┬────────────────────────────┘
                             │ shell commands
                             │ search → read → follow links → read ...
┌────────────────────────────▼────────────────────────────┐
│                      ai-memory CLI                       │
│              (Node.js + moostjs/cli + atscript-db)       │
├─────────────────────────────────────────────────────────┤
│  Commands: read | add | update | search | list | lint   │
│            reindex | status | kb (create/list/delete)   │
├─────────────────────────────────────────────────────────┤
│  read: line ranges, link listing, link following        │
│  search: hybrid semantic + keyword → returns paths      │
│  add/update: write MD + sync index atomically           │
└──────┬──────────────────────────────┬───────────────────┘
       │                              │
┌──────▼──────────┐     ┌────────────▼────────────────────┐
│   MD Files      │     │        SQLite Index             │
│  (source of     │     │  ┌─────────────────────────┐   │
│   truth)        │     │  │ FTS5 (full-text search)  │   │
│                 │     │  ├─────────────────────────┤   │
│  ~/.ai-memory/  │     │  │ sqlite-vec (vectors)    │   │
│    <kb>/docs/   │     │  ├─────────────────────────┤   │
│                 │     │  │ links table (graph)     │   │
│  relative links │     │  ├─────────────────────────┤   │
│  between files  │     │  │ metadata table          │   │
│                 │     │  └─────────────────────────┘   │
└─────────────────┘     └─────────────────────────────────┘
                              derived from MD files
                              (rebuildable via `reindex`)
```

## Directory Layout

```
~/.ai-memory/
├── config.json                    # global settings (default KB, model path, etc.)
├── models/                        # cached embedding model (downloaded on first use)
│   └── all-MiniLM-L6-v2/
├── default/                       # default knowledge base
│   ├── index.db                   # SQLite index (FTS5 + vectors + links)
│   ├── docs/                      # MD files (flat — all in one directory)
│   │   ├── kubernetes.md
│   │   ├── api-redesign.md
│   │   ├── john-smith.md
│   │   └── use-grpc-decision.md
│   └── index.md                   # auto-generated table of contents
├── work/                          # another knowledge base
│   ├── index.db
│   ├── docs/
│   └── index.md
└── personal/
    ├── index.db
    ├── docs/
    └── index.md
```

**Flat file structure**: All documents live directly in `docs/` — no subdirectories. Categories exist only in frontmatter metadata (indexed in SQLite, queryable via `aimem list --category`). This eliminates broken links from file moves and simplifies link resolution to `./filename.md`.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| CLI framework | @moostjs/cli | Decorator-driven, DI, interceptors, pipes |
| DB schema/access | @atscript/db + @atscript/db-sqlite | Type-safe schema as .as files, migration-friendly |
| SQLite driver | better-sqlite3 | Synchronous, fast, native bindings |
| Vector search | sqlite-vec | Zero-dep SQLite extension, float32/int8 vectors |
| Full-text search | FTS5 (built into SQLite) | Proven, fast, porter stemming |
| Embeddings | @huggingface/transformers | ONNX runtime, offline after first download |
| Embedding model | all-MiniLM-L6-v2 | 384-dim, 90MB, ~200 docs/sec on Apple Silicon |
| MD parsing | remark + remark-frontmatter | AST-based, extensible, extracts relative links |
| Runtime | Node.js 22+ | LTS, stable, ESM native |
| Package manager | pnpm | Fast, disk-efficient |

## Data Flow

### Ingest (add/update)

```
Input (text/file)
  → Parse MD (extract frontmatter, body, links)
  → Write/update .md file to disk
  → Compute embedding (all-MiniLM-L6-v2, 384-dim)
  → Upsert into SQLite:
      - metadata table (id, title, category, tags, timestamps, file_path)
      - FTS5 index (full text content)
      - vec0 table (embedding vector)
      - links table (from_id, to_id — parsed from [text](./file.md) links)
```

### Search

```
Query string
  → Compute query embedding
  → Parallel:
      - sqlite-vec KNN search (semantic, top-K)
      - FTS5 search (keyword, top-K)
  → Merge + rank (RRF or weighted score)
  → Return: path, title, snippet, score
```

### Read (virtual filesystem)

```
aimem read <path> [--lines N-M] [--follow <link>] [--links] [--meta]
  → Resolve path within KB docs/ directory
  → If --follow: resolve relative link from source doc's location, redirect to target
  → If --meta: return frontmatter as JSON
  → If --links: query links table for outgoing links from this doc
  → Otherwise: read file, format with line numbers, include header (path, total lines, tags, links)
  → If --lines: slice to requested range
  → Stream to stdout
```

### Lint

```
Scan all MD files in KB (flat docs/ directory)
  → Parse [text](./file.md) links from each file
  → Cross-reference against existing files in docs/
  → Report:
      - Broken links (target file doesn't exist)
      - Orphaned docs (no incoming links from any other doc)
      - Missing frontmatter fields (id, title, category)
      - Duplicate IDs
```

### Reindex

```
Drop SQLite index tables
  → Scan all MD files in KB
  → Re-parse, re-embed, rebuild all index tables
  → Regenerate index.md TOC
```

## Document Format

```markdown
---
id: api-redesign
title: API Redesign Project
category: projects
tags: [api, architecture, q1-2025]
created: 2025-01-15
updated: 2025-03-20
---

# API Redesign Project

We decided to move from REST to gRPC for internal services.
See [Kubernetes](./kubernetes.md) for deployment strategy.

## Key Decisions

- Protocol: gRPC (see [gRPC Evaluation](./grpc-evaluation.md))
- Timeline: Q1 2025
- Related: [Microservices](./microservices.md)
```

Links are standard Markdown relative paths — always `./filename.md` (flat structure, same directory). Works in Obsidian (graph view), VS Code, GitHub, and any MD renderer. Parseable by CLI for graph traversal and link integrity checks.

## Embedding Strategy

- **Model**: all-MiniLM-L6-v2 (384 dimensions, ~90MB)
- **Upgrade path**: nomic-embed-text-v1.5 (768 dims, better quality, 274MB) via config
- **Storage**: float32 in sqlite-vec `vec0` virtual table
- **Chunking**: For docs > 512 tokens, chunk by heading sections. Store per-chunk embedding + doc-level embedding (mean pool).
- **Cache**: Content hash prevents re-embedding unchanged documents
- **First-use download**: Model auto-downloads on first `add` or `reindex` command (~90MB)

## Performance Targets

| Operation | Target | Mechanism |
|-----------|--------|-----------|
| Search (50K docs) | <100ms | sqlite-vec brute KNN + FTS5 |
| Add single doc | <500ms | Embedding + SQLite insert |
| Lint (1K docs) | <2s | In-memory link graph scan |
| Reindex (1K docs) | <60s | Batch embedding + bulk insert |
| CLI cold start | <300ms | Lazy model loading (only for embed ops) |

## Security & Privacy

- All data stays on local filesystem
- No network calls except optional model download on first use
- No telemetry, no cloud sync
- Knowledge bases are just directories — can be git-tracked, encrypted, backed up independently
