# Search Workflow — Retrieving Knowledge

The wiki is a **graph**. `kb search` returns **ranked seed docs**, not exact answers — and not an existence check for a specific id. Real understanding comes from reading a seed, following its links, reading those, and continuing until you have enough context. One document is almost never enough.

**Use `kb search` when:** you want the most-relevant docs for a question or topic.
**Use `kb resolve <handle>` when:** you want to know whether a specific doc exists (and what its canonical id/filename is). Search will rank-order even unrelated docs; resolve tells you yes/no with fuzzy suggestions.

## Search modes

| Mode | Flag | When to use |
|------|------|-------------|
| **hybrid** (default) | `--mode hybrid` or omit | The right default when you do not want to think about mode choice. Fuses fts + vec via Reciprocal Rank Fusion. |
| **fts** | `--mode fts` | Best for **exact tokens and identifiers** — function names, error strings, library names, anything you would grep for. Instant, no model load. |
| **vec** | `--mode vec` | Best for **conceptual questions** — "how does X work", "what handles Y", paraphrased queries where exact words may not appear in the docs. |

## Step 1: Search

```bash
kb search "<natural language query>"
kb search "BetterSqlite3Driver" --mode fts     # exact term lookup (fast)
kb search "how to handle errors" --mode vec    # semantic query
```

Returns ranked results: ID, title, category, relevance score, and a snippet.

## Step 2: Read top results

```bash
kb read <filename>
kb read <filename> --lines 1-80     # chunked reading
kb read <filename> --lines 81-160
```

## Step 3: Crawl the link graph

This is the core of retrieval — not an optional step.

From each promising seed page:

```bash
kb read <filename> --links          # what does this page point to?
kb read <filename> --follow "./linked-doc.md"   # jump along a link
kb related <id>                     # semantically nearby docs (may not be linked yet)
```

Follow links that look relevant to the question. Read those pages. Look at *their* links. Repeat. Each hop should add new information.

**Stop when reading further pages stops adding new information.** If you find two pages that *should* be linked but aren't, fix it after answering (`kb update <id> --append "See also: [Other](./other.md)"`).

## Step 4: Browse by category

```bash
kb categories
kb list --category <category>
```

## Step 5: File answers back

If you synthesized a substantial answer by combining information from multiple documents, save it as a new document.

```bash
kb add --title "How Auth System Works" --category concepts --tags "auth,architecture" --content "<synthesized answer with links to the pages you read>"
```

**This is how the wiki compounds.** Your synthesis becomes a new seed for future queries — the next agent doesn't have to re-derive the same conclusion from raw pages. Link to the docs you drew from so the connections stay traceable.

Only applies when the answer adds value beyond what individual docs already say.

## Tips

- Use natural language for semantic matches ("how does authentication work")
- Use specific keywords for exact matches ("BetterSqlite3Driver")
- `--format json` (CLI) returns machine-parseable results
- Follow links to build complete context before answering
- If search returns nothing useful, try different terms or browse categories
