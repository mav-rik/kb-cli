# kb

<p align="center">
  <img src="./logo.svg" alt="kb logo" width="180">
</p>

Local-first wiki CLI for AI agents. Persistent, searchable knowledge bases built from Markdown files with hybrid semantic + keyword search.

Inspired by [Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the LLM incrementally builds and maintains a structured wiki that compounds over time.

## What it does

- Stores knowledge as interlinked Markdown files (source of truth)
- SQLite for metadata indexing, FTS5 for keyword search, sqlite-vec for semantic search
- Local embeddings via bge-base-en-v1.5 (768 dims, no cloud, no API keys, runs on Apple Silicon); switchable to gte-base-en-v1.5 for 8K-token long context
- Hybrid search combines BM25 + cosine similarity via Reciprocal Rank Fusion
- CLI for agents + HTTP transport for remote KB access
- Multiple isolated wikis per user (work, personal, research, etc.)
- Agent skill system with workflows for ingestion, search, updates, and maintenance

## Install

```bash
npm install -g kb-wiki
```

First run downloads the embedding model (~200 MB for the default `bge-base-en-v1.5`, cached in `~/.kb/.models/`). See [Embedding models](#embedding-models) below if you want to swap to the long-context variant.

### Platforms

Prebuilt binaries exist for all three native dependencies (`better-sqlite3`, `sqlite-vec`, `onnxruntime-node`) on five OS/arch combinations:

| Platform | Status |
|---|---|
| macOS arm64 (Apple Silicon) | confirmed |
| macOS x64 (Intel) | should work, untested |
| Linux x64 | should work, untested |
| Linux arm64 | should work, untested |
| Windows x64 | should work, untested |
| Windows arm64 | not supported (no prebuilds) |

Untested = the architecture is portable and all three native deps publish working prebuilt binaries for the platform, but the project has only been exercised end-to-end on macOS arm64 so far. If you run into a platform-specific issue, please file it on the [issue tracker](https://github.com/mav-rik/kb-cli/issues).

### Installing with pnpm

pnpm refuses to run install scripts of transitive native dependencies (`better-sqlite3`, `onnxruntime-node`) unless you've approved them. Without that step, `kb` will fail at startup with `Could not locate the bindings file`. Two ways to handle it:

```bash
# Recommended: approve native builds once, then install.
pnpm approve-builds -g            # interactive — say yes to better-sqlite3 + onnxruntime-node
pnpm add -g kb-wiki

# If you already installed and hit the bindings error, force a rebuild:
pnpm rebuild -g
```

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
  "wiki": "my-project-wiki"
}
```

Any `kb` command run within this directory (or subdirectories) will use that wiki by default.

### Supported agents

| Agent | What gets installed |
|-------|-------------------|
| Claude Code | `.claude/skills/` + `.claude/commands/` |
| Cursor | `.cursor/rules/kb.mdc` |
| Codex CLI | `AGENTS.md` section |
| Cline | `.clinerules` append |
| Windsurf | `.windsurfrules` append |
| Continue.dev | `.continue/rules/` |

## Commands

```
kb search <query>        Hybrid search (--mode hybrid|fts|vec, --limit, --format json)
kb read <file>           Read document (--lines, --meta, --links, --follow); alias: kb get
kb add                   Add document (--title, --category, --tags, --content/--file/--stdin)
kb update <id>           Update document (--content, --append, --title, --category, --tags)
kb delete <id>           Delete document
kb rename <old> <new>    Rename with automatic link updates
kb list                  List documents (--category, --tag, --format json)
kb categories            List categories in use
kb related <id>          Find semantically similar documents
kb lint [--fix]          Check integrity (broken links, orphans, drift)
kb reindex               Rebuild index from markdown files (run after switching embedding model)
kb toc                   Table of contents
kb schema                Show wiki schema (structure, conventions)
kb schema update         Regenerate schema
kb log                   Recent activity log
kb migrate               Upgrade local schema/embeddings (--dry-run, --yes, --wiki)
kb status                Show local environment status (server, config, wikis)
kb wiki create/list/use/delete/info   Manage wikis
kb config get/set/list   Configuration
kb skill [workflow]      Show agent instructions (ingest/search/update/lint)
kb setup                 Install agent integrations
kb serve [--port 4141 --secret <s> --detached --log <path> --stop]   HTTP API server
kb remote add/remove/list/connect        Manage remote KBs
kb remote attach/detach/wikis            Manage remote wiki access
```

## Speed up: run a local server

Every `kb` invocation that touches the index loads the embedding model into memory (~200 MB for `bge-base-en-v1.5`, ~2-3 seconds on Apple Silicon). Across many commands per session, that adds up.

If you start `kb serve` in the background, every subsequent `kb` command on the same machine **auto-detects the running server and routes through it** — the model stays warm in the server process. Typical search latency drops from ~2-3s to ~50-150ms.

```bash
# Start the server in the background
kb serve --detached

# Optional: capture the server's stdout/stderr to a file
kb serve --detached --log /tmp/kb-server.log

# Inspect what's running and which model the server has loaded
kb status

# When you're done, stop it
kb serve --stop
```

No flags are needed on the routed commands themselves — `kb search`, `kb read`, `kb add`, `kb update`, `kb reindex`, etc. all detect the server transparently. `kb status` shows whether routing is active and surfaces any mismatch between the server's loaded model and the current `config.json` (a restart picks up config changes).

Notes:
- The server binds to `127.0.0.1`; no auth is required by default for purely local use. If you pass `--secret <token>`, every routed call sends it as a Bearer token automatically.
- A coordination file at `~/.kb/.serve.json` records port / pid / model. It's removed cleanly on `kb serve --stop` and on `SIGINT`/`SIGTERM`.
- `kb migrate` refuses to run while the server is up (concurrent schema mutation would be unsafe) — stop the server first.
- Only one local server at a time. A second `kb serve` exits with a clear error pointing at the running one.

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
- **Embeddings** computed locally via ONNX (see [Embedding models](#embedding-models))

## Embedding models

kb-wiki ships with two supported local embedding models. Both produce 768-dim vectors stored in the per-wiki vec0 index.

| Model | Default? | Dims | Context | Strength |
|-------|----------|------|---------|----------|
| `Xenova/bge-base-en-v1.5` | yes | 768 | 512 tokens | Best general-purpose quality for short-to-medium docs (MTEB ~64) |
| `Alibaba-NLP/gte-base-en-v1.5` | no | 768 | 8192 tokens | Same quality tier, much longer context — pick this if your docs are long (1000+ words) |

Both run fully local via ONNX through `@huggingface/transformers`. No API keys, no network after first download.

### Inspecting and switching

```bash
kb config list                                     # see current setting
kb config get embeddingModel                        # current model name
kb config set embeddingModel Alibaba-NLP/gte-base-en-v1.5
```

The setting is **global** (lives in `~/.kb/config.json`), not per-wiki. Only the two model names above are accepted — any other value is rejected on the next embed call.

### After switching

The vector index for each wiki was built with the previous model's embeddings. Vectors from different models live in **different vector spaces** and can't be compared — semantic search will degrade or return nonsense until you re-embed:

```bash
kb reindex --wiki my-wiki     # re-embed one wiki
# repeat for each wiki you want to update
```

`kb reindex` drops the FTS index, the vec0 shadow, and re-walks all markdown files. The first invocation after a switch will trigger a fresh download of the new model (~200 MB → `~/.kb/.models/`).

Both supported models are 768-dim, so the vec0 schema doesn't change and you can switch back and forth at will (just remember to reindex each time). Wikis on different versions before a reindex won't error — they'll just return poor results.

### Why these two?

`bge-base-en-v1.5` is the best small-medium general-purpose embedder available as an ONNX port in the Hugging Face ecosystem — strong on MTEB benchmarks and well-suited to the kind of mixed prose/identifier content most personal wikis contain. `gte-base-en-v1.5` matches it on quality but extends the context window to 8K tokens, which matters if you write long-form docs that exceed the 512-token cap (otherwise content past the cap gets truncated before embedding).

If you want to add another model to the allowlist, see [`src/services/embedding.service.ts`](src/services/embedding.service.ts) — `ALLOWED_EMBEDDING_MODELS` is a single tuple. Adding a model with a different dim count would also require updating the `@db.search.vector` annotation in [`src/models/document.as`](src/models/document.as) and migrating existing wikis.

## Tech stack

- Node.js 22+, TypeScript, ESM
- [moostjs](https://moost.org) CLI + HTTP framework
- [atscript-db](https://db.atscript.dev) with SQLite adapter
- [@huggingface/transformers](https://huggingface.co/docs/transformers.js) for local embeddings
- [sqlite-vec](https://github.com/asg017/sqlite-vec) for vector search
- [rolldown](https://rolldown.rs) bundler

## License

MIT — Artem Maltsev
