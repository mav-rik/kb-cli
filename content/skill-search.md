# Search Workflow — Retrieving Knowledge

Follow these steps when looking up information from the knowledge base.

## Search modes

| Mode | Flag | When to use |
|------|------|-------------|
| **hybrid** (default) | `--mode hybrid` or omit | Best ranking, combines both. Use for most queries. |
| **fts** | `--mode fts` | Exact terms, function names, identifiers. Instant, no model load. |
| **vec** | `--mode vec` | Conceptual/semantic queries ("how does X work", "what handles Y"). |

**Rule of thumb**: If the query contains a specific identifier or exact term → use `fts`. If it's a natural language question → use `vec` or `hybrid`.

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

## Step 3: Explore related knowledge

```bash
kb read <filename> --links          # list outgoing links
kb read <filename> --follow "./linked-doc.md"
kb related <id>                     # semantically similar docs
```

## Step 4: Browse by category

```bash
kb categories
kb list --category <category>
```

## Step 5: Persist valuable answers

If you synthesized a substantial answer by combining information from multiple documents, **save it back** as a new document.

```bash
kb add --title "How Auth System Works" --category concepts --tags "auth,architecture" --content "<synthesized answer with links>"
```

This only applies when the answer adds value beyond what individual docs already say.

## Tips

- Use natural language for semantic matches ("how does authentication work")
- Use specific keywords for exact matches ("BetterSqlite3Driver")
- `--format json` (CLI) returns machine-parseable results
- Follow links to build complete context before answering
- If search returns nothing useful, try different terms or browse categories
