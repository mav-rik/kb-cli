# kb

<p align="center">
  <img src="./logo.svg" alt="kb logo" width="180">
</p>

Local-first wiki CLI for AI agents. Persistent, searchable knowledge bases built from Markdown files with hybrid semantic + keyword search.

Inspired by [Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the LLM incrementally builds and maintains a structured wiki that compounds over time.

## What it does

- Stores knowledge as interlinked Markdown files (source of truth)
- SQLite for metadata indexing, FTS5 for keyword search, sqlite-vec for semantic search
- Local embeddings via all-MiniLM-L6-v2 (no cloud, no API keys, runs on Apple Silicon)
- CLI for agents + HTTP transport for remote KB access
- Multiple isolated wikis per user (work, personal, research, etc.)
- Agent skill system with workflows for ingestion, search, updates, and maintenance

## Install

```bash
pnpm add -g kb-wiki
# or
npm install -g kb-wiki
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
kb serve [--port 4141 --secret <shared-secret>]  Start server for remote access
kb remote add/remove/list/connect        Manage remote KBs
kb remote attach/detach/wikis            Manage remote wiki access
```

## Remote KBs

Connect to remote kb instances (servers running `kb serve`) to access shared team knowledge.

Access control uses a shared secret — both server and client must know the same string. The secret is sent as a Bearer token on every request. This is minimal access control; granular permissions and proper token management are planned for a future release.

```bash
# On the server machine
kb serve --port 4141 --secret my-shared-secret

# On your machine
kb remote add team --url http://server:4141 --secret my-shared-secret
kb remote connect team                     # verify connection
kb remote wikis team                       # list available wikis
kb remote attach team docs                 # attach "docs" wiki locally
kb remote attach team notes --alias tnotes # attach with alias (avoids name conflicts)

# Now use it like any local wiki
kb search "query" --wiki docs
kb add --title "..." --wiki docs --content "..."
kb wiki list                               # shows local + remote wikis

# Disconnect
kb remote detach docs
kb remote remove team                      # unregisters (remote data preserved)
```

Remote wikis are transparent — all commands work the same whether the target wiki is local or remote. Use `--wiki <name>` to target a specific one, or set it as default with `kb wiki use <name>`.

### Managing remote wikis

```bash
kb remote create-wiki team new-wiki        # create wiki on remote
kb remote delete-wiki team old-wiki --force # delete on remote (destructive!)
```

## How it works

```
~/.kb/
├── config.json              global config
├── remotes.json             remote KB registrations
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

MIT — Artem Maltsev
