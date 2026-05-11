# ai-memory — Agent Instructions

You have access to a persistent knowledge base via the `aimem` CLI or HTTP API. Use it to store, retrieve, and manage knowledge that persists across conversations.

## When to use

- User asks to **remember/store** something → use ingest workflow
- User asks to **recall/find** something → use search workflow
- User provides **new information** → use ingest workflow
- User asks to **organize/clean up** memory → use lint workflow

## Quick reference

### CLI

```bash
aimem search "<query>"              # find knowledge (hybrid semantic + keyword)
aimem read <filename>               # read a document (raw markdown)
aimem read <filename> --lines 1-80  # read in chunks
aimem read <filename> --links       # see outgoing links
aimem read <filename> --meta        # frontmatter as JSON
aimem add --title "..." --category <cat> --tags "t1,t2" --content "..."
aimem update <id> --append "..."    # add to existing doc
aimem delete <id>                   # remove a doc
aimem rename <old> <new>            # rename with link updates
aimem list [--category <c>]         # list docs
aimem categories                    # list categories in use
aimem related <id>                  # find similar docs
aimem lint [--fix]                  # check KB health
aimem toc                           # show table of contents
aimem schema                        # show KB schema
aimem schema update                 # regenerate schema
aimem log                           # recent activity
aimem kb list                       # list knowledge bases
aimem kb use <name>                 # set default KB
```

### HTTP API (when server is running via `aimem serve`)

```
GET  /api/search?q=<query>&limit=10&kb=<name>
GET  /api/read/<filename>?kb=<name>&lines=<range>&format=json
POST /api/docs                        body: { title, category, tags[], content, kb? }
PUT  /api/docs/<id>                   body: { title?, category?, tags?, content?, append?, kb? }
DELETE /api/docs/<id>?kb=<name>
GET  /api/docs?kb=<name>&category=<c>&tag=<t>
GET  /api/docs/<id>/related?kb=<name>&limit=10
POST /api/docs/<id>/rename            body: { newId, kb? }
GET  /api/categories?kb=<name>
GET  /api/lint?kb=<name>
POST /api/lint/fix?kb=<name>
POST /api/reindex?kb=<name>
GET  /api/toc?kb=<name>
GET  /api/schema?kb=<name>
POST /api/schema?kb=<name>
GET  /api/log?kb=<name>&limit=20
GET  /api/kb
POST /api/kb                          body: { name }
PUT  /api/kb/use/<name>
DELETE /api/kb/<name>
GET  /api/skill?workflow=<name>
```

## Key principles

1. **Search before adding** — avoid duplicates
2. **Cross-link aggressively** — use `[text](./other-doc.md)` format
3. **After every mutation, check related docs** — fix contradictions/outdated info
4. **One concept per doc, 50-200 lines** — atomic, searchable units
5. **Categories are free-form** — run `aimem categories` to discover existing ones
6. **Update schema after changes** — `aimem schema update`

## Workflows

Run `aimem skill ingest`, `aimem skill search`, `aimem skill update`, or `aimem skill lint` for detailed workflow instructions.
