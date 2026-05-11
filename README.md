# kb

Local-first wiki CLI for AI agents. Persistent, searchable knowledge bases built from Markdown files with hybrid semantic + keyword search.

Inspired by [Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the LLM incrementally builds and maintains a structured wiki that compounds over time.

## What it does

- Stores knowledge as interlinked Markdown files (source of truth)
- SQLite for metadata indexing, FTS5 for keyword search, sqlite-vec for semantic search
- Local embeddings via all-MiniLM-L6-v2 (no cloud, no API keys, runs on Apple Silicon)
- CLI + HTTP API — usable by any AI agent that can run shell commands or make HTTP calls
- Multiple isolated wikis per user (work, personal, research, etc.)
- Agent skill system with workflows for ingestion, search, updates, and maintenance

## Install

```bash
pnpm add -g kb-cli
# or
npm install -g kb-cli
```

First run downloads the embedding model (~90MB, cached in `~/.kb/.models/`).

## Quick start

```bash
kb wiki create my-wiki       # create a wiki
kb wiki use my-wiki          # set as default

kb add --title "Docker Basics" --category concepts --tags "docker,containers" \
  --content "Docker packages applications into containers..."

kb search "container orchestration"
kb read docker-basics.md
kb related docker-basics
kb lint
```

## Project setup

To bind a wiki to a specific project directory:

```bash
kb setup --agents claude     # install for Claude Code (skill + slash commands)
kb setup --agents cursor     # install for Cursor (.mdc rules)
kb setup --all               # install for all supported agents
```

This creates `kb.config.json` in your project root:

```json
{
  "kb": "my-project-wiki"
}
```

Any `kb` command run within this directory (or subdirectories) will use that wiki by default.

### Supported agents

| Agent | What gets installed |
|-------|-------------------|
| Claude Code | `.claude/skills/` + `.claude/commands/` |
| Cursor | `.cursor/rules/aimem.mdc` |
| Codex CLI | `AGENTS.md` section |
| Cline | `.clinerules` append |
| Windsurf | `.windsurfrules` append |
| Continue.dev | `.continue/rules/` |

## Commands

```
kb search <query>        Hybrid semantic + keyword search
kb read <file>           Read document (--lines, --meta, --links, --follow)
kb add                   Add document (--title, --category, --tags, --content/--file/--stdin)
kb update <id>           Update document (--content, --append, --title, --category, --tags)
kb delete <id>           Delete document
kb rename <old> <new>    Rename with automatic link updates
kb list                  List documents (--category, --tag, --format json)
kb categories            List categories in use
kb related <id>          Find semantically similar documents
kb lint [--fix]          Check integrity (broken links, orphans, drift)
kb reindex               Rebuild index from markdown files
kb toc                   Table of contents
kb schema                Show wiki schema (structure, conventions)
kb schema update         Regenerate schema
kb log                   Recent activity log
kb wiki create/list/use/delete/info   Manage wikis
kb config get/set/list   Configuration
kb skill [workflow]      Show agent instructions (ingest/search/update/lint)
kb setup                 Install agent integrations
kb serve [--port 4141]   Start HTTP API server
```

## HTTP API

```bash
kb serve --port 4141
```

Starts a REST API mirroring all CLI commands. All endpoints under `/api/`.

```
GET  /api/search?q=...&wiki=...&limit=10
GET  /api/read/<filename>?wiki=...&lines=...
POST /api/docs              { title, category, tags[], content }
PUT  /api/docs/<id>         { title?, category?, tags?, content?, append? }
DELETE /api/docs/<id>?wiki=...
GET  /api/docs?wiki=...&category=...
GET  /api/docs/<id>/related?wiki=...
POST /api/docs/<id>/rename  { newId }
GET  /api/wiki              list wikis
POST /api/wiki              { name }
GET  /api/lint?wiki=...
POST /api/reindex?wiki=...
GET  /api/schema?wiki=...
```

**No authentication.** The API is intended for local use — bind to localhost only in production setups. Do not expose to the network without adding your own auth layer.

## How it works

```
~/.kb/
├── config.json              global config
├── .models/                 cached embedding model
├── my-wiki/
│   ├── docs/                markdown files (flat, no subdirs)
│   │   ├── docker-basics.md
│   │   └── kubernetes.md
│   ├── index.db             SQLite (metadata + FTS + vectors + links)
│   └── schema.md            wiki structure & conventions
└── another-wiki/
    ├── docs/
    ├── index.db
    └── schema.md
```

- **Markdown files** are the source of truth — human-readable, git-friendly, Obsidian-compatible
- **SQLite** is a derived index, rebuildable via `kb reindex`
- **Links** use standard Markdown format: `[text](./filename.md)` — works in Obsidian graph view, VS Code, GitHub
- **Categories** are free-form strings in frontmatter (not directories)
- **Embeddings** computed locally via ONNX (all-MiniLM-L6-v2, 384 dimensions)

## Tech stack

- Node.js 22+, TypeScript, ESM
- [moostjs](https://moost.org) CLI + HTTP framework
- [atscript-db](https://db.atscript.dev) with SQLite adapter
- [@huggingface/transformers](https://huggingface.co/docs/transformers.js) for local embeddings
- [sqlite-vec](https://github.com/asg017/sqlite-vec) for vector search
- [rolldown](https://rolldown.rs) bundler

## License

ISC
