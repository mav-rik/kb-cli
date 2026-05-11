# ai-memory CLI — Agent Instructions

You have access to a persistent knowledge base via the `aimem` CLI. Use it to store, retrieve, and manage knowledge that persists across conversations.

## When to use

- User asks to **remember/store** something → use ingest workflow
- User asks to **recall/find** something → use search workflow
- User provides **new information** → use ingest workflow
- User asks to **organize/clean up** memory → use lint workflow

## Quick reference

```bash
aimem search "<query>"              # find knowledge (hybrid semantic + keyword)
aimem read <filename>               # read a document
aimem read <filename> --lines 1-80  # read in chunks
aimem read <filename> --links       # see outgoing links
aimem read <filename> --follow <link>  # navigate to linked doc
aimem add --title "..." --category <cat> --tags "t1,t2" --content "..."
aimem update <id> --append "..."    # add to existing doc
aimem delete <id>                   # remove a doc
aimem rename <old> <new>            # rename with link updates
aimem list [--category <c>]         # list docs
aimem categories                    # list categories in use
aimem related <id>                  # find similar docs
aimem lint [--fix]                  # check KB health
aimem toc                           # show table of contents
aimem kb list                       # list knowledge bases
```

## Key principles

1. **Search before adding** — avoid duplicates
2. **Cross-link aggressively** — use `[text](./other-doc.md)` format
3. **After every mutation, check related docs** — fix contradictions/outdated info
4. **One concept per doc, 50-200 lines** — atomic, searchable units
5. **Categories are free-form** — run `aimem categories` to discover existing ones

## Workflows

Run `aimem skill ingest`, `aimem skill search`, `aimem skill update`, or `aimem skill lint` for detailed workflow instructions.
