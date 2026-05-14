---
description: "kb knowledge base integration"
globs: "**/*"
alwaysApply: true
---

# AI Memory (kb)

This project uses `kb` for persistent knowledge management. The CLI is globally installed.

## Usage

Run `kb skill` in the terminal for full instructions. Key commands:

- `kb search "<query>"` — find knowledge (semantic + keyword)
- `kb read <filename>` — read a document
- `kb add --title "..." --category <cat> --tags "..." --content "..."` — store new knowledge
- `kb update <id> --append "..."` — add to existing document
- `kb lint` — check knowledge base health
- `kb log` — view recent activity
- `kb log add --op <type> --details "..."` — record session summary

## Rules

1. Search before adding to avoid duplicates
2. Cross-link related docs with `[text](./file.md)` links
3. After any change, check related docs for contradictions
4. Keep docs ~200-1500 words, one concept per doc; ≥80 words per H2/H3 section; paragraphs under 1500 chars
5. Discuss key takeaways with user before ingesting
6. Resolve contradictions: recency → authority → specificity
7. Log session summaries after ingest/lint
8. Docs are chunked by heading at index time. Sections under ~160 chars or >50% link syntax auto-merge into the previous chunk. `kb lint` flags `chunk-merge`, `long-paragraph`, `doc-too-short`, `doc-too-long`. Frontmatter opt-outs (use deliberately): `important_sections` (preserve named sections), `suppress_merge_warn` (silence per-section warning), `suppress_lint` (silence doc-level soft warnings)
