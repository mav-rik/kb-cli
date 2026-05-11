---
description: "ai-memory knowledge base integration"
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

## Rules

1. Search before adding to avoid duplicates
2. Cross-link related docs with `[text](./file.md)` links
3. After any change, check related docs for contradictions
4. Keep docs 50-200 lines, one concept per doc
