# Search Workflow — Retrieving Knowledge

Follow these steps when looking up information from the knowledge base.

## Step 1: Search

**CLI:**
```bash
aimem search "<natural language query>"
```

**API:**
```
GET /api/search?q=<query>&limit=10&kb=<name>
```

Returns ranked results: ID, title, category, relevance score, and a snippet.

## Step 2: Read top results

**CLI:**
```bash
aimem read <filename>
aimem read <filename> --lines 1-80     # chunked reading
aimem read <filename> --lines 81-160
```

**API:**
```
GET /api/read/<filename>?kb=<name>
GET /api/read/<filename>?kb=<name>&lines=1-80
GET /api/read/<filename>?kb=<name>&format=json    # structured response
```

## Step 3: Explore related knowledge

**CLI:**
```bash
aimem read <filename> --links          # list outgoing links
aimem read <filename> --follow "./linked-doc.md"
aimem related <id>                     # semantically similar docs
```

**API:**
```
GET /api/read/<filename>?kb=<name>&format=json    # includes links array
GET /api/docs/<id>/related?kb=<name>&limit=10
```

## Step 4: Browse by category

**CLI:**
```bash
aimem categories
aimem list --category <category>
```

**API:**
```
GET /api/categories?kb=<name>
GET /api/docs?kb=<name>&category=<category>
```

## Step 5: Persist valuable answers

If you synthesized a substantial answer by combining information from multiple documents, **save it back** as a new document.

**CLI:**
```bash
aimem add --title "How Auth System Works" --category concepts --tags "auth,architecture" --content "<synthesized answer with links>"
```

**API:**
```
POST /api/docs
body: { "title": "How Auth System Works", "category": "concepts", "tags": ["auth","architecture"], "content": "..." }
```

This only applies when the answer adds value beyond what individual docs already say.

## Tips

- Use natural language for semantic matches ("how does authentication work")
- Use specific keywords for exact matches ("BetterSqlite3Driver")
- `--format json` (CLI) returns machine-parseable results
- Follow links to build complete context before answering
- If search returns nothing useful, try different terms or browse categories
