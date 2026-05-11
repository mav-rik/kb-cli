# Search Workflow — Retrieving Knowledge

Follow these steps when looking up information from the knowledge base.

## Step 1: Search

```bash
aimem search "<natural language query>"
```

Returns ranked results: ID, title, category, relevance score, and a snippet.

## Step 2: Read top results

```bash
aimem read <filename>
```

Output includes:
- Header: filename, line count, tags, outgoing links
- Numbered content lines

For large documents, read in chunks:
```bash
aimem read <filename> --lines 1-80
aimem read <filename> --lines 81-160
```

## Step 3: Explore related knowledge

Check outgoing links:
```bash
aimem read <filename> --links
```

Follow a specific link:
```bash
aimem read <filename> --follow "./linked-doc.md"
```

Find semantically related docs:
```bash
aimem related <id>
```

## Step 4: Browse by category

```bash
aimem categories
aimem list --category <category>
```

## Step 5: Persist valuable answers

If you synthesized a substantial answer by combining information from multiple documents, **save it back** as a new document. This enriches the KB for future queries.

```bash
aimem add --title "How Auth System Works" --category concepts --tags "auth,architecture" --content "<your synthesized answer with links to source docs>"
```

This only applies when the answer adds value beyond what individual docs already say (e.g., a synthesis, a summary connecting multiple topics, or a resolved question).

## Tips

- Use natural language for semantic matches ("how does authentication work")
- Use specific keywords for exact matches ("BetterSqlite3Driver")
- `--format json` returns machine-parseable results
- Follow links to build complete context before answering
- If search returns nothing useful, try different terms or browse categories
