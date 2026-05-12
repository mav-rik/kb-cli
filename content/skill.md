# kb — Agent Instructions

You have access to a persistent wiki via the `kb` CLI. Use it to store, retrieve, and manage knowledge that persists across conversations.

## When to use

- User asks to **remember/store** something → use ingest workflow
- User asks to **recall/find** something → use search workflow
- User provides **new information** → use ingest workflow
- User asks to **organize/clean up** memory → use lint workflow

## Quick reference

### CLI

```bash
kb search "<query>"              # find knowledge (hybrid semantic + keyword)
kb search "<query>" --mode fts   # keyword only (fast, no model load)
kb search "<query>" --mode vec   # semantic only
kb read <filename>               # read a document (raw markdown)
kb read <filename> --lines 1-80  # read in chunks
kb read <filename> --links       # see outgoing links
kb read <filename> --meta        # frontmatter as JSON
kb add --title "..." --category <cat> --tags "t1,t2" --content "..."
kb update <id> --append "..."    # add to existing doc
kb delete <id>                   # remove a doc
kb rename <old> <new>            # rename with link updates
kb list [--category <c>]         # list docs
kb categories                    # list categories in use
kb related <id>                  # find similar docs
kb lint [--fix]                  # check wiki health
kb toc                           # show table of contents
kb schema                        # show wiki schema
kb schema update                 # regenerate schema
kb log                           # recent activity
kb log add --op <type> --details "..."  # record agent session entry
kb wiki list                     # list wikis
kb wiki use <name>               # set default wiki
```

### Remote wikis

Connect to remote kb servers to use shared team knowledge:

```bash
kb remote add <name> --url <url> [--pat <token>]   # register a remote KB
kb remote connect <name>                            # test connection
kb remote wikis <name>                              # list available wikis
kb remote attach <kb> <wiki> [--alias <local-name>] # attach for local use
kb remote detach <name>                             # detach
kb wiki list                                        # shows both local and remote
```

Once attached, remote wikis work identically to local ones — all commands (search, read, add, update, delete, lint) route transparently via `--wiki <name>`.

## Key principles

1. **Search before adding** — avoid duplicates
2. **Cross-link aggressively** — use `[text](./other-doc.md)` format
3. **After every mutation, check related docs** — fix contradictions/outdated info
4. **One concept per doc, 50-500 lines** — atomic, searchable units
5. **Categories are free-form** — run `kb categories` to discover existing ones
6. **Update schema after changes** — `kb schema update`

## Workflows

Run `kb skill ingest`, `kb skill search`, `kb skill update`, or `kb skill lint` for detailed workflow instructions.
