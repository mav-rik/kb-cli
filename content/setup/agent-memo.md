## kb — Persistent wiki for AI agents

`kb` is a local CLI for storing and retrieving knowledge across conversations.

**Trigger: when the user asks to ingest info / data / docs into a wiki / kb / knowledge base / memory — run `kb skill ingest` FIRST to load the proper workflow, then follow it.** Do not invent your own ingestion steps.

For other workflows run the matching skill first: `kb skill search` (lookups), `kb skill update` (modifying), `kb skill lint` (maintenance), or `kb skill` for the overview.

- **Run `kb wiki list` first** to see available wikis. The default is marked with `*` and the line below shows where it came from. **Treat the default as what the user wants** — especially when it was pinned by a `kb.config.json` in the project (that's a deliberate choice by the user binding this directory to that wiki). Only switch wikis with `--wiki <name>` when the user explicitly asks about a topic that clearly belongs elsewhere.
- Search before adding (avoid duplicates).
- Cross-link related docs with `[text](./file.md)`.
- After mutations, check related docs for contradictions.
- Use `kb add --dry-run` to preview retrievability warnings before writing.
- If a doc handle doesn't resolve (`kb read`/`kb update` says "not found"), run `kb resolve <arg>` — it returns the canonical id and fuzzy suggestions.
