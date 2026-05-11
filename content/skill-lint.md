# Lint Workflow — Knowledge Base Maintenance

Use these commands to keep the knowledge base healthy and consistent.

## Running lint

```bash
aimem lint
```

Reports:
- **broken** (error): links pointing to non-existent files
- **orphan** (warning): docs with zero incoming links
- **missing** (error): docs missing required frontmatter (id, title, category)
- **drift** (warning): index out of sync with file content

## Auto-fix

```bash
aimem lint --fix
```

Fixes:
- Broken links: removes the markdown link, keeps the display text
- Drift: re-reads the file and updates the index

Cannot auto-fix: orphans (need manual linking) and missing frontmatter (need manual edit).

## Fixing orphans manually

For each orphan, find docs that should link to it:
```bash
aimem related <orphan-id>
```

Add a link from a related doc:
```bash
aimem update <related-id> --append "\n\nSee also: [Orphan Title](./orphan-id.md)"
```

## Rebuilding the index

If the index gets corrupted or you've edited MD files manually:
```bash
aimem reindex
```

This drops all index data and rebuilds from the MD files on disk (re-computes embeddings).

## Regular maintenance

Run periodically:
```bash
aimem lint              # check health
aimem toc               # review structure
aimem categories        # check category sprawl
```
